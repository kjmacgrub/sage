"""
Fetch fund data. Tries CEFConnect first; falls back to Yahoo Finance
for BDCs and other tickers not listed on CEFConnect.
"""
import re
from datetime import date, datetime, timezone
import httpx
from bs4 import BeautifulSoup

HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}


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


def fetch_fund_data(ticker: str) -> dict:
    ticker = ticker.upper()
    data = _fetch_cefconnect(ticker)
    if data.get("price") is None:
        # CEFConnect had no data — try Yahoo Finance
        data = _fetch_yahoo(ticker)
    return data


def _fetch_cefconnect(ticker: str) -> dict:
    # Step 1: get latest price, NAV, discount from the JSON API
    price = nav = premium_discount = None
    price_history = []
    try:
        api_url = f"https://www.cefconnect.com/api/v3/pricinghistory/{ticker}/5D"
        r = httpx.get(api_url, headers=HEADERS, timeout=10)
        if r.status_code == 200:
            rows = r.json().get("Data", {}).get("PriceHistory", [])
            if rows:
                latest = rows[0]  # most recent first
                price = latest.get("Data")
                nav = latest.get("NAVData")
                disc = latest.get("DiscountData")
                data_date = (latest.get("DataDate") or "").split("T")[0] or date.today().isoformat()
                if disc is not None:
                    premium_discount = round(disc, 2)
                elif price and nav:
                    premium_discount = round((price / nav - 1) * 100, 2)
                # Collect prior days for gap-filling
                for row in rows[1:]:
                    row_date = (row.get("DataDate") or "").split("T")[0]
                    row_price = row.get("Data")
                    row_nav = row.get("NAVData")
                    row_disc = row.get("DiscountData")
                    if row_date and row_price:
                        if row_disc is None and row_price and row_nav:
                            row_disc = round((row_price / row_nav - 1) * 100, 2)
                        price_history.append({
                            "ticker": ticker,
                            "date": row_date,
                            "price": round(row_price, 4),
                            "nav": round(row_nav, 4) if row_nav else None,
                            "premium_discount": round(row_disc, 2) if row_disc is not None else None,
                        })
    except Exception:
        pass

    if price is None:
        return _empty(ticker)

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
        "history": price_history,
    }


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
            if rows:
                latest = rows[0]
                price = latest.get("Data")
                nav = latest.get("NAVData")
                disc = latest.get("DiscountData")
                if disc is not None:
                    premium_discount = round(disc, 2)
                elif price and nav:
                    premium_discount = round((price / nav - 1) * 100, 2)
                discounts = [r["DiscountData"] for r in rows if r.get("DiscountData") is not None]
                if discounts:
                    avg_discount_1y = round(sum(discounts) / len(discounts), 2)
                nav_vals = [r["NAVData"] for r in rows if r.get("NAVData") is not None]
                if len(nav_vals) >= 2:
                    nav_change_1y = round((nav_vals[0] - nav_vals[-1]) / nav_vals[-1] * 100, 2)
    except Exception:
        pass

    if price is None:
        return None

    # NAV CAGR from 5Y history; distribution CAGR from full history
    nav_cagr = _compute_nav_cagr(ticker)
    dist_cagr = _compute_dist_cagr(ticker)

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
    }
