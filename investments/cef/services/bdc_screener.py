"""BDC screener, sourced from SEC XBRL.

CEFConnect — the screener's source for closed-end funds — has no BDC coverage
at all, so this is a separate pipeline. BDCs file 10-Q/10-K with tagged XBRL,
which gives the same figures the audit needs (NAV, net investment income and
distributions per share) without scraping press-release HTML.

Two properties of the data shape everything here:

  * It lags the earnings release by weeks. XBRL comes from the 10-Q, not the
    8-K, so the newest quarter on screen is usually one behind the headline.
    Good enough to rank candidates; the audit rotation should stay on releases.

  * Income concepts are reported year-to-date, not per quarter. Q2 arrives as
    six months, Q3 as nine. Quarters have to be differenced out — see
    _to_quarters, which is where most of the subtlety lives.
"""
import collections
import json
import time
import urllib.request
from datetime import date, datetime

UA = {"User-Agent": "Ken MacGregor kjmacbcg@gmail.com"}
SEC = "https://data.sec.gov"

NAV_TAG = "NetAssetValuePerShare"
NII_TAG = "InvestmentCompanyInvestmentIncomeLossPerShare"
# Filers don't agree on how to tag distributions. Preferred first; several
# large BDCs (PSEC, TCPC, FDUS) only use the plain common-stock concept, and
# GSBD tags none of them — it falls back to Yahoo's dividend history.
DIST_TAGS = ["InvestmentCompanyDistributionToShareholdersPerShare",
             "CommonStockDividendsPerShareDeclared",
             "CommonStockDividendsPerShareCashPaid"]

# Commodity and crypto trusts report the same per-share concepts as BDCs and
# would otherwise flood the universe (GLD, IBIT, SLV...). They carry a SIC of
# 6221 or 6199; operating BDCs have no SIC assigned at all.
EXCLUDED_SIC = {"6221", "6199"}


def _get(url, timeout=60):
    return json.load(urllib.request.urlopen(
        urllib.request.Request(url, headers=UA), timeout=timeout))


def discover_universe(period="CY2026Q1"):
    """Listed BDCs, from everyone tagging both NAV and NII per share.

    Misses companies whose fiscal quarters don't line up with the calendar —
    Golub's year ends in September — so the result is a starting point that
    can be topped up by hand, not a definitive list.
    """
    nav = _get(f"{SEC}/api/xbrl/frames/us-gaap/{NAV_TAG}/USD-per-shares/{period}I.json")["data"]
    nii = _get(f"{SEC}/api/xbrl/frames/us-gaap/{NII_TAG}/USD-per-shares/{period}.json")["data"]
    both = {r["cik"] for r in nav} & {r["cik"] for r in nii}

    tickers = _get("https://www.sec.gov/files/company_tickers.json", 30)
    by_cik = {}
    for v in tickers.values():
        by_cik.setdefault(v["cik_str"], v["ticker"])

    out = []
    for cik in sorted(both):
        ticker = by_cik.get(cik)
        if not ticker or not (2 <= len(ticker) <= 4) or "-" in ticker:
            continue                      # skip baby bonds/preferreds sharing a CIK
        try:
            sub = _get(f"{SEC}/submissions/CIK{cik:010d}.json", 30)
        except Exception:
            continue
        time.sleep(0.12)                  # SEC asks for <10 requests/second
        if (sub.get("sic") or "") in EXCLUDED_SIC:
            continue
        out.append({"ticker": ticker, "cik": cik, "name": (sub.get("name") or "").strip()})
    return out


def _to_quarters(rows):
    """Year-to-date per-share values -> discrete quarters, keyed by period end.

    A filing states Q1 directly, then Q2 as six months, Q3 as nine and Q4 as
    the full year. Anything already covering ~a quarter is taken as-is;
    otherwise the prior cumulative figure within the same fiscal year is
    subtracted. Taking these at face value would overstate later quarters by
    up to 4x.
    """
    by_year = collections.defaultdict(list)
    for r in rows:
        start, end = r.get("start"), r.get("end")
        if not start or not end:
            continue
        try:
            s, e = datetime.fromisoformat(start).date(), datetime.fromisoformat(end).date()
        except ValueError:
            continue
        by_year[s.year].append((s, e, float(r["val"])))

    quarters = {}
    for year, spans in by_year.items():
        spans.sort(key=lambda x: (x[1], x[0]))
        cumulative = {}
        for s, e, val in spans:
            days = (e - s).days
            if days <= 100:                       # already a single quarter
                quarters[e.isoformat()] = round(val, 4)
            else:
                # Subtract the longest earlier cumulative span in the same year.
                prior = [(pe, pv) for (pe, pv) in cumulative.items() if pe < e]
                if prior:
                    pe, pv = max(prior)
                    quarters[e.isoformat()] = round(val - pv, 4)
                cumulative[e] = val
            if days > 100:
                cumulative[e] = val
    return quarters


