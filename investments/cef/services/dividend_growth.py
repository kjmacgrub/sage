"""Dividend-growth screener over the S&P 1500.

A different question from the CEF and BDC screens. Those ask whether a yield is
being earned; this asks whether a company has raised its dividend for decades
and can keep doing so. The sleeve it serves is judged on yield on cost twenty
years out, not on current yield -- see docs/decisions.md, 2026-09-19.

Data traps worth not rediscovering:

- ``range=max`` silently truncates dividend history. With
  ``range=max&interval=1mo`` Yahoo returns KO's dividends for 1962-2003 and then
  jumps to 2026; with an explicit ``period1`` it returns all 65 years.
- Monthly prices only reach ~1985 for most names while dividends reach 1962, so
  **both CAGRs are measured over the same window** -- the first full dividend
  year the price series also covers, through the last complete calendar year.
  KO reads 9.24%/10.58% aligned against 9.58%/10.75% mismatched.
- ``quoteSummary`` needs a crumb (fetch fc.yahoo.com for a cookie, then
  /v1/test/getcrumb). The chart endpoint does not.
- FCF coverage is computed against the *cash cost* of the dividend
  (shares x trailing dividend per share), not inferred from the payout ratio.
  The two disagree often and the cash version is the one that matters.
- The payout column cannot measure REITs -- they distribute ~90% of taxable
  income and are assessed on FFO, which is non-GAAP and absent from Yahoo.
"""
from __future__ import annotations

import datetime as dt
import re
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

import httpx

UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}

INDEXES = [
    ("https://en.wikipedia.org/wiki/List_of_S%26P_500_companies", "S&P 500"),
    ("https://en.wikipedia.org/wiki/List_of_S%26P_400_companies", "S&P 400"),
    ("https://en.wikipedia.org/wiki/List_of_S%26P_600_companies", "S&P 600"),
]


def _cagr(a, b, years):
    if not a or not b or a <= 0 or b <= 0 or years <= 0:
        return None
    return (b / a) ** (1.0 / years) - 1


def _pc(v, places=2):
    return round(v * 100, places) if v is not None else None


def discover_universe():
    """Current S&P 1500 constituents, scraped from Wikipedia."""
    strip = lambda c: re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", c)).replace("&amp;", "&").strip()
    seen, out = set(), []
    for url, tag in INDEXES:
        html = httpx.get(url, headers=UA, timeout=40, follow_redirects=True).text
        seg = html[html.find("constituents"):]
        seg = seg[:seg.find("</table>")]
        for row in re.findall(r"<tr[^>]*>(.*?)</tr>", seg, re.S):
            cells = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S)
            if len(cells) < 4:
                continue
            sym = strip(cells[0])
            if not re.fullmatch(r"[A-Z][A-Z.\-]{0,6}", sym):
                continue
            ticker = sym.replace(".", "-")
            if ticker in seen:
                continue
            seen.add(ticker)
            out.append({"ticker": ticker, "name": strip(cells[1]),
                        "sector": strip(cells[2]), "industry": strip(cells[3]),
                        "idx": tag})
    return out


