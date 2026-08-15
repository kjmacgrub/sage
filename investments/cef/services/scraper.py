"""
Fetch fund data. Tries CEFConnect first; falls back to Yahoo Finance
for BDCs and other tickers not listed on CEFConnect.
"""
import re
from datetime import date, datetime, timedelta, timezone
import httpx
from bs4 import BeautifulSoup

HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}

SPECIAL_THRESHOLD = 1.75  # payment ≥ this × median ⇒ flagged special


def _analyze_distributions(ticker: str, price: float) -> dict:
    """
    Detect special distributions and compute a regular-only yield.

    Returns {has_special_dist, regular_yield_pct, last_special_date, last_special_amount}.
    All keys present (values may be None) so callers can pass straight to SQL.
    """
    out = {
        "has_special_dist": 0,
        "regular_yield_pct": None,
        "last_special_date": None,
        "last_special_amount": None,
    }
    if not price:
        return out
    try:
        url = f"https://query2.finance.yahoo.com/v8/finance/chart/{ticker}?range=2y&interval=1mo&events=dividends"
        r = httpx.get(url, headers=HEADERS, timeout=10)
        if r.status_code != 200:
            return out
        divs = r.json()["chart"]["result"][0].get("events", {}).get("dividends", {})
        if not divs:
            return out
        events = []
        for d in divs.values():
            ex = datetime.fromtimestamp(d["date"], tz=timezone.utc).date()
            events.append((ex, float(d["amount"])))
        events.sort()
        if len(events) < 2:
            return out

        amounts_sorted = sorted(a for _, a in events)
        median = amounts_sorted[len(amounts_sorted) // 2]
        if median <= 0:
            return out

        today = date.today()
        # 12-month window
        cutoff = today.replace(year=today.year - 1)

        recent_specials = [
            (ex, a) for ex, a in events
            if ex >= cutoff and a >= median * SPECIAL_THRESHOLD
        ]
        regulars_12m = [
            (ex, a) for ex, a in events
            if ex >= cutoff and a < median * SPECIAL_THRESHOLD
        ]

        out["has_special_dist"] = 1 if recent_specials else 0
        if recent_specials:
            last = recent_specials[-1]
            out["last_special_date"] = last[0].isoformat()
            out["last_special_amount"] = round(last[1], 4)

        if regulars_12m:
            n_reg = len(regulars_12m)
            freq_map = {1: 1, 2: 2, 3: 4, 4: 4, 6: 6, 11: 12, 12: 12, 13: 12}
            periods = freq_map.get(n_reg, 12 if n_reg > 12 else n_reg)
            out["regular_yield_pct"] = round(median * periods / price * 100, 2)
    except Exception:
        pass
    return out


def _compute_nav_cagr(ticker: str) -> float:
    """Fetch 5Y weekly NAV history and return annualized NAV CAGR, or None."""
    try:
        r = httpx.get(
            f"https://www.cefconnect.com/api/v3/pricinghistory/{ticker}/5Y",
            headers=HEADERS, timeout=10,
        )
        if r.status_code != 200:
            return None
        rows = r.json().get("Data", {}).get("PriceHistory", [])
        if len(rows) < 2:
            return None
        # 5Y returns oldest-first; sort by date to be safe
        rows_sorted = sorted(rows, key=lambda x: x["DataDate"])
        nav_start = rows_sorted[0].get("NAVData")
        nav_end = rows_sorted[-1].get("NAVData")
        d1 = datetime.fromisoformat(rows_sorted[0]["DataDate"].split("T")[0])
        d2 = datetime.fromisoformat(rows_sorted[-1]["DataDate"].split("T")[0])
        years = (d2 - d1).days / 365.25
        if nav_start and nav_end and nav_start > 0 and years >= 0.5:
            return round(((nav_end / nav_start) ** (1 / years) - 1) * 100, 2)
    except Exception:
        pass
    return None


def _compute_dist_cagr(ticker: str) -> float:
    """
    Fetch full dividend history from Yahoo Finance (range=max) and return the
    annualized CAGR of annual distributions (first complete year → last complete year).
    """
    try:
        url = f"https://query2.finance.yahoo.com/v8/finance/chart/{ticker}?range=max&interval=3mo&events=dividends"
        r = httpx.get(url, headers=HEADERS, timeout=15)
        if r.status_code != 200:
            return None
        result = r.json()["chart"]["result"][0]
        divs = result.get("events", {}).get("dividends", {})
        if not divs:
            return None

        year_totals = {}
        for d in divs.values():
            ex_date = datetime.fromtimestamp(d["date"], tz=timezone.utc).date()
            year = ex_date.year
            year_totals[year] = year_totals.get(year, 0) + float(d["amount"])

        current_year = date.today().year
        complete = {y: t for y, t in year_totals.items() if y < current_year}
        if len(complete) < 2:
            return None

        years_sorted = sorted(complete.keys())
        first_yr, last_yr = years_sorted[0], years_sorted[-1]
        first_total, last_total = complete[first_yr], complete[last_yr]
        n = last_yr - first_yr
        if first_total > 0 and n >= 1:
            return round(((last_total / first_total) ** (1 / n) - 1) * 100, 2)
    except Exception:
        pass
    return None


def _compute_yield_metrics(ticker: str) -> dict:
    """
    Earned yield (total return on NAV) vs distributed yield (distributions / NAV),
    annualized, for the trailing 1 year and for the full available history
    (up to 5 years from CEFConnect, or since inception for younger funds).

    earned − distributed ≈ the NAV growth rate: when earned ≥ distributed the
    distribution is being out-earned (NAV holding/growing); when earned <
    distributed the payout is eroding NAV (effectively ROC-funded).

    All five keys are always present (values may be None) so callers can pass
    the dict straight to SQL. Only meaningful for CEFs on CEFConnect.
    """
    out = {
        "earned_yield_1y": None, "dist_yield_1y": None,
        "earned_yield_life": None, "dist_yield_life": None,
        "yield_life_years": None,
    }

    # 1. Weekly NAV series (≤5Y) from CEFConnect
    try:
        r = httpx.get(
            f"https://www.cefconnect.com/api/v3/pricinghistory/{ticker}/5Y",
            headers=HEADERS, timeout=10,
        )
        if r.status_code != 200:
            return out
        rows = r.json().get("Data", {}).get("PriceHistory", [])
        navs = []
        for x in rows:
            dd = (x.get("DataDate") or "").split("T")[0]
            nv = x.get("NAVData")
            if dd and nv and nv > 0:
                navs.append((datetime.fromisoformat(dd).date(), nv))
        navs.sort()
        if len(navs) < 2:
            return out
    except Exception:
        return out

    # 2. Full distribution history from Yahoo
    divs = []
    try:
        url = f"https://query2.finance.yahoo.com/v8/finance/chart/{ticker}?range=max&interval=1mo&events=dividends"
        dr = httpx.get(url, headers=HEADERS, timeout=15)
        if dr.status_code == 200:
            ev = dr.json()["chart"]["result"][0].get("events", {}).get("dividends", {})
            for v in ev.values():
                ex = datetime.fromtimestamp(v["date"], tz=timezone.utc).date()
                divs.append((ex, float(v["amount"])))
            divs.sort()
    except Exception:
        pass

    end_date, nav_end = navs[-1]

    def _metrics(start_date, nav_start):
        """Annualized (earned, distributed) over (start_date, end_date]."""
        years = (end_date - start_date).days / 365.25
        if years < 0.5 or not nav_start:
            return None, None
        dist_sum = sum(a for ex, a in divs if start_date < ex <= end_date)
        simple_tr = (nav_end - nav_start + dist_sum) / nav_start
        earned = ((1 + simple_tr) ** (1 / years) - 1) * 100
        distributed = (dist_sum / years) / nav_start * 100
        return round(earned, 2), round(distributed, 2)

    # Lifetime: full available series
    start_date, nav_start = navs[0]
    out["earned_yield_life"], out["dist_yield_life"] = _metrics(start_date, nav_start)
    out["yield_life_years"] = round((end_date - start_date).days / 365.25, 1)

    # Trailing 1 year: anchor on the NAV reading closest to 365 days before end
    target = end_date - timedelta(days=365)
    anchor = min(navs, key=lambda t: abs((t[0] - target).days))
    if anchor[0] < end_date and abs((anchor[0] - target).days) <= 45:
        out["earned_yield_1y"], out["dist_yield_1y"] = _metrics(anchor[0], anchor[1])

    return out


def fetch_fund_data(ticker: str) -> dict:
    ticker = ticker.upper()
    data = _fetch_cefconnect(ticker)
    if data.get("price") is None:
        # CEFConnect had no data — try Yahoo Finance
        data = _fetch_yahoo(ticker)
    return data


def cefconnect_history(ticker: str, window: str = "5Y") -> list[dict]:
    """Price/NAV history for a window, always sorted oldest-first.

    The API's own ordering is NOT consistent across windows — /5D comes back
    newest-first while /1Y and /5Y come back oldest-first — so never rely on
    row position. Always sort by DataDate.
    """
    try:
        r = httpx.get(
            f"https://www.cefconnect.com/api/v3/pricinghistory/{ticker}/{window}",
            headers=HEADERS, timeout=10,
        )
        if r.status_code != 200:
            return []
        rows = r.json().get("Data", {}).get("PriceHistory", [])
    except Exception:
        return []

    out = []
    for row in rows or []:
        row_date = (row.get("DataDate") or "").split("T")[0]
        if not row_date:
            continue
        row_price, row_nav, row_disc = row.get("Data"), row.get("NAVData"), row.get("DiscountData")
        if row_disc is None and row_price and row_nav:
            row_disc = (row_price / row_nav - 1) * 100
        out.append({
            "ticker": ticker,
            "date": row_date,
            "price": round(row_price, 4) if row_price else None,
            "nav": round(row_nav, 4) if row_nav else None,
            "premium_discount": round(row_disc, 2) if row_disc is not None else None,
        })
    out.sort(key=lambda r: r["date"])
    return out


def _fetch_cefconnect(ticker: str) -> dict:
    # Step 1: latest price, NAV, discount from the JSON API.
    # Fall back to wider windows before giving up: funds that report NAV weekly
    # rather than daily (SPE, for one) return zero rows for a 5-day window, which
    # would otherwise look identical to "this ticker doesn't exist".
    price = nav = premium_discount = None
    price_history = []
    rows = []
    for window in ("5D", "1Y", "5Y"):
        rows = cefconnect_history(ticker, window)
        if any(r.get("nav") for r in rows):
            break
    if rows:
        latest = rows[-1]  # sorted oldest-first
        price = latest.get("price")
        nav = latest.get("nav")
        premium_discount = latest.get("premium_discount")
        data_date = latest.get("date") or date.today().isoformat()
        # Keep recent prior days for gap-filling; a 5Y fallback series would
        # otherwise dump years of weekly rows into the daily prices table.
        price_history = [r for r in rows[:-1] if r.get("price")][-10:]

    if price is None:
        return _empty(ticker)

    # Step 1a: weekly-NAV funds carry a stale CEFConnect price, which throws the
    # discount off. Take the live price from Yahoo and recompute against the
    # latest NAV so the discount reflects today rather than last Friday.
    try:
        stale_days = (date.today() - datetime.fromisoformat(data_date).date()).days
        if stale_days > 2:
            live = _yahoo_quote(ticker)
            if live:
                price = live
                data_date = date.today().isoformat()
                if nav:
                    premium_discount = round((price / nav - 1) * 100, 2)
    except Exception:
        pass

    # Step 1b: fetch 1Y history for average discount and 5Y for NAV CAGR
    avg_discount_1y = None
    try:
        hist_url = f"https://www.cefconnect.com/api/v3/pricinghistory/{ticker}/1Y"
        hr = httpx.get(hist_url, headers=HEADERS, timeout=10)
        if hr.status_code == 200:
            hist_rows = hr.json().get("Data", {}).get("PriceHistory", [])
            discounts = [r["DiscountData"] for r in hist_rows if r.get("DiscountData") is not None]
            if discounts:
                avg_discount_1y = round(sum(discounts) / len(discounts), 2)
    except Exception:
        pass

    nav_cagr = _compute_nav_cagr(ticker)
    yield_metrics = _compute_yield_metrics(ticker)

    # Step 2: get distribution data from the fund page HTML
    yield_pct = distribution = dist_freq = None
    try:
        page = httpx.get(f"https://www.cefconnect.com/fund/{ticker}",
                         headers=HEADERS, timeout=15, follow_redirects=True)
        if page.status_code == 200:
            soup = BeautifulSoup(page.text, "html.parser")

            def find_td_value(label_pattern):
                """Find value in next <td> after a <td> containing label text."""
                el = soup.find(string=re.compile(label_pattern, re.I))
                if el:
                    td = el.find_parent("td")
                    if td:
                        sib = td.find_next_sibling("td")
                        if sib:
                            return sib.get_text(strip=True)
                return None

            def parse_float(s):
                if not s:
                    return None
                s = re.sub(r"[%$,\s]", "", s)
                try:
                    return float(s)
                except ValueError:
                    return None

            yield_pct = parse_float(find_td_value(r"Distribution Rate"))
            distribution = parse_float(find_td_value(r"Distribution Amount"))
            dist_freq_raw = find_td_value(r"Distribution Frequency")
            dist_freq = dist_freq_raw.strip() if dist_freq_raw else None
    except Exception:
        pass

    special = _analyze_distributions(ticker, price)
    if special["has_special_dist"] and special["regular_yield_pct"] is not None:
        # Only override when the recalc actually excludes specials (lower than source).
        # If it comes out higher, the median was contaminated by a policy change
        # (old larger regulars vs. new smaller ones) — keep the source value.
        if yield_pct is None or special["regular_yield_pct"] < yield_pct:
            yield_pct = special["regular_yield_pct"]

    return {
        "ticker": ticker,
        "name": None,
        "date": data_date,
        "price": round(price, 4) if price else None,
        "nav": round(nav, 4) if nav else None,
        "premium_discount": premium_discount,
        "avg_discount_1y": avg_discount_1y,
        "nav_cagr": nav_cagr,
        "yield_pct": yield_pct,
        "distribution": distribution,
        "dist_freq": dist_freq,
        "has_special_dist": special["has_special_dist"],
        "regular_yield_pct": special["regular_yield_pct"],
        "last_special_date": special["last_special_date"],
        "last_special_amount": special["last_special_amount"],
        **yield_metrics,
        "history": price_history,
    }


def _yahoo_quote(ticker: str) -> float | None:
    """Just the live last price — used to refresh a stale CEFConnect quote."""
    try:
        r = httpx.get(
            f"https://query2.finance.yahoo.com/v8/finance/chart/{ticker}?range=1d&interval=1d",
            headers=HEADERS, timeout=10,
        )
        if r.status_code != 200:
            return None
        return r.json()["chart"]["result"][0]["meta"].get("regularMarketPrice")
    except Exception:
        return None


def _fetch_yahoo(ticker: str) -> dict:
    """Fallback for BDCs and other tickers not on CEFConnect."""
    url = f"https://query2.finance.yahoo.com/v8/finance/chart/{ticker}?range=1y&interval=1mo&events=dividends"
    try:
        resp = httpx.get(url, headers=HEADERS, timeout=10)
        resp.raise_for_status()
        result = resp.json()["chart"]["result"][0]
        meta = result["meta"]
        price = meta.get("regularMarketPrice")
        long_name = meta.get("longName") or meta.get("shortName") or ticker
        # Use actual market data date, not today
        market_time = meta.get("regularMarketTime")
        if market_time:
            from datetime import timezone, timedelta
            ET = timezone(timedelta(hours=-5))
            data_date = datetime.fromtimestamp(market_time, tz=ET).strftime("%Y-%m-%d")
        else:
            data_date = date.today().isoformat()

        # Calculate yield and frequency from last 12 months of dividend history
        yield_pct = None
        dist_freq = None
        distribution = None
        divs = result.get("events", {}).get("dividends", {})
        if divs and price:
            amounts = [d["amount"] for d in divs.values()]
            annual_total = sum(amounts)
            count = len(amounts)
            if annual_total and price:
                yield_pct = round((annual_total / price) * 100, 2)
            if amounts:
                distribution = round(amounts[-1], 4)  # most recent payment
            freq_map = {1: "Annual", 2: "Semi-Annual", 3: "Quarterly", 4: "Quarterly",
                        6: "Bi-Monthly", 11: "Monthly", 12: "Monthly", 13: "Monthly"}
            dist_freq = freq_map.get(count)

        special = _analyze_distributions(ticker, price)
        if special["has_special_dist"] and special["regular_yield_pct"] is not None:
            if yield_pct is None or special["regular_yield_pct"] < yield_pct:
                yield_pct = special["regular_yield_pct"]

        return {
            "ticker": ticker,
            "name": long_name,
            "date": data_date,
            "price": round(price, 2) if price else None,
            "nav": None,
            "premium_discount": None,
            "avg_discount_1y": None,
            "nav_cagr": None,
            "yield_pct": yield_pct,
            "distribution": distribution,
            "dist_freq": dist_freq,
            "has_special_dist": special["has_special_dist"],
            "regular_yield_pct": special["regular_yield_pct"],
            "last_special_date": special["last_special_date"],
            "last_special_amount": special["last_special_amount"],
            # Earned-vs-distributed needs a NAV series (CEFConnect only); N/A for Yahoo tickers
            "earned_yield_1y": None, "dist_yield_1y": None,
            "earned_yield_life": None, "dist_yield_life": None, "yield_life_years": None,
        }
    except Exception as e:
        raise RuntimeError(f"Yahoo Finance fetch failed for {ticker}: {e}")


def fetch_dividends(ticker: str, since: str = None) -> list:
    """
    Fetch dividend history from Yahoo Finance.
    Returns list of {ex_date, amount} for distributions on or after `since` (YYYY-MM-DD)
    and on or before today. Sorted oldest-first.
    """
    url = f"https://query2.finance.yahoo.com/v8/finance/chart/{ticker}?range=2y&interval=1mo&events=dividends"
    try:
        resp = httpx.get(url, headers=HEADERS, timeout=10)
        resp.raise_for_status()
        result = resp.json()["chart"]["result"][0]
        divs = result.get("events", {}).get("dividends", {})
        today = date.today()
        since_date = date.fromisoformat(since) if since else None
        out = []
        for d in divs.values():
            ex_date = datetime.fromtimestamp(d["date"], tz=timezone.utc).date()
            if ex_date > today:
                continue  # future — not yet paid
            if since_date and ex_date < since_date:
                continue  # older than tracking window
            out.append({"ex_date": ex_date.isoformat(), "amount": d["amount"]})
        return sorted(out, key=lambda x: x["ex_date"])
    except Exception as e:
        raise RuntimeError(f"fetch_dividends failed for {ticker}: {e}")


def _fetch_5d_rows(ticker: str) -> list:
    """Fetch CEFConnect 5D price history and return list of {ticker, date, price, nav, premium_discount}."""
    try:
        r = httpx.get(
            f"https://www.cefconnect.com/api/v3/pricinghistory/{ticker}/5D",
            headers=HEADERS, timeout=10,
        )
        if r.status_code != 200:
            return []
        rows = r.json().get("Data", {}).get("PriceHistory", [])
        out = []
        for row in rows:
            row_date = (row.get("DataDate") or "").split("T")[0]
            row_price = row.get("Data")
            row_nav = row.get("NAVData")
            row_disc = row.get("DiscountData")
            if not (row_date and row_price):
                continue
            if row_disc is None and row_price and row_nav:
                row_disc = round((row_price / row_nav - 1) * 100, 2)
            out.append({
                "ticker": ticker,
                "date": row_date,
                "price": round(row_price, 4),
                "nav": round(row_nav, 4) if row_nav else None,
                "premium_discount": round(row_disc, 2) if row_disc is not None else None,
            })
        return out
    except Exception:
        return []


def _fetch_yahoo_5d(ticker: str) -> list:
    """Yahoo Finance fallback for tickers not on CEFConnect (BDCs etc)."""
    try:
        r = httpx.get(
            f"https://query2.finance.yahoo.com/v8/finance/chart/{ticker}?range=5d&interval=1d",
            headers=HEADERS, timeout=10,
        )
        if r.status_code != 200:
            return []
        result = r.json()["chart"]["result"][0]
        timestamps = result.get("timestamp", [])
        closes = result.get("indicators", {}).get("quote", [{}])[0].get("close", [])
        # Build date→close map using Eastern timezone
        from datetime import timezone, timedelta
        ET = timezone(timedelta(hours=-5))  # EST (close enough; DST ignored)
        date_close = {}
        for ts, c in zip(timestamps, closes):
            if c is None:
                continue
            d = datetime.fromtimestamp(ts, tz=ET).strftime("%Y-%m-%d")
            date_close[d] = round(c, 4)
        # Return sorted newest-first, same shape as _fetch_5d_rows
        out = []
        for d in sorted(date_close, reverse=True):
            out.append({"ticker": ticker, "date": d, "price": date_close[d], "nav": None, "premium_discount": None})
        return out
    except Exception:
        return []


def fetch_quick_prices(tickers: list) -> dict:
    """Parallel 5D fetch for all tickers: CEFConnect primary, Yahoo fallback. Returns {ticker: [rows]}."""
    from concurrent.futures import ThreadPoolExecutor, as_completed

    def fetch_one(ticker):
        rows = _fetch_5d_rows(ticker)
        if not rows:
            rows = _fetch_yahoo_5d(ticker)
        return ticker, rows

    results = {}
    with ThreadPoolExecutor(max_workers=10) as ex:
        futures = {ex.submit(fetch_one, t): t for t in tickers}
        for f in as_completed(futures):
            ticker, rows = f.result()
            results[ticker] = rows
    return results


def fetch_cef_list() -> list:
    """Return [{Ticker, Name}, ...] for all CEFs on CEFConnect (~368 funds)."""
    r = httpx.get("https://www.cefconnect.com/api/v3/funds?take=500", headers=HEADERS, timeout=15)
    r.raise_for_status()
    return r.json()


def fetch_screener_data(ticker: str):
    """
    Comprehensive per-fund fetch for the screener cache.
    Returns None if the ticker is not found on CEFConnect.
    """
    ticker = ticker.upper()
    price = nav = premium_discount = avg_discount_1y = nav_change_1y = None

    try:
        r = httpx.get(
            f"https://www.cefconnect.com/api/v3/pricinghistory/{ticker}/1Y",
            headers=HEADERS, timeout=10,
        )
        if r.status_code == 200:
            rows = r.json().get("Data", {}).get("PriceHistory", [])
            # The 1Y endpoint returns oldest-first (unlike the 5D endpoint), so newest is at the end.
            if rows:
                rows_sorted = sorted(rows, key=lambda x: x.get("DataDate") or "")
                latest = rows_sorted[-1]
                oldest = rows_sorted[0]
                price = latest.get("Data")
                nav = latest.get("NAVData")
                disc = latest.get("DiscountData")
                if disc is not None:
                    premium_discount = round(disc, 2)
                elif price and nav:
                    premium_discount = round((price / nav - 1) * 100, 2)
                discounts = [r["DiscountData"] for r in rows_sorted if r.get("DiscountData") is not None]
                if discounts:
                    avg_discount_1y = round(sum(discounts) / len(discounts), 2)
                nav_first = oldest.get("NAVData")
                nav_last = latest.get("NAVData")
                if nav_first and nav_last:
                    nav_change_1y = round((nav_last - nav_first) / nav_first * 100, 2)
    except Exception:
        pass

    if price is None:
        return None

    # NAV CAGR from 5Y history; distribution CAGR from full history
    nav_cagr = _compute_nav_cagr(ticker)
    dist_cagr = _compute_dist_cagr(ticker)
    yield_metrics = _compute_yield_metrics(ticker)

    yield_pct = dist_freq = inception_date = category = None
    try:
        page = httpx.get(
            f"https://www.cefconnect.com/fund/{ticker}",
            headers=HEADERS, timeout=15, follow_redirects=True,
        )
        if page.status_code == 200:
            soup = BeautifulSoup(page.text, "html.parser")

            def find_td(label):
                el = soup.find(string=re.compile(label, re.I))
                if el:
                    td = el.find_parent("td")
                    if td:
                        sib = td.find_next_sibling("td")
                        if sib:
                            return sib.get_text(strip=True)
                return None

            def pf(s):
                if not s:
                    return None
                try:
                    return float(re.sub(r"[%$,\s]", "", s))
                except ValueError:
                    return None

            yield_pct = pf(find_td(r"Distribution Rate"))
            freq_raw = find_td(r"Distribution Frequency")
            dist_freq = freq_raw.strip() if freq_raw else None
            inception_raw = find_td(r"Inception Date:")
            if inception_raw:
                try:
                    from datetime import datetime as _dt
                    inception_date = _dt.strptime(inception_raw, "%m/%d/%Y").date().isoformat()
                except Exception:
                    pass
            category = find_td(r"Category:")
    except Exception:
        pass

    special = _analyze_distributions(ticker, price)
    if special["has_special_dist"] and special["regular_yield_pct"] is not None:
        if yield_pct is None or special["regular_yield_pct"] < yield_pct:
            yield_pct = special["regular_yield_pct"]

    return {
        "ticker": ticker,
        "price": round(price, 4),
        "nav": round(nav, 4) if nav else None,
        "premium_discount": premium_discount,
        "avg_discount_1y": avg_discount_1y,
        "nav_change_1y": nav_change_1y,
        "nav_cagr": nav_cagr,
        "yield_pct": yield_pct,
        "dist_freq": dist_freq,
        "inception_date": inception_date,
        "category": category,
        "dist_cagr": dist_cagr,
        "has_special_dist": special["has_special_dist"],
        "regular_yield_pct": special["regular_yield_pct"],
        "last_special_date": special["last_special_date"],
        "last_special_amount": special["last_special_amount"],
        **yield_metrics,
    }


def _empty(ticker: str) -> dict:
    return {
        "ticker": ticker,
        "name": None,
        "date": date.today().isoformat(),
        "price": None,
        "nav": None,
        "premium_discount": None,
        "avg_discount_1y": None,
        "nav_cagr": None,
        "yield_pct": None,
        "distribution": None,
        "dist_freq": None,
        "has_special_dist": 0,
        "regular_yield_pct": None,
        "last_special_date": None,
        "last_special_amount": None,
        "earned_yield_1y": None, "dist_yield_1y": None,
        "earned_yield_life": None, "dist_yield_life": None, "yield_life_years": None,
    }
