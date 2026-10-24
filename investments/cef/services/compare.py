"""Live vs backtest for the options sleeve.

Three sources, one table each, compared by trading day:

* **backtest** — Option Omega's trade-log export (one row per leg group; a condor
  is three rows) and its portfolio CSV (daily net liquidity).
* **live** — the autotrader's strategy trade log (same row shape as the OO log,
  with an Account column and `Initial Premium`).
* **schwab** — the brokerage transaction export, options rows only. No strategy
  names, so it is compared by underlying and by cash: it is the number that
  actually hit the account.

Uploads replace by date range per source — the newest file for a day wins, and
re-uploading an overlapping week never duplicates. Strategy names are mapped to
the book (`Condor` / `Hedge` / `Leap`); anything else is carried as itself and
shown under Other. See docs/decisions.md 2026-10-24 for why these three.
"""
import csv
import io
import re
from collections import defaultdict
from datetime import datetime

# The live condor has run under three autotrader names; OO's saved strategy was
# renamed too. One canonical name per book strategy, everything else kept raw.
CANON = {
    "IC": "Condor", "CIC - 10am": "Condor", "CIC - AM": "Condor",
    "Long Put Hedge": "Hedge",
    "QQQ Leap''": "Leap", "QQQ Leap": "Leap", "QQQ 360": "Leap",
}
BOOK = ["Condor", "Hedge", "Leap"]

LEG_RE = re.compile(
    r"(\d+)\s+([A-Z][a-z]{2})\s+(\d{1,2})\s+([\d.]+)\s+([PC])\s+(BTO|STO)\s+([\d.]+)")
OPT_SYMBOL_RE = re.compile(
    r"^([A-Z.]+)\s+(\d{2}/\d{2}/\d{4})\s+([\d.]+)\s+([PC])$")
MONTHS = {m: i for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}


# ---------------------------------------------------------------- helpers

def _num(s):
    s = (s or "").strip().replace("$", "").replace(",", "")
    if not s:
        return None
    neg = s.startswith("(") and s.endswith(")")
    if neg:
        s = s[1:-1]
    try:
        v = float(s)
    except ValueError:
        return None
    return -v if neg else v


