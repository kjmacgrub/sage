"""Position audit — is the yield paying for itself, or are you paying for the yield?

The question is the same for both security types, but the evidence differs:

  CEF  earned yield (NAV total return) vs distributed yield. If a fund pays 12%
       while its NAV total return is 1%, the other 11 points came out of your
       principal and came back to you labelled "income".

  BDC  net investment income per share vs dividend per share, straight from the
       10-Q. Same question, better evidence — the company states it rather than
       leaving you to infer it. Not available from any free API, so it comes
       from manually entered quarterly figures (see bdc_fundamentals).

Every run re-fetches from public sources rather than trusting the local DB, and
reports any disagreement it finds. Discrepancies never move the grade — a data
gap is a tooling problem, not a fund problem — they lower confidence instead.
"""
import json
from datetime import date, datetime, timedelta, timezone

import httpx

from ..database import get_db
from .. import settings as cfg
from .scraper import cefconnect_history, HEADERS

# Score curve anchors, piecewise-linear between points, clamped outside.
# Deliberately not user-tunable: the settings panel exposes weights and
# thresholds, but if every curve were adjustable the grade could be tuned until
# everything scored an A, which would make it useless as a check on judgment.
SCORE_CURVES = {
    # earned / distributed
    "coverage":     [(-0.5, 0), (0.0, 15), (0.4, 40), (0.7, 65), (1.0, 85), (1.5, 100)],
    # NAV CAGR, %/yr
    "nav_trend":    [(-9, 0), (-6, 25), (-3, 50), (0, 75), (3, 100)],
    # payout rate / demonstrated earning power (lower is better)
    "payout_power": [(1.0, 100), (1.5, 75), (2.0, 55), (3.0, 30), (5.0, 0)],
    # your annualized total return, %/yr
    "your_return":  [(-5, 0), (0, 40), (4, 65), (8, 85), (12, 100)],
    # BDC: NII / dividend
    "nii_coverage": [(0.5, 0), (0.8, 40), (0.95, 70), (1.05, 90), (1.25, 100)],
    # BDC: dividend stability score is computed directly, no curve
}

COVERAGE_RATIO_CAP = 3.0     # one spectacular year shouldn't swamp the blend
MIN_WINDOW_YEARS = 0.5       # below this, annualizing is noise


# --------------------------------------------------------------------------
# shared helpers
# --------------------------------------------------------------------------

def _interp(curve, x):
    """Piecewise-linear lookup, clamped at both ends."""
    if x is None:
        return None
    if x <= curve[0][0]:
        return float(curve[0][1])
    if x >= curve[-1][0]:
        return float(curve[-1][1])
    for (x0, y0), (x1, y1) in zip(curve, curve[1:]):
        if x0 <= x <= x1:
            if x1 == x0:
                return float(y0)
            return float(y0 + (y1 - y0) * (x - x0) / (x1 - x0))
    return float(curve[-1][1])


def _blend(components, weights):
    """Weighted mean over available components; missing ones reweight the rest."""
    usable = {k: v for k, v in components.items() if v is not None and weights.get(k)}
    if not usable:
        return None, {}
    total_w = sum(weights[k] for k in usable)
    score = sum(usable[k] * weights[k] for k in usable) / total_w
    effective = {k: round(weights[k] / total_w * 100, 1) for k in usable}
    return score, effective


def _letter(score, bands):
    """Score to letter, with +/- by position inside the band."""
    if score is None:
        return None
    order = [("A", bands.get("A", 90)), ("B", bands.get("B", 80)),
             ("C", bands.get("C", 70)), ("D", bands.get("D", 60))]
    for i, (letter, floor) in enumerate(order):
        if score >= floor:
            ceiling = 100.0 if i == 0 else order[i - 1][1]
            span = ceiling - floor
            if span <= 0:
                return letter
            pos = (score - floor) / span
            if pos >= 0.67:
                return letter + "+"
            if pos < 0.33:
                return letter + "-"
            return letter
    return "F"


def _grade_value(letter):
    """Numeric rank for comparing grades against a cap. Higher is better."""
    if not letter:
        return -1
    base = {"A": 4, "B": 3, "C": 2, "D": 1, "F": 0}.get(letter[0], 0)
    mod = 0.33 if letter.endswith("+") else (-0.33 if letter.endswith("-") else 0)
    return base + mod


