"""Schwab transaction CSV -> cef.db.

Schwab's export is the authoritative record of a position: it states actual
dollars received and actual share counts, where the app would otherwise infer
both (a per-share rate from Yahoo times today's share count, which is wrong for
every period the position was a different size).

Both the Import tab and import_schwab_transactions.py call through here, so
there is one implementation and one set of rules.
"""
import collections
import csv
import io
from datetime import datetime

# Actions that change the share count. Quantities may already be signed —
# BSTZ's reorganized-issue rows come through negative — so add as given.
ACQUIRE = {"Buy", "Stock Merger", "Reorganized Issue", "Journaled Shares",
           "Rights Exercise", "Reinvest Shares", "Pr Yr Div Reinvest",
           "Reorg Adj", "Internal Transfer"}
DISPOSE = {"Sell"}
# A reverse split states the resulting share count, not a delta.
RESET = {"Reverse Split"}

# A reorganization or split exchanges your shares for different ones. The count
# can pass through zero between the legs, but you never stopped owning the
# position, so these must not open or close a holding period.
REORG_NEUTRAL = {"Reorganized Issue", "Reorg Adj", "Reverse Split"}

# Money actually received. Cash-in-lieu is fractional-share proceeds from a
# split or merger, not income, so it stays out of the distribution total.
INCOME = {"Cash Dividend", "Non-Qualified Div", "Qualified Dividend",
          "Pr Yr Cash Div", "Special Dividend", "Long Term Cap Gain",
          "Short Term Cap Gain", "Pr Yr Long Term Cap Gain", "Bond Interest"}

TRADE_ACTIONS = ACQUIRE | DISPOSE | RESET


def _parse_date(s):
    # Schwab writes "05/19/2026 as of 05/18/2026" on some rows; take the first.
    return datetime.strptime(s.split(" as of ")[0].strip(), "%m/%d/%Y").date()


def _parse_money(s):
    s = (s or "").replace("$", "").replace(",", "").strip()
    if not s:
        return None
    try:
        return -float(s[1:-1]) if s.startswith("(") else float(s)
    except ValueError:
        return None


def parse_csv(text):
    """Fund transactions from a Schwab export, oldest first.

    Options rows are skipped: their Symbol carries a space ("SPXW 08/21/2026
    7825.00 C") and never looks like a plain ticker.
    """
    lines = text.splitlines()
    start = 0
    for i, line in enumerate(lines[:20]):
        if "Date" in line and "Action" in line and "Symbol" in line:
            start = i
            break

    events = []
    for row in csv.DictReader(io.StringIO("\n".join(lines[start:]))):
        symbol = (row.get("Symbol") or "").strip().upper()
        action = (row.get("Action") or "").strip()
        if not symbol or " " in symbol or not symbol.isalpha() or len(symbol) > 6:
            continue
        if action not in TRADE_ACTIONS and action not in INCOME:
            continue
        try:
            when = _parse_date(row["Date"])
        except (KeyError, ValueError):
            continue
        events.append({
            "date": when,
            "action": action,
            "ticker": symbol,
            "qty": _parse_money(row.get("Quantity")),
            "price": _parse_money(row.get("Price")),
            "fees": _parse_money(row.get("Fees & Comm")),
            "amount": _parse_money(row.get("Amount")),
        })
    events.sort(key=lambda e: (e["date"], e["ticker"]))
    return events


def share_timeline(events):
    """[(date, shares_after)], the date the current lot opened, final count.

    Only a genuine sale down to zero restarts the clock, so the acquired date
    reflects the lot actually held rather than one exited years ago.
    """
    shares = 0.0
    opened = None
    timeline = []
    for e in events:
        neutral = e["action"] in REORG_NEUTRAL
        if e["action"] in RESET:
            if e["qty"]:
                shares = abs(e["qty"])
        elif e["action"] in ACQUIRE and e["qty"]:
            if shares <= 1e-6 and e["qty"] > 0 and not neutral:
                opened = e["date"]
            shares += e["qty"]
        elif e["action"] in DISPOSE and e["qty"]:
            shares -= abs(e["qty"])
            if shares <= 1e-6:
                opened = None
        timeline.append((e["date"], shares))
    return timeline, opened, shares


