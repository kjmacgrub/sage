"""App settings — code-defined defaults, DB rows override.

A missing DB row means "use the default", so resetting a setting is just a
DELETE. Audit runs snapshot the settings they were computed under (see
services/audit.py) so a grade stays interpretable after the rubric is retuned.
"""
import json
from .database import get_db

# Anything here is user-tunable from the settings panel. Scoring curve anchors
# (services/audit.py:SCORE_CURVES) deliberately stay in code — exposing every
# knob makes the grade tunable until everything scores an A.
DEFAULTS = {
    # --- CEF audit rubric ---------------------------------------------------
    # Component weights, must total 100.
    "audit.weights": {
        "coverage": 50,       # earned vs distributed — the core question
        "nav_trend": 20,      # is the NAV eroding
        "payout_power": 15,   # payout rate vs demonstrated earning power
        "your_return": 15,    # realized return on your cost basis
    },
    # Blend inside the coverage component, must total 100. Longer windows are
    # weighted heavier so a single market year can't dominate the grade.
    # "longrun" is the median of rolling 3-year windows, not a single
    # inception-to-today figure — see services/audit.py:_rolling for why.
    "audit.coverage_windows": {"y1": 25, "y3": 40, "longrun": 35},

    "audit.cash_benchmark_pct": 4.0,   # what "your return" is measured against
    "audit.stale_days": 45,            # audit older than this reads as stale

    # Score -> letter. Value is the minimum score for that letter.
    "audit.grade_bands": {"A": 90, "B": 80, "C": 70, "D": 60},

    # Ceilings that fire regardless of blended score, so a good price run
    # can't mask chronic distribution destruction.
    "audit.hard_caps": {
        "enabled": True,
        "capped_grade": "D",
        # Cap if coverage is below this ratio on BOTH the 1Y and 3Y windows.
        "coverage_floor_ratio": 0.4,
        # Cap if NAV CAGR is at or below this AND payout is at or above the
        # ceiling below (both must be true).
        "nav_cagr_floor": -5.0,
        "payout_power_ceiling": 2.0,
    },

    # --- BDC audit rubric ---------------------------------------------------
    "audit.bdc_weights": {
        "nii_coverage": 50,     # NII/share vs dividend/share, as filed
        "nav_trend": 20,
        "dist_stability": 15,   # cuts, and raises into a falling NAV
        "your_return": 15,
    },

    # --- Display ------------------------------------------------------------
    "display.group_by_type": True,
    "display.disc_alert_threshold": 3.0,   # pp wider than avg triggers alert
}

# Settings that invalidate stored audits when changed — a grade computed under
# different rules is not comparable to one computed under the current rules.
RUBRIC_KEYS = [
    "audit.weights",
    "audit.coverage_windows",
    "audit.cash_benchmark_pct",
    "audit.grade_bands",
    "audit.hard_caps",
    "audit.bdc_weights",
]


def _row_value(raw):
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return raw


def get_all() -> dict:
    """Full settings map: defaults with any stored overrides applied."""
    out = dict(DEFAULTS)
    with get_db() as conn:
        try:
            rows = conn.execute("SELECT key, value FROM settings").fetchall()
        except Exception:
            return out
    for r in rows:
        if r["key"] in DEFAULTS:
            stored = _row_value(r["value"])
            base = DEFAULTS[r["key"]]
            # Merge dict-valued settings so a default added later still applies.
            if isinstance(base, dict) and isinstance(stored, dict):
                merged = dict(base)
                merged.update(stored)
                out[r["key"]] = merged
            else:
                out[r["key"]] = stored
    return out


def get(key: str):
    return get_all().get(key, DEFAULTS.get(key))


def rubric_snapshot(settings: dict | None = None) -> dict:
    """The subset of settings a grade depends on — stored on each audit row."""
    s = settings or get_all()
    return {k: s.get(k) for k in RUBRIC_KEYS}


def set_many(updates: dict) -> dict:
    """Persist overrides. Unknown keys are ignored; a null value resets to default."""
    applied = {}
    with get_db() as conn:
        for key, value in updates.items():
            if key not in DEFAULTS:
                continue
            if value is None:
                conn.execute("DELETE FROM settings WHERE key=?", (key,))
            else:
                conn.execute(
                    """INSERT INTO settings (key, value, updated_at)
                       VALUES (?, ?, datetime('now'))
                       ON CONFLICT(key) DO UPDATE SET
                         value=excluded.value, updated_at=datetime('now')""",
                    (key, json.dumps(value)),
                )
            applied[key] = value
    return applied


def reset(keys: list[str] | None = None) -> None:
    """Drop overrides so defaults apply again. None resets everything."""
    with get_db() as conn:
        if keys is None:
            conn.execute("DELETE FROM settings")
        else:
            for k in keys:
                conn.execute("DELETE FROM settings WHERE key=?", (k,))


def validate(updates: dict) -> list[str]:
    """Return a list of human-readable problems; empty means OK."""
    errors = []
    for key, weights in (("audit.weights", updates.get("audit.weights")),
                         ("audit.bdc_weights", updates.get("audit.bdc_weights")),
                         ("audit.coverage_windows", updates.get("audit.coverage_windows"))):
        if weights is None:
            continue
        if not isinstance(weights, dict):
            errors.append(f"{key} must be an object")
            continue
        total = sum(v for v in weights.values() if isinstance(v, (int, float)))
        if abs(total - 100) > 0.01:
            errors.append(f"{key} must total 100% (currently {total:g}%)")

    bands = updates.get("audit.grade_bands")
    if isinstance(bands, dict):
        vals = [bands.get(g) for g in ("A", "B", "C", "D")]
        if any(v is None for v in vals):
            errors.append("audit.grade_bands needs A, B, C and D cutoffs")
        elif not all(vals[i] > vals[i + 1] for i in range(3)):
            errors.append("audit.grade_bands must descend: A > B > C > D")

    stale = updates.get("audit.stale_days")
    if stale is not None and (not isinstance(stale, (int, float)) or stale < 1):
        errors.append("audit.stale_days must be at least 1")

    cash = updates.get("audit.cash_benchmark_pct")
    if cash is not None and (not isinstance(cash, (int, float)) or cash < 0):
        errors.append("audit.cash_benchmark_pct cannot be negative")

    return errors
