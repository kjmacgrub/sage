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
    notes: str = ""


@router.get("")
def list_holdings():
    with get_db() as conn:
        rows = conn.execute("""
            SELECT h.*, f.name, f.type,
                   p.price, p.nav, p.premium_discount, p.avg_discount_1y, p.nav_cagr, p.yield_pct,
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


@router.put("/{ticker}")
def upsert_holding(ticker: str, holding: HoldingIn):
    with get_db() as conn:
        conn.execute("""
            INSERT INTO holdings (ticker, shares, cost_basis, dividends_received, manual_nav, manual_nav_date, div_tracking_since, notes, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, date('now'), ?, datetime('now'))
            ON CONFLICT(ticker) DO UPDATE SET
                shares=excluded.shares,
                cost_basis=excluded.cost_basis,
                dividends_received=excluded.dividends_received,
                manual_nav=excluded.manual_nav,
                manual_nav_date=excluded.manual_nav_date,
                div_tracking_since=COALESCE(holdings.div_tracking_since, excluded.div_tracking_since),
                notes=excluded.notes,
                updated_at=datetime('now')
        """, (ticker.upper(), holding.shares, holding.cost_basis,
              holding.dividends_received, holding.manual_nav, holding.manual_nav_date, holding.notes)
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
