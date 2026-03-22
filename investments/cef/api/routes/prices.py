from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from datetime import date, timedelta
from ...database import get_db
from ...services.scraper import fetch_fund_data, fetch_quick_prices

router = APIRouter()


class RefreshOne(BaseModel):
    ticker: str


@router.get("/latest")
def latest_prices():
    """Return the most recent price row for each active fund."""
    with get_db() as conn:
        rows = conn.execute("""
            SELECT p.*, f.name, f.type
            FROM prices p
            JOIN funds f ON f.ticker = p.ticker
            WHERE f.active = 1
              AND p.date = (SELECT MAX(p2.date) FROM prices p2 WHERE p2.ticker = p.ticker)
            ORDER BY p.premium_discount ASC
        """).fetchall()
        return [dict(r) for r in rows]


@router.get("/history/{ticker}")
def price_history(ticker: str, days: int = 90):
    with get_db() as conn:
        rows = conn.execute("""
            SELECT * FROM prices
            WHERE ticker = ?
            ORDER BY date DESC
            LIMIT ?
        """, (ticker.upper(), days)).fetchall()
        return [dict(r) for r in rows]


@router.post("/refresh-one")
def refresh_one(body: RefreshOne):
    """Fetch a single ticker and save to prices table."""
    data = fetch_fund_data(body.ticker)
    if data.get("price") is not None:
        with get_db() as conn:
            conn.execute("""
                INSERT INTO prices (ticker, date, price, nav, premium_discount, yield_pct, distribution, dist_freq)
                VALUES (:ticker, :date, :price, :nav, :premium_discount, :yield_pct, :distribution, :dist_freq)
                ON CONFLICT(ticker, date) DO UPDATE SET
                    price=excluded.price, nav=excluded.nav,
                    premium_discount=excluded.premium_discount,
                    yield_pct=excluded.yield_pct,
                    distribution=excluded.distribution,
                    dist_freq=excluded.dist_freq,
                    fetched_at=datetime('now')
            """, data)
            if data.get("nav"):
                conn.execute("""
                    INSERT INTO nav_history (ticker, date, nav) VALUES (?, ?, ?)
                    ON CONFLICT(ticker, date) DO UPDATE SET nav=excluded.nav
                """, (data["ticker"], data["date"], data["nav"]))
            for h in data.get("history", []):
                conn.execute("""
                    INSERT INTO prices (ticker, date, price, nav, premium_discount)
                    VALUES (:ticker, :date, :price, :nav, :premium_discount)
                    ON CONFLICT(ticker, date) DO NOTHING
                """, h)
                if h.get("nav"):
                    conn.execute("""
                        INSERT INTO nav_history (ticker, date, nav) VALUES (?, ?, ?)
                        ON CONFLICT(ticker, date) DO NOTHING
                    """, (h["ticker"], h["date"], h["nav"]))
    return {"data": data}


@router.get("/nav-sparklines")
def nav_sparklines(months: int = 13):
    """Return NAV history for all active funds over the last N months from prices table."""
    cutoff = (date.today() - timedelta(days=months * 31)).isoformat()
    with get_db() as conn:
        rows = conn.execute("""
            SELECT p.ticker, p.date, p.nav
            FROM prices p
            JOIN funds f ON f.ticker = p.ticker AND f.active = 1
            WHERE p.date >= ? AND p.nav IS NOT NULL
            ORDER BY p.ticker, p.date
        """, (cutoff,)).fetchall()
    result = {}
    for r in rows:
        result.setdefault(r["ticker"], []).append({"date": r["date"], "nav": r["nav"]})
    return result


@router.post("/quick-refresh")
def quick_refresh():
    """Fast parallel CEFConnect 5D fetch — upserts recent price rows for all active tickers."""
    with get_db() as conn:
        tickers = [r["ticker"] for r in conn.execute(
            "SELECT ticker FROM funds WHERE active=1"
        ).fetchall()]

    all_rows = fetch_quick_prices(tickers)

    updated, errors = [], []
    with get_db() as conn:
        for ticker, rows in all_rows.items():
            if not rows:
                continue
            try:
                for h in rows:
                    conn.execute("""
                        INSERT INTO prices (ticker, date, price, nav, premium_discount)
                        VALUES (:ticker, :date, :price, :nav, :premium_discount)
                        ON CONFLICT(ticker, date) DO UPDATE SET
                            price=excluded.price,
                            nav=excluded.nav,
                            premium_discount=excluded.premium_discount,
                            fetched_at=datetime('now')
                    """, h)
                    if h.get("nav"):
                        conn.execute("""
                            INSERT INTO nav_history (ticker, date, nav) VALUES (?, ?, ?)
                            ON CONFLICT(ticker, date) DO NOTHING
                        """, (h["ticker"], h["date"], h["nav"]))
                updated.append(ticker)
            except Exception as e:
                errors.append({"ticker": ticker, "error": str(e)})

    return {"updated": updated, "errors": errors}


@router.post("/refresh")
def refresh_prices():
    """Fetch latest data from CEFConnect for all active funds."""
    with get_db() as conn:
        tickers = [r["ticker"] for r in conn.execute(
            "SELECT ticker FROM funds WHERE active=1"
        ).fetchall()]

    results = {"ok": [], "errors": []}
    for ticker in tickers:
        try:
            data = fetch_fund_data(ticker)
            with get_db() as conn:
                conn.execute("""
                    INSERT INTO prices (ticker, date, price, nav, premium_discount, avg_discount_1y, nav_cagr, yield_pct, distribution, dist_freq)
                    VALUES (:ticker, :date, :price, :nav, :premium_discount, :avg_discount_1y, :nav_cagr, :yield_pct, :distribution, :dist_freq)
                    ON CONFLICT(ticker, date) DO UPDATE SET
                        price=excluded.price, nav=excluded.nav,
                        premium_discount=excluded.premium_discount,
                        avg_discount_1y=excluded.avg_discount_1y,
                        nav_cagr=excluded.nav_cagr,
                        yield_pct=excluded.yield_pct,
                        distribution=excluded.distribution,
                        dist_freq=excluded.dist_freq,
                        fetched_at=datetime('now')
                """, data)
                # Keep nav_history in sync for sparklines
                if data.get("nav"):
                    conn.execute("""
                        INSERT INTO nav_history (ticker, date, nav) VALUES (?, ?, ?)
                        ON CONFLICT(ticker, date) DO UPDATE SET nav=excluded.nav
                    """, (ticker, data["date"], data["nav"]))
                for h in data.get("history", []):
                    conn.execute("""
                        INSERT INTO prices (ticker, date, price, nav, premium_discount)
                        VALUES (:ticker, :date, :price, :nav, :premium_discount)
                        ON CONFLICT(ticker, date) DO NOTHING
                    """, h)
                    if h.get("nav"):
                        conn.execute("""
                            INSERT INTO nav_history (ticker, date, nav) VALUES (?, ?, ?)
                            ON CONFLICT(ticker, date) DO NOTHING
                        """, (h["ticker"], h["date"], h["nav"]))
            results["ok"].append(ticker)
        except Exception as e:
            results["errors"].append({"ticker": ticker, "error": str(e)})

    return results
