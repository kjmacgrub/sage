from datetime import datetime
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
from ...database import get_db

router = APIRouter()


def _cagr_from_rows(rows):
    d1 = datetime.fromisoformat(rows[0]['date'])
    d2 = datetime.fromisoformat(rows[-1]['date'])
    years = (d2 - d1).days / 365.25
    nav_start, nav_end = rows[0]['nav'], rows[-1]['nav']
    if years >= 0.5 and nav_start > 0:
        return round(((nav_end / nav_start) ** (1 / years) - 1) * 100, 2)
    return None


class HoldingIn(BaseModel):
    ticker: str
    shares: float
    cost_basis: float
    dividends_received: float = 0.0
    manual_nav: Optional[float] = None
    manual_nav_date: Optional[str] = None
    acquired_date: Optional[str] = None
    notes: str = ""


@router.get("")
def list_holdings():
    with get_db() as conn:
        rows = conn.execute("""
            SELECT h.*, f.name, f.type,
                   p.price, p.nav, p.premium_discount, p.avg_discount_1y, p.nav_cagr, p.yield_pct,
                   p.has_special_dist, p.regular_yield_pct, p.last_special_date, p.last_special_amount,
                   p.earned_yield_1y, p.dist_yield_1y, p.earned_yield_life, p.dist_yield_life, p.yield_life_years,
                   p2.price AS prev_price
            FROM holdings h
            JOIN funds f ON f.ticker = h.ticker
            LEFT JOIN prices p ON p.ticker = h.ticker
              AND p.date = (SELECT MAX(px.date) FROM prices px WHERE px.ticker = h.ticker)
            LEFT JOIN prices p2 ON p2.ticker = h.ticker
              AND p2.date = (SELECT MAX(px.date) FROM prices px WHERE px.ticker = h.ticker AND px.date < p.date)
            ORDER BY h.ticker
        """).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            # For BDCs: use manual_nav to compute disc/prem if no live NAV
            if d.get("manual_nav") and d.get("price"):
                if not d.get("nav"):
                    d["nav"] = d["manual_nav"]
                if not d.get("premium_discount"):
                    d["premium_discount"] = round((d["price"] / d["manual_nav"] - 1) * 100, 2)
            # Compute nav_cagr from nav_history if not available from prices
            if d.get('nav_cagr') is None:
                hist = conn.execute(
                    "SELECT date, nav FROM nav_history WHERE ticker=? ORDER BY date",
                    (d['ticker'],)
                ).fetchall()
                if len(hist) >= 2:
                    d['nav_cagr'] = _cagr_from_rows(hist)
            if d.get("price") and d.get("prev_price"):
                d["price_change_pct"] = round((d["price"] / d["prev_price"] - 1) * 100, 2)
            if d["price"] and d["cost_basis"] and d["shares"]:
                market_value = d["price"] * d["shares"]
                total_cost = d["cost_basis"]
                d["market_value"] = round(market_value, 2)
                d["unrealized_gain"] = round(market_value - total_cost, 2)
                d["total_return"] = round(market_value - total_cost + d["dividends_received"], 2)
                d["total_return_pct"] = round((d["total_return"] / total_cost) * 100, 2) if total_cost else None
            result.append(d)
        return result


# Share-count-changing actions, mirroring services/schwab_import.py.
_ACQUIRE = {"Buy", "Rights Exercise", "Stock Merger", "Reorg Adj", "Reorganized Issue",
            "Journaled Shares", "Internal Transfer", "Reinvest Shares", "Pr Yr Div Reinvest"}


