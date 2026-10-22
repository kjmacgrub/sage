#!/usr/bin/env python3
"""
QQQ Leap replay: the entry gate and the contract cap, measured outside Option Omega.

Replays the live rule on QQQ daily closes from 2000 (OO's QQQ chain starts 2017
and goes blank after 2026-02-12, so neither the dot-com bear nor 2008 is in any
OO run). Entry: close >= 1.75% below the open, gate as chosen. Position: call at
0.975 x spot, 360 DTE, priced with Black-Scholes; one-year IV = half VXN, half a
22% mean, which reproduces the two real February-2026 entries (IV 23-24%, both
at the 80% target in the first week of May, as OO had them). Exit: 80% profit
target or 7 DTE. Returns are in units of the premium paid, so eras with QQQ at
$40 and $700 compare; "$ today" uses the current contract price.

Run:  python3 leap_replay.py            (downloads QQQ and ^VXN from Yahoo, IPv4)
      python3 leap_replay.py --cache DIR
Findings and the review procedure: docs/decisions.md 2026-10-22,
docs/review-checklist.md.
"""
import argparse, datetime as dt, json, math, os, socket, sys, tempfile, time, urllib.request
from collections import defaultdict

# httpx/urllib try IPv6 first; on this network v6 SYNs black-hole (see cef/services/http.py)
_gai = socket.getaddrinfo
socket.getaddrinfo = lambda *a, **k: [r for r in _gai(*a, **k) if r[0] == socket.AF_INET] or _gai(*a, **k)

UA = {"User-Agent": "Mozilla/5.0"}
TARGET, DTE, EXIT_DTE, MOVE = 0.80, 360, 7, -0.0175
R, Q = 0.02, 0.006


def fetch(sym, cache):
    p = os.path.join(cache, sym.strip("^") + ".json")
    if os.path.exists(p) and time.time() - os.path.getmtime(p) < 86400:
        return json.load(open(p))
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}"
           f"?period1=0&period2={int(time.time())}&interval=1d")
    data = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30))
    json.dump(data, open(p, "w"))
    return data


def series(data):
    d = data["chart"]["result"][0]; q = d["indicators"]["quote"][0]; out = {}
    for t, o, c in zip(d["timestamp"], q["open"], q["close"]):
        if o and c:
            out[dt.datetime.fromtimestamp(t, dt.UTC).date()] = (o, c)
    return out


