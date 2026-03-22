from fastapi import APIRouter
from pydantic import BaseModel
from ...database import get_db

router = APIRouter()


class NavEntry(BaseModel):
    date: str
    nav: float


@router.get("/{ticker}")
def list_nav_history(ticker: str):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT date, nav FROM nav_history WHERE ticker=? ORDER BY date",
            (ticker.upper(),)
        ).fetchall()
        return [dict(r) for r in rows]


@router.post("/{ticker}")
def add_nav_history(ticker: str, entry: NavEntry):
    with get_db() as conn:
        conn.execute("""
            INSERT INTO nav_history (ticker, date, nav)
            VALUES (?, ?, ?)
            ON CONFLICT(ticker, date) DO UPDATE SET nav=excluded.nav
        """, (ticker.upper(), entry.date, entry.nav))
    return {"ok": True}


@router.delete("/{ticker}/{date}")
def delete_nav_history(ticker: str, date: str):
    with get_db() as conn:
        conn.execute(
            "DELETE FROM nav_history WHERE ticker=? AND date=?",
            (ticker.upper(), date)
        )
    return {"ok": True}
