import threading
from datetime import date, datetime

from fastapi import APIRouter

from ...database import get_db
from ...services import bdc_screener as svc

router = APIRouter()

_state = {"running": False, "done": 0, "total": 0, "errors": []}


@router.get("/funds")
def list_bdcs():
    with get_db() as conn:
        rows = [dict(r) for r in conn.execute(
            "SELECT * FROM bdc_screener_cache ORDER BY ticker")]
        watch = {r["ticker"] for r in conn.execute("SELECT ticker FROM funds WHERE active=1")}
        held = {r["ticker"] for r in conn.execute("SELECT ticker FROM holdings WHERE shares>0")}
    for r in rows:
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


def _stale_days(latest_quarter):
    if not latest_quarter:
        return None
    try:
        return (date.today() - datetime.fromisoformat(latest_quarter).date()).days
    except (TypeError, ValueError):
        return None


def _confidence(summary, quote):
    """Whether this row is fit to rank on.

    A screen that sorts stale or unverifiable rows to the top is worse than no
    screen: NSLR's newest filing is from 2022 and PSEC's from 2024, and both
    landed above every real company. Coverage is only trustworthy when the
    filing is recent and the payout can be checked against cash actually paid.
    """
    days = _stale_days(summary.get("latest_quarter"))
    cov = summary.get("coverage")
    if days is None or cov is None:
        return "low"
    # A 10-Q lands ~45 days after quarter end, so ~230 days means a filing was
    # missed entirely rather than merely being the usual one behind.
    if days > 230:
        return "low"
    if not quote.get("div_ttm"):
        return "low"        # no dividend history to check the filed payout against
    if cov > 2.0 or cov < 0.2:
        return "low"        # implausible for an operating BDC; usually a tagging artifact
    if days > 150 or summary.get("dist_source") == "yahoo":
        return "medium"
    return "high"


def _do_refresh():
    global _state
    _state = {"running": True, "done": 0, "total": 0, "errors": []}
    try:
        universe = svc.discover_universe()
        _state["total"] = len(universe)

        # Sequential on purpose: the SEC asks for under 10 requests a second and
        # will start refusing if that's ignored. 47 companies is a couple of
        # minutes, and this runs a few times a year.
        for entry in universe:
            try:
                rec = svc.fetch_bdc(entry["cik"], entry["ticker"])
                quote = svc.yahoo_quote(entry["ticker"])
                summary = svc.reconcile(svc.summarize(rec), quote.get("div_ttm")) or {}
                if not summary:
                    # No usable distribution tag — measure income against the
                    # dividends actually paid instead of dropping the company.
                    summary = svc.summarize_with_yahoo_dist(rec, quote.get("div_ttm")) or {}
                price = quote.get("price")
                nav = summary.get("nav_per_share")
                div_ttm = quote.get("div_ttm")

                row = {
                    "ticker": entry["ticker"], "cik": entry["cik"],
                    "name": quote.get("name") or entry["name"],
                    "price": price, "nav_per_share": nav,
                    "price_to_nav": round((price / nav - 1) * 100, 2) if price and nav else None,
                    "div_ttm": div_ttm,
                    "yield_pct": round(div_ttm / price * 100, 2) if price and div_ttm else None,
                    "nii_ttm": summary.get("nii_ttm"), "dist_ttm": summary.get("dist_ttm"),
                    "coverage": summary.get("coverage"), "nav_trend": summary.get("nav_trend"),
                    "quarters": summary.get("quarters"),
                    "latest_quarter": summary.get("latest_quarter"),
                    "error": rec.get("error"),
                    "dist_source": summary.get("dist_source"),
                    "stale_days": _stale_days(summary.get("latest_quarter")),
                    "confidence": _confidence(summary, quote),
                }
                with get_db() as conn:
                    conn.execute("""
                        INSERT INTO bdc_screener_cache
                          (ticker,cik,name,price,nav_per_share,price_to_nav,div_ttm,yield_pct,
                           nii_ttm,dist_ttm,coverage,nav_trend,quarters,latest_quarter,error,
                           dist_source,stale_days,confidence,fetched_at)
                        VALUES (:ticker,:cik,:name,:price,:nav_per_share,:price_to_nav,:div_ttm,
                                :yield_pct,:nii_ttm,:dist_ttm,:coverage,:nav_trend,:quarters,
                                :latest_quarter,:error,:dist_source,:stale_days,:confidence,
                                datetime('now'))
                        ON CONFLICT(ticker) DO UPDATE SET
                          name=excluded.name, price=excluded.price,
                          nav_per_share=excluded.nav_per_share, price_to_nav=excluded.price_to_nav,
                          div_ttm=excluded.div_ttm, yield_pct=excluded.yield_pct,
                          nii_ttm=excluded.nii_ttm, dist_ttm=excluded.dist_ttm,
                          coverage=excluded.coverage, nav_trend=excluded.nav_trend,
                          quarters=excluded.quarters, latest_quarter=excluded.latest_quarter,
                          error=excluded.error, dist_source=excluded.dist_source,
                          stale_days=excluded.stale_days, confidence=excluded.confidence,
                          fetched_at=datetime('now')
                    """, row)
            except Exception as e:
                _state["errors"].append({"ticker": entry["ticker"], "error": str(e)[:140]})
            _state["done"] += 1
    except Exception as e:
        _state["errors"].append({"ticker": "*", "error": str(e)[:200]})
    finally:
        _state["running"] = False