def fetch_history(rec, client, today=None):
    """Monthly prices + full dividend history -> aligned CAGRs, streak, cuts.

    Returns None when the company pays nothing, has fewer than three complete
    dividend years, or its price and dividend windows do not overlap.
    """
    today = today or dt.date.today()
    ticker = rec["ticker"]
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
           "?period1=-2208988800&period2=9999999999&interval=1mo&events=div%2Csplit")
    data = None
    for attempt in range(3):
        try:
            r = client.get(url, headers=UA, timeout=45)
            if r.status_code != 200:
                raise RuntimeError(r.status_code)
            data = r.json()["chart"]["result"][0]
            break
        except Exception:
            if attempt == 2:
                return None
            time.sleep(1.5 * (attempt + 1))

    quote = data["indicators"]["quote"][0]
    px = [(dt.datetime.fromtimestamp(a, dt.UTC).date(), c)
          for a, c in zip(data["timestamp"], quote["close"]) if c is not None]
    if len(px) < 36:
        return None
    price = (data.get("meta") or {}).get("regularMarketPrice") or px[-1][1]
    p_start = px[0][0]

    divs = sorted((dt.datetime.fromtimestamp(v["date"], dt.UTC).date(), float(v["amount"]))
                  for v in data.get("events", {}).get("dividends", {}).values()
                  if v.get("amount"))
    if not divs:
        return None
    ttm = sum(a for date, a in divs if (today - date).days <= 366)

    annual, count = defaultdict(float), defaultdict(int)
    for date, amt in divs:
        annual[date.year] += amt
        count[date.year] += 1
    freq = sorted(count.values())[len(count) // 2]
    full = [y for y in sorted(annual) if y < today.year and count[y] >= freq]
    if len(full) < 3:
        return None

    last = full[-1]
    covered = [y for y in full if y >= p_start.year + 1]
    if len(covered) < 3:
        return None
    first = covered[0]
    window = last - first
    at_start = next((c for date, c in px if date.year == first), px[0][1])

    streak = 0
    for y in range(last, full[0], -1):
        if y in annual and (y - 1) in annual and annual[y] > annual[y - 1] + 1e-9:
            streak += 1
        else:
            break
    cuts = sum(1 for i, y in enumerate(full[1:], 1)
               if annual[y] < annual[full[i - 1]] - 1e-9)

    return {
        "ticker": ticker, "name": rec["name"], "idx": rec["idx"],
        "sector": rec["sector"], "industry": rec["industry"],
        "price": round(price, 2), "div_ttm": round(ttm, 4),
        "yield_pct": _pc(ttm / price) if price else None,
        "div_cagr": _pc(_cagr(annual[first], annual[last], window)),
        "price_cagr": _pc(_cagr(at_start, price, window)),
        "win_years": window, "win_from": first,
        "hist_years": round((px[-1][0] - p_start).days / 365.25, 1),
        "streak": streak, "cuts": cuts,
        "annuals": [round(annual[y], 4) for y in full[-16:]],
    }


def _crumbed_client():
    c = httpx.Client(follow_redirects=True, timeout=40)
    c.get("https://fc.yahoo.com", headers=UA)
    crumb = c.get("https://query1.finance.yahoo.com/v1/test/getcrumb",
                  headers=UA).text.strip()
    return c, crumb


def fetch_fundamentals(tickers, progress=None):
    """Payout ratio, free and operating cash flow, shares, revenue growth."""
    client, crumb = _crumbed_client()
    mods = "defaultKeyStatistics,financialData,summaryDetail"
    out = {}

    def one(ticker):
        url = (f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{ticker}"
               f"?modules={mods}&crumb={crumb}")
        for attempt in range(3):
            try:
                r = client.get(url, headers=UA)
                if r.status_code == 429:
                    time.sleep(3 * (attempt + 1))
                    continue
                if r.status_code != 200:
                    return ticker, None
                d = r.json()["quoteSummary"]["result"][0]
                g = lambda m, k: (d.get(m, {}).get(k) or {}).get("raw")
                return ticker, {
                    "payout": g("summaryDetail", "payoutRatio"),
                    "fcf": g("financialData", "freeCashflow"),
                    "ocf": g("financialData", "operatingCashflow"),
                    "shares": g("defaultKeyStatistics", "sharesOutstanding"),
                    "rev_growth": g("financialData", "revenueGrowth"),
                }
            except Exception:
                time.sleep(1.5 * (attempt + 1))
        return ticker, None

    done = 0
    with ThreadPoolExecutor(max_workers=4) as ex:
        for f in as_completed([ex.submit(one, t) for t in tickers]):
            ticker, val = f.result()
            out[ticker] = val
            done += 1
            if progress:
                progress(done)
    return out


def fetch_quotes(tickers):
    """52-week range and moving averages. Batches 50 symbols per call."""
    client, crumb = _crumbed_client()
    out = {}
    for i in range(0, len(tickers), 50):
        url = ("https://query2.finance.yahoo.com/v7/finance/quote?symbols="
               + ",".join(tickers[i:i + 50]) + "&crumb=" + crumb)
        r = None
        for attempt in range(3):
            r = client.get(url, headers=UA)
            if r.status_code == 200:
                break
            time.sleep(2 * (attempt + 1))
        if r is not None and r.status_code == 200:
            for x in r.json()["quoteResponse"]["result"]:
                out[x["symbol"]] = x
        time.sleep(0.3)
    return out


def enrich(row, fundamentals, quote):
    """Fold fundamentals and the current quote into a history row, in place."""
    f = fundamentals or {}
    q = quote or {}
    price = q.get("regularMarketPrice")
    if price:
        row["price"] = round(price, 2)
        row["yield_pct"] = round(row["div_ttm"] / price * 100, 2) if row["div_ttm"] else None

    cost = (f.get("shares") or 0) * (row["div_ttm"] or 0)
    row["fcf_cover"] = round(f["fcf"] / cost, 2) if f.get("fcf") and cost > 0 else None
    row["ocf_cover"] = round(f["ocf"] / cost, 2) if f.get("ocf") and cost > 0 else None
    row["payout_pct"] = _pc(f["payout"], 1) if f.get("payout") is not None else None
    row["rev_growth"] = _pc(f["rev_growth"], 1) if f.get("rev_growth") is not None else None

    lo, hi = q.get("fiftyTwoWeekLow"), q.get("fiftyTwoWeekHigh")
    d200 = q.get("twoHundredDayAverage")
    row["range_52w"] = round((price - lo) / (hi - lo) * 100) if (
        price and hi and lo and hi > lo) else None
    row["vs_200d"] = round(price / d200 * 100 - 100, 1) if (price and d200) else None
    return row
