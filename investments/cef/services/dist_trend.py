"""
Distribution trend: has a fund cut its regular payout, and when?

The screener's `dist_cagr` (first complete year → last) hides the thing Ken
cares about: a fund that cut in 2020 and has been climbing back since shows a
flat CAGR and looks "steady". This module walks the actual payment sequence
and counts the cuts.

Method
- Full dividend history from Yahoo (events only; same feed `_compute_dist_cagr`
  uses). Future-dated events are dropped.
- Yahoo's max-range feed is flaky (the same ticker returned 30 events on one
  call and 59 on the next), so the 2-year feed and the broker records in
  `distributions` are merged in; two records within 20 days are one payment
  (Yahoo's ex-date, the broker's pay date, amounts differing by rounding).
  Broker rows only prove a payment happened: their per-share amount is
  total ÷ shares and goes wrong whenever the position changed mid-month
  (TYG 2026-06 read as a 25% cut that never happened), so they count for
  frequency and coverage but never register as a cut or a raise.
- Specials are removed: a payment ≥ SPECIAL_MULT × the median of its twelve
  neighbours (six either side) is a one-off, not the rate. Comparing with
  neighbours on both sides keeps a genuine doubling of the payout (NPFD 2022→25)
  from being mistaken for a run of specials.
- Each payment is annualised by the schedule in force when it was paid,
  read from the gaps around it (see `_freqs`): a quarterly→monthly switch is
  a change of frequency, not a two-thirds cut, and a month missing from the
  feed is a hole, not a change of frequency.
- A cut is an annualised rate more than CUT_TOL below the previous regular
  payment's rate; a raise is the mirror image. Counted over the trailing
  5 and 10 years.
- Funds whose payout is a percentage of NAV (USA, SPE, ...) move every quarter
  in both directions. When half or more of the payments in the window change,
  with both raises and cuts present, the fund is labelled `Variable` rather
  than scored on cut count: there is no fixed rate to cut.

Labels: Rising (raises, no cuts) · Steady (no change) · Cut (≥ 1 cut) ·
Variable (NAV-linked payout) · None (too little history).

The rule (decided 2026-10-25): what matters is the LEVEL, not each step. A
fund whose annualised payout is more than OFF_HIGH_TRIGGER below its own
three-year high, for two consecutive payments, is flagged. That ignores penny
toggles (AOD), a 3% trim (HGLB) and NAV-linked swings, forgives a cut that is
reversed, and still catches a slow bleed of 1-2% steps (ECAT, -12%) that a
per-payment cut count cannot see.
"""
from datetime import date, datetime, timedelta, timezone
from statistics import median

from cef.services import http

HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}
SPECIAL_MULT = 1.75
CUT_TOL = 0.02       # 2%: below this a change is rounding or a managed-rate nudge, not a decision
OFF_HIGH_TRIGGER = -10.0   # % below the 3-year high that flags a fund, two payments running
FREQS = (12, 4, 2, 1)

EMPTY = {
    "dist_trend": None, "dist_cuts_5y": None, "dist_cuts_10y": None,
    "dist_raises_5y": None, "dist_last_cut": None, "dist_last_cut_pct": None,
    "dist_max_cut_pct": None, "dist_change_5y": None, "dist_payments": 0,
    "dist_trend_as_of": None,
    "dist_rate_now": None, "dist_high_3y": None, "dist_off_high_pct": None, "dist_flag": None,
}


def _yahoo(ticker: str, rng: str, interval: str) -> list[tuple[date, float]]:
    url = f"https://query2.finance.yahoo.com/v8/finance/chart/{ticker}?range={rng}&interval={interval}&events=dividends"
    try:
        r = http.get(url, headers=HEADERS, timeout=15)
        if r.status_code != 200:
            return []
        divs = r.json()["chart"]["result"][0].get("events", {}).get("dividends", {})
    except Exception:
        return []
    return [(datetime.fromtimestamp(d["date"], tz=timezone.utc).date(), float(d["amount"]), "yahoo") for d in divs.values()]