def _merged_distributions(ticker, conn):
    """Yahoo dividend history, with local broker records filling its gaps.

    Yahoo's feed has real holes for some tickers — for DMA it is missing
    Jul 2023-Nov 2024 and Sep 2025-Jan 2026 entirely — which understates both
    the earned and distributed figures. Broker records close them. A payment
    within 12 days of an existing one is treated as the same distribution,
    since broker pay-dates and Yahoo ex-dates don't always line up.
    """
    divs, source_note = {}, []
    try:
        r = httpx.get(
            f"https://query2.finance.yahoo.com/v8/finance/chart/{ticker}"
            f"?range=max&interval=1d&events=div",
            headers=HEADERS, timeout=20,
        )
        if r.status_code == 200:
            ev = r.json()["chart"]["result"][0].get("events", {}).get("dividends", {})
            for v in ev.values():
                ex = datetime.fromtimestamp(v["date"], tz=timezone.utc).date()
                divs[ex] = float(v["amount"])
    except Exception:
        source_note.append("Yahoo distribution history unavailable")

    yahoo_count = len(divs)
    filled = 0
    for row in conn.execute(
        "SELECT ex_date, amount FROM distributions WHERE ticker=? ORDER BY ex_date", (ticker,)
    ):
        try:
            ex = datetime.fromisoformat(row["ex_date"]).date()
        except (TypeError, ValueError):
            continue
        if not any(abs((ex - k).days) <= 12 for k in divs):
            divs[ex] = row["amount"]
            filled += 1

    return dict(sorted(divs.items())), yahoo_count, filled, source_note


def _window_metrics(navs, divs, start_date, end_date, nav_end):
    """Annualized (earned, distributed, ratio) over (start_date, end_date]."""
    anchor = min(navs, key=lambda t: abs((t[0] - start_date).days))
    sd, nav_start = anchor
    if sd >= end_date or not nav_start:
        return None
    years = (end_date - sd).days / 365.25
    if years < MIN_WINDOW_YEARS:
        return None
    dist_sum = sum(a for ex, a in divs.items() if sd < ex <= end_date)
    simple_tr = (nav_end - nav_start + dist_sum) / nav_start
    # Guard the fractional power against a total wipeout (< -100%).
    earned = ((1 + simple_tr) ** (1 / years) - 1) * 100 if simple_tr > -1 else -100.0
    distributed = (dist_sum / years) / nav_start * 100
    ratio = None
    if distributed > 0.01:
        ratio = max(-1.0, min(COVERAGE_RATIO_CAP, earned / distributed))
    return {
        "start": sd.isoformat(), "end": end_date.isoformat(),
        "years": round(years, 2),
        "nav_start": round(nav_start, 4), "nav_end": round(nav_end, 4),
        "dist_total": round(dist_sum, 4),
        "earned": round(earned, 2), "distributed": round(distributed, 2),
        "gap": round(earned - distributed, 2),
        "ratio": round(ratio, 3) if ratio is not None else None,
    }


def _median(values):
    vals = sorted(v for v in values if v is not None)
    if not vals:
        return None
    mid = len(vals) // 2
    return vals[mid] if len(vals) % 2 else (vals[mid - 1] + vals[mid]) / 2


def _rolling(navs, divs, window_days, step_days=30):
    """Metrics for every rolling window of the given length across the series.

    A single inception-to-today measurement is hostage to whatever the market
    was doing on one day years ago — anchoring BSTZ on 2021-08-20 catches the
    tech peak and makes a fund that now covers its distribution 3x look like it
    earns nothing. Rolling windows and taking the median removes that
    sensitivity while still describing long-run behaviour.
    """
    out = []
    if len(navs) < 2:
        return out
    last = navs[-1][0]
    start = navs[0][0]
    while start + timedelta(days=window_days) <= last:
        target = start + timedelta(days=window_days)
        end_anchor = min(navs, key=lambda t: abs((t[0] - target).days))
        m = _window_metrics(navs, divs, start, end_anchor[0], end_anchor[1])
        if m:
            out.append(m)
        start += timedelta(days=step_days)
    return out


