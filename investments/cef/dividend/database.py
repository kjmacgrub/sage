"""Schema and connection for the dividend-growth sleeve's own database.

Separate file from cef.db. Nothing here touches the CEF book.
"""
import sqlite3
from contextlib import contextmanager
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[2] / "dividend.db"

SCHEMA = """
-- One row per position. `initial_cost` is the load-bearing column: under DRIP
-- every reinvestment adds to cost_basis, so dividing this year's dividend by
-- cost_basis understates yield on cost badly and increasingly (at year 20 a
-- $20k position reads $74k of basis, reporting 9.5% where the figure against
-- the original outlay is 35.5%). initial_cost is written once and never
-- updated, and it cannot be reconstructed later without replaying every
-- transaction -- which is why it exists before the first purchase.
CREATE TABLE IF NOT EXISTS holdings (
    ticker        TEXT PRIMARY KEY,
    name          TEXT,
    account       TEXT,              -- 'Schwab ...123', 'Fidelity ...456'
    shares        REAL NOT NULL DEFAULT 0,
    cost_basis    REAL NOT NULL DEFAULT 0,   -- grows with every reinvestment
    initial_cost  REAL,                      -- the original outlay. NEVER updated.
    initial_date  TEXT,
    dividends_received REAL NOT NULL DEFAULT 0,
    drip          INTEGER NOT NULL DEFAULT 1,  -- 0 = turned off after a screen failure
    target_weight REAL,                        -- e.g. 0.10 for a ten-name sleeve
    screen_ok     INTEGER,                     -- last quarterly check: 1 pass, 0 fail
    screen_note   TEXT,
    screen_date   TEXT,
    notes         TEXT,
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Per-share amount is stored separately from shares held on purpose. Under
-- DRIP total dividends received grows for two reasons at once -- the company
-- raising, and owning more shares -- and the quarterly screen check only cares
-- about the first. Without the split the check cannot be run.
CREATE TABLE IF NOT EXISTS distributions (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker    TEXT NOT NULL,
    account   TEXT,
    pay_date  TEXT NOT NULL,
    amount    REAL,                   -- per share; derived after import from shares held
    shares    REAL,                   -- held at the time
    total     REAL NOT NULL,          -- cash actually received
    qualified INTEGER,                -- 1 qualified, 0 not, NULL unknown
    added_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(account, ticker, pay_date, total)
);

CREATE TABLE IF NOT EXISTS broker_trades (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    account  TEXT,
    date     TEXT NOT NULL,
    action   TEXT NOT NULL,
    ticker   TEXT NOT NULL,
    shares   REAL,
    price    REAL,
    fees     REAL,
    amount   REAL,
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(account, date, action, ticker, shares, amount)
);

-- The S&P 1500 screen. Reference data, not portfolio data, but it lives here
-- so everything about this sleeve is in one file.
CREATE TABLE IF NOT EXISTS screener_cache (
    ticker       TEXT PRIMARY KEY,
    name         TEXT,
    idx          TEXT,
    sector       TEXT,
    industry     TEXT,
    price        REAL,
    div_ttm      REAL,
    yield_pct    REAL,
    div_cagr     REAL,
    price_cagr   REAL,
    win_years    INTEGER,
    win_from     INTEGER,
    hist_years   REAL,
    streak       INTEGER,
    cuts         INTEGER,
    payout_pct   REAL,
    fcf_cover    REAL,
    ocf_cover    REAL,
    rev_growth   REAL,
    range_52w    REAL,
    vs_200d      REAL,
    annuals      TEXT,
    fetched_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_dist_ticker ON distributions(ticker, pay_date);
CREATE INDEX IF NOT EXISTS idx_trades_ticker ON broker_trades(ticker, date);
"""


def init_db():
    with sqlite3.connect(str(DB_PATH)) as conn:
        conn.executescript(SCHEMA)


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