def fetch_bdc(cik, ticker):
    """Per-quarter NAV, NII and distributions for one company."""
    try:
        facts = _get(f"{SEC}/api/xbrl/companyfacts/CIK{cik:010d}.json")["facts"]["us-gaap"]
    except Exception as e:
        return {"ticker": ticker, "error": str(e)[:120]}

    def rows(tag):
        node = facts.get(tag)
        if not node:
            return []
        out = []
        for unit_rows in node["units"].values():
            out.extend(unit_rows)
        return out

    # NAV is an instant, not a duration — keyed straight off the period end.
    nav = {}
    for r in rows(NAV_TAG):
        if r.get("end") and r.get("val") is not None and not r.get("start"):
            nav[r["end"]] = float(r["val"])

    nii = _to_quarters(rows(NII_TAG))

    dist, dist_tag = {}, None
    for tag in DIST_TAGS:
        candidate = _to_quarters(rows(tag))
        # Take the tag that overlaps the income series best, not merely the
        # first one present — some filers carry a stub of a concept they no
        # longer really use.
        if len(set(candidate) & set(nii)) > len(set(dist) & set(nii)):
            dist, dist_tag = candidate, tag

    ends = sorted(set(nii) & set(dist), reverse=True)[:8]
    quarters = [{"quarter_end": e, "nii": nii[e], "dist": dist[e], "nav": nav.get(e)}
                for e in sorted(ends)]
    nii_only = [{"quarter_end": e, "nii": nii[e], "nav": nav.get(e)}
                for e in sorted(nii)[-8:]]
    return {"ticker": ticker, "cik": cik, "quarters": quarters,
            "quarters_nii_only": nii_only, "dist_tag": dist_tag}


def summarize(rec):
    """Trailing-four-quarter coverage and NAV trend for the screener row."""
    qs = [q for q in rec.get("quarters", []) if q["nii"] is not None and q["dist"]]
    if len(qs) < 2:
        return None
    last4 = qs[-4:]
    nii_ttm = round(sum(q["nii"] for q in last4), 4)
    dist_ttm = round(sum(q["dist"] for q in last4), 4)
    coverage = round(nii_ttm / dist_ttm, 3) if dist_ttm else None

    navs = [(q["quarter_end"], q["nav"]) for q in qs if q["nav"]]
    nav_latest = navs[-1][1] if navs else None
    nav_trend = None
    if len(navs) >= 2:
        (d0, v0), (d1, v1) = navs[0], navs[-1]
        years = (datetime.fromisoformat(d1).date() - datetime.fromisoformat(d0).date()).days / 365.25
        if years >= 0.4 and v0:
            nav_trend = round(((v1 / v0) ** (1 / years) - 1) * 100, 2)

    return {"nii_ttm": nii_ttm, "dist_ttm": dist_ttm, "coverage": coverage,
            "nav_per_share": nav_latest, "nav_trend": nav_trend,
            "quarters": len(qs), "latest_quarter": qs[-1]["quarter_end"]}


def reconcile(summary, div_ttm):
    """Sanity-check the filed distribution total against dividends actually paid.

    Tag choice is not reliable enough to trust blind. Monthly payers tag
    single months under CommonStockDividendsPerShareDeclared, which this code
    reads as quarters and so undercounts the payout — PSEC came out at 4.3x
    coverage, which would rank a troubled BDC top of the universe.

    Yahoo's trailing dividends are cash that actually landed. When the two
    disagree by more than 25% the filing figure is the suspect one, so the
    coverage is recomputed against real cash and marked as such.
    """
    if not summary or not div_ttm or not summary.get("dist_ttm"):
        return summary
    filed = summary["dist_ttm"]
    if 0.75 <= filed / div_ttm <= 1.25:
        return summary
    summary = dict(summary)
    summary["dist_ttm"] = round(div_ttm, 4)
    summary["coverage"] = round(summary["nii_ttm"] / div_ttm, 3) if div_ttm else None
    summary["dist_source"] = "yahoo"
    summary["dist_filed"] = filed
    return summary


def summarize_with_yahoo_dist(rec, div_ttm):
    """Fallback when a filer tags no distribution concept at all (GSBD).

    Income still comes from the filing; only the payout side falls back to
    Yahoo's actual dividend history, which is real cash paid.
    """
    qs = [q for q in rec.get("quarters_nii_only", []) if q["nii"] is not None]
    if len(qs) < 2 or not div_ttm:
        return None
    nii_ttm = round(sum(q["nii"] for q in qs[-4:]), 4)
    navs = [q["nav"] for q in qs if q["nav"]]
    return {"nii_ttm": nii_ttm, "dist_ttm": round(div_ttm, 4),
            "coverage": round(nii_ttm / div_ttm, 3),
            "nav_per_share": navs[-1] if navs else None, "nav_trend": None,
            "quarters": len(qs), "latest_quarter": qs[-1]["quarter_end"],
            "dist_source": "yahoo"}


def yahoo_quote(ticker):
    """Live price and trailing dividend rate — XBRL has neither."""
    try:
        r = _get(f"https://query2.finance.yahoo.com/v8/finance/chart/{ticker}"
                 f"?range=1y&interval=1mo&events=div", 20)
        meta = r["chart"]["result"][0]["meta"]
        divs = r["chart"]["result"][0].get("events", {}).get("dividends", {})
        cutoff = time.time() - 365 * 86400
        ttm = sum(float(v["amount"]) for v in divs.values() if v["date"] >= cutoff)
        return {"price": meta.get("regularMarketPrice"),
                "name": meta.get("longName") or meta.get("shortName"),
                "div_ttm": round(ttm, 4) or None}
    except Exception:
        return {}
