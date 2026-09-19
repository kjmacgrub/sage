#!/usr/bin/env python3
"""
build.py — rebuild the dividend-growth screener dataset.

Pulls the S&P 1500 (500 + MidCap 400 + SmallCap 600) from Wikipedia, then for
each ticker fetches split-adjusted monthly prices, the full dividend history,
trailing fundamentals and a current quote from Yahoo. Writes screen_data.json,
which render.py embeds into the page.

    python3 build.py                # full rebuild, ~10 min
    python3 build.py --quotes-only  # refresh prices / 52-week position only

Key methodology choice: dividend CAGR and price CAGR are measured over the SAME
window — the first full dividend year the price series also covers, through the
last complete calendar year. Yahoo returns dividends back to 1962 but monthly
prices only to ~1985 for most names, so measuring each over its own span
flatters one against the other (KO: 9.24%/10.58% aligned vs 9.58%/10.75% not).
"""
import httpx, json, re, sys, time, datetime as dt
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'}
TODAY = dt.date.today()
OUT = 'screen_data.json'
INDEXES = [
    ('https://en.wikipedia.org/wiki/List_of_S%26P_500_companies', 'S&P 500'),
    ('https://en.wikipedia.org/wiki/List_of_S%26P_400_companies', 'S&P 400'),
    ('https://en.wikipedia.org/wiki/List_of_S%26P_600_companies', 'S&P 600'),
]


def cagr(a, b, years):
    if not a or not b or a <= 0 or b <= 0 or years <= 0:
        return None
    return (b / a) ** (1.0 / years) - 1


def universe():
    """Scrape current constituents. Wikipedia tables carry id="constituents"."""
    strip = lambda c: re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', c)).replace('&amp;', '&').strip()
    seen, out = set(), []
    for url, tag in INDEXES:
        html = httpx.get(url, headers=UA, timeout=40, follow_redirects=True).text
        seg = html[html.find('constituents'):]
        seg = seg[:seg.find('</table>')]
        n = 0
        for row in re.findall(r'<tr[^>]*>(.*?)</tr>', seg, re.S):
            cells = re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', row, re.S)
            if len(cells) < 4:
                continue
            sym = strip(cells[0])
            if not re.fullmatch(r'[A-Z][A-Z.\-]{0,6}', sym):
                continue
            t = sym.replace('.', '-')
            if t in seen:
                continue
            seen.add(t)
            out.append({'t': t, 'n': strip(cells[1]), 's': strip(cells[2]),
                        'i': strip(cells[3]), 'ix': tag})
            n += 1
        print(f'  {tag}: {n}', flush=True)
    return out


