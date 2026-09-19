"""Portfolio routes for the dividend-growth sleeve. Reads dividend.db only."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ...dividend import importer
from ...dividend.database import get_db, init_db

router = APIRouter()


class BrokerCsv(BaseModel):
    csv: str
    filename: str | None = None
    broker: str = "schwab"


def _parse(payload: BrokerCsv):
    if payload.broker not in importer.ADAPTERS:
        raise HTTPException(400, f"No adapter for broker '{payload.broker}'")
    parse, detect = importer.ADAPTERS[payload.broker]
    account = detect(payload.filename)
    if not account:
        # Refusing beats guessing: filing a taxable export under the Roth is
        # very hard to spot afterwards and harder to unwind.
        raise HTTPException(400,
            "Could not read the account from the filename. Schwab names exports "
            "like 'Individual_XXX1234_Transactions_20260101-120000.csv' — upload "
            "the file as downloaded, without renaming it.")
    try:
        events = parse(payload.csv)
    except Exception as e:
        raise HTTPException(400, f"Could not read that CSV: {e}")
    if not events:
        raise HTTPException(400,
            "No stock transactions found. Options rows are skipped by design; "
            "this sleeve only tracks common shares.")
    return events, account


RETIREMENT = ("IRA", "ROTH", "401", "SEP", "SIMPLE", "BENEFICIARY")


def _warnings(account):
    """This sleeve is taxable by design (decisions.md 2026-09-19). Importing the
    Roth export here would pull the whole CEF book in as stock positions."""
    up = account.upper()
    if any(w in up for w in RETIREMENT):
        return [f"'{account}' looks like a retirement account. The dividend sleeve "
                "is taxable by design — importing a Roth or IRA export here will "
                "pull that account's positions in as holdings."]
    return []


@router.post("/import/preview")
def preview(payload: BrokerCsv):
    events, account = _parse(payload)
    init_db()
    with get_db() as conn:
        plan = importer.build_plan(conn, events, account)
    plan["warnings"] = _warnings(account)
    return plan


@router.post("/import/confirm")
def confirm(payload: BrokerCsv):
    events, account = _parse(payload)
    init_db()
    with get_db() as conn:
        plan = importer.build_plan(conn, events, account)
        counts = importer.apply_import(conn, events, account)
    return {"account": account, "counts": counts,
            "new": len(plan["new"]), "updated": len(plan["updated"])}


@router.get("/holdings")
def holdings():
    """Positions with yield on cost measured against the ORIGINAL outlay.

    Not against cost_basis, which DRIP inflates every quarter — at year 20 that
    understates yield on cost roughly 3.7x.
    """
    init_db()
    with get_db() as conn:
        rows = [dict(r) for r in conn.execute(
            "SELECT * FROM holdings WHERE shares > 0 ORDER BY ticker")]
        scr = {r["ticker"]: dict(r) for r in conn.execute("SELECT * FROM screener_cache")}
        for r in rows:
            s = scr.get(r["ticker"], {})
            r["price"] = s.get("price")
            r["value"] = round(r["shares"] * s["price"], 2) if s.get("price") else None
            base = r.get("initial_cost") or r.get("cost_basis")
            ttm = s.get("div_ttm")
            r["income_ttm"] = round(ttm * r["shares"], 2) if ttm else None
            r["yield_on_cost"] = round(r["income_ttm"] / base * 100, 2) if (
                r.get("income_ttm") and base) else None
            r["yield_current"] = s.get("yield_pct")
            r["div_cagr"] = s.get("div_cagr")
            r["payout_pct"] = s.get("payout_pct")
            r["fcf_cover"] = s.get("fcf_cover")
            r["per_share"] = importer.per_share_history(conn, r["ticker"])
        total = sum(r["value"] or 0 for r in rows)
        for r in rows:
            r["weight"] = round((r["value"] or 0) / total * 100, 1) if total else None
    return {"holdings": rows, "total_value": round(total, 2),
            "total_cost": round(sum(r.get("initial_cost") or r.get("cost_basis") or 0
                                    for r in rows), 2),
            "total_income_ttm": round(sum(r["income_ttm"] or 0 for r in rows), 2)}
