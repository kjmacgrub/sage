"""Import a Schwab transactions CSV into cef.db.

Schwab's export is the authoritative record: it states actual dollars received
and actual share counts, where the app had been inferring both. This backfills
acquired dates, trade history, and real distribution amounts.

Run with --apply to write; default is a dry run.

    .venv/bin/python import_schwab_transactions.py <csv> [--apply]
"""
import argparse
import collections
import csv
import shutil
import sqlite3
import sys
from datetime import datetime, date
from pathlib import Path

DB = Path(__file__).parent / "cef.db"

# Actions that change the share count. Quantities may already be signed
# (BSTZ's reorganized-issue rows come through negative), so add as given.
ACQUIRE = {"Buy", "Stock Merger", "Reorganized Issue", "Journaled Shares",
           "Rights Exercise", "Reinvest Shares", "Pr Yr Div Reinvest",
           "Reorg Adj", "Internal Transfer"}
DISPOSE = {"Sell"}
# A reverse split states the resulting share count, not a delta.
RESET = {"Reverse Split"}

# Money actually received. Cash-in-lieu is fractional-share proceeds from a
# split or merger, not income, so it stays out of the distribution total.
INCOME = {"Cash Dividend", "Non-Qualified Div", "Qualified Dividend",
          "Pr Yr Cash Div", "Special Dividend", "Long Term Cap Gain",
          "Short Term Cap Gain", "Pr Yr Long Term Cap Gain", "Bond Interest"}

TRADE_ACTIONS = ACQUIRE | DISPOSE | RESET


def parse_date(s):
    # Schwab writes "05/19/2026 as of 05/18/2026" for some rows; take the first.
    return datetime.strptime(s.split(" as of ")[0].strip(), "%m/%d/%Y").date()


def parse_money(s):
    s = (s or "").replace("$", "").replace(",", "").strip()
    if not s:
        return None
    return -float(s[1:-1]) if s.startswith("(") else float(s)


def load(path, tickers):
    rows = []
    for r in csv.DictReader(open(path)):
        t = (r.get("Symbol") or "").strip()
        if t not in tickers:
            continue
        rows.append({
            "date": parse_date(r["Date"]),
            "action": r["Action"].strip(),
            "ticker": t,
            "qty": parse_money(r["Quantity"]),
            "price": parse_money(r["Price"]),
            "fees": parse_money(r["Fees & Comm"]),
            "amount": parse_money(r["Amount"]),
        })
    rows.sort(key=lambda r: (r["date"], r["ticker"]))
    return rows


# A fund reorganization or split exchanges your shares for different ones. The
# count can pass through zero between the two legs, but you never stopped owning
# the position, so these must not open or close a holding period. BSTZ's reorg
# legs (-46/+41, -93/+80) would otherwise reset its acquired date by 8 months.
REORG_NEUTRAL = {"Reorganized Issue", "Reorg Adj", "Reverse Split"}


