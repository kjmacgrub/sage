"""Import a Schwab transactions CSV into cef.db from the command line.

The Import tab in the app does the same thing through the same code
(cef/services/schwab_import.py); this is here for scripting and for seeing the
full plan in a terminal. Dry run by default.

    .venv/bin/python import_schwab_transactions.py <csv> [--apply]
"""
import argparse
import shutil
import sqlite3
from datetime import datetime, date
from pathlib import Path

from cef.services import schwab_import

DB = Path(__file__).parent / "cef.db"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv_path")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    events = schwab_import.parse_csv(Path(args.csv_path).read_text())
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    plan = schwab_import.build_plan(con, events)

    print("=" * 78)
    print(f"{len(events)} fund transactions across {plan['tickers']} tickers"
          f"  {plan['date_range'].get('min','')} .. {plan['date_range'].get('max','')}")
    print("=" * 78)

    if plan["acquired"]:
        print(f"\nACQUIRED DATES ({len(plan['acquired'])})")
        for a in plan["acquired"]:
            held = (date.today() - datetime.fromisoformat(a["to"]).date()).days / 365.25
            span = f"{held:.1f}y" if held >= 1 else f"{round(held*12)}mo"
            print(f"  {a['ticker']:6s} {str(a['from'] or '(none)'):12s} -> {a['to']}   Held becomes {span}")

    if plan["shares"]:
        print(f"\nSHARE COUNT CORRECTIONS ({len(plan['shares'])})")
        for s in plan["shares"]:
            print(f"  {s['ticker']:6s} {s['from']:g} -> {s['to']:g}   ({s['to']-s['from']:+g})")

    if plan["divs"]:
        print(f"\nDISTRIBUTIONS RECEIVED ({len(plan['divs'])})")
        o = n = 0
        for d in plan["divs"]:
            o += d["from"]; n += d["to"]
            print(f"  {d['ticker']:6s} {d['from']:9.2f} -> {d['to']:9.2f}  {d['to']-d['from']:+9.2f}"
                  f"  ({d['payments']} payments)")
        print(f"  {'TOTAL':6s} {o:9.2f} -> {n:9.2f}  {n-o:+9.2f}")

    if plan["partial"]:
        print(f"\nPARTIAL EXPORT — {len(plan['partial'])} ticker(s) sold in the window but bought")
        print("  before it starts. Share counts and acquired dates left untouched for these;")
        print("  use the All date range to update them.")
        print(f"  {' '.join(plan['partial'])}")

    if plan["new_tickers"]:
        print(f"\nNOT IMPORTED — {len(plan['new_tickers'])} untracked tickers in the export.")
        print("  Add any that are funds you want tracked via + Add Fund, then re-import.")
        print(f"  {' '.join(plan['new_tickers'])}")

    print(f"\n  trades to upsert:         {plan['trades']}")
    print(f"  distribution rows:        {plan['distributions']}")
    print(f"  dates with >1 payment:    {plan['merged_dates']} (summed into one row each)")

    if not args.apply:
        print("\nDRY RUN — no changes written. Re-run with --apply.")
        return

    backup = DB.with_name(f"cef.db.bak-preschwab-{datetime.now():%Y%m%d-%H%M%S}")
    shutil.copy2(DB, backup)
    counts = schwab_import.apply_import(con, events)
    con.commit()
    print(f"\nBacked up to {backup.name}")
    print(f"Applied: {counts}")


if __name__ == "__main__":
    main()
