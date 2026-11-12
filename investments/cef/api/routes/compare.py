"""Live vs backtest for the options sleeve. See services/compare.py."""
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from ...database import get_db
from ...services import compare

router = APIRouter()


class Upload(BaseModel):
    csv: str
    filename: str = ""


class FidelityPeriod(BaseModel):
    start: str
    end: str
    pct: float
    note: str | None = None


@router.get("/checklist")
def checklist():
    """The review checklist, parsed fresh from docs/review-checklist.md."""
    from ...services import checklist as ck
    return ck.load()


@router.get("/fidelity")
def fidelity():
    with get_db() as conn:
        return {"periods": compare.fidelity_periods(conn)}


@router.post("/fidelity")
def add_fidelity(p: FidelityPeriod):
    try:
        with get_db() as conn:
            compare.add_fidelity_period(conn, p.start, p.end, p.pct, p.note)
            return {"periods": compare.fidelity_periods(conn)}
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.delete("/fidelity/{period_id}")
def delete_fidelity(period_id: int):
    with get_db() as conn:
        return {"deleted": compare.delete_fidelity_period(conn, period_id)}


@router.post("/upload")
def upload(payload: Upload):
    try:
        with get_db() as conn:
            return compare.store_upload(conn, payload.csv, payload.filename)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/uploads")
def uploads():
    with get_db() as conn:
        return {"uploads": compare.list_uploads(conn), "coverage": compare.coverage(conn)}


@router.delete("/uploads/{upload_id}")
def delete_upload(upload_id: int):
    with get_db() as conn:
        return {"deleted_rows": compare.delete_upload(conn, upload_id)}


@router.get("/summary")
def summary(start: str | None = None, end: str | None = None,
            exclude_manual: bool = Query(False)):
    with get_db() as conn:
        if not start or not end:
            start, end = compare.default_range(conn)
            if not start:
                return {"empty": True, "coverage": compare.coverage(conn)}
        out = compare.summary(conn, start, end, exclude_manual)
        out["coverage"] = compare.coverage(conn)
        return out
