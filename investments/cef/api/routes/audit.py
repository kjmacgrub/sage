from fastapi import APIRouter, HTTPException
from ...database import get_db
from ...services import audit as audit_svc

router = APIRouter()


@router.get("")
def list_latest():
    """Latest audit per ticker, keyed by ticker — one call feeds every badge."""
    return audit_svc.latest_audits()


@router.get("/{ticker}")
def get_audit(ticker: str):
    found = audit_svc.latest_audits([ticker.upper()])
    if ticker.upper() not in found:
        raise HTTPException(404, "No audit recorded for this ticker yet.")
    return found[ticker.upper()]


@router.get("/{ticker}/history")
def get_history(ticker: str, limit: int = 20):
    return audit_svc.audit_history(ticker, limit)


@router.post("/{ticker}")
def run(ticker: str):
    with get_db() as conn:
        exists = conn.execute(
            "SELECT 1 FROM funds WHERE ticker=?", (ticker.upper(),)
        ).fetchone()
    if not exists:
        raise HTTPException(404, f"{ticker.upper()} is not a tracked fund.")
    try:
        return audit_svc.run_audit(ticker)
    except Exception as e:
        raise HTTPException(502, f"Audit failed: {e}")


# --- BDC quarterly fundamentals -------------------------------------------

@router.get("/bdc/{ticker}")
def list_quarters(ticker: str):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM bdc_fundamentals WHERE ticker=? ORDER BY quarter_end DESC",
            (ticker.upper(),),
        ).fetchall()
    return [dict(r) for r in rows]


@router.put("/bdc/{ticker}")
def upsert_quarter(ticker: str, body: dict):
    quarter_end = (body.get("quarter_end") or "").strip()
    if not quarter_end:
        raise HTTPException(400, "quarter_end (YYYY-MM-DD) is required.")

    # Update only the fields the caller actually sent. Writing every column on
    # every PUT means a request carrying one field silently nulls the rest —
    # a partial update aimed at the leverage figures wiped a filed quarter's
    # NII, NAV and non-accruals during development. An explicit null still
    # clears a field; an omitted key now leaves it alone.
    editable = ("nii_per_share", "nav_per_share", "dividend_per_share",
                "special_per_share", "non_accrual_pct", "notes",
                "total_debt", "total_equity")
    sent = {k: body[k] for k in editable if k in body}

    with get_db() as conn:
        cols = ["ticker", "quarter_end"] + list(sent)
        placeholders = ", ".join("?" for _ in cols)
        updates = ", ".join(f"{k}=excluded.{k}" for k in sent) or "ticker=ticker"
        conn.execute(
            f"""INSERT INTO bdc_fundamentals ({", ".join(cols)})
                VALUES ({placeholders})
                ON CONFLICT(ticker, quarter_end) DO UPDATE SET {updates}""",
            [ticker.upper(), quarter_end] + list(sent.values()))
    return {"ok": True}


@router.delete("/bdc/{ticker}/{quarter_end}")
def delete_quarter(ticker: str, quarter_end: str):
    with get_db() as conn:
        conn.execute(
            "DELETE FROM bdc_fundamentals WHERE ticker=? AND quarter_end=?",
            (ticker.upper(), quarter_end),
        )
    return {"ok": True}
