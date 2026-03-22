from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import httpx
from ...database import get_db

router = APIRouter()


class FundIn(BaseModel):
    ticker: str
    name: str
    type: str = "CEF"


@router.get("")
def list_funds():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM funds WHERE active=1 ORDER BY ticker").fetchall()
        return [dict(r) for r in rows]


@router.post("")
def add_fund(fund: FundIn):
    with get_db() as conn:
        conn.execute(
            "INSERT INTO funds (ticker, name, type) VALUES (?, ?, ?) "
            "ON CONFLICT(ticker) DO UPDATE SET name=excluded.name, type=excluded.type, active=1",
            (fund.ticker.upper(), fund.name, fund.type)
        )
    return {"ok": True}


@router.get("/inactive")
def list_inactive_funds():
    with get_db() as conn:
        rows = conn.execute("""
            SELECT f.ticker, f.name, f.type,
                   h.shares, h.cost_basis, h.dividends_received, h.realized_gain,
                   p.price, p.nav,
                   COALESCE(p.date, (SELECT MAX(ex_date) FROM distributions WHERE ticker = f.ticker)) as last_date
            FROM funds f
            LEFT JOIN holdings h ON h.ticker = f.ticker
            LEFT JOIN prices p ON p.ticker = f.ticker
                AND p.date = (SELECT MAX(date) FROM prices WHERE ticker = f.ticker)
            WHERE f.active = 0
            ORDER BY f.ticker
        """).fetchall()
        return [dict(r) for r in rows]


@router.post("/fill-names")
def fill_names():
    """Fetch real names from Yahoo Finance for any fund where name = ticker (placeholder)."""
    HEADERS = {"User-Agent": "Mozilla/5.0"}
    with get_db() as conn:
        stubs = conn.execute(
            "SELECT ticker FROM funds WHERE name = ticker"
        ).fetchall()

    updated = 0
    for row in stubs:
        ticker = row["ticker"]
        try:
            url = f"https://query2.finance.yahoo.com/v8/finance/chart/{ticker}?range=1d&interval=1d"
            r = httpx.get(url, headers=HEADERS, timeout=8)
            if r.status_code == 200:
                meta = r.json()["chart"]["result"][0]["meta"]
                name = meta.get("longName") or meta.get("shortName")
                if name and name != ticker:
                    with get_db() as conn:
                        conn.execute("UPDATE funds SET name = ? WHERE ticker = ?", (name, ticker))
                    updated += 1
        except Exception:
            pass

    return {"updated": updated}


@router.delete("/{ticker}")
def remove_fund(ticker: str):
    with get_db() as conn:
        conn.execute("UPDATE funds SET active=0 WHERE ticker=?", (ticker.upper(),))
    return {"ok": True}
