from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ...database import get_db
from ...services import schwab_import

router = APIRouter()


class SchwabCsv(BaseModel):
    csv: str


def _events(payload: SchwabCsv):
    try:
        events = schwab_import.parse_csv(payload.csv)
    except Exception as e:
        raise HTTPException(400, f"Could not read that CSV: {e}")
    if not events:
        raise HTTPException(
            400,
            "No fund transactions found. Export from Schwab via "
            "Accounts -> History -> Export with the All date range.")
    return events


@router.post("/preview")
def preview_import(payload: SchwabCsv):
    """What the import would change. Reads only."""
    events = _events(payload)
    with get_db() as conn:
        return schwab_import.build_plan(conn, events)


@router.post("/confirm")
def confirm_import(payload: SchwabCsv):
    events = _events(payload)
    with get_db() as conn:
        plan = schwab_import.build_plan(conn, events)
        counts = schwab_import.apply_import(conn, events)
    return {**counts, "plan": plan}
