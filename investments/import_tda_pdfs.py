#!/usr/bin/env python3
"""
TD Ameritrade PDF Statement Importer
=====================================
Parses monthly TDA brokerage statements into a local SQLite database,
then optionally pushes distributions/trades to the CEF tracker.

Commands:
  parse     Parse PDF(s) into tda_history.db
  summary   Show what's in the DB
  push      Push to CEF tracker /api/imports/confirm
  query     Run a SQL query against the DB

Examples:
  python3 import_tda_pdfs.py parse ~/Downloads/TDA/*.PDF
  python3 import_tda_pdfs.py summary
  python3 import_tda_pdfs.py summary --ticker PTY
  python3 import_tda_pdfs.py push
  python3 import_tda_pdfs.py push --confirm
  python3 import_tda_pdfs.py query "SELECT ticker, COUNT(*), SUM(amount) FROM dividends GROUP BY ticker ORDER BY SUM(amount) DESC"
"""

import sys
import re
import json
import sqlite3
import argparse
import urllib.request
import urllib.error
from pathlib import Path
from collections import Counter

DB_PATH = Path(__file__).parent / 'tda_history.db'

SKIP_TICKERS = {'IDA', 'ACH', 'FDIC'}
DIV_TXNS   = {'Div/Int - Income'}
TRADE_TXNS = {'Sell - Securities Sold', 'Buy - Securities Purchased'}


# ── DB ────────────────────────────────────────────────────────────────────────

