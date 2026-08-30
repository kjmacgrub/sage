"""
Backfill leverage into screener_cache without a full screener refresh.

Leverage lives only in the CEFConnect fund page HTML, so a normal refresh picks
it up automatically from now on. This exists to populate the column for rows
already cached, newest-relevant first, without re-fetching 370 funds' worth of
price/NAV/distribution history.

    python backfill_leverage.py            # held + watchlist only
    python backfill_leverage.py --all      # every cached ticker
"""
import sys
from concurrent.futures import ThreadPoolExecutor

from cef.database import get_db, init_db
from cef.services.scraper import fetch_leverage

COLS = ("leverage_pct", "leverage_type", "leverage_band", "leverage_cushion_pct",
        "preferred_usd", "debt_usd", "regulatory_usd", "leverage_as_of", "leverage_stale")


def targets(everything: bool) -> list[str]:
    with get_db() as conn:
        if everything:
            rows = conn.execute("SELECT ticker FROM screener_cache ORDER BY ticker")
        else:
            rows = conn.execute("""
                SELECT ticker FROM screener_cache
                WHERE ticker IN (SELECT ticker FROM holdings WHERE shares > 0)
                   OR ticker IN (SELECT ticker FROM funds WHERE active = 1)
                ORDER BY ticker""")
        return [r["ticker"] for r in rows]


def main() -> None:
    init_db()
    everything = "--all" in sys.argv
    tickers = targets(everything)
    print(f"Fetching leverage for {len(tickers)} funds...")

    with ThreadPoolExecutor(max_workers=5) as pool:
        results = list(zip(tickers, pool.map(fetch_leverage, tickers)))

    found = 0
    with get_db() as conn:
        for ticker, lev in results:
            if lev["leverage_band"] is None:
                continue
            conn.execute(
                f"UPDATE screener_cache SET {', '.join(f'{c}=:{c}' for c in COLS)} "
                "WHERE ticker=:ticker", {**lev, "ticker": ticker})
            found += 1
        conn.commit()

    print(f"Updated {found}; {len(tickers) - found} reported no leverage block.")


if __name__ == "__main__":
    main()
