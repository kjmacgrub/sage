from fastapi import APIRouter
from ...database import get_db
from ...services.scraper import fetch_screener_data, fetch_cef_list
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

router = APIRouter()

_state = {"running": False, "done": 0, "total": 0, "errors": []}
_write_lock = threading.Lock()


@router.get("/funds")
def screener_funds():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM screener_cache ORDER BY ticker"
        ).fetchall()
        data = [dict(r) for r in rows]

        watchlist = {r["ticker"] for r in conn.execute(
            "SELECT ticker FROM funds WHERE active=1"
        ).fetchall()}
        portfolio = {r["ticker"] for r in conn.execute(
            "SELECT ticker FROM holdings WHERE shares > 0"
        ).fetchall()}

    for d in data:
        d["in_watchlist"] = d["ticker"] in watchlist
        d["in_portfolio"] = d["ticker"] in portfolio

    return {"funds": data, "total": len(data), "state": _state}


@router.get("/status")
def screener_status():
    return _state


@router.post("/refresh")
def screener_refresh():
    if _state["running"]:
        return {"message": "Already running", "state": _state}
    t = threading.Thread(target=_do_refresh, daemon=True)
    t.start()
    return {"message": "Refresh started"}


def _do_refresh():
    global _state
    _state = {"running": True, "done": 0, "total": 0, "errors": []}
    try:
        funds = fetch_cef_list()
        _state["total"] = len(funds)

        def fetch_and_save(f):
            ticker = f["Ticker"]
            name = f["Name"]
            try:
                data = fetch_screener_data(ticker)
                if data:
                    with _write_lock:
                        with get_db() as conn:
                            conn.execute("""
                                INSERT INTO screener_cache
                                  (ticker, name, price, nav, premium_discount, avg_discount_1y,
                                   nav_change_1y, nav_cagr, yield_pct, dist_freq, inception_date, category, dist_cagr, fetched_at)
                                VALUES
                                  (:ticker, :name, :price, :nav, :premium_discount, :avg_discount_1y,
                                   :nav_change_1y, :nav_cagr, :yield_pct, :dist_freq, :inception_date, :category, :dist_cagr, datetime('now'))
                                ON CONFLICT(ticker) DO UPDATE SET
                                    name=excluded.name, price=excluded.price, nav=excluded.nav,
                                    premium_discount=excluded.premium_discount,
                                    avg_discount_1y=excluded.avg_discount_1y,
                                    nav_change_1y=excluded.nav_change_1y,
                                    nav_cagr=excluded.nav_cagr,
                                    yield_pct=excluded.yield_pct,
                                    dist_freq=excluded.dist_freq,
                                    inception_date=excluded.inception_date,
                                    category=excluded.category,
                                    dist_cagr=excluded.dist_cagr,
                                    fetched_at=excluded.fetched_at
                            """, {**data, "name": name})
            except Exception as e:
                with _write_lock:
                    _state["errors"].append(ticker)
            finally:
                with _write_lock:
                    _state["done"] += 1

        with ThreadPoolExecutor(max_workers=5) as executor:
            futures = [executor.submit(fetch_and_save, f) for f in funds]
            for _ in as_completed(futures):
                pass
    finally:
        _state["running"] = False
