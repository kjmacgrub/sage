from fastapi import APIRouter
from ...database import get_db
from ...services.exposure import resolve as resolve_exposure
from ...services.scraper import fetch_screener_data, fetch_cef_list
from ...services import dist_trend
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

router = APIRouter()

_state = {"running": False, "done": 0, "total": 0, "errors": []}
_write_lock = threading.Lock()


@router.get("/funds")
def screener_funds():
    with get_db() as conn:
        rows = conn.execute(
            f"SELECT sc.*, {dist_trend.SELECT_COLS} FROM screener_cache sc "
            "LEFT JOIN dist_trend dt ON dt.ticker = sc.ticker ORDER BY sc.ticker"
        ).fetchall()
        data = [dict(r) for r in rows]

        watchlist = {r["ticker"] for r in conn.execute(
            "SELECT ticker FROM funds WHERE active=1"
        ).fetchall()}
        # Hand-set exposures, so the screener shows the same label the
        # portfolio does rather than re-deriving a different default.
        set_exposure = {r["ticker"]: r["exposure"] for r in conn.execute(
            "SELECT ticker, exposure FROM funds WHERE exposure IS NOT NULL").fetchall()}
        fund_types = {r["ticker"]: r["type"] for r in conn.execute(
            "SELECT ticker, type FROM funds").fetchall()}
        portfolio = {r["ticker"] for r in conn.execute(
            "SELECT ticker FROM holdings WHERE shares > 0"
        ).fetchall()}

    for d in data:
        d["in_watchlist"] = d["ticker"] in watchlist
        d["in_portfolio"] = d["ticker"] in portfolio
        d["exposure"] = resolve_exposure(
            set_exposure.get(d["ticker"]), d.get("category"), fund_types.get(d["ticker"]))

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


_trend_state = {"running": False, "done": 0, "total": 0, "errors": []}


@router.post("/trend/refresh")
def trend_refresh():
    """Recompute the distribution trend for held and watchlist funds only."""
    if _trend_state["running"]:
        return {"message": "Already running", "state": _trend_state}
    threading.Thread(target=_do_trend_refresh, daemon=True).start()
    return {"message": "Trend refresh started"}


@router.get("/trend/status")
def trend_status():
    return _trend_state


def _do_trend_refresh():
    global _trend_state
    with get_db() as conn:
        tickers = [r["ticker"] for r in conn.execute(
            "SELECT ticker FROM holdings WHERE shares > 0 "
            "UNION SELECT ticker FROM funds WHERE active = 1 ORDER BY 1")]
    _trend_state = {"running": True, "done": 0, "total": len(tickers), "errors": []}
    try:
        def one(t):
            try:
                dist_trend.refresh_one(t)
            except Exception:
                _trend_state["errors"].append(t)
            finally:
                _trend_state["done"] += 1
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(one, tickers))
    finally:
        _trend_state["running"] = False


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
                trend = dist_trend.analyze(dist_trend.fetch_events(ticker)) if data else None
                if data:
                    with _write_lock:
                        with get_db() as conn:
                            dist_trend.upsert(conn, ticker, trend)
                        with get_db() as conn:
                            conn.execute("""
                                INSERT INTO screener_cache
                                  (ticker, name, price, nav, premium_discount, avg_discount_1y,
                                   nav_change_1y, nav_cagr, yield_pct, dist_freq, inception_date, category, dist_cagr,
                                   has_special_dist, regular_yield_pct, last_special_date, last_special_amount,
                                   earned_yield_1y, dist_yield_1y, earned_yield_life, dist_yield_life, yield_life_years,
                                   leverage_pct, leverage_type, leverage_band, leverage_cushion_pct,
                                   preferred_usd, debt_usd, regulatory_usd, leverage_as_of, leverage_stale, fetched_at)
                                VALUES
                                  (:ticker, :name, :price, :nav, :premium_discount, :avg_discount_1y,
                                   :nav_change_1y, :nav_cagr, :yield_pct, :dist_freq, :inception_date, :category, :dist_cagr,
                                   :has_special_dist, :regular_yield_pct, :last_special_date, :last_special_amount,
                                   :earned_yield_1y, :dist_yield_1y, :earned_yield_life, :dist_yield_life, :yield_life_years,
                                   :leverage_pct, :leverage_type, :leverage_band, :leverage_cushion_pct,
                                   :preferred_usd, :debt_usd, :regulatory_usd, :leverage_as_of, :leverage_stale, datetime('now'))
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
                                    has_special_dist=excluded.has_special_dist,
                                    regular_yield_pct=excluded.regular_yield_pct,
                                    last_special_date=excluded.last_special_date,
                                    last_special_amount=excluded.last_special_amount,
                                    earned_yield_1y=excluded.earned_yield_1y,
                                    dist_yield_1y=excluded.dist_yield_1y,
                                    earned_yield_life=excluded.earned_yield_life,
                                    dist_yield_life=excluded.dist_yield_life,
                                    yield_life_years=excluded.yield_life_years,
                                    leverage_pct=excluded.leverage_pct,
                                    leverage_type=excluded.leverage_type,
                                    leverage_band=excluded.leverage_band,
                                    leverage_cushion_pct=excluded.leverage_cushion_pct,
                                    preferred_usd=excluded.preferred_usd,
                                    debt_usd=excluded.debt_usd,
                                    regulatory_usd=excluded.regulatory_usd,
                                    leverage_as_of=excluded.leverage_as_of,
                                    leverage_stale=excluded.leverage_stale,
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