def merge_events(*sources) -> list[tuple[date, float, str]]:
    """(ex_date, amount, source); source is 'yahoo' or 'broker'."""
    today = date.today()
    out: list[tuple[date, float, str]] = []
    # Yahoo first within a date, so a broker duplicate is the one dropped
    for ex, amt, src in sorted((e for s_ in sources for e in s_), key=lambda e: (e[0], e[2] != "yahoo")):
        if ex > today or amt <= 0:
            continue
        # nothing here pays more often than monthly, so two records within 20 days are
        # one payment (Yahoo ex-date, broker pay date; amounts differ by rounding)
        dup = any(abs((ex - d).days) <= 20 for d, _, _ in out[-3:])
        if not dup:
            out.append((ex, amt, src))
    return out


def fetch_events(ticker: str, local=None) -> list[tuple[date, float, str]]:
    """Yahoo max + 2y feeds, plus any broker rows the caller passes in."""
    return merge_events(_yahoo(ticker, "max", "3mo"), _yahoo(ticker, "2y", "1mo"), local or [])


def local_events(conn, ticker: str) -> list[tuple[date, float, str]]:
    rows = conn.execute("SELECT ex_date, amount FROM distributions WHERE ticker=? AND amount>0", (ticker,)).fetchall()
    return [(date.fromisoformat(r[0][:10]), float(r[1]), "broker") for r in rows]


def _strip_specials(events):
    amts = [e[1] for e in events]
    regular = []
    for i, e in enumerate(events):
        nb = amts[max(0, i - 6):i] + amts[i + 1:i + 7]
        if len(nb) >= 3 and e[1] >= SPECIAL_MULT * median(nb):
            continue
        regular.append(e)
    return regular


def _gap_class(days: int) -> int:
    return min(FREQS, key=lambda f: abs(f - 365.25 / max(days, 1)))


def _freqs(regular) -> list[int]:
    """payments per year for each payment.

    A payment belongs to the schedule in force when it was paid. If the two
    gaps before it agree, that is the schedule (TYG's last quarterly payment,
    Nov 2024, sits between a 91-day gap and the first 32-day gap of the
    monthly regime: it is quarterly). If they disagree, the payment is the
    start of something new or sits just after a hole in the feed: the two gaps
    after it decide. When both sides are settled but differ, the side whose
    annualised rate is closer to the previous payment's wins, which is what
    keeps a rate-neutral switch from reading as a cut and a raise. Neither
    settled: the smallest surrounding gaps, which a hole can only stretch.
    """
    dates = [e[0] for e in regular]
    amts = [e[1] for e in regular]
    gaps = [_gap_class((b - a).days) for a, b in zip(dates, dates[1:])]
    out: list[int] = []
    prev_rate = None
    for i in range(len(dates)):
        before = gaps[max(0, i - 2):i]          # gaps ending at payment i
        after = gaps[i:i + 2]                   # gaps starting at payment i
        b_ok = len(before) == 2 and before[0] == before[1]
        a_ok = len(after) == 2 and after[0] == after[1]
        if b_ok and a_ok and before[1] != after[0] and prev_rate:
            f = min((before[1], after[0]), key=lambda x: abs(amts[i] * x - prev_rate))
        elif b_ok:
            f = before[1]
        elif a_ok:
            f = after[0]
        else:
            around = sorted((b - a).days for a, b in zip(dates[max(0, i - 3):i + 4], dates[max(0, i - 3) + 1:i + 4]))
            f = _gap_class(median(around[:3])) if around else 1
        out.append(f)
        prev_rate = amts[i] * f
    return out


