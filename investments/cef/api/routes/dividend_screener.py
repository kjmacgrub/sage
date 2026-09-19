import json
import threading

import httpx
from fastapi import APIRouter

from ...dividend.database import get_db, init_db
from ...dividend import importer
from ...services import dividend_growth as svc

router = APIRouter()

_state = {"running": False, "phase": "", "done": 0, "total": 0, "errors": []}

_COLS = ("ticker,name,idx,sector,industry,price,div_ttm,yield_pct,div_cagr,price_cagr,"
         "win_years,win_from,hist_years,streak,cuts,payout_pct,fcf_cover,ocf_cover,"
         "rev_growth,range_52w,vs_200d,annuals")


@router.get("/funds")
def list_rows():
    with get_db() as conn:
        rows = [dict(r) for r in conn.execute(
            "SELECT * FROM screener_cache ORDER BY ticker")]
        held = {r["ticker"] for r in conn.execute("SELECT ticker FROM holdings WHERE shares>0")}
        watch = set()
    for r in rows:
        r["annuals"] = json.loads(r["annuals"]) if r.get("annuals") else []
        r["in_watchlist"] = r["ticker"] in watch
        r["in_portfolio"] = r["ticker"] in held
    return {"funds": rows, "total": len(rows), "state": _state}


@router.get("/status")
def status():
    return _state


@router.post("/refresh")
def refresh():
    if _state["running"]:
        return {"message": "Already running", "state": _state}
    threading.Thread(target=_do_refresh, daemon=True).start()
    return {"message": "Refresh started"}


def _do_refresh():
    """Full rebuild: ~1,500 tickers, three phases, roughly ten minutes.

    Phase order matters. History is the expensive pass and also decides which
    tickers are worth enriching -- roughly a third of the S&P 1500 either pays
    nothing or has too little dividend history to measure, and there is no
    reason to pull fundamentals for those.
    """
    global _state
    _state = {"running": True, "phase": "universe", "done": 0, "total": 0, "errors": []}
    try:
        universe = svc.discover_universe()
        _state.update(phase="history", total=len(universe))

        rows = []
        with httpx.Client(limits=httpx.Limits(max_connections=8)) as client:
            from concurrent.futures import ThreadPoolExecutor, as_completed
            with ThreadPoolExecutor(max_workers=6) as ex:
                futures = [ex.submit(svc.fetch_history, rec, client) for rec in universe]
                for f in as_completed(futures):
                    try:
                        row = f.result()
                        if row:
                            rows.append(row)
                    except Exception as e:
                        _state["errors"].append({"ticker": "?", "error": str(e)[:140]})
                    _state["done"] += 1

        tickers = [r["ticker"] for r in rows]
        _state.update(phase="fundamentals", done=0, total=len(tickers))
        fundamentals = svc.fetch_fundamentals(
            tickers, progress=lambda n: _state.__setitem__("done", n))

        _state.update(phase="quotes", done=0, total=len(tickers))
        quotes = svc.fetch_quotes(tickers)
        _state["done"] = len(tickers)

        _state.update(phase="saving", done=0, total=len(rows))
        with get_db() as conn:
            conn.execute("DELETE FROM screener_cache")
            for row in rows:
                svc.enrich(row, fundamentals.get(row["ticker"]), quotes.get(row["ticker"]))
                row["annuals"] = json.dumps(row.get("annuals") or [])
                conn.execute(
                    f"INSERT INTO screener_cache ({_COLS},fetched_at) VALUES ("
                    + ",".join(f":{c}" for c in _COLS.split(","))
                    + ",datetime('now'))", row)
                _state["done"] += 1
    except Exception as e:
        _state["errors"].append({"ticker": "*", "error": str(e)[:200]})
    finally:
        _state["running"] = False
        _state["phase"] = "done"