def N(x): return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def call(S, K, T, sig):
    if T <= 0: return max(S - K, 0.0)
    d1 = (math.log(S / K) + (R - Q + 0.5 * sig * sig) * T) / (sig * math.sqrt(T)); d2 = d1 - sig * math.sqrt(T)
    return S * math.exp(-Q * T) * N(d1) - K * math.exp(-R * T) * N(d2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=os.path.join(tempfile.gettempdir(), "leap_replay"))
    ap.add_argument("--premium", type=float, default=None, help="today's contract price in $ (default: model's last entry)")
    args = ap.parse_args(); os.makedirs(args.cache, exist_ok=True)
    qqq, vxn = series(fetch("QQQ", args.cache)), series(fetch("^VXN", args.cache))
    days = sorted(qqq); close = {d: qqq[d][1] for d in days}; opn = {d: qqq[d][0] for d in days}
    idx = {d: i for i, d in enumerate(days)}
    print(f"QQQ {days[0]} -> {days[-1]} ({len(days)} days); VXN from {min(vxn)}")

    def sma(n):
        s, run = {}, 0.0
        for i, d in enumerate(days):
            run += close[d]
            if i >= n: run -= close[days[i - n]]
            if i >= n - 1: s[d] = run / n
        return s
    sma50, sma100, sma200 = sma(50), sma(100), sma(200)
    since_hi = {}
    for i, d in enumerate(days):
        if i >= 251:
            w = [close[x] for x in days[i - 251:i + 1]]; h = max(w)
            since_hi[d] = 251 - max(k for k, v in enumerate(w) if v == h)
    rv20 = {}
    for i, d in enumerate(days):
        if i >= 20:
            rs = [math.log(close[days[k]] / close[days[k - 1]]) for k in range(i - 19, i + 1)]
            m = sum(rs) / 20; rv20[d] = math.sqrt(sum((r - m) ** 2 for r in rs) / 19 * 252) * 100

    def iv(d):
        v = vxn[d][1] if d in vxn else rv20.get(d, 25.0) * 1.15
        return max(0.12, (0.5 * v + 0.5 * 22.0) / 100)

    gates = {
        "no gate": lambda d: True,
        "above SMA200 (live)": lambda d: close[d] > sma200[d],
        "rising SMA200 (20d)": lambda d: sma200[d] > sma200[days[idx[d] - 20]],
        "above SMA100": lambda d: close[d] > sma100[d],
        "SMA50 > SMA200": lambda d: sma50[d] > sma200[d],
        "<120d since 252d high": lambda d: since_hi[d] < 120,
    }
    start = dt.date(2000, 2, 1)
    signals = [d for d in days if d >= start and d in sma200 and d in since_hi and close[d] / opn[d] - 1 <= MOVE]

    def simulate(d):
        S0 = close[d]; K = round(S0 * 0.975 / 5) * 5 if S0 > 50 else round(S0 * 0.975)
        exp = d + dt.timedelta(days=DTE); prem = call(S0, K, DTE / 365, iv(d)); path = {}
        for j in range(idx[d] + 1, len(days)):
            x = days[j]; T = (exp - x).days; v = call(close[x], K, T / 365, iv(x)); path[x] = v / prem - 1
            if v >= prem * (1 + TARGET): return dict(entry=d, exit=x, pl=v / prem - 1, how="target", prem=prem, S0=S0, path=path, open_=False)
            if T <= EXIT_DTE: return dict(entry=d, exit=x, pl=v / prem - 1, how="dte", prem=prem, S0=S0, path=path, open_=False)
        return dict(entry=d, exit=days[-1], pl=path[days[-1]], how="open", prem=prem, S0=S0, path=path, open_=True)
    trades = {d: simulate(d) for d in signals}
    prem_today = args.premium or trades[signals[-1]]["prem"] * 100
    print(f"signals: {len(signals)}; contract price used for '$ today': ${prem_today:,.0f}\n")

    def book(sel, cap):
        out, openpos = [], []
        for d in sel:
            if cap:
                openpos = [t for t in openpos if t["exit"] > d]
                if len(openpos) >= cap: continue
            out.append(trades[d]); openpos.append(trades[d])
        return out

    def stats(ts):
        n = len(ts); pl = [t["pl"] for t in ts]
        return (f"n={n:3d} avg={100 * sum(pl) / n:+6.1f}% win={100 * sum(p > 0 for p in pl) / n:3.0f}% "
                f"busts={sum(p <= -0.9 for p in pl):3d} total={sum(pl):+6.1f} premiums") if n else "n=0"

    def maxdd(ts):
        eq = defaultdict(float)
        for t in ts:
            last = None
            for x in days[idx[t["entry"]]:]:
                last = t["path"].get(x, last)
                if last is not None: eq[x] += last
        peak, dd, when = -1e9, 0.0, None
        for x in days:
            if x in eq:
                peak = max(peak, eq[x])
                if peak - eq[x] > dd: dd, when = peak - eq[x], x
        return dd, when

    print("=== GATE: every signal taken (no cap) ===")
    for g, f in gates.items(): print(f"{g:24s} {stats(book([d for d in signals if f(d)], None))}")
    for cap in (2, 3):
        print(f"\n=== GATE: cap {cap} ===")
        for g, f in gates.items(): print(f"{g:24s} {stats(book([d for d in signals if f(d)], cap))}")
    live = [d for d in signals if gates["above SMA200 (live)"](d)]
    print("\n=== GATE: live gate vs none by year (no cap): n / avg return on premium ===")
    byy = defaultdict(lambda: ([], []))
    for d in signals: byy[d.year][0 if gates["above SMA200 (live)"](d) else 1].append(trades[d]["pl"])
    for y in sorted(byy):
        p, b = byy[y]; f = lambda L: f"n={len(L):3d} avg={100 * sum(L) / len(L):+6.1f}%" if L else " " * 18
        print(f"{y} | passed {f(p)} | blocked {f(b)}")

    print("\n=== CAP (live gate): per-slot edge, drawdown in premiums, $ today ===")
    print(f"{'cap':>3} | {'trades':>6} | {'P/L all':>8} {'P/L 2017+':>9} | {'marginal slot':>26} | {'DD all':>6} {'DD 2017+':>8} | {'DD $ today 2017+':>16} | {'all bust':>9}")
    prev = set()
    for cap in range(1, 7):
        ts = book(live, cap); rec = [t for t in ts if t["entry"].year >= 2017]
        new = [t for t in ts if t["entry"] not in prev]; prev = {t["entry"] for t in ts}
        marg = f"n={len(new):2d} avg={100 * sum(t['pl'] for t in new) / len(new):+4.0f}% tot={sum(t['pl'] for t in new):+5.1f}"
        dd_all, _ = maxdd(ts); dd_rec, _ = maxdd(rec)
        print(f"{cap:>3} | {len(ts):>6} | {sum(t['pl'] for t in ts):>+8.1f} {sum(t['pl'] for t in rec):>+9.1f} | {marg:>26} | "
              f"{dd_all:>6.2f} {dd_rec:>8.2f} | ${dd_rec * prem_today:>15,.0f} | ${cap * prem_today:>8,.0f}")
    print("\nRule: cap = floor(loss budget / (contract price x bust cycles)); 1 cycle = a 2022, ~2.6 = a 2000-02.")
    for eq in (40000, 80000, 120000, 160000, 200000):
        b = 0.22 * eq
        print(f"  equity ${eq:>7,}: budget ${b:>7,.0f} -> cap {int(b // prem_today)} (1 cycle) / cap {int(b // (prem_today * 2.6))} (2.6 cycles)")


if __name__ == "__main__":
    main()