def analyze(events, today: date | None = None) -> dict:
    today = today or date.today()
    out = dict(EMPTY)
    regular = _strip_specials(events)
    if len(regular) < 4:
        return out
    freqs = _freqs(regular)
    # broker-sourced amounts are unreliable per share: rate None, see module doc
    rates = [(ex, amt * f if src == "yahoo" else None) for (ex, amt, src), f in zip(regular, freqs)]

    def window(years):
        cutoff = today - timedelta(days=int(365.25 * years))
        # include the last payment before the cutoff so the first in-window payment has a comparator
        idx = [i for i, (ex, _) in enumerate(rates) if ex >= cutoff]
        if not idx:
            return []
        start = max(idx[0] - 1, 0)
        return rates[start:]

    def changes(seq):
        cuts, raises = [], []
        prev = None
        for d1, r1 in seq:
            if r1 is None:
                continue
            if prev and prev > 0:
                ch = r1 / prev - 1
                if ch < -CUT_TOL:
                    cuts.append((d1, ch))
                elif ch > CUT_TOL:
                    raises.append((d1, ch))
            prev = r1
        return cuts, raises

    w5, w10 = window(5), window(10)
    c5, r5 = changes(w5)
    c10, _ = changes(w10)
    n5 = max(sum(1 for _, r in w5 if r is not None) - 1, 0)
    out["dist_payments"] = len(regular)
    out["dist_trend_as_of"] = regular[-1][0].isoformat()
    if n5 < 3:
        return out
    out["dist_cuts_5y"] = len(c5)
    out["dist_cuts_10y"] = len(c10)
    out["dist_raises_5y"] = len(r5)
    known = [r for _, r in w5 if r]
    if known:
        out["dist_change_5y"] = round((known[-1] / known[0] - 1) * 100, 1)
    if c10:
        last = c10[-1]
        out["dist_last_cut"] = last[0].isoformat()
        out["dist_last_cut_pct"] = round(last[1] * 100, 1)
        out["dist_max_cut_pct"] = round(min(ch for _, ch in c10) * 100, 1)
    # level rule: annualised rate vs its 3-year high, two payments running
    w3 = [(d, r) for d, r in window(3) if r is not None]
    if len(w3) >= 2:
        high = max(r for _, r in w3)
        off = [(r / high - 1) * 100 for _, r in w3[-2:]]
        out["dist_rate_now"] = round(w3[-1][1], 4)
        out["dist_high_3y"] = round(high, 4)
        out["dist_off_high_pct"] = round(off[-1], 1)
        out["dist_flag"] = 1 if all(o <= OFF_HIGH_TRIGGER for o in off) else 0
    variable = (len(c5) + len(r5)) / n5 >= 0.5 and c5 and r5
    if variable:
        out["dist_trend"] = "Variable"
    elif c5:
        out["dist_trend"] = "Cut"
    elif r5:
        out["dist_trend"] = "Rising"
    else:
        out["dist_trend"] = "Steady"
    return out


COLS = tuple(EMPTY)
SELECT_COLS = ", ".join(f"dt.{c}" for c in COLS)


def upsert(conn, ticker: str, data: dict) -> None:
    conn.execute(
        f"INSERT INTO dist_trend (ticker, {', '.join(COLS)}, fetched_at) "
        f"VALUES (:ticker, {', '.join(':' + c for c in COLS)}, datetime('now')) "
        "ON CONFLICT(ticker) DO UPDATE SET "
        + ", ".join(f"{c}=excluded.{c}" for c in COLS) + ", fetched_at=excluded.fetched_at",
        {**data, "ticker": ticker.upper()})


def refresh_one(ticker: str) -> dict:
    """Fetch, store and return the trend for one ticker (own connections)."""
    from cef.database import get_db
    with get_db() as conn:
        local = local_events(conn, ticker.upper())
    data = analyze(fetch_events(ticker.upper(), local))
    with get_db() as conn:
        upsert(conn, ticker, data)
    return data


def fetch_trend(ticker: str, conn=None) -> dict:
    try:
        local = local_events(conn, ticker.upper()) if conn is not None else None
        return analyze(fetch_events(ticker.upper(), local))
    except Exception:
        return dict(EMPTY)