def _consecutive_down_years(navs):
    """Trailing run of down calendar years, ignoring the incomplete current one."""
    by_year = {}
    for d, n in navs:
        by_year.setdefault(d.year, []).append((d, n))
    this_year = date.today().year
    years = sorted(y for y in by_year if y < this_year)
    run = 0
    for y in reversed(years):
        pts = sorted(by_year[y])
        if pts[-1][1] < pts[0][1]:
            run += 1
        else:
            break
    return run


def _position_return(ticker, conn, price):
    """Your realized annualized total return on cost basis, if you hold it."""
    row = conn.execute(
        "SELECT shares, cost_basis, dividends_received, acquired_date "
        "FROM holdings WHERE ticker=? AND shares > 0", (ticker,)
    ).fetchone()
    if not row or not row["cost_basis"] or not price:
        return None

    start = row["acquired_date"]
    if not start:
        first = conn.execute(
            "SELECT MIN(ex_date) d FROM distributions WHERE ticker=?", (ticker,)
        ).fetchone()
        start = first["d"] if first else None

    market_value = row["shares"] * price
    total_return = market_value - row["cost_basis"] + (row["dividends_received"] or 0)
    total_pct = total_return / row["cost_basis"] * 100

    years, annualized, estimated = None, None, not row["acquired_date"]
    if start:
        try:
            years = (date.today() - datetime.fromisoformat(start).date()).days / 365.25
        except (TypeError, ValueError):
            years = None
    # Only annualize a genuinely long-enough hold. Scaling a short one up is
    # actively misleading when the start date is itself a guess: FSCO's earliest
    # *recorded* distribution is months after it was actually bought (records
    # only start at div_tracking_since), which turned -1.25% into -5.3%/yr.
    if years and years >= MIN_WINDOW_YEARS and total_pct > -100:
        annualized = ((1 + total_pct / 100) ** (1 / years) - 1) * 100

    return {
        "market_value": round(market_value, 2),
        "cost_basis": round(row["cost_basis"], 2),
        "distributions": round(row["dividends_received"] or 0, 2),
        "total_return": round(total_return, 2),
        "total_return_pct": round(total_pct, 2),
        "hold_years": round(years, 2) if years else None,
        "annualized": round(annualized, 2) if annualized is not None else None,
        "start_estimated": estimated,
        "start": start,
    }


def _discrepancies(ticker, conn, fresh):
    """Fresh public data vs what the app has stored."""
    out = []
    stored = conn.execute(
        "SELECT * FROM prices WHERE ticker=? ORDER BY date DESC LIMIT 1", (ticker,)
    ).fetchone()
    if not stored:
        out.append({"field": "prices", "severity": "info",
                    "message": "No stored price row to compare against."})
        return out

    checks = [
        ("nav", "NAV", 1.0), ("price", "Price", 1.0),
        ("premium_discount", "Discount", None), ("yield_pct", "Yield", None),
    ]
    for field, label, _ in checks:
        old, new = stored[field] if field in stored.keys() else None, fresh.get(field)
        if old is None or new is None:
            continue
        if field in ("premium_discount", "yield_pct"):
            delta = abs(new - old)                       # already percentages
            big = delta > 1.5
            shown = f"{old:.2f}% stored vs {new:.2f}% live"
        else:
            delta = abs(new - old) / old * 100 if old else 0
            big = delta > 2.0
            shown = f"${old:.4g} stored vs ${new:.4g} live"
        if big:
            out.append({"field": field, "severity": "warn",
                        "message": f"{label}: {shown} ({delta:.1f} off)",
                        "stored": old, "live": new})
    return out


# --------------------------------------------------------------------------
# CEF audit
# --------------------------------------------------------------------------

