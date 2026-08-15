from fastapi import APIRouter, HTTPException
from ... import settings as cfg

router = APIRouter()


@router.get("")
def read_settings():
    """Current values, plus the defaults so the panel can show 'Reset'."""
    return {"settings": cfg.get_all(), "defaults": cfg.DEFAULTS}


@router.put("")
def write_settings(body: dict):
    """Persist overrides. A null value resets that key to its default.

    Returns rubric_changed so the UI can mark existing audits as stale — a
    grade computed under a different rubric isn't comparable to a current one.
    """
    updates = body.get("settings", body) or {}
    unknown = [k for k in updates if k not in cfg.DEFAULTS]
    if unknown:
        raise HTTPException(400, f"Unknown setting(s): {', '.join(sorted(unknown))}")

    errors = cfg.validate(updates)
    if errors:
        raise HTTPException(400, "; ".join(errors))

    before = cfg.rubric_snapshot()
    cfg.set_many(updates)
    after = cfg.rubric_snapshot()

    return {
        "ok": True,
        "settings": cfg.get_all(),
        "rubric_changed": before != after,
    }


@router.post("/reset")
def reset_settings(body: dict | None = None):
    keys = (body or {}).get("keys")
    before = cfg.rubric_snapshot()
    cfg.reset(keys)
    after = cfg.rubric_snapshot()
    return {"ok": True, "settings": cfg.get_all(), "rubric_changed": before != after}
