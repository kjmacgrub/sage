"""Broker transaction imports for the dividend sleeve.

Structured as a normalising core plus one adapter per broker, because this
sleeve may end up at Fidelity and their exports share no vocabulary with
Schwab's. An adapter's only job is to turn a CSV into the normalised event
shape below; everything downstream is broker-agnostic.

    {date, action, ticker, shares, price, fees, amount, qualified}

`action` is normalised to: BUY · SELL · REINVEST · DIVIDEND · OTHER.
"""
from __future__ import annotations

import csv
import io
import re
from datetime import datetime

BUY, SELL, REINVEST, DIVIDEND, OTHER = "BUY", "SELL", "REINVEST", "DIVIDEND", "OTHER"


# ---------------------------------------------------------------- Schwab

SCHWAB_ACTIONS = {
    "Buy": BUY, "Sell": SELL,
    "Reinvest Shares": REINVEST, "Pr Yr Div Reinvest": REINVEST,
    "Cash Dividend": DIVIDEND, "Qualified Dividend": DIVIDEND,
    "Non-Qualified Div": DIVIDEND, "Pr Yr Cash Div": DIVIDEND,
    "Special Dividend": DIVIDEND, "Reinvest Dividend": DIVIDEND,
    "Long Term Cap Gain": DIVIDEND, "Short Term Cap Gain": DIVIDEND,
}
SCHWAB_QUALIFIED = {"Qualified Dividend": 1, "Non-Qualified Div": 0}


def schwab_account(filename: str | None) -> str | None:
    """'Roth_Contributory_IRA_XXX967_Transactions_2026....csv' -> 'Roth Contributory IRA ...967'

    Schwab exports one file per account with no Account column, but names the
    file after it. Returning None means the caller must refuse the import
    rather than guess: silently filing a taxable export under the wrong account
    is very hard to detect and harder to unwind.
    """
    if not filename:
        return None
    m = re.match(r"(.+?)_X+(\w+)_Transactions", filename)
    if not m:
        return None
    return f"{m.group(1).replace('_', ' ').strip()} ...{m.group(2)}"


def _money(s):
    s = (s or "").replace("$", "").replace(",", "").strip()
    if not s:
        return None
    try:
        return -float(s[1:-1]) if s.startswith("(") else float(s)
    except ValueError:
        return None


def _date(s):
    return datetime.strptime(s.split(" as of ")[0].strip(), "%m/%d/%Y").date()


def parse_schwab(text: str):
    lines = text.splitlines()
    start = next((i for i, l in enumerate(lines[:20])
                  if "Date" in l and "Action" in l and "Symbol" in l), 0)
    out = []
    for row in csv.DictReader(io.StringIO("\n".join(lines[start:]))):
        sym = (row.get("Symbol") or "").strip().upper()
        raw = (row.get("Action") or "").strip()
        # Options rows carry a space in Symbol ("SPXW 08/21/2026 7825.00 C")
        if not sym or " " in sym or not sym.isalpha() or len(sym) > 6:
            continue
        if raw not in SCHWAB_ACTIONS:
            continue
        try:
            when = _date(row["Date"])
        except (KeyError, ValueError):
            continue
        out.append({
            "date": when, "action": SCHWAB_ACTIONS[raw], "raw_action": raw,
            "ticker": sym, "shares": _money(row.get("Quantity")),
            "price": _money(row.get("Price")), "fees": _money(row.get("Fees & Comm")),
            "amount": _money(row.get("Amount")),
            "qualified": SCHWAB_QUALIFIED.get(raw),
            "name": (row.get("Description") or "").strip() or None,
        })
    out.sort(key=lambda e: (e["date"], e["ticker"]))
    return out


ADAPTERS = {"schwab": (parse_schwab, schwab_account)}


# ---------------------------------------------------------- normalised apply

def build_plan(conn, events, account):
    """What an import would change. Reads only."""
    have = {r["ticker"]: dict(r) for r in conn.execute(
        "SELECT ticker, shares, cost_basis, initial_cost, dividends_received "
        "FROM holdings WHERE account IS NULL OR account = ?", (account,))}
    seen, plan = {}, {"new": [], "updated": [], "dividends": 0, "trades": 0,
                      "account": account}
    for e in events:
        t = e["ticker"]
        s = seen.setdefault(t, {"shares": 0.0, "cost": 0.0, "divs": 0.0,
                                "first": None, "name": e.get("name")})
        if e["action"] in (BUY, REINVEST):
            s["shares"] += e["shares"] or 0
            s["cost"] += abs(e["amount"] or 0)
            if e["action"] == BUY and s["first"] is None:
                s["first"] = (e["date"], abs(e["amount"] or 0))
            plan["trades"] += 1
        elif e["action"] == SELL:
            s["shares"] -= abs(e["shares"] or 0)
            plan["trades"] += 1
        elif e["action"] == DIVIDEND:
            s["divs"] += e["amount"] or 0
            plan["dividends"] += 1
    for t, s in seen.items():
        row = {"ticker": t, "shares": round(s["shares"], 4),
               "cost_basis": round(s["cost"], 2),
               "dividends_received": round(s["divs"], 2),
               "initial_cost": round(s["first"][1], 2) if s["first"] else None,
               "initial_date": str(s["first"][0]) if s["first"] else None,
               "name": s["name"]}
        (plan["updated"] if t in have else plan["new"]).append(row)
    return plan


