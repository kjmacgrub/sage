"""
Recompute the distribution trend (cuts / raises / steady) without a full refresh.

    python refresh_dist_trend.py            # held + watchlist
    python refresh_dist_trend.py --all      # every cached screener ticker too
    python refresh_dist_trend.py AOD HGLB   # just these

Prints the inventory afterwards. The same numbers show in the Positions table
and the screener ("vs 3y high" column; "Payout within N% of 3y high" filter).
!! = more than 10% below the 3-year high, two payments running.
"""
import sys
from concurrent.futures import ThreadPoolExecutor

from cef.database import get_db, init_db
from cef.services.dist_trend import refresh_one


def targets(args: list[str]) -> list[str]:
    named = [a.upper() for a in args if not a.startswith("--")]
    if named:
        return named
    with get_db() as conn:
        sql = ("SELECT ticker FROM holdings WHERE shares > 0 "
               "UNION SELECT ticker FROM funds WHERE active = 1")
        if "--all" in args:
            sql += " UNION SELECT ticker FROM screener_cache"
        return [r["ticker"] for r in conn.execute(sql + " ORDER BY 1")]


def main() -> None:
    init_db()
    tickers = targets(sys.argv[1:])
    print(f"Computing distribution trend for {len(tickers)} funds...")
    with ThreadPoolExecutor(max_workers=4) as pool:
        rows = list(zip(tickers, pool.map(refresh_one, tickers)))
    with get_db() as conn:
        held = {r["ticker"] for r in conn.execute("SELECT ticker FROM holdings WHERE shares > 0")}
    print(f"\n{'':2}{'ticker':7}{'vs 3y hi':>9}{'flag':>5}  {'trend':10}{'cuts5y':>7}{'raises5y':>9}{'last cut':>12}{'size':>7}{'worst10y':>9}{'5y chg':>8}  as of")
    for t, a in rows:
        if a["dist_trend"] is None and t not in held:
            continue
        off = f"{a['dist_off_high_pct']:+.0f}%" if a['dist_off_high_pct'] is not None else ''
        print(f"{'*' if t in held else ' ':2}{t:7}{off:>9}{'  !!' if a['dist_flag'] else '':>5}  {str(a['dist_trend']):10}{str(a['dist_cuts_5y']):>7}{str(a['dist_raises_5y']):>9}"
              f"{str(a['dist_last_cut'] or ''):>12}{(str(a['dist_last_cut_pct']) + '%') if a['dist_last_cut_pct'] is not None else '':>7}"
              f"{(str(a['dist_max_cut_pct']) + '%') if a['dist_max_cut_pct'] is not None else '':>9}"
              f"{(('+' if (a['dist_change_5y'] or 0) > 0 else '') + str(a['dist_change_5y']) + '%') if a['dist_change_5y'] is not None else '':>8}  {a['dist_trend_as_of'] or ''}")
    print("\n* = held")


if __name__ == "__main__":
    main()
