#!/usr/bin/env python3
"""
mae_check.py — flag Option Omega backtests that skipped stop-outs.

Reads a trade-log CSV export and reports, per strategy, how often a position's
Max Loss (maximum adverse excursion) went past the level where the stop should
have fired -- while the log recorded some other close reason.

A high breach rate means `Ignore Single Bar Stop Loss Breach` is ON, or
`Use 0-DTE Intra-Minute Stops` is OFF. Either way the backtest is booking wins
on trades that would have stopped out live.

Reference rates measured on known runs:
    ~1%   clean
    ~5%   suspicious
    10%+  flags are on

Usage:
    python3 mae_check.py "trade-log (9).csv"
    python3 mae_check.py *.csv
"""

import csv
import sys
import statistics
from collections import defaultdict

NON_STOP = ("Expired", "Profit Target")


def num(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def check(path):
    with open(path, encoding="utf-8-sig") as fh:
        rows = list(csv.DictReader(fh))

    if not rows or "Max Loss" not in rows[0]:
        print(f"{path}: no 'Max Loss' column — not an Option Omega trade log")
        return

    print(f"\n{'=' * 74}\n{path}\n{'=' * 74}")
    print(f"{'strategy':<30} {'stops':>6} {'trigger':>9} {'breached':>10} {'rate':>7}  verdict")
    print("-" * 74)

    by_strategy = defaultdict(list)
    for r in rows:
        by_strategy[r.get("Strategy") or "(unnamed)"].append(r)

    for name, legs in sorted(by_strategy.items()):
        # Within a credit structure (iron condor), the long wings close
        # alongside the shorts with near-zero MAE and would drag the inferred
        # trigger to 0%. Isolate the short legs where they exist. A pure debit
        # strategy (calendar, long hedge) has no such legs and its own legs are
        # homogeneous, so the whole set is used.
        shorts = [
            r for r in legs
            if num(r["Premium"]) > 0 and "BTO" not in (r.get("Legs") or "")
        ]
        pool = shorts if shorts else legs
        kind = "" if shorts else " (debit)"

        stops = [r for r in pool if r["Reason For Close"] == "Stop Loss"]
        others = [r for r in pool if r["Reason For Close"] in NON_STOP]

        if not stops:
            print(f"{name[:30]:<30} {'—':>6} {'—':>9} {'—':>10} {'—':>7}  no stops in use")
            continue
        if not others:
            print(f"{name[:30]:<30} {len(stops):>6} {'—':>9} {'—':>10} {'—':>7}  no expiries to compare")
            continue

        # The shallowest MAE among actual stop-outs approximates the trigger level.
        trigger = max(num(r["Max Loss"]) for r in stops)
        breached = [r for r in others if num(r["Max Loss"]) < trigger]
        rate = 100 * len(breached) / len(others)

        if rate < 2:
            verdict = "clean"
        elif rate < 5:
            verdict = "check the setting"
        else:
            verdict = "FLAGS LIKELY ON"

        print(
            f"{(name + kind)[:30]:<30} {len(stops):>6} {trigger:>8.0f}% "
            f"{len(breached):>5}/{len(others):<4} {rate:>6.1f}%  {verdict}"
        )

        if breached:
            worst = sorted(breached, key=lambda r: num(r["Max Loss"]))[:3]
            deep = [num(r["Max Loss"]) for r in breached]
            print(
                f"{'':<30} median MAE on breaches {statistics.median(deep):.0f}%, "
                f"worst {min(deep):.0f}%, P/L booked {sum(num(r['P/L']) for r in breached):+,.0f}"
            )
            for r in worst:
                print(
                    f"{'':<32} {r['Date Opened']} {r['Reason For Close']:<14} "
                    f"MAE {num(r['Max Loss']):>7.0f}%  P/L {num(r['P/L']):>+9,.0f}"
                )

    print(
        "\nNote: debit spreads (calendars) carry short legs, so the inferred trigger\n"
        "is approximate there. Treat a high rate as a prompt to open the strategy and\n"
        "read the checkbox, not as proof on its own."
    )


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    for p in sys.argv[1:]:
        try:
            check(p)
        except OSError as e:
            print(f"{p}: {e}")