def shares_at(timeline, when):
    """Share count in force on a date (last event on or before it)."""
    n = 0.0
    for d, s in timeline:
        if d > when:
            break
        n = s
    return n


def merge_income(events):
    """Income summed per date.

    distributions is UNIQUE(ticker, ex_date), so several payments landing on one
    date must become a single row — a regular dividend alongside a special or a
    year-end capital gain is common. Inserting them separately means each
    overwrites the last and the money silently disappears.
    """
    merged = collections.OrderedDict()
    for e in events:
        if e["action"] in INCOME and e["amount"]:
            merged.setdefault(e["date"], []).append(e["amount"])
    return [(d, round(sum(v), 2), len(v)) for d, v in merged.items()]


def build_plan(conn, events):
    """What the import would change, without changing it."""
    by_ticker = collections.defaultdict(list)
    for e in events:
        by_ticker[e["ticker"]].append(e)

    held = {r["ticker"]: dict(r) for r in conn.execute(
        "SELECT ticker, shares, dividends_received, acquired_date FROM holdings")}
    known = {r["ticker"] for r in conn.execute("SELECT ticker FROM funds")}

    plan = {"acquired": [], "shares": [], "divs": [], "new_tickers": [],
            "trades": 0, "distributions": 0, "merged_dates": 0,
            "tickers": len(by_ticker), "date_range": {}}

    dates = [e["date"] for e in events]
    if dates:
        plan["date_range"] = {"min": min(dates).isoformat(), "max": max(dates).isoformat()}
    coverage_start = min(dates).isoformat() if dates else "0000-00-00"

    for t, evs in sorted(by_ticker.items()):
        if t not in known:
            plan["new_tickers"].append(t)
            continue
        timeline, opened, final = share_timeline(evs)
        income = merge_income(evs)

        # Mirror what apply_import will do: rows on the export's own dates get
        # replaced, nearby Yahoo estimates are dropped as duplicates, and
        # everything else is left alone and still counts toward the total.
        existing = conn.execute(
            "SELECT ex_date, total, source FROM distributions WHERE ticker=?", (t,)).fetchall()
        export_dates = [d for d, _, _ in income]
        kept = 0.0
        for r in existing:
            iso = r["ex_date"]
            if iso in {d.isoformat() for d in export_dates}:
                continue                                   # replaced
            if r["source"] == "yahoo" and any(
                    abs((datetime.fromisoformat(iso).date() - d).days) <= 15 for d in export_dates):
                continue                                   # superseded estimate
            kept += r["total"] or 0
        total = round(kept + sum(a for _, a, _ in income), 2)

        plan["trades"] += sum(1 for e in evs if e["action"] in TRADE_ACTIONS)
        plan["distributions"] += len(income)
        plan["merged_dates"] += sum(1 for _, _, n in income if n > 1)

        cur = held.get(t)
        if cur and cur["shares"] > 0:
            if opened and cur["acquired_date"] != opened.isoformat():
                plan["acquired"].append({"ticker": t, "from": cur["acquired_date"],
                                         "to": opened.isoformat()})
            if abs(final - cur["shares"]) > 0.01:
                plan["shares"].append({"ticker": t, "from": cur["shares"], "to": final})
        if not cur or abs(total - (cur["dividends_received"] or 0)) > 0.02:
            plan["divs"].append({"ticker": t, "from": (cur or {}).get("dividends_received") or 0,
                                 "to": total, "payments": len(income)})
    return plan