def _audit_cef(ticker, conn, s):
    flags, notes = [], []

    # Merge windows rather than trusting 5Y alone: CEFConnect's long series is
    # sparse for some tickers (XFLT returns 15 rows for 5Y but 95 for 1Y), and
    # taking only the wide window would silently discard most of the history.
    merged, rows = {}, []
    for window in ("5Y", "1Y", "5D"):
        w_rows = cefconnect_history(ticker, window)
        rows = w_rows or rows
        for r in w_rows:
            if r.get("nav"):
                merged[r["date"]] = r
    navs = [(datetime.fromisoformat(d).date(), r["nav"])
            for d, r in sorted(merged.items())]
    rows = [merged[d] for d in sorted(merged)] or rows
    if len(navs) < 2:
        return {
            "kind": "cef", "grade": None, "score": None, "confidence": "low",
            "verdict": "No NAV history available — cannot audit this fund.",
            "detail": {"windows": {}, "components": {}},
            "flags": [{"field": "nav", "severity": "error",
                       "message": "CEFConnect returned no NAV series for this ticker."}],
        }

    end_date, nav_end = navs[-1]
    latest_price = rows[-1].get("price")
    divs, yahoo_count, filled, src_notes = _merged_distributions(ticker, conn)
    notes.extend(src_notes)
    if filled:
        flags.append({
            "field": "distributions", "severity": "info",
            "message": f"{filled} distribution(s) missing from Yahoo were filled from "
                       f"your broker records ({yahoo_count} from Yahoo). Public feeds "
                       f"have gaps for this ticker; coverage ratios are unaffected "
                       f"because a missing payment shifts earned and distributed equally.",
        })

    # --- windows ---
    windows = {}
    for label, days in (("6m", 183), ("1y", 365), ("2y", 731), ("3y", 1096)):
        m = _window_metrics(navs, divs, end_date - timedelta(days=days), end_date, nav_end)
        if m:
            windows[label] = m
    life = _window_metrics(navs, divs, navs[0][0], end_date, nav_end)
    if life:
        windows["life"] = life

    # --- rolling series: anchor-robust long-run estimates ---
    roll_3y = _rolling(navs, divs, 1096)
    roll_1y = _rolling(navs, divs, 365)
    longrun_ratio = _median([m["ratio"] for m in roll_3y])
    # "Earning power" = the typical year, not the endpoint-to-endpoint average.
    earning_power = _median([m["earned"] for m in roll_1y])
    longrun_nav_cagr = _median([
        ((m["nav_end"] / m["nav_start"]) ** (1 / m["years"]) - 1) * 100
        for m in roll_3y if m["nav_start"] and m["years"]
    ])

    # --- component: coverage ---
    win_weights = s["audit.coverage_windows"]
    cov_parts = {
        "y1": (windows.get("1y") or {}).get("ratio"),
        "y3": (windows.get("3y") or {}).get("ratio"),
        # Falls back to the single-anchor lifetime figure when the series is
        # too short to roll a 3-year window.
        "longrun": longrun_ratio if longrun_ratio is not None
                   else (windows.get("life") or {}).get("ratio"),
    }
    cov_scores = {k: _interp(SCORE_CURVES["coverage"], v) if v is not None else None
                  for k, v in cov_parts.items()}
    coverage_score, cov_effective = _blend(cov_scores, win_weights)

    # --- component: NAV trend ---
    nav_years = (end_date - navs[0][0]).days / 365.25
    inception_cagr = None
    if nav_years >= MIN_WINDOW_YEARS and navs[0][1]:
        inception_cagr = ((nav_end / navs[0][1]) ** (1 / nav_years) - 1) * 100
    nav_cagr = longrun_nav_cagr if longrun_nav_cagr is not None else inception_cagr
    nav_score = _interp(SCORE_CURVES["nav_trend"], nav_cagr)
    down_run = _consecutive_down_years(navs)
    if nav_score is not None and down_run > 1:
        nav_score = max(0.0, nav_score - 10 * (down_run - 1))

    # --- component: payout vs earning power ---
    # Run rate, not trailing twelve months: a fund that just raised its payout
    # should be judged on what it is paying now, not what it averaged.
    payout_rate = payout_ratio = None
    recent = sorted(divs.items())[-6:]
    if recent and nav_end:
        gaps = [(recent[i + 1][0] - recent[i][0]).days for i in range(len(recent) - 1)]
        median_gap = sorted(gaps)[len(gaps) // 2] if gaps else 30
        per_year = 12 if median_gap <= 45 else (4 if median_gap <= 135 else 1)
        payout_rate = recent[-1][1] * per_year / nav_end * 100
        power = earning_power if earning_power is not None else \
            (windows.get("life") or windows.get("3y") or {}).get("earned")
        if power is not None:
            # Floor the denominator so a fund that earns nothing doesn't divide
            # by zero, but cap the result: past ~10x the multiple stops carrying
            # information and starts looking like false precision (DMA's payout
            # over a near-zero earning power came out at "29.5x").
            payout_ratio = min(10.0, payout_rate / max(power, 0.5))
    payout_score = _interp(SCORE_CURVES["payout_power"], payout_ratio)

    # --- component: your realized return ---
    position = _position_return(ticker, conn, latest_price)
    your_return = position["annualized"] if position else None
    cash = s["audit.cash_benchmark_pct"]
    # Recentre the curve on the configured cash benchmark (default 4%).
    curve = [(x + (cash - 4.0) if x >= 0 else x, y) for x, y in SCORE_CURVES["your_return"]]
    return_score = _interp(curve, your_return)
    if position and your_return is None:
        notes.append("Held too briefly to annualize your realized return.")

    # --- blend ---
    components = {"coverage": coverage_score, "nav_trend": nav_score,
                  "payout_power": payout_score, "your_return": return_score}
    score, effective = _blend(components, s["audit.weights"])
    bands = s["audit.grade_bands"]
    grade = _letter(score, bands)

    # A grade needs enough evidence behind it. Scoring a fund on one surviving
    # component and calling the result an F says "this fund is bad" when the
    # truth is "we couldn't measure it" — refuse rather than mislead.
    available_weight = sum(s["audit.weights"].get(k, 0)
                           for k, v in components.items() if v is not None)
    if coverage_score is None or available_weight < 50:
        missing = [k for k, v in components.items() if v is None]
        grade, score = None, None
        flags.append({
            "field": "grade", "severity": "error",
            "message": "Not enough data to grade: no distribution-coverage measurement"
                       if coverage_score is None else
                       f"Not enough data to grade — missing {', '.join(missing)}.",
        })

    # --- hard caps ---
    caps = s["audit.hard_caps"]
    applied_caps = []
    if caps.get("enabled") and grade:
        floor = caps.get("coverage_floor_ratio", 0.4)
        r1, r3 = cov_parts.get("y1"), cov_parts.get("y3")
        if r1 is not None and r3 is not None and r1 < floor and r3 < floor:
            applied_caps.append(
                f"coverage below {floor:g}x on both 1Y ({r1:.2f}x) and 3Y ({r3:.2f}x)")
        if (nav_cagr is not None and payout_ratio is not None
                and nav_cagr <= caps.get("nav_cagr_floor", -5.0)
                and payout_ratio >= caps.get("payout_power_ceiling", 2.0)):
            applied_caps.append(
                f"NAV CAGR {nav_cagr:.1f}%/yr with payout {payout_ratio:.1f}x earning power")
        if applied_caps:
            cap_grade = caps.get("capped_grade", "D")
            if _grade_value(grade) > _grade_value(cap_grade):
                grade = cap_grade
                flags.append({"field": "grade", "severity": "warn",
                              "message": "Grade capped at " + cap_grade + ": " +
                                         "; ".join(applied_caps)})

    # --- confidence ---
    fresh = {"nav": nav_end, "price": latest_price,
             "premium_discount": round((latest_price / nav_end - 1) * 100, 2)
             if latest_price and nav_end else None}
    flags.extend(_discrepancies(ticker, conn, fresh))

    usable_windows = sum(1 for v in cov_parts.values() if v is not None)
    if usable_windows >= 3 and nav_years >= 3 and not src_notes:
        confidence = "high"
    elif usable_windows >= 2:
        confidence = "medium"
    else:
        confidence = "low"
    if any(f["severity"] == "warn" for f in flags):
        confidence = "medium" if confidence == "high" else confidence

    # --- verdict ---
    # Driven by the coverage *score*, not a mean of the ratios. Averaging ratios
    # and averaging their scores are different numbers, because the curve
    # saturates above 1.5x: BMEZ's ratios (2.33x / 0.84x / 0.27x) average to
    # 1.01 and read "pays for itself" while the score blend correctly says 66.
    # The capped outlier year must not outvote two weak long-run windows.
    w = windows.get("1y") or windows.get("life")
    recent = (f"Last year earned {w['earned']:.1f}% vs paid {w['distributed']:.1f}%"
              if w and w["ratio"] is not None else None)

    if coverage_score is None:
        verdict = "Not enough history to judge distribution coverage."
    elif coverage_score >= 85:
        verdict = "The distribution is fully earned — the yield pays for itself."
    elif coverage_score >= 65:
        verdict = "Mostly covered, with some NAV drag."
    elif coverage_score >= 40:
        verdict = "About half the distribution is coming out of principal."
    else:
        verdict = "You're paying for the yield — the payout is mostly principal."

    # Name the biggest drag when something other than coverage is sinking the
    # grade, so a badge reading F next to "mostly covered" still explains itself.
    drags = []
    if nav_score is not None and nav_score < 50 and nav_cagr is not None:
        drags.append(f"NAV is eroding {abs(nav_cagr):.1f}%/yr")
    if payout_score is not None and payout_score < 50 and payout_ratio is not None:
        drags.append(f"the payout is {payout_ratio:.1f}x what it earns")
    if drags and (coverage_score or 0) >= 40:
        verdict += " But " + " and ".join(drags) + "."

    # Flag when the recent picture diverges sharply from the long-run one, so a
    # recovering fund and a decaying one don't read the same.
    r1, rl = cov_parts.get("y1"), cov_parts.get("longrun")
    if r1 is not None and rl is not None:
        if r1 >= 1.0 > rl:
            verdict += " Recent years are much stronger than its longer record."
        elif rl >= 1.0 > r1:
            verdict += " Long-run record is much stronger than the past year."
    if recent:
        verdict += f" ({recent}.)"

    return {
        "kind": "cef", "grade": grade,
        "score": round(score, 1) if score is not None else None,
        "confidence": confidence, "verdict": verdict,
        "detail": {
            # Single "does it pay for itself" number for the table column.
            # Prefers the anchor-robust long-run figure over the noisy trailing year.
            "headline_ratio": _r(cov_parts.get("longrun") if cov_parts.get("longrun") is not None
                                 else cov_parts.get("y3") if cov_parts.get("y3") is not None
                                 else cov_parts.get("y1"), 2),
            "windows": windows,
            "components": {
                "coverage": {"score": _r(coverage_score), "ratios": cov_parts,
                             "window_weights": cov_effective,
                             "rolling_3y_windows": len(roll_3y)},
                "nav_trend": {"score": _r(nav_score), "cagr": _r(nav_cagr),
                              "inception_cagr": _r(inception_cagr),
                              "nav_start": navs[0][1], "nav_end": nav_end,
                              "years": round(nav_years, 1),
                              "consecutive_down_years": down_run},
                "payout_power": {"score": _r(payout_score), "payout_rate_on_nav": _r(payout_rate),
                                 "earning_power": _r(earning_power),
                                 "ratio_to_earning_power": _r(payout_ratio)},
                "your_return": {"score": _r(return_score), "position": position,
                                "cash_benchmark": cash},
            },
            "effective_weights": effective,
            "nav_points": len(navs),
            "distribution_count": len(divs),
            "notes": notes,
        },
        "flags": flags,
    }


# --------------------------------------------------------------------------
# BDC audit
# --------------------------------------------------------------------------

def _audit_bdc(ticker, conn, s):
    """Graded on filed NII coverage rather than inferred NAV total return."""
    rows = conn.execute(
        "SELECT * FROM bdc_fundamentals WHERE ticker=? ORDER BY quarter_end", (ticker,)
    ).fetchall()
    quarters = [dict(r) for r in rows]

    latest_price = conn.execute(
        "SELECT price FROM prices WHERE ticker=? ORDER BY date DESC LIMIT 1", (ticker,)
    ).fetchone()
    price = latest_price["price"] if latest_price else None
    position = _position_return(ticker, conn, price)

    if len(quarters) < 2:
        need = 2 - len(quarters)
        return {
            "kind": "bdc", "grade": None, "score": None, "confidence": "low",
            "verdict": f"Needs {need} more quarter{'s' if need > 1 else ''} of filed data "
                       f"— see the BDC audit runbook.",
            "detail": {"quarters": quarters,
                       "components": {"your_return": {"position": position}}},
            "flags": [{"field": "bdc_fundamentals", "severity": "info",
                       "message": "Enter NII/share, NAV/share and dividend/share from the "
                                  "latest 10-Q to grade this position."}],
        }

    # --- NII coverage, weighted toward recent quarters ---
    covers, weights_seq = [], []
    for i, q in enumerate(quarters):
        nii, div = q.get("nii_per_share"), q.get("dividend_per_share")
        if nii is not None and div:
            covers.append(nii / div)
            weights_seq.append(i + 1)          # linear recency weighting
    nii_ratio = None
    if covers:
        nii_ratio = sum(c * w for c, w in zip(covers, weights_seq)) / sum(weights_seq)
    nii_score = _interp(SCORE_CURVES["nii_coverage"], nii_ratio)

    # --- NAV/share trend ---
    navs = [(q["quarter_end"], q["nav_per_share"]) for q in quarters if q.get("nav_per_share")]
    nav_cagr = None
    if len(navs) >= 3:
        try:
            d0 = datetime.fromisoformat(navs[0][0]).date()
            d1 = datetime.fromisoformat(navs[-1][0]).date()
            yrs = (d1 - d0).days / 365.25
            # BDC data is quarterly by nature, so three consecutive quarters span
            # 182 days and would just miss the 0.5-year floor used for CEFs.
            # Three points is enough to read a direction; two is not.
            if yrs >= 0.45 and navs[0][1]:
                nav_cagr = ((navs[-1][1] / navs[0][1]) ** (1 / yrs) - 1) * 100
        except (TypeError, ValueError):
            pass
    nav_score = _interp(SCORE_CURVES["nav_trend"], nav_cagr)

    # --- dividend stability ---
    # A cut is a demerit. A raise while NAV/share is falling is a bigger one:
    # that is the BDC form of paying you with your own capital.
    divs_seq = [q["dividend_per_share"] for q in quarters if q.get("dividend_per_share")]
    stability_score, cuts, raises_into_decline = None, 0, 0
    if len(divs_seq) >= 2:
        stability_score = 100.0
        for i in range(1, len(divs_seq)):
            prev, cur = divs_seq[i - 1], divs_seq[i]
            if cur < prev * 0.98:
                cuts += 1
                stability_score -= 20
            elif cur > prev * 1.02 and nav_cagr is not None and nav_cagr < 0:
                raises_into_decline += 1
                stability_score -= 25
        stability_score = max(0.0, stability_score)

    # --- your return ---
    cash = s["audit.cash_benchmark_pct"]
    curve = [(x + (cash - 4.0) if x >= 0 else x, y) for x, y in SCORE_CURVES["your_return"]]
    return_score = _interp(curve, position["annualized"]) if position else None

    components = {"nii_coverage": nii_score, "nav_trend": nav_score,
                  "dist_stability": stability_score, "your_return": return_score}
    score, effective = _blend(components, s["audit.bdc_weights"])
    grade = _letter(score, s["audit.grade_bands"])

    flags = []
    latest_q = quarters[-1]
    if latest_q.get("non_accrual_pct") is not None and latest_q["non_accrual_pct"] > 2.0:
        flags.append({"field": "non_accruals", "severity": "warn",
                      "message": f"Non-accruals at {latest_q['non_accrual_pct']:.1f}% of fair "
                                 f"value — above the ~2% level that usually signals credit stress."})
    try:
        age_days = (date.today() - datetime.fromisoformat(latest_q["quarter_end"]).date()).days
        if age_days > 135:
            flags.append({"field": "bdc_fundamentals", "severity": "warn",
                          "message": f"Most recent quarter is {age_days} days old — "
                                     f"a newer 10-Q is probably out."})
    except (TypeError, ValueError):
        pass

    if nii_ratio is None:
        verdict = "Not enough NII data to judge coverage."
    elif nii_ratio >= 1.0:
        verdict = (f"NII covers the dividend {nii_ratio:.2f}x "
                   f"— the payout is earned.")
    elif nii_ratio >= 0.9:
        verdict = (f"NII covers {nii_ratio:.2f}x — slightly short, watch it.")
    else:
        verdict = (f"NII covers only {nii_ratio:.2f}x "
                   f"— the dividend is running ahead of earnings.")

    confidence = "high" if len(quarters) >= 4 else "medium"

    return {
        "kind": "bdc", "grade": grade,
        "score": round(score, 1) if score is not None else None,
        "confidence": confidence, "verdict": verdict,
        "detail": {
            "headline_ratio": _r(nii_ratio, 2),
            "quarters": quarters,
            "components": {
                "nii_coverage": {"score": _r(nii_score), "ratio": _r(nii_ratio, 3),
                                 "quarters_used": len(covers)},
                "nav_trend": {"score": _r(nav_score), "cagr": _r(nav_cagr)},
                "dist_stability": {"score": _r(stability_score), "cuts": cuts,
                                   "raises_into_decline": raises_into_decline},
                "your_return": {"score": _r(return_score), "position": position,
                                "cash_benchmark": cash},
            },
            "effective_weights": effective,
        },
        "flags": flags,
    }


def _r(v, places=2):
    return round(v, places) if isinstance(v, (int, float)) else v


# --------------------------------------------------------------------------
# entry point
# --------------------------------------------------------------------------

def run_audit(ticker: str) -> dict:
    ticker = ticker.upper()
    s = cfg.get_all()
    with get_db() as conn:
        row = conn.execute("SELECT type FROM funds WHERE ticker=?", (ticker,)).fetchone()
        kind = "bdc" if (row and (row["type"] or "").upper() == "BDC") else "cef"

        result = _audit_bdc(ticker, conn, s) if kind == "bdc" else _audit_cef(ticker, conn, s)
        snapshot = cfg.rubric_snapshot(s)

        cur = conn.execute(
            """INSERT INTO audits (ticker, kind, grade, score, confidence, verdict,
                                   detail_json, flags_json, settings_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (ticker, result["kind"], result["grade"], result["score"],
             result["confidence"], result["verdict"],
             json.dumps(result["detail"], default=str),
             json.dumps(result["flags"], default=str),
             json.dumps(snapshot)),
        )
        audit_id = cur.lastrowid
        run_at = conn.execute(
            "SELECT run_at FROM audits WHERE id=?", (audit_id,)
        ).fetchone()["run_at"]

    result.update({"id": audit_id, "ticker": ticker, "run_at": run_at,
                   "settings": snapshot, "stale": False, "rubric_changed": False})
    return result


def latest_audits(tickers: list[str] | None = None) -> dict:
    """Most recent audit per ticker, marked stale by age or by rubric change."""
    s = cfg.get_all()
    current = cfg.rubric_snapshot(s)
    stale_days = s["audit.stale_days"]

    with get_db() as conn:
        rows = conn.execute("""
            SELECT a.* FROM audits a
            JOIN (SELECT ticker, MAX(run_at) mx, MAX(id) mid
                  FROM audits GROUP BY ticker) l
              ON l.ticker = a.ticker AND a.id = l.mid
        """).fetchall()

    out = {}
    today = date.today()
    for r in rows:
        d = dict(r)
        if tickers and d["ticker"] not in tickers:
            continue
        for field in ("detail_json", "flags_json", "settings_json"):
            try:
                d[field.replace("_json", "")] = json.loads(d.pop(field) or "null")
            except (TypeError, ValueError):
                d[field.replace("_json", "")] = None
        try:
            age = (today - datetime.fromisoformat(d["run_at"]).date()).days
        except (TypeError, ValueError):
            age = None
        d["age_days"] = age
        d["rubric_changed"] = d.get("settings") != current
        d["stale"] = bool(d["rubric_changed"] or (age is not None and age > stale_days))
        out[d["ticker"]] = d
    return out


def audit_history(ticker: str, limit: int = 20) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, run_at, grade, score, confidence, verdict FROM audits "
            "WHERE ticker=? ORDER BY run_at DESC, id DESC LIMIT ?",
            (ticker.upper(), limit),
        ).fetchall()
    return [dict(r) for r in rows]