def init_db(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS dividends (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            date        TEXT NOT NULL,
            ticker      TEXT NOT NULL,
            amount      REAL NOT NULL,
            source_file TEXT,
            added_at    TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(date, ticker, amount)
        );

        CREATE TABLE IF NOT EXISTS trades (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            date        TEXT NOT NULL,
            action      TEXT NOT NULL,   -- Buy, Sell
            ticker      TEXT NOT NULL,
            shares      REAL,
            price       REAL,
            amount      REAL,
            source_file TEXT,
            added_at    TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(date, action, ticker, shares, amount)
        );

        CREATE TABLE IF NOT EXISTS parse_log (
            filename    TEXT PRIMARY KEY,
            parsed_at   TEXT NOT NULL DEFAULT (datetime('now')),
            div_count   INTEGER,
            trade_count INTEGER
        );
    """)
    conn.commit()


def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    init_db(conn)
    return conn


# ── PDF PARSING ───────────────────────────────────────────────────────────────

def parse_date(s):
    m = re.match(r'^(\d{2})/(\d{2})/(\d{2})$', s.strip())
    if not m:
        return None
    mo, dy, yr = m.groups()
    return f'20{yr}-{mo}-{dy}'


def parse_amount(s):
    s = s.strip().replace(',', '')
    if not s or s == '-':
        return None
    if s.startswith('(') and s.endswith(')'):
        return -float(s[1:-1])
    try:
        return float(s)
    except ValueError:
        return None


def parse_page(page):
    blocks = page.get_text('blocks')
    left  = [(b[1], b[3], b[4]) for b in blocks if b[6] == 0 and b[0] < 430]
    right = [(b[1], b[3], b[4]) for b in blocks if b[6] == 0 and b[0] >= 430]

    rows = []
    for ly0, ly1, ltext in left:
        rtext = next((rt for ry0, ry1, rt in right if ry0 <= ly1 and ry1 >= ly0), None)
        if rtext is None:
            continue

        rlines = [l.strip() for l in rtext.strip().splitlines() if l.strip()]
        if len(rlines) < 4:
            continue

        symbol    = rlines[0]
        qty_raw   = rlines[1].rstrip('-').strip()
        price_raw = rlines[2]
        amt_raw   = rlines[3]

        if not re.match(r'^[A-Z]{1,6}$', symbol) or symbol in SKIP_TICKERS:
            continue

        llines    = [l.strip() for l in ltext.strip().splitlines() if l.strip()]
        date_idx  = next((i for i, l in enumerate(llines) if re.match(r'^\d{2}/\d{2}/\d{2}$', l)), None)
        if date_idx is None or date_idx + 3 >= len(llines):
            continue

        date     = parse_date(llines[date_idx])
        txn_type = llines[date_idx + 3]
        amount   = parse_amount(amt_raw)
        qty      = parse_amount(qty_raw)
        price    = parse_amount(price_raw)

        if date and amount is not None:
            rows.append({'date': date, 'txn_type': txn_type, 'symbol': symbol,
                         'qty': qty, 'price': price, 'amount': amount})
    return rows


def parse_pdf(path):
    import fitz
    doc   = fitz.open(str(path))
    divs  = []
    trades = []
    for page in doc:
        for row in parse_page(page):
            t = row['txn_type']
            if t in DIV_TXNS and row['amount'] > 0:
                divs.append({'date': row['date'], 'ticker': row['symbol'], 'amount': row['amount']})
            elif t in TRADE_TXNS:
                action = 'Sell' if 'Sell' in t else 'Buy'
                trades.append({'date': row['date'], 'action': action, 'ticker': row['symbol'],
                                'shares': abs(row['qty']) if row['qty'] else None,
                                'price': row['price'], 'amount': row['amount']})
    return divs, trades


# ── COMMANDS ──────────────────────────────────────────────────────────────────

def cmd_parse(args):
    try:
        import fitz  # noqa
    except ImportError:
        print('ERROR: pymupdf not installed. Run: pip install pymupdf')
        sys.exit(1)

    conn = get_db()
    total_divs = total_trades = total_files = 0

    for path_str in args.pdfs:
        path = Path(path_str)
        if not path.exists():
            print(f'  SKIP (not found): {path_str}')
            continue

        already = conn.execute('SELECT filename FROM parse_log WHERE filename=?', (path.name,)).fetchone()
        if already and not args.reparse:
            print(f'  SKIP (already parsed): {path.name}')
            continue

        print(f'  Parsing {path.name}…', end=' ', flush=True)
        try:
            divs, trades = parse_pdf(path)
        except Exception as e:
            print(f'ERROR: {e}')
            continue

        div_ins = trade_ins = 0
        for d in divs:
            try:
                conn.execute(
                    'INSERT OR IGNORE INTO dividends (date, ticker, amount, source_file) VALUES (?,?,?,?)',
                    (d['date'], d['ticker'], d['amount'], path.name))
                div_ins += conn.execute('SELECT changes()').fetchone()[0]
            except Exception:
                pass

        for t in trades:
            try:
                conn.execute(
                    'INSERT OR IGNORE INTO trades (date, action, ticker, shares, price, amount, source_file) VALUES (?,?,?,?,?,?,?)',
                    (t['date'], t['action'], t['ticker'], t['shares'], t['price'], t['amount'], path.name))
                trade_ins += conn.execute('SELECT changes()').fetchone()[0]
            except Exception:
                pass

        conn.execute(
            'INSERT OR REPLACE INTO parse_log (filename, div_count, trade_count) VALUES (?,?,?)',
            (path.name, len(divs), len(trades)))
        conn.commit()

        print(f'{div_ins} new divs (+{len(divs)-div_ins} dupes), {trade_ins} new trades')
        total_divs   += div_ins
        total_trades += trade_ins
        total_files  += 1

    print(f'\nDone: {total_files} files → {total_divs} new dividends, {total_trades} new trades')
    print(f'DB: {DB_PATH}')
    conn.close()


def cmd_summary(args):
    if not DB_PATH.exists():
        print('No DB yet. Run: python3 import_tda_pdfs.py parse <pdfs>')
        return

    conn = get_db()
    ticker_filter = f"AND ticker = '{args.ticker.upper()}'" if args.ticker else ''

    total_divs   = conn.execute(f'SELECT COUNT(*), SUM(amount) FROM dividends WHERE 1=1 {ticker_filter}').fetchone()
    total_trades = conn.execute(f'SELECT COUNT(*) FROM trades WHERE 1=1 {ticker_filter}').fetchone()
    date_range   = conn.execute(f'SELECT MIN(date), MAX(date) FROM dividends WHERE 1=1 {ticker_filter}').fetchone()
    files_parsed = conn.execute('SELECT COUNT(*) FROM parse_log').fetchone()[0]

    print(f'\n{"─"*50}')
    print(f'  TDA History DB  ({DB_PATH.name})')
    print(f'{"─"*50}')
    print(f'  PDF files parsed : {files_parsed}')
    print(f'  Dividends        : {total_divs[0]:,}   total ${total_divs[1] or 0:,.2f}')
    print(f'  Trades           : {total_trades[0]:,}')
    if date_range[0]:
        print(f'  Date range       : {date_range[0]} → {date_range[1]}')

    print(f'\n  Dividends by ticker:')
    rows = conn.execute(f'''
        SELECT ticker, COUNT(*) as cnt, SUM(amount) as total, MIN(date) as first, MAX(date) as last
        FROM dividends WHERE 1=1 {ticker_filter}
        GROUP BY ticker ORDER BY total DESC
    ''').fetchall()
    for r in rows:
        print(f'    {r["ticker"]:8s}  {r["cnt"]:3d} payments  ${r["total"]:8,.2f}  ({r["first"]} → {r["last"]})')

    if args.ticker:
        print(f'\n  Payment history for {args.ticker.upper()}:')
        rows = conn.execute(
            'SELECT date, amount FROM dividends WHERE ticker=? ORDER BY date',
            (args.ticker.upper(),)).fetchall()
        for r in rows:
            print(f'    {r["date"]}  ${r["amount"]:.2f}')

    conn.close()


def cmd_push(args):
    if not DB_PATH.exists():
        print('No DB yet. Run: python3 import_tda_pdfs.py parse <pdfs>')
        return

    conn = get_db()

    divs = [dict(r) for r in conn.execute('SELECT date, ticker, amount FROM dividends ORDER BY date').fetchall()]
    trades = [dict(r) for r in conn.execute('SELECT date, action, ticker, shares, price, amount FROM trades ORDER BY date').fetchall()]
    conn.close()

    payload = {'distributions': divs, 'trades': trades}
    print(f'Payload: {len(divs)} distributions, {len(trades)} trades')

    # Preview
    try:
        result = post_json(f'{args.url}/api/imports/preview', payload)
        d  = result['distributions']
        dr = result.get('date_range', {})
        new_tickers = result.get('new_tickers', [])
        print(f'Preview: {d["total"]} distributions → '
              f'{d["in_portfolio"]} in portfolio, '
              f'{d["in_watchlist"]} on watchlist, '
              f'{d["new_inactive"]} new (will be added as inactive)')
        if new_tickers:
            print(f'  New tickers: {", ".join(new_tickers)}')
        if dr:
            print(f'Date range: {dr.get("min")} → {dr.get("max")}')
    except Exception as e:
        print(f'Could not reach API for preview: {e}')
        if not args.confirm:
            return

    if not args.confirm:
        print('\nDry run — pass --confirm to write to DB')
        return

    try:
        result = post_json(f'{args.url}/api/imports/confirm', payload)
        print(f'\nImported: {result["distributions_saved"]} distributions, {result["trades_saved"]} trades')
    except urllib.error.HTTPError as e:
        print(f'HTTP {e.code}: {e.read().decode()}')
    except Exception as e:
        print(f'Error: {e}')


def cmd_query(args):
    if not DB_PATH.exists():
        print('No DB yet.')
        return
    conn = get_db()
    try:
        rows = conn.execute(args.sql).fetchall()
        if not rows:
            print('(no results)')
            return
        keys = rows[0].keys()
        print('  ' + '  '.join(f'{k:>12}' for k in keys))
        print('  ' + '  '.join(['─' * 12] * len(keys)))
        for r in rows:
            print('  ' + '  '.join(f'{str(r[k]):>12}' for k in keys))
    except Exception as e:
        print(f'Error: {e}')
    conn.close()


# ── HELPERS ───────────────────────────────────────────────────────────────────

def post_json(url, payload):
    data = json.dumps(payload).encode()
    req  = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


# ── MAIN ──────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description='TDA PDF → CEF tracker importer')
    sub = ap.add_subparsers(dest='cmd')

    p = sub.add_parser('parse', help='Parse PDF(s) into tda_history.db')
    p.add_argument('pdfs', nargs='+')
    p.add_argument('--reparse', action='store_true', help='Re-parse already-logged files')

    p = sub.add_parser('summary', help='Show DB contents')
    p.add_argument('--ticker', help='Filter to one ticker')

    p = sub.add_parser('push', help='Push DB contents to CEF tracker')
    p.add_argument('--confirm', action='store_true', help='Actually write (default: preview)')
    p.add_argument('--url', default='http://localhost:8000')

    p = sub.add_parser('query', help='Run SQL against tda_history.db')
    p.add_argument('sql')

    args = ap.parse_args()
    if   args.cmd == 'parse':   cmd_parse(args)
    elif args.cmd == 'summary': cmd_summary(args)
    elif args.cmd == 'push':    cmd_push(args)
    elif args.cmd == 'query':   cmd_query(args)
    else:
        ap.print_help()


if __name__ == '__main__':
    main()
