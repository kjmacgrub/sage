"""
budget/db.py — SQLite backend for Budget Planner + Cash Flow
"""
import sqlite3, os

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "budget.db")


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(df=None):
    conn = get_conn()
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS transactions (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        date    TEXT NOT NULL,
        year    INTEGER,
        month   INTEGER,
        account TEXT,
        payee   TEXT,
        category TEXT,
        amount  REAL
    );
    CREATE INDEX IF NOT EXISTS idx_tx_ym  ON transactions(year, month);
    CREATE INDEX IF NOT EXISTS idx_tx_cat ON transactions(category);
    CREATE INDEX IF NOT EXISTS idx_tx_payee ON transactions(payee);

    CREATE TABLE IF NOT EXISTS budget_plans (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_date       TEXT UNIQUE NOT NULL,   -- ISO "2026-01-08"
        label           TEXT,
        starting_balance REAL DEFAULT 0,
        created_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS budget_items (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_id       INTEGER NOT NULL REFERENCES budget_plans(id) ON DELETE CASCADE,
        category      TEXT,                     -- Quicken category name (NULL for freeform)
        label         TEXT,                     -- custom display name (freeform items)
        budget_amount REAL DEFAULT 0,
        item_type     TEXT DEFAULT 'expense',   -- 'income' | 'expense'
        UNIQUE(plan_id, category)               -- NULLs are distinct, so freeform rows coexist
    );


    CREATE TABLE IF NOT EXISTS scheduled_income (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        source     TEXT NOT NULL,
        amount     REAL DEFAULT 0,
        start_date TEXT NOT NULL,
        end_date   TEXT,
        frequency  TEXT DEFAULT 'monthly',
        notes      TEXT
    );
    """)
    conn.commit()
    _migrate_budget_items(conn)
    if df is not None:
        _import_df(conn, df)
    conn.close()


def _migrate_budget_items(conn):
    """Add label column and make category nullable (idempotent)."""
    cols = [r[1] for r in conn.execute("PRAGMA table_info(budget_items)").fetchall()]
    if 'label' in cols:
        return
    # Recreate table to add label + drop NOT NULL on category
    conn.executescript("""
        PRAGMA foreign_keys = OFF;
        ALTER TABLE budget_items RENAME TO _budget_items_old;
        CREATE TABLE budget_items (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            plan_id       INTEGER NOT NULL REFERENCES budget_plans(id) ON DELETE CASCADE,
            category      TEXT,
            label         TEXT,
            budget_amount REAL DEFAULT 0,
            item_type     TEXT DEFAULT 'expense',
            UNIQUE(plan_id, category)
        );
        INSERT INTO budget_items(id, plan_id, category, budget_amount, item_type)
            SELECT id, plan_id, category, budget_amount, item_type FROM _budget_items_old;
        DROP TABLE _budget_items_old;
        PRAGMA foreign_keys = ON;
    """)


def _import_df(conn, df):
    """Load pandas DataFrame into transactions — skips if already populated."""
    count = conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
    if count > 0:
        return
    rows = []
    for _, r in df.iterrows():
        rows.append((
            r["Date"].strftime("%Y-%m-%d"),
            int(r["Year"]),
            int(r["Date"].month),
            str(r.get("Account", "") or ""),
            str(r.get("Payee",   "") or ""),
            str(r.get("Category","") or ""),
            float(r["Amount"])
        ))
    conn.executemany(
        "INSERT INTO transactions(date,year,month,account,payee,category,amount) VALUES(?,?,?,?,?,?,?)",
        rows
    )
    conn.commit()


def reimport_df(df):
    """Force-reload CSV data (call after uploading a new CSV)."""
    conn = get_conn()
    conn.execute("DELETE FROM transactions")
    _import_df(conn, df)
    conn.close()


# ── Plans ──────────────────────────────────────────────────────────────────

def list_plans():
    conn = get_conn()
    rows = conn.execute(
        "SELECT id, plan_date, label, starting_balance FROM budget_plans ORDER BY plan_date DESC"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def create_plan(plan_date, label=None, starting_balance=0):
    conn = get_conn()
    conn.execute(
        "INSERT INTO budget_plans(plan_date, label, starting_balance) VALUES(?,?,?)",
        (plan_date, label, starting_balance)
    )
    conn.commit()
    row = conn.execute("SELECT id,plan_date,label,starting_balance FROM budget_plans WHERE plan_date=?",
                       (plan_date,)).fetchone()
    conn.close()
    return dict(row)


def get_plan(plan_id):
    conn = get_conn()
    plan = conn.execute(
        "SELECT id,plan_date,label,starting_balance FROM budget_plans WHERE id=?", (plan_id,)
    ).fetchone()
    if not plan:
        conn.close()
        return None
    items = conn.execute(
        "SELECT id,category,label,budget_amount,item_type FROM budget_items "
        "WHERE plan_id=? ORDER BY item_type, COALESCE(category, label)",
        (plan_id,)
    ).fetchall()
    conn.close()
    return {**dict(plan), "items": [dict(i) for i in items]}


def update_plan(plan_id, **kwargs):
    allowed = {"label", "starting_balance"}
    sets = {k: v for k, v in kwargs.items() if k in allowed}
    if not sets:
        return
    conn = get_conn()
    placeholders = ", ".join(f"{k}=?" for k in sets)
    conn.execute(f"UPDATE budget_plans SET {placeholders} WHERE id=?",
                 (*sets.values(), plan_id))
    conn.commit()
    conn.close()


def delete_plan(plan_id):
    conn = get_conn()
    conn.execute("DELETE FROM budget_plans WHERE id=?", (plan_id,))
    conn.commit()
    conn.close()


# ── Budget Items ───────────────────────────────────────────────────────────

def add_item(plan_id, category, budget_amount, item_type, label=None):
    conn = get_conn()
    conn.execute(
        "INSERT INTO budget_items(plan_id,category,label,budget_amount,item_type) VALUES(?,?,?,?,?)",
        (plan_id, category or None, label or None, budget_amount, item_type)
    )
    conn.commit()
    row = conn.execute(
        "SELECT id,category,label,budget_amount,item_type FROM budget_items WHERE rowid=last_insert_rowid()"
    ).fetchone()
    conn.close()
    return dict(row)


def update_item(item_id, budget_amount):
    conn = get_conn()
    conn.execute("UPDATE budget_items SET budget_amount=? WHERE id=?", (budget_amount, item_id))
    conn.commit()
    conn.close()


def delete_item(item_id):
    conn = get_conn()
    conn.execute("DELETE FROM budget_items WHERE id=?", (item_id,))
    conn.commit()
    conn.close()


# ── Actuals ────────────────────────────────────────────────────────────────

def get_actuals(month, year):
    conn = get_conn()
    rows = conn.execute(
        "SELECT category, SUM(amount) as total FROM transactions WHERE month=? AND year=? GROUP BY category",
        (month, year)
    ).fetchall()
    conn.close()
    return {r["category"]: r["total"] for r in rows}


# ── Categories ─────────────────────────────────────────────────────────────

def get_categories():
    """Return all categories from transactions, with typical type (income/expense)."""
    _, groups = get_categories_flat()
    return groups


def get_categories_flat():
    conn = get_conn()
    rows = conn.execute(
        "SELECT category, AVG(amount) as avg_amt FROM transactions WHERE category != '' GROUP BY category ORDER BY category"
    ).fetchall()
    conn.close()
    result = []
    groups = {}
    for r in rows:
        cat = r["category"]
        typ = "income" if (r["avg_amt"] or 0) > 0 else "expense"
        group = cat.split(":")[0] if ":" in cat else cat
        groups.setdefault(group, []).append({"category": cat, "type": typ})
        result.append({"category": cat, "type": typ})
    return result, groups



# ── Scheduled Income (B2) ───────────────────────────────────────────────────

def list_scheduled_income():
    conn = get_conn()
    rows = conn.execute("SELECT * FROM scheduled_income ORDER BY start_date").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def add_scheduled_income(source, amount, start_date, end_date=None, frequency="monthly", notes=""):
    conn = get_conn()
    conn.execute(
        "INSERT INTO scheduled_income(source, amount, start_date, end_date, frequency, notes) VALUES(?,?,?,?,?,?)",
        (source, amount, start_date, end_date, frequency, notes)
    )
    conn.commit()
    row = conn.execute("SELECT * FROM scheduled_income WHERE rowid=last_insert_rowid()").fetchone()
    conn.close()
    return dict(row)


def delete_scheduled_income(item_id):
    conn = get_conn()
    conn.execute("DELETE FROM scheduled_income WHERE id=?", (item_id,))
    conn.commit()
    conn.close()


# ── Tax Config (Phase 5) ───────────────────────────────────────────────────

def _ensure_tax_config(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS tax_config (
            key   TEXT PRIMARY KEY,
            value TEXT
        )
    """)
    conn.commit()