def apply_import(conn, events):
    """Write the import. Caller owns the transaction."""
    by_ticker = collections.defaultdict(list)
    for e in events:
        by_ticker[e["ticker"]].append(e)

    # An export is authoritative only for the dates it actually reports. It is
    # not proof that nothing else happened: this account's pre-transfer TDA
    # history isn't in a Schwab export, and clearing a whole date range would
    # silently erase it (PSLDX loses $222, PTY $283). So replace the dates the
    # export names, drop Yahoo estimates those supersede, and leave the rest.
    pass

    known = {r["ticker"] for r in conn.execute("SELECT ticker FROM funds")}
    held_shares = {r["ticker"]: r["shares"] for r in conn.execute(
        "SELECT ticker, shares FROM holdings")}
    counts = {"trades": 0, "distributions": 0, "holdings": 0, "skipped_tickers": 0}

    for t, evs in by_ticker.items():
        # Only touch tickers already tracked. A brokerage export contains
        # everything traded in the account -- TSLA, GLD, UVXY -- and silently
        # filing those as inactive CEFs pollutes the fund list. Unknown tickers
        # are reported in the plan instead, so genuine funds can be added
        # deliberately via + Add Fund and picked up on the next import.
        if t not in known:
            counts["skipped_tickers"] += 1
            continue
        conn.execute(
            "INSERT OR IGNORE INTO holdings (ticker, shares, cost_basis, dividends_received) "
            "VALUES (?, 0, 0, 0)", (t,))

        timeline, opened, final = share_timeline(evs)

        for e in evs:
            if e["action"] in TRADE_ACTIONS:
                cur = conn.total_changes
                conn.execute(
                    """INSERT OR IGNORE INTO broker_trades
                       (date, action, ticker, shares, price, fees, amount)
                       VALUES (?,?,?,?,?,?,?)""",
                    (e["date"].isoformat(), e["action"], t, e["qty"],
                     e["price"], e["fees"], e["amount"]))
                counts["trades"] += conn.total_changes - cur

        income = merge_income(evs)
        for when, total, _ in income:
            n = shares_at(timeline, when) or final
            conn.execute(
                """INSERT OR REPLACE INTO distributions
                   (ticker, ex_date, amount, shares, total, source)
                   VALUES (?,?,?,?,?, 'schwab')""",
                (t, when.isoformat(), round(total / n, 6) if n else 0, n, total))
            counts["distributions"] += 1

        # A Yahoo estimate sitting a few days from a real payment is the same
        # payment with a made-up amount; the ex-date and the pay date differ.
        for when, _, _ in income:
            conn.execute(
                """DELETE FROM distributions
                   WHERE ticker=? AND source='yahoo'
                     AND ABS(julianday(ex_date) - julianday(?)) <= 15""",
                (t, when.isoformat()))

        # Sum the table, not just the export, so preserved older rows still count.
        divs_total = round(conn.execute(
            "SELECT COALESCE(SUM(total),0) FROM distributions WHERE ticker=?",
            (t,)).fetchone()[0], 2)
        # Only touch shares and the acquired date for positions still open;
        # a ticker that appears solely as history keeps its zeroed holding row.
        if held_shares.get(t, 0) > 0 or final > 0:
            conn.execute(
                """UPDATE holdings SET shares=?, dividends_received=?,
                       acquired_date=COALESCE(?, acquired_date),
                       div_tracking_since=COALESCE(?, div_tracking_since),
                       updated_at=datetime('now')
                   WHERE ticker=?""",
                (final, divs_total,
                 opened.isoformat() if opened else None,
                 opened.isoformat() if opened else None, t))
        else:
            conn.execute(
                "UPDATE holdings SET dividends_received=?, updated_at=datetime('now') "
                "WHERE ticker=?", (divs_total, t))
        counts["holdings"] += 1

    conn.execute("UPDATE funds SET active=1 WHERE ticker IN "
                 "(SELECT ticker FROM holdings WHERE shares>0)")
    return counts