def share_timeline(events):
    """[(date, shares_after)] plus the date the current lot was opened.

    Only a genuine sale down to zero restarts the clock — the acquired date
    should reflect the lot you actually hold, not one you exited years ago.
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
        if d <= when:
            n = s
        else:
            break
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv_path")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    held = {r["ticker"]: dict(r) for r in con.execute(
        "SELECT ticker, shares, cost_basis, dividends_received, acquired_date "
        "FROM holdings WHERE shares > 0")}
    all_tickers = {r["ticker"] for r in con.execute("SELECT ticker FROM funds")}

    rows = load(args.csv_path, all_tickers)
    by_ticker = collections.defaultdict(list)
    for r in rows:
        by_ticker[r["ticker"]].append(r)

    plan = {"acquired": [], "shares": [], "divs": [], "trades": 0, "dist": 0}

    for t in sorted(held):
        events = by_ticker.get(t, [])
        if not events:
            continue
        timeline, opened, computed_shares = share_timeline(events)

        if opened and held[t]["acquired_date"] != opened.isoformat():
            plan["acquired"].append((t, held[t]["acquired_date"], opened.isoformat()))

        if abs(computed_shares - held[t]["shares"]) > 0.01:
            plan["shares"].append((t, held[t]["shares"], computed_shares))

        income = [e for e in events if e["action"] in INCOME and e["amount"]]
        total = round(sum(e["amount"] for e in income), 2)
        if abs(total - (held[t]["dividends_received"] or 0)) > 0.02:
            plan["divs"].append((t, held[t]["dividends_received"] or 0, total, len(income)))

        plan["trades"] += sum(1 for e in events if e["action"] in TRADE_ACTIONS)
        plan["dist"] += len(income)

    # ---- report ----
    print("=" * 78)
    print("ACQUIRED DATES" + (f"  ({len(plan['acquired'])} to set)" if plan["acquired"] else "  (all current)"))
    print("=" * 78)
    for t, old, new in plan["acquired"]:
        held_days = (date.today() - datetime.fromisoformat(new).date()).days
        yrs = held_days / 365.25
        span = f"{yrs:.1f}y" if yrs >= 1 else f"{round(held_days/30.4)}mo"
        print(f"  {t:6s} {str(old or '(none)'):12s} -> {new}   Held becomes {span}")

    if plan["shares"]:
        print("\n" + "=" * 78)
        print("SHARE COUNT CORRECTIONS")
        print("=" * 78)
        for t, old, new in plan["shares"]:
            print(f"  {t:6s} {old:g} -> {new:g}   ({new-old:+g})")

    print("\n" + "=" * 78)
    print("DISTRIBUTIONS RECEIVED (Schwab actuals replace inferred amounts)")
    print("=" * 78)
    d_old = d_new = 0
    for t, old, new, n in plan["divs"]:
        d_old += old; d_new += new
        print(f"  {t:6s} {old:9.2f} -> {new:9.2f}  {new-old:+9.2f}  ({n} payments)")
    print(f"  {'TOTAL':6s} {d_old:9.2f} -> {d_new:9.2f}  {d_new-d_old:+9.2f}")

    print(f"\n  broker_trades to upsert:  {plan['trades']}")
    print(f"  distributions to rewrite: {plan['dist']}")

    if not args.apply:
        print("\nDRY RUN — no changes written. Re-run with --apply.")
        return

    # ---- write ----
    backup = DB.with_name(f"cef.db.bak-preschwab-{datetime.now():%Y%m%d-%H%M%S}")
    shutil.copy2(DB, backup)
    print(f"\nBacked up to {backup.name}")

    for t in sorted(held):
        events = by_ticker.get(t, [])
        if not events:
            continue
        timeline, opened, computed_shares = share_timeline(events)

        for e in events:
            if e["action"] in TRADE_ACTIONS:
                con.execute(
                    """INSERT OR IGNORE INTO broker_trades
                       (date, action, ticker, shares, price, fees, amount)
                       VALUES (?,?,?,?,?,?,?)""",
                    (e["date"].isoformat(), e["action"], t, e["qty"],
                     e["price"], e["fees"], e["amount"]))

        # Schwab's actual cash replaces Yahoo estimates, which were computed as
        # (per-share rate x today's share count) and so were wrong for every
        # period the position was a different size.
        con.execute("DELETE FROM distributions WHERE ticker=?", (t,))
        income = [e for e in events if e["action"] in INCOME and e["amount"]]
        for e in income:
            n = shares_at(timeline, e["date"]) or computed_shares
            con.execute(
                """INSERT OR REPLACE INTO distributions
                   (ticker, ex_date, amount, shares, total, source)
                   VALUES (?,?,?,?,?, 'schwab')""",
                (t, e["date"].isoformat(),
                 round(e["amount"] / n, 6) if n else 0, n, round(e["amount"], 2)))

        total = round(sum(e["amount"] for e in income), 2)
        con.execute(
            """UPDATE holdings
               SET shares=?, dividends_received=?, acquired_date=?,
                   div_tracking_since=?, updated_at=datetime('now')
               WHERE ticker=?""",
            (computed_shares, total,
             opened.isoformat() if opened else held[t]["acquired_date"],
             opened.isoformat() if opened else held[t]["div_tracking_since"]
             if "div_tracking_since" in held[t] else None,
             t))

    con.commit()
    print("Applied.")


if __name__ == "__main__":
    main()