def apply_import(conn, events, account):
    """Write the import. initial_cost is set only when absent — never updated."""
    plan = build_plan(conn, events, account)
    counts = {"holdings": 0, "dividends": 0, "trades": 0}

    for e in events:
        cur = conn.execute(
            "INSERT OR IGNORE INTO broker_trades "
            "(account,date,action,ticker,shares,price,fees,amount) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (account, str(e["date"]), e["raw_action"], e["ticker"],
             e["shares"], e["price"], e["fees"], e["amount"]))
        counts["trades"] += cur.rowcount
        if e["action"] == DIVIDEND and e["amount"]:
            cur = conn.execute(
                "INSERT OR IGNORE INTO distributions "
                "(ticker,account,pay_date,amount,shares,total,qualified) "
                "VALUES (?,?,?,?,?,?,?)",
                (e["ticker"], account, str(e["date"]), None, None,
                 e["amount"], e["qualified"]))
            counts["dividends"] += cur.rowcount

    # Per-share amount is derived, not given: Schwab reports the cash total and
    # the share count is only known once this import's trades are written.
    for t in {e["ticker"] for e in events if e["action"] == DIVIDEND}:
        held = 0.0
        trades = list(conn.execute(
            "SELECT date, action, shares FROM broker_trades WHERE ticker=? AND account=? "
            "ORDER BY date", (t, account)))
        divs = list(conn.execute(
            "SELECT id, pay_date, total FROM distributions WHERE ticker=? AND account=? "
            "AND amount IS NULL ORDER BY pay_date", (t, account)))
        i = 0
        for d in divs:
            while i < len(trades) and trades[i]["date"] <= d["pay_date"]:
                q = trades[i]["shares"] or 0
                held += -abs(q) if trades[i]["action"] == "Sell" else q
                i += 1
            if held > 0:
                conn.execute("UPDATE distributions SET amount=?, shares=? WHERE id=?",
                             (round(d["total"] / held, 6), round(held, 4), d["id"]))

    for row in plan["new"] + plan["updated"]:
        conn.execute("""
            INSERT INTO holdings (ticker,name,account,shares,cost_basis,
                                  initial_cost,initial_date,dividends_received)
            VALUES (:ticker,:name,:account,:shares,:cost_basis,
                    :initial_cost,:initial_date,:dividends_received)
            ON CONFLICT(ticker) DO UPDATE SET
              shares=excluded.shares,
              cost_basis=excluded.cost_basis,
              dividends_received=excluded.dividends_received,
              name=COALESCE(holdings.name, excluded.name),
              account=COALESCE(holdings.account, excluded.account),
              initial_cost=COALESCE(holdings.initial_cost, excluded.initial_cost),
              initial_date=COALESCE(holdings.initial_date, excluded.initial_date),
              updated_at=datetime('now')
        """, {**row, "account": account})
        counts["holdings"] += 1
    return counts


def per_share_history(conn, ticker):
    """Annual dividend per share — the company's own raises, with DRIP removed.

    Total received grows both because the dividend rose and because more shares
    are held. Reconstruct the per-share rate from the share count on each date.
    """
    trades = list(conn.execute(
        "SELECT date, action, shares FROM broker_trades "
        "WHERE ticker=? ORDER BY date, id", (ticker,)))
    divs = list(conn.execute(
        "SELECT pay_date, total FROM distributions WHERE ticker=? ORDER BY pay_date",
        (ticker,)))
    out, held, i = {}, 0.0, 0
    for d in divs:
        while i < len(trades) and trades[i]["date"] <= d["pay_date"]:
            a, q = trades[i]["action"], trades[i]["shares"] or 0
            held += -abs(q) if a == "Sell" else q
            i += 1
        if held > 0:
            yr = d["pay_date"][:4]
            out[yr] = round(out.get(yr, 0) + d["total"] / held, 4)
    return out
