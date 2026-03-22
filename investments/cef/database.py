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
