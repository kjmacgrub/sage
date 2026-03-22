from fastapi import APIRouter
from ...database import get_db
from ...services.scraper import fetch_dividends

router = APIRouter()


@router.post("/check")
def check_distributions():
    """
    For each holding, fetch recent dividends from Yahoo Finance and add any
    new ones (on/after div_tracking_since and not already in the distributions
    table) to dividends_received.
    """
    with get_db() as conn:
        holdings = conn.execute(
            "SELECT ticker, shares, div_tracking_since FROM holdings WHERE shares > 0"
        ).fetchall()

    added = []
    errors = []

    for h in holdings:
        ticker = h["ticker"]
        shares = h["shares"]
        since = h["div_tracking_since"]
        try:
            divs = fetch_dividends(ticker, since=since)
            for d in divs:
                total = round(d["amount"] * shares, 2)
                with get_db() as conn:
                    try:
                        conn.execute(
                            """INSERT INTO distributions (ticker, ex_date, amount, shares, total)
                               VALUES (?, ?, ?, ?, ?)""",
                            (ticker, d["ex_date"], d["amount"], shares, total),
                        )
                        conn.execute(
                            """UPDATE holdings
                               SET dividends_received = dividends_received + ?
                               WHERE ticker = ?""",
                            (total, ticker),
                        )
                        added.append({"ticker": ticker, "ex_date": d["ex_date"],
                                      "amount": d["amount"], "total": total})
                    except Exception:
                        pass  # UNIQUE constraint — already logged
        except Exception as e:
            errors.append({"ticker": ticker, "error": str(e)})

    return {"added": added, "errors": errors}


@router.get("")
def list_distributions():
    """Return all logged distributions, newest first."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM distributions ORDER BY ex_date DESC, ticker"
        ).fetchall()
        return [dict(r) for r in rows]


@router.post("/backfill")
def backfill_distributions():
    """Fetch last 6 months of distributions for all holdings, ignoring div_tracking_since."""
    from datetime import date, timedelta
    since_6mo = (date.today() - timedelta(days=183)).isoformat()

    with get_db() as conn:
        holdings = conn.execute(
            "SELECT ticker, shares FROM holdings WHERE shares > 0"
        ).fetchall()

    added = []
    errors = []

    for h in holdings:
        ticker = h["ticker"]
        shares = h["shares"]
        try:
            divs = fetch_dividends(ticker, since=since_6mo)
            for d in divs:
                total = round(d["amount"] * shares, 2)
                with get_db() as conn:
                    try:
                        conn.execute(
                            """INSERT INTO distributions (ticker, ex_date, amount, shares, total)
                               VALUES (?, ?, ?, ?, ?)""",
                            (ticker, d["ex_date"], d["amount"], shares, total),
                        )
                        conn.execute(
                            """UPDATE holdings
                               SET dividends_received = dividends_received + ?
                               WHERE ticker = ?""",
                            (total, ticker),
                        )
                        added.append({"ticker": ticker, "ex_date": d["ex_date"],
                                      "amount": d["amount"], "total": total})
                    except Exception:
                        pass  # already recorded
        except Exception as e:
            errors.append({"ticker": ticker, "error": str(e)})

    return {"added": added, "errors": errors}


@router.get("/{ticker}")
def ticker_distributions(ticker: str):
    """Return distributions for a single ticker, newest first."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM distributions WHERE ticker = ? ORDER BY ex_date DESC",
            (ticker.upper(),)
        ).fetchall()
        return [dict(r) for r in rows]