def get_tax_config():
    conn = get_conn()
    _ensure_tax_config(conn)
    rows = conn.execute("SELECT key, value FROM tax_config").fetchall()
    conn.close()
    return {r["key"]: r["value"] for r in rows}


def set_tax_config(updates: dict):
    conn = get_conn()
    _ensure_tax_config(conn)
    for k, v in updates.items():
        conn.execute(
            "INSERT OR REPLACE INTO tax_config(key, value) VALUES(?,?)",
            (k, str(v))
        )
    conn.commit()
    conn.close()


def get_income_by_category(year: int):
    """Sum of positive-amount transactions by category for a given year."""
    conn = get_conn()
    rows = conn.execute(
        "SELECT category, SUM(amount) as total FROM transactions "
        "WHERE year=? AND amount>0 GROUP BY category ORDER BY total DESC",
        (year,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_scheduled_income_for_month(year, month):
    """Return scheduled income events active in the given year/month."""
    month_first = f"{year}-{month:02d}-01"
    month_last  = f"{year}-{month:02d}-31"
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM scheduled_income WHERE start_date <= ? AND (end_date IS NULL OR end_date >= ?)",
        (month_last, month_first)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ── Annual Summary (B4) ─────────────────────────────────────────────────────

def annual_summary(year):
    """Return budget totals for every plan in the given year, plus actuals."""
    conn = get_conn()
    plan_rows = conn.execute(
        "SELECT id, plan_date, label, starting_balance FROM budget_plans WHERE plan_date LIKE ? ORDER BY plan_date",
        (f"{year}-%",)
    ).fetchall()

    result = []
    for p in plan_rows:
        items = conn.execute(
            "SELECT item_type, SUM(budget_amount) as total FROM budget_items WHERE plan_id=? GROUP BY item_type",
            (p["id"],)
        ).fetchall()
        income   = sum(i["total"] for i in items if i["item_type"] == "income")
        expenses = sum(i["total"] for i in items if i["item_type"] == "expense")

        # Actuals from transactions
        d_parts = p["plan_date"].split("-")
        p_month, p_year = int(d_parts[1]), int(d_parts[0])
        act_rows = conn.execute(
            "SELECT SUM(CASE WHEN amount>0 THEN amount ELSE 0 END) as inc, "
            "SUM(CASE WHEN amount<0 THEN amount ELSE 0 END) as exp "
            "FROM transactions WHERE year=? AND month=?",
            (p_year, p_month)
        ).fetchone()

        result.append({
            "plan_id":         p["id"],
            "plan_date":       p["plan_date"],
            "label":           p["label"],
            "starting_balance": p["starting_balance"],
            "income":          income,
            "expenses":        expenses,
            "net":             income - expenses,
            "actual_income":   act_rows["inc"] or 0,
            "actual_expenses": abs(act_rows["exp"] or 0),
        })

    conn.close()
    return {"year": year, "months": result}