def history(rec, client):
    """Monthly prices + full dividend history -> aligned CAGRs, streak, cuts."""
    t = rec['t']
    url = (f'https://query1.finance.yahoo.com/v8/finance/chart/{t}'
           '?period1=-2208988800&period2=9999999999&interval=1mo&events=div%2Csplit')
    for attempt in range(3):
        try:
            r = client.get(url, headers=UA, timeout=45)
            if r.status_code != 200:
                raise RuntimeError(r.status_code)
            d = r.json()['chart']['result'][0]
            break
        except Exception as e:
            if attempt == 2:
                return None
            time.sleep(1.5 * (attempt + 1))
    q = d['indicators']['quote'][0]
    px = [(dt.datetime.fromtimestamp(a, dt.UTC).date(), c)
          for a, c in zip(d['timestamp'], q['close']) if c is not None]
    if len(px) < 36:
        return None
    price = (d.get('meta') or {}).get('regularMarketPrice') or px[-1][1]
    pstart, _ = px[0]

    divs = sorted((dt.datetime.fromtimestamp(v['date'], dt.UTC).date(), float(v['amount']))
                  for v in d.get('events', {}).get('dividends', {}).values() if v.get('amount'))
    if not divs:
        return None
    ttm = sum(a for date, a in divs if (TODAY - date).days <= 366)
    ann, cnt = defaultdict(float), defaultdict(int)
    for date, a in divs:
        ann[date.year] += a
        cnt[date.year] += 1
    freq = sorted(cnt.values())[len(cnt) // 2]
    full = [y for y in sorted(ann) if y < TODAY.year and cnt[y] >= freq]
    if len(full) < 3:
        return None
    last = full[-1]
    # aligned window: first full dividend year the price series also covers
    base = [y for y in full if y >= pstart.year + 1]
    if len(base) < 3:
        return None
    first = base[0]
    window = last - first
    at_start = next((c for date, c in px if date.year == first), px[0][1])

    streak = 0
    for y in range(last, full[0], -1):
        if y in ann and (y - 1) in ann and ann[y] > ann[y - 1] + 1e-9:
            streak += 1
        else:
            break
    cuts = sum(1 for i, y in enumerate(full[1:], 1) if ann[y] < ann[full[i - 1]] - 1e-9)

    pc = lambda v: round(v * 100, 2) if v is not None else None
    return {**rec, 'p': round(price, 2), 'ttm': round(ttm, 4),
            'y': pc(ttm / price) if price else None,
            'd': pc(cagr(ann[first], ann[last], window)),
            'x': pc(cagr(at_start, price, window)),
            'w': window, 'h': round((px[-1][0] - pstart).days / 365.25, 1),
            'k': streak, 'c': cuts,
            'a': [round(ann[y], 4) for y in full[-16:]]}


def crumbed():
    c = httpx.Client(follow_redirects=True, timeout=40)
    c.get('https://fc.yahoo.com', headers=UA)
    return c, c.get('https://query1.finance.yahoo.com/v1/test/getcrumb', headers=UA).text.strip()


def fundamentals(tickers):
    """payout ratio, free & operating cash flow, shares, revenue growth."""
    c, crumb = crumbed()
    mods = 'defaultKeyStatistics,financialData,summaryDetail'
    out = {}

    def one(t):
        u = f'https://query2.finance.yahoo.com/v10/finance/quoteSummary/{t}?modules={mods}&crumb={crumb}'
        for a in range(3):
            try:
                r = c.get(u, headers=UA)
                if r.status_code == 429:
                    time.sleep(3 * (a + 1)); continue
                if r.status_code != 200:
                    return t, None
                d = r.json()['quoteSummary']['result'][0]
                g = lambda m, k: (d.get(m, {}).get(k) or {}).get('raw')
                return t, {'payout': g('summaryDetail', 'payoutRatio'),
                           'fcf': g('financialData', 'freeCashflow'),
                           'ocf': g('financialData', 'operatingCashflow'),
                           'sh': g('defaultKeyStatistics', 'sharesOutstanding'),
                           'revg': g('financialData', 'revenueGrowth')}
            except Exception:
                time.sleep(1.5 * (a + 1))
        return t, None

    n = 0
    with ThreadPoolExecutor(max_workers=4) as ex:
        for f in as_completed([ex.submit(one, t) for t in tickers]):
            t, v = f.result(); out[t] = v; n += 1
            if n % 100 == 0:
                print(f'  fundamentals {n}/{len(tickers)}', flush=True)
    return out


def quotes(tickers):
    """Batched — 50 symbols per call. 52-week range and moving averages."""
    c, crumb = crumbed()
    out = {}
    for i in range(0, len(tickers), 50):
        u = ('https://query2.finance.yahoo.com/v7/finance/quote?symbols='
             + ','.join(tickers[i:i + 50]) + '&crumb=' + crumb)
        for a in range(3):
            r = c.get(u, headers=UA)
            if r.status_code == 200:
                break
            time.sleep(2 * (a + 1))
        if r.status_code == 200:
            for x in r.json()['quoteResponse']['result']:
                out[x['symbol']] = x
        time.sleep(0.3)
    return out


def merge(rows, fund, quote):
    for r in rows:
        f = fund.get(r['t']) or {}
        x = quote.get(r['t']) or {}
        p = x.get('regularMarketPrice')
        if p:
            r['p'] = round(p, 2)
            r['y'] = round(r['ttm'] / p * 100, 2)
        cost = (f.get('sh') or 0) * r['ttm']
        r['fc'] = round(f['fcf'] / cost, 2) if f.get('fcf') and cost > 0 else None
        r['oc'] = round(f['ocf'] / cost, 2) if f.get('ocf') and cost > 0 else None
        r['pr'] = round(f['payout'] * 100, 1) if f.get('payout') is not None else None
        r['rg'] = round(f['revg'] * 100, 1) if f.get('revg') is not None else None
        lo, hi = x.get('fiftyTwoWeekLow'), x.get('fiftyTwoWeekHigh')
        d200 = x.get('twoHundredDayAverage')
        r['rg52'] = round((p - lo) / (hi - lo) * 100) if (p and hi and lo and hi > lo) else None
        r['m200'] = round(p / d200 * 100 - 100, 1) if (p and d200) else None
        r.pop('ttm', None)
    return rows


def main():
    if '--quotes-only' in sys.argv:
        rows = json.load(open(OUT))
        print(f'refreshing quotes for {len(rows)} names')
        # ttm was dropped on the last write; recover it from yield x price
        for r in rows:
            r['ttm'] = r['y'] / 100 * r['p'] if r.get('y') else 0
        rows = merge(rows, {}, quotes([r['t'] for r in rows]))
        json.dump(rows, open(OUT, 'w'), separators=(',', ':'))
        print(f'wrote {OUT}')
        return

    print('universe:')
    uni = universe()
    print(f'  total unique: {len(uni)}')

    print('price + dividend history:')
    rows, n = [], 0
    with httpx.Client(limits=httpx.Limits(max_connections=8)) as client:
        with ThreadPoolExecutor(max_workers=6) as ex:
            for f in as_completed([ex.submit(history, r, client) for r in uni]):
                v = f.result(); n += 1
                if v:
                    rows.append(v)
                if n % 100 == 0:
                    print(f'  {n}/{len(uni)} fetched, {len(rows)} usable', flush=True)
    print(f'  {len(rows)} of {len(uni)} have measurable dividend history')

    tick = [r['t'] for r in rows]
    print('fundamentals:')
    fund = fundamentals(tick)
    print('quotes:')
    quote = quotes(tick)
    rows = merge(rows, fund, quote)
    json.dump(rows, open(OUT, 'w'), separators=(',', ':'))
    print(f'wrote {OUT} — {len(rows)} records, {len(open(OUT).read())/1024:.0f} KB')


if __name__ == '__main__':
    main()
