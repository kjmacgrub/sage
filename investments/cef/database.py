import sqlite3
from contextlib import contextmanager
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "cef.db"


def init_db():
    with get_db() as conn:
        # migrations for existing DBs
        for sql in [
            "ALTER TABLE holdings ADD COLUMN manual_nav REAL",
            "ALTER TABLE holdings ADD COLUMN manual_nav_date TEXT",
            "ALTER TABLE holdings ADD COLUMN div_tracking_since TEXT",
            "ALTER TABLE prices ADD COLUMN avg_discount_1y REAL",
            "ALTER TABLE prices ADD COLUMN nav_cagr REAL",
            "ALTER TABLE screener_cache ADD COLUMN nav_change_1y REAL",
            "ALTER TABLE screener_cache ADD COLUMN nav_cagr REAL",
            "ALTER TABLE screener_cache ADD COLUMN dist_cagr REAL",
            "ALTER TABLE distributions ADD COLUMN source TEXT DEFAULT 'yahoo'",
            "ALTER TABLE holdings ADD COLUMN realized_gain REAL",
            "ALTER TABLE prices ADD COLUMN prev_close REAL",
            "ALTER TABLE holdings ADD COLUMN acquired_date TEXT",
            "ALTER TABLE prices ADD COLUMN has_special_dist INTEGER DEFAULT 0",
            "ALTER TABLE prices ADD COLUMN regular_yield_pct REAL",
            "ALTER TABLE prices ADD COLUMN last_special_date TEXT",
            "ALTER TABLE prices ADD COLUMN last_special_amount REAL",
            "ALTER TABLE screener_cache ADD COLUMN has_special_dist INTEGER DEFAULT 0",
            "ALTER TABLE screener_cache ADD COLUMN regular_yield_pct REAL",
            "ALTER TABLE screener_cache ADD COLUMN last_special_date TEXT",
            "ALTER TABLE screener_cache ADD COLUMN last_special_amount REAL",
            # Earned (total return on NAV) vs distributed (distributions/NAV) yields
            "ALTER TABLE prices ADD COLUMN earned_yield_1y REAL",
            "ALTER TABLE prices ADD COLUMN dist_yield_1y REAL",
            "ALTER TABLE prices ADD COLUMN earned_yield_life REAL",
            "ALTER TABLE prices ADD COLUMN dist_yield_life REAL",
            "ALTER TABLE prices ADD COLUMN yield_life_years REAL",
            "ALTER TABLE screener_cache ADD COLUMN earned_yield_1y REAL",
            "ALTER TABLE screener_cache ADD COLUMN dist_yield_1y REAL",
            "ALTER TABLE screener_cache ADD COLUMN earned_yield_life REAL",
            "ALTER TABLE screener_cache ADD COLUMN dist_yield_life REAL",
            "ALTER TABLE screener_cache ADD COLUMN yield_life_years REAL",
            # Specials must be data, not prose: a BDC that quietly stops paying
            # them cuts your income without touching the regular dividend.
            "ALTER TABLE bdc_fundamentals ADD COLUMN special_per_share REAL",
            # Leverage. Tracked as a risk dimension in its own right, never
            # folded into the A-F distribution grade: a levered fund is not a
            # badly-run fund. The preferred/debt split is the load-bearing
            # field -- the 1940 Act tests debt at 300% coverage and preferred
            # at 200%, so identical headline ratios can be four times apart in
            # how far the market can fall before a forced deleveraging.
            "ALTER TABLE screener_cache ADD COLUMN leverage_pct REAL",
            "ALTER TABLE screener_cache ADD COLUMN leverage_type TEXT",
            "ALTER TABLE screener_cache ADD COLUMN leverage_band TEXT",
            "ALTER TABLE screener_cache ADD COLUMN leverage_cushion_pct REAL",
            "ALTER TABLE screener_cache ADD COLUMN preferred_usd REAL",
            "ALTER TABLE screener_cache ADD COLUMN debt_usd REAL",
            "ALTER TABLE screener_cache ADD COLUMN regulatory_usd REAL",
            "ALTER TABLE screener_cache ADD COLUMN leverage_as_of TEXT",
            "ALTER TABLE screener_cache ADD COLUMN leverage_stale INTEGER DEFAULT 0",
            # BDCs are tested at 150% asset coverage (SBCAA 2018), not 300%.
            # Different regime, so it rides along with the manual quarterly entry.
            "ALTER TABLE bdc_fundamentals ADD COLUMN total_debt REAL",
            "ALTER TABLE bdc_fundamentals ADD COLUMN total_equity REAL",
            # Exposure: what the fund actually holds, as opposed to how it is
            # packaged. CEFConnect's category answers the second question and
            # is the wrong axis for spotting concentration -- it split a 24%
            # energy-infrastructure position across two buckets while merging
            # midstream with tech. Null means "not yet classified"; a value
            # here overrides the category-derived default.
            "ALTER TABLE funds ADD COLUMN exposure TEXT",
        ]:
            try:
                conn.execute(sql)
                conn.commit()
            except Exception:
                pass  # column already exists
        # Set div_tracking_since to today for any holdings that don't have it
        conn.execute("""
            UPDATE holdings SET div_tracking_since = date('now')
            WHERE div_tracking_since IS NULL
        """)
        conn.commit()
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS funds (
                ticker      TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                type        TEXT NOT NULL DEFAULT 'CEF',  -- CEF, BDC
                active      INTEGER NOT NULL DEFAULT 1,
                added_at    TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS prices (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker      TEXT NOT NULL,
                date        TEXT NOT NULL,
                price       REAL,
                nav         REAL,
                premium_discount REAL,  -- (price/nav - 1) * 100
                yield_pct   REAL,
                distribution REAL,
                dist_freq   TEXT,
                fetched_at  TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(ticker, date)
            );

            CREATE TABLE IF NOT EXISTS holdings (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker      TEXT NOT NULL UNIQUE,
                shares      REAL NOT NULL DEFAULT 0,
                cost_basis  REAL NOT NULL DEFAULT 0,  -- total cost
                dividends_received REAL NOT NULL DEFAULT 0,
                manual_nav  REAL,                     -- for BDCs: user-entered quarterly NAV
                manual_nav_date TEXT,                 -- quarter-end date the manual NAV represents
                div_tracking_since TEXT,              -- only auto-add distributions on/after this date
                notes       TEXT,
                updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS screener_cache (
                ticker          TEXT PRIMARY KEY,
                name            TEXT,
                price           REAL,
                nav             REAL,
                premium_discount REAL,
                avg_discount_1y REAL,
                nav_change_1y   REAL,
                nav_cagr        REAL,
                yield_pct       REAL,
                dist_freq       TEXT,
                inception_date  TEXT,
                category        TEXT,
                dist_cagr       REAL,
                fetched_at      TEXT
            );

            CREATE TABLE IF NOT EXISTS distributions (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker      TEXT NOT NULL,
                ex_date     TEXT NOT NULL,
                amount      REAL NOT NULL,  -- per share
                shares      REAL NOT NULL,  -- shares held at time of recording
                total       REAL NOT NULL,  -- amount * shares
                added_at    TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(ticker, ex_date)
            );

            CREATE TABLE IF NOT EXISTS broker_trades (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                date     TEXT NOT NULL,
                action   TEXT NOT NULL,
                ticker   TEXT NOT NULL,
                shares   REAL,
                price    REAL,
                fees     REAL,
                amount   REAL,
                added_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(date, action, ticker, shares)
            );

            CREATE TABLE IF NOT EXISTS nav_history (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker      TEXT NOT NULL,
                date        TEXT NOT NULL,
                nav         REAL NOT NULL,
                UNIQUE(ticker, date)
            );

            -- User-tunable settings. A missing row means "use the code default"
            -- (see settings.py:DEFAULTS), so resetting is just a DELETE.
            CREATE TABLE IF NOT EXISTS settings (
                key         TEXT PRIMARY KEY,
                value       TEXT NOT NULL,          -- JSON
                updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
            );

            -- One row per audit run; history is kept so grade drift is visible.
            -- settings_json snapshots the rubric the grade was computed under,
            -- so an old grade stays interpretable after the rubric is retuned.
            CREATE TABLE IF NOT EXISTS audits (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker        TEXT NOT NULL,
                run_at        TEXT NOT NULL DEFAULT (datetime('now')),
                kind          TEXT NOT NULL DEFAULT 'cef',   -- cef | bdc
                grade         TEXT,                          -- A+ .. F
                score         REAL,
                confidence    TEXT,                          -- high | medium | low
                verdict       TEXT,                          -- one-line summary
                detail_json   TEXT,                          -- windows, components, inputs
                flags_json    TEXT,                          -- discrepancies + caveats
                settings_json TEXT                           -- rubric snapshot
            );
            CREATE INDEX IF NOT EXISTS idx_audits_ticker_run
                ON audits(ticker, run_at DESC);

            -- Manually entered BDC quarterly fundamentals. BDCs publish NII
            -- coverage directly, which is a cleaner signal than CEF NAV total
            -- return, but it lives in 10-Q filings rather than any free API.
            -- Screener rows for the BDC universe, sourced from SEC XBRL rather
            -- than CEFConnect (which carries no BDC data at all). Coverage here
            -- is against TOTAL distributions including supplementals, which is
            -- what XBRL tags -- the audit measures against the regular dividend.
            CREATE TABLE IF NOT EXISTS bdc_screener_cache (
                ticker         TEXT PRIMARY KEY,
                cik            INTEGER,
                name           TEXT,
                price          REAL,
                nav_per_share  REAL,
                price_to_nav   REAL,     -- (price/nav - 1) * 100, negative = discount
                div_ttm        REAL,     -- trailing 12m distributions per share
                yield_pct      REAL,
                nii_ttm        REAL,
                dist_ttm       REAL,
                coverage       REAL,     -- nii_ttm / dist_ttm
                nav_trend      REAL,     -- %/yr across available quarters
                quarters       INTEGER,
                latest_quarter TEXT,
                dist_source    TEXT,     -- 'yahoo' when the filed tag was unreliable
                stale_days     INTEGER,
                confidence     TEXT,     -- high | medium | low; low is hidden by default
                error          TEXT,
                fetched_at     TEXT
            );

            CREATE TABLE IF NOT EXISTS bdc_fundamentals (
                id                 INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker             TEXT NOT NULL,
                quarter_end        TEXT NOT NULL,
                nii_per_share      REAL,
                nav_per_share      REAL,
                dividend_per_share REAL,
                non_accrual_pct    REAL,     -- at fair value
                notes              TEXT,
                added_at           TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(ticker, quarter_end)
            );
        """)


@contextmanager
def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