def _iso(s):
    """'2026-10-23' or '10/23/2026' (with Schwab's ' as of ' suffix) -> ISO."""
    s = (s or "").strip()
    if not s:
        return None
    s = s.split(" as of ")[0].strip()
    for fmt in ("%Y-%m-%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            pass
    return None


def _hms(s):
    s = (s or "").strip()
    return s[:8] if s else None


def canon(name):
    name = (name or "").strip()
    return CANON.get(name, name or "Unknown")


def parse_legs(legs, date_opened):
    """-> list of {qty, expiry, strike, right, action, price}.

    The leg string carries month and day but no year; take the first such date
    on or after the open date (a December open with a January expiry rolls).
    """
    out = []
    y = int(date_opened[:4]) if date_opened else None
    for m in LEG_RE.finditer(legs or ""):
        qty, mon, day, strike, right, action, price = m.groups()
        exp = None
        if y and mon in MONTHS:
            try:
                exp = datetime(y, MONTHS[mon], int(day)).date()
                if exp.isoformat() < date_opened:
                    exp = datetime(y + 1, MONTHS[mon], int(day)).date()
                exp = exp.isoformat()
            except ValueError:
                exp = None
        out.append({"qty": int(qty), "expiry": exp, "strike": float(strike),
                    "right": right, "action": action, "price": float(price)})
    return out


def _closing_cost(raw):
    """Per-share debit paid to close, positive.

    The autotrader writes '-8.9' (per share, negative = paid). OO's trade log
    writes '725' for 7.25 — an integer in cents. An integer at or above 100 is
    taken as cents; anything with a decimal point is per share as written.
    """
    s = (raw or "").strip()
    v = _num(s)
    if v is None:
        return 0.0
    v = abs(v)
    if "." not in s and v >= 100:
        v = v / 100.0
    return round(v, 4)


def _row_kind(legs):
    sto = [l for l in legs if l["action"] == "STO"]
    bto = [l for l in legs if l["action"] == "BTO"]
    if sto and not bto:
        return "put" if sto[0]["right"] == "P" else "call"
    if bto and not sto:
        return "wings" if len(bto) > 1 else "long"
    return "combo"


# ---------------------------------------------------------------- detection

def detect_kind(text):
    head = "\n".join(text.lstrip("﻿").splitlines()[:3])
    if "Net Liquidity" in head:
        return "portfolio"
    if "Fees & Comm" in head and "Symbol" in head:
        return "schwab"
    if "Account" in head and "Initial Premium" in head:
        return "live"
    if "Funds at Close" in head or "Margin Req." in head:
        return "backtest"
    raise ValueError("Not an Option Omega trade log, portfolio CSV, autotrader "
                     "strategy log or Schwab transaction export.")


def _reader(text):
    return csv.DictReader(io.StringIO(text.lstrip("﻿")))


# ---------------------------------------------------------------- parsers

def parse_trades(text, source):
    """OO trade log (source='backtest') or autotrader log (source='live') -> rows."""
    rows = []
    for r in _reader(text):
        date_opened = _iso(r.get("Date Opened"))
        if not date_opened:
            continue
        legs_s = (r.get("Legs") or "").strip()
        legs = parse_legs(legs_s, date_opened)
        premium = round(sum(l["price"] for l in legs if l["action"] == "STO")
                        - sum(l["price"] for l in legs if l["action"] == "BTO"), 4)
        sto = [l for l in legs if l["action"] == "STO"]
        reason = (r.get("Reason For Close") or "").strip()
        contracts = _num(r.get("No. of Contracts"))
        if contracts is None and legs:
            contracts = legs[0]["qty"]
        raw_name = (r.get("Strategy") or "").strip()
        rows.append({
            "source": source,
            "strategy_raw": raw_name,
            "strategy": canon(raw_name),
            "date_opened": date_opened,
            "time_opened": _hms(r.get("Time Opened")),
            "opening_price": _num(r.get("Opening Price")),
            "legs": legs_s,
            "row_kind": _row_kind(legs),
            "premium": premium,
            "short_strike": sto[0]["strike"] if len(sto) == 1 else None,
            "short_right": sto[0]["right"] if len(sto) == 1 else None,
            "contracts": int(contracts or 0),
            "pl": _num(r.get("P/L")) or 0.0,
            "closing_price": _num(r.get("Closing Price")),
            "date_closed": _iso(r.get("Date Closed")),
            "time_closed": _hms(r.get("Time Closed")),
            "closing_cost": _closing_cost(r.get("Avg. Closing Cost")),
            "reason": reason,
            "is_manual": 1 if "manual" in reason.lower() else 0,
            "is_stop": 1 if "stop" in reason.lower() else 0,
            "funds_at_close": _num(r.get("Funds at Close")),
            "margin_req": _num(r.get("Margin Req.")),
            "account": (r.get("Account") or "").strip() or None,
        })
    return rows


def parse_portfolio(text):
    rows = []
    for r in _reader(text):
        d = _iso(r.get("Date"))
        if not d:
            continue
        rows.append({"source": "backtest", "date": d,
                     "net_liq": _num(r.get("Net Liquidity")),
                     "day_pl": _num(r.get("P/L")),
                     "dd_pct": _num(r.get("Drawdown %"))})
    return rows


def parse_schwab_options(text):
    """Option rows only. Expired rows carry no cash and are dated to the expiry."""
    lines = text.lstrip("﻿").splitlines()
    start = 0
    for i, line in enumerate(lines[:20]):
        if "Date" in line and "Action" in line and "Symbol" in line:
            start = i
            break
    rows = []
    for r in csv.DictReader(io.StringIO("\n".join(lines[start:]))):
        sym = (r.get("Symbol") or "").strip().upper()
        m = OPT_SYMBOL_RE.match(sym)
        if not m:
            continue
        root, exp, strike, right = m.groups()
        raw_date = (r.get("Date") or "").strip()
        action = (r.get("Action") or "").strip()
        # 'as of' is the settlement-style date Schwab stamps on expirations;
        # the trading day the position actually ended is the 'as of' one.
        if " as of " in raw_date:
            d = _iso(raw_date.split(" as of ")[1])
        else:
            d = _iso(raw_date)
        if not d:
            continue
        underlying = "SPX" if root in ("SPX", "SPXW") else root
        rows.append({
            "date": d, "action": action, "symbol": sym, "underlying": underlying,
            "expiry": _iso(exp), "strike": float(strike), "right": right,
            "qty": _num(r.get("Quantity")), "price": _num(r.get("Price")),
            "fees": _num(r.get("Fees & Comm")) or 0.0,
            "amount": _num(r.get("Amount")) or 0.0,
        })
    return rows


# ---------------------------------------------------------------- storage

def store_upload(conn, text, filename):
    kind = detect_kind(text)
    if kind in ("backtest", "live"):
        rows = parse_trades(text, kind)
        if not rows:
            raise ValueError("No trades found in that file.")
        dates = [r["date_opened"] for r in rows]
        lo, hi = min(dates), max(dates)
        up = _log_upload(conn, kind, filename, len(rows), lo, hi)
        cur = conn.execute(
            "DELETE FROM oo_trades WHERE source=? AND date_opened BETWEEN ? AND ?",
            (kind, lo, hi))
        replaced = cur.rowcount
        conn.executemany("""
            INSERT INTO oo_trades (upload_id, source, strategy_raw, strategy,
                date_opened, time_opened, opening_price, legs, row_kind, premium,
                short_strike, short_right, contracts, pl, closing_price,
                date_closed, time_closed, closing_cost, reason, is_manual,
                is_stop, funds_at_close, margin_req, account)
            VALUES (:upload_id, :source, :strategy_raw, :strategy, :date_opened,
                :time_opened, :opening_price, :legs, :row_kind, :premium,
                :short_strike, :short_right, :contracts, :pl, :closing_price,
                :date_closed, :time_closed, :closing_cost, :reason, :is_manual,
                :is_stop, :funds_at_close, :margin_req, :account)""",
            [{**r, "upload_id": up} for r in rows])
    elif kind == "portfolio":
        rows = parse_portfolio(text)
        if not rows:
            raise ValueError("No daily rows found in that portfolio CSV.")
        dates = [r["date"] for r in rows]
        lo, hi = min(dates), max(dates)
        up = _log_upload(conn, kind, filename, len(rows), lo, hi)
        cur = conn.execute(
            "DELETE FROM oo_equity WHERE source='backtest' AND date BETWEEN ? AND ?",
            (lo, hi))
        replaced = cur.rowcount
        conn.executemany("""
            INSERT INTO oo_equity (upload_id, source, date, net_liq, day_pl, dd_pct)
            VALUES (:upload_id, :source, :date, :net_liq, :day_pl, :dd_pct)""",
            [{**r, "upload_id": up} for r in rows])
    else:
        rows = parse_schwab_options(text)
        if not rows:
            raise ValueError("No option transactions found in that Schwab export.")
        dates = [r["date"] for r in rows]
        lo, hi = min(dates), max(dates)
        up = _log_upload(conn, kind, filename, len(rows), lo, hi)
        cur = conn.execute(
            "DELETE FROM schwab_options WHERE date BETWEEN ? AND ?", (lo, hi))
        replaced = cur.rowcount
        conn.executemany("""
            INSERT INTO schwab_options (upload_id, date, action, symbol, underlying,
                expiry, strike, right, qty, price, fees, amount)
            VALUES (:upload_id, :date, :action, :symbol, :underlying, :expiry,
                :strike, :right, :qty, :price, :fees, :amount)""",
            [{**r, "upload_id": up} for r in rows])
    return {"kind": kind, "rows": len(rows), "min_date": lo, "max_date": hi,
            "replaced": replaced, "upload_id": up}


def _log_upload(conn, kind, filename, rows, lo, hi):
    cur = conn.execute(
        "INSERT INTO compare_uploads (kind, filename, rows, min_date, max_date) "
        "VALUES (?,?,?,?,?)", (kind, filename, rows, lo, hi))
    return cur.lastrowid


def list_uploads(conn):
    return [dict(r) for r in conn.execute(
        "SELECT * FROM compare_uploads ORDER BY uploaded_at DESC, id DESC LIMIT 60")]


def delete_upload(conn, upload_id):
    n = 0
    for t in ("oo_trades", "oo_equity", "schwab_options"):
        n += conn.execute(f"DELETE FROM {t} WHERE upload_id=?", (upload_id,)).rowcount
    conn.execute("DELETE FROM compare_uploads WHERE id=?", (upload_id,))
    return n


def coverage(conn):
    """Distinct dates per source, for the range picker."""
    out = {}
    for src in ("live", "backtest"):
        out[src] = [r[0] for r in conn.execute(
            "SELECT DISTINCT date_opened FROM oo_trades WHERE source=? ORDER BY 1", (src,))]
    out["portfolio"] = [r[0] for r in conn.execute(
        "SELECT DISTINCT date FROM oo_equity ORDER BY 1")]
    out["schwab"] = [r[0] for r in conn.execute(
        "SELECT DISTINCT date FROM schwab_options ORDER BY 1")]
    return out


# ---------------------------------------------------------------- comparison

def _group_trades(rows):
    """OO rows -> trades keyed on (source, strategy_raw, date, time)."""
    groups = defaultdict(list)
    for r in rows:
        groups[(r["source"], r["strategy_raw"], r["date_opened"], r["time_opened"])].append(r)
    trades = []
    for (source, raw, d, t), rs in groups.items():
        sides = []
        for r in sorted(rs, key=lambda x: (x["row_kind"], x["time_closed"] or "")):
            over = None
            if r["is_stop"] and r["premium"] and r["premium"] > 0 and r["closing_cost"]:
                over = round(r["closing_cost"] - 3 * r["premium"], 2)
            sides.append({
                "kind": r["row_kind"], "strike": r["short_strike"],
                "right": r["short_right"], "credit": r["premium"],
                "reason": r["reason"], "time_closed": r["time_closed"],
                "closing_cost": r["closing_cost"], "pl": round(r["pl"], 2),
                "is_manual": bool(r["is_manual"]), "is_stop": bool(r["is_stop"]),
                "overshoot": over,
            })
        short_put = next((s["strike"] for s in sides if s["kind"] == "put"), None)
        short_call = next((s["strike"] for s in sides if s["kind"] == "call"), None)
        trades.append({
            "source": source, "strategy_raw": raw, "strategy": canon(raw),
            "date": d, "time": t,
            "contracts": max(r["contracts"] for r in rs),
            "opening_price": rs[0]["opening_price"],
            "legs": " | ".join(r["legs"] for r in rs if r["legs"]),
            "credit": round(sum(r["premium"] for r in rs), 2),
            "short_put": short_put, "short_call": short_call,
            "pl": round(sum(r["pl"] for r in rs), 2),
            "is_manual": any(r["is_manual"] for r in rs),
            "is_stop": any(r["is_stop"] for r in rs),
            "sides": sides,
        })
    trades.sort(key=lambda x: (x["date"], x["strategy"], x["time"] or ""))
    return trades


def default_range(conn, days=5):
    dates = sorted({r[0] for r in conn.execute(
        "SELECT DISTINCT date_opened FROM oo_trades")} | {r[0] for r in conn.execute(
        "SELECT DISTINCT date FROM schwab_options")})
    if not dates:
        return None, None
    return dates[-days] if len(dates) >= days else dates[0], dates[-1]


def summary(conn, start, end, exclude_manual=False):
    rows = [dict(r) for r in conn.execute(
        "SELECT * FROM oo_trades WHERE date_opened BETWEEN ? AND ? "
        "ORDER BY date_opened, time_opened", (start, end))]
    trades = _group_trades(rows)
    equity = {r["date"]: dict(r) for r in conn.execute(
        "SELECT * FROM oo_equity WHERE source='backtest' AND date BETWEEN ? AND ?",
        (start, end))}
    schwab = [dict(r) for r in conn.execute(
        "SELECT * FROM schwab_options WHERE date BETWEEN ? AND ? ORDER BY date",
        (start, end))]

    # Pair live and backtest trades by (strategy, date), in time order within
    # a day. A manual live exit excludes the PAIR when asked, so the totals stay
    # like-for-like rather than dropping one side only.
    by_key = defaultdict(lambda: {"live": [], "backtest": []})
    for t in trades:
        by_key[(t["date"], t["strategy"])][t["source"]].append(t)
    pairs = []
    for (d, strat), both in sorted(by_key.items()):
        n = max(len(both["live"]), len(both["backtest"]))
        for i in range(n):
            lv = both["live"][i] if i < len(both["live"]) else None
            bt = both["backtest"][i] if i < len(both["backtest"]) else None
            flags = []
            if lv and lv["is_manual"]:
                flags.append("manual exit")
            if lv and bt:
                if lv["short_put"] != bt["short_put"] or lv["short_call"] != bt["short_call"]:
                    flags.append("strikes differ")
                if lv["contracts"] != bt["contracts"]:
                    flags.append(f"{lv['contracts']} vs {bt['contracts']} contracts")
                lr = {s["kind"]: s["reason"] for s in lv["sides"]}
                br = {s["kind"]: s["reason"] for s in bt["sides"]}
                for k in ("put", "call", "combo", "long"):
                    if k in lr and k in br and (lr[k] == "Expired") != (br[k] == "Expired"):
                        flags.append(f"{k}: live {lr[k]}, test {br[k]}")
            elif lv and not bt:
                flags.append("no backtest trade")
            elif bt and not lv:
                flags.append("no live trade")
            excluded = bool(exclude_manual and lv and lv["is_manual"])
            pairs.append({"date": d, "strategy": strat, "live": lv, "backtest": bt,
                          "flags": flags, "excluded": excluded,
                          "diff": (round(lv["pl"] - bt["pl"], 2) if lv and bt else None)})

    # Daily table. Strategies outside the book are lumped as Other.
    cols = BOOK + ["Other"]
    days = {}
    def day(d):
        if d not in days:
            days[d] = {"date": d,
                       "live": {c: 0.0 for c in cols}, "backtest": {c: 0.0 for c in cols},
                       "live_total": 0.0, "backtest_total": 0.0,
                       "schwab": {}, "schwab_total": 0.0, "schwab_fees": 0.0,
                       "has": {"live": False, "backtest": False, "schwab": False},
                       "net_liq": None, "bt_day_pl": None, "dd_pct": None}
        return days[d]
    for p in pairs:
        if p["excluded"]:
            continue
        c = p["strategy"] if p["strategy"] in BOOK else "Other"
        for src in ("live", "backtest"):
            t = p[src]
            if t:
                dd = day(p["date"])
                dd[src][c] = round(dd[src][c] + t["pl"], 2)
                dd[src + "_total"] = round(dd[src + "_total"] + t["pl"], 2)
                dd["has"][src] = True
    for t in trades:  # presence even when excluded
        day(t["date"])["has"][t["source"]] = True
    for s in schwab:
        dd = day(s["date"])
        dd["schwab"][s["underlying"]] = round(dd["schwab"].get(s["underlying"], 0.0) + s["amount"], 2)
        dd["schwab_total"] = round(dd["schwab_total"] + s["amount"], 2)
        dd["schwab_fees"] = round(dd["schwab_fees"] + (s["fees"] or 0.0), 2)
        dd["has"]["schwab"] = True
    for d, e in equity.items():
        dd = day(d)
        dd["net_liq"], dd["bt_day_pl"], dd["dd_pct"] = e["net_liq"], e["day_pl"], e["dd_pct"]
    day_list = [days[d] for d in sorted(days)]

    cum = {"live": 0.0, "backtest": 0.0, "schwab": 0.0}
    for dd in day_list:
        cum["live"] += dd["live_total"]
        cum["backtest"] += dd["backtest_total"]
        cum["schwab"] += dd["schwab_total"]
        dd["cum"] = {k: round(v, 2) for k, v in cum.items()}

    totals = {
        "live": {c: round(sum(dd["live"][c] for dd in day_list), 2) for c in cols},
        "backtest": {c: round(sum(dd["backtest"][c] for dd in day_list), 2) for c in cols},
        "live_total": round(sum(dd["live_total"] for dd in day_list), 2),
        "backtest_total": round(sum(dd["backtest_total"] for dd in day_list), 2),
        "schwab_total": round(sum(dd["schwab_total"] for dd in day_list), 2),
        "schwab_fees": round(sum(dd["schwab_fees"] for dd in day_list), 2),
        "schwab": {},
        "pairs": len(pairs),
        "manual": sum(1 for p in pairs if p["live"] and p["live"]["is_manual"]),
        "excluded": sum(1 for p in pairs if p["excluded"]),
    }
    for dd in day_list:
        for u, v in dd["schwab"].items():
            totals["schwab"][u] = round(totals["schwab"].get(u, 0.0) + v, 2)

    # Fill diagnostics across the range: stop overshoot vs the 3x trigger, and
    # net entry credit on matched strikes — the two live measurements the
    # tripwires actually read.
    diag = {"live_stop_overshoot": [], "backtest_stop_overshoot": [],
            "credit_diff_matched": []}
    for p in pairs:
        for src in ("live", "backtest"):
            t = p[src]
            if t:
                diag[src + "_stop_overshoot"] += [s["overshoot"] for s in t["sides"]
                                                   if s["overshoot"] is not None]
        if p["live"] and p["backtest"] and "strikes differ" not in p["flags"] \
                and p["live"]["contracts"] == p["backtest"]["contracts"]:
            diag["credit_diff_matched"].append(round(p["live"]["credit"] - p["backtest"]["credit"], 2))
    def avg(xs):
        return round(sum(xs) / len(xs), 3) if xs else None
    diag_out = {k: {"n": len(v), "avg": avg(v), "max": (max(v) if v else None)}
                for k, v in diag.items()}

    return {"start": start, "end": end, "exclude_manual": bool(exclude_manual),
            "columns": cols, "days": day_list, "totals": totals,
            "pairs": pairs, "diagnostics": diag_out,
            "schwab_rows": schwab}