@router.get("/lifetime")
def lifetime_summary():
    """Account-level score across every CEF/BDC ever held, not just current ones.

    Lifetime = realized on closed positions + all distributions + current
    unrealized. Scoped to CEF and BDC: the account also carries ETF, stock and
    options activity from other strategies that would swamp the figure.

    A position whose buys predate the earliest transaction export cannot have
    its realized gain reconstructed. Those are reported separately rather than
    counted as zero, which would silently understate the result.
    """
    with get_db() as conn:
        rows = conn.execute("""
            SELECT h.ticker, h.shares, h.cost_basis, h.dividends_received, p.price
            FROM holdings h
            JOIN funds f ON f.ticker = h.ticker
            LEFT JOIN prices p ON p.ticker = h.ticker
              AND p.date = (SELECT MAX(date) FROM prices WHERE ticker = h.ticker)
            WHERE f.type IN ('CEF','BDC')
        """).fetchall()

        trades = {}
        for r in conn.execute(
                "SELECT ticker, action, shares, amount FROM broker_trades ORDER BY date"):
            trades.setdefault(r["ticker"], []).append(dict(r))

        # The window the figure actually covers. Anything earlier than this is
        # simply not in the record, so the label should say where it starts
        # rather than implying the number reaches back forever.
        earliest = conn.execute("""
            SELECT MIN(dt) FROM (
                SELECT MIN(d.ex_date) dt FROM distributions d
                  JOIN funds f ON f.ticker = d.ticker WHERE f.type IN ('CEF','BDC')
                UNION ALL
                SELECT MIN(b.date) FROM broker_trades b
                  JOIN funds f ON f.ticker = b.ticker WHERE f.type IN ('CEF','BDC')
            )""").fetchone()[0]

    realized = dividends = unrealized = 0.0
    closed = held = 0
    incomplete = []

    for r in rows:
        legs = trades.get(r["ticker"], [])
        if not legs and not (r["dividends_received"] or 0):
            continue

        qty, ok = 0.0, True
        for leg in legs:
            s = leg["shares"] or 0
            if leg["action"] in _ACQUIRE:
                qty += s
            elif leg["action"] == "Sell":
                qty -= abs(s)
            elif leg["action"] == "Reverse Split":
                qty = abs(s)
            if qty < -1e-6:
                ok = False
        # Trustworthy only if the reconstruction lands on the shares held today.
        ok = ok and abs(qty - (r["shares"] or 0)) < 0.01

        dividends += r["dividends_received"] or 0

        if (r["shares"] or 0) > 0:
            held += 1
            if r["price"] and r["cost_basis"]:
                unrealized += r["price"] * r["shares"] - r["cost_basis"]
        elif ok:
            closed += 1
            realized += sum(leg["amount"] or 0 for leg in legs)
        else:
            incomplete.append(r["ticker"])

    return {
        "realized": round(realized, 2),
        "dividends": round(dividends, 2),
        "unrealized": round(unrealized, 2),
        "lifetime": round(realized + dividends + unrealized, 2),
        "closed_positions": closed,
        "held_positions": held,
        "incomplete": sorted(incomplete),
        "earliest": earliest,
    }


@router.put("/{ticker}")
def upsert_holding(ticker: str, holding: HoldingIn):
    with get_db() as conn:
        conn.execute("""
            INSERT INTO holdings (ticker, shares, cost_basis, dividends_received, manual_nav, manual_nav_date, acquired_date, div_tracking_since, notes, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, date('now'), ?, datetime('now'))
            ON CONFLICT(ticker) DO UPDATE SET
                shares=excluded.shares,
                cost_basis=excluded.cost_basis,
                dividends_received=excluded.dividends_received,
                manual_nav=excluded.manual_nav,
                manual_nav_date=excluded.manual_nav_date,
                acquired_date=excluded.acquired_date,
                div_tracking_since=COALESCE(holdings.div_tracking_since, excluded.div_tracking_since),
                notes=excluded.notes,
                updated_at=datetime('now')
        """, (ticker.upper(), holding.shares, holding.cost_basis,
              holding.dividends_received, holding.manual_nav, holding.manual_nav_date,
              holding.acquired_date, holding.notes)
        )
        if holding.manual_nav and holding.manual_nav_date:
            conn.execute("""
                INSERT INTO nav_history (ticker, date, nav)
                VALUES (?, ?, ?)
                ON CONFLICT(ticker, date) DO UPDATE SET nav=excluded.nav
            """, (ticker.upper(), holding.manual_nav_date, holding.manual_nav))
    return {"ok": True}


@router.patch("/{ticker}/realized-gain")
def set_realized_gain(ticker: str, body: dict):
    with get_db() as conn:
        conn.execute(
            "UPDATE holdings SET realized_gain=? WHERE ticker=?",
            (body.get("realized_gain"), ticker.upper())
        )
    return {"ok": True}
