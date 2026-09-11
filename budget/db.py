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
    _rename_legacy_tables(conn)   # must precede CREATE TABLE IF NOT EXISTS below
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


    CREATE TABLE IF NOT EXISTS scheduled_items (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        source     TEXT NOT NULL,
        amount     REAL DEFAULT 0,
        start_date TEXT NOT NULL,
        end_date   TEXT,
        frequency  TEXT DEFAULT 'monthly',
        notes      TEXT,
        item_type  TEXT DEFAULT 'income'      -- 'income' | 'expense'
    );

    -- A rejected suggestion is remembered per plan, so it stays hidden for that
    -- period only; the schedule itself is untouched.
    CREATE TABLE IF NOT EXISTS scheduled_dismissals (
        plan_id      INTEGER NOT NULL REFERENCES budget_plans(id) ON DELETE CASCADE,
        scheduled_id INTEGER NOT NULL REFERENCES scheduled_items(id) ON DELETE CASCADE,
        PRIMARY KEY (plan_id, scheduled_id)
    );
    """)
    conn.commit()
    _migrate_budget_items(conn)   # may rebuild budget_items, so run before adding columns
    _migrate_scheduled(conn)
    if df is not None:
        _import_df(conn, df)
    conn.close()


def _table_exists(conn, name):
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
    ).fetchone() is not None


def _rename_legacy_tables(conn):
    """scheduled_income → scheduled_items, now that schedules cover expenses too."""
    if _table_exists(conn, "scheduled_income") and not _table_exists(conn, "scheduled_items"):
        conn.execute("ALTER TABLE scheduled_income RENAME TO scheduled_items")
        conn.commit()


def _migrate_scheduled(conn):
    """Add item_type to scheduled_items and scheduled_id to budget_items (idempotent)."""
    sched_cols = [r[1] for r in conn.execute("PRAGMA table_info(scheduled_items)").fetchall()]
    if "item_type" not in sched_cols:
        conn.execute("ALTER TABLE scheduled_items ADD COLUMN item_type TEXT DEFAULT 'income'")
        conn.execute("UPDATE scheduled_items SET item_type='income' WHERE item_type IS NULL")

    item_cols = [r[1] for r in conn.execute("PRAGMA table_info(budget_items)").fetchall()]
    if "scheduled_id" not in item_cols:
        # Links an accepted suggestion back to its schedule so it stops being suggested.
        conn.execute("ALTER TABLE budget_items ADD COLUMN scheduled_id INTEGER")
    conn.commit()


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
        "SELECT id,category,label,budget_amount,item_type,scheduled_id FROM budget_items "
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

def list_scheduled_items():
    conn = get_conn()
    rows = conn.execute("SELECT * FROM scheduled_items ORDER BY item_type, start_date").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def add_scheduled_item(source, amount, start_date, end_date=None, frequency="monthly",
                       notes="", item_type="income"):
    conn = get_conn()
    conn.execute(
        "INSERT INTO scheduled_items(source, amount, start_date, end_date, frequency, notes, item_type) "
        "VALUES(?,?,?,?,?,?,?)",
        (source, amount, start_date, end_date, frequency, notes, item_type)
    )
    conn.commit()
    row = conn.execute("SELECT * FROM scheduled_items WHERE rowid=last_insert_rowid()").fetchone()
    conn.close()
    return dict(row)


def delete_scheduled_item(item_id):
    conn = get_conn()
    conn.execute("DELETE FROM scheduled_dismissals WHERE scheduled_id=?", (item_id,))
    conn.execute("UPDATE budget_items SET scheduled_id=NULL WHERE scheduled_id=?", (item_id,))
    conn.execute("DELETE FROM scheduled_items WHERE id=?", (item_id,))
    conn.commit()
    conn.close()


# ── Per-plan suggestions ────────────────────────────────────────────────────

def get_suggestions_for_plan(plan_id):
    """Scheduled items active in this plan's month that are neither already
    accepted into the plan nor rejected for it.

    Returns {"income": [...], "expense": [...], "dismissed": <count>}.
    """
    conn = get_conn()
    plan = conn.execute(
        "SELECT plan_date FROM budget_plans WHERE id=?", (plan_id,)
    ).fetchone()
    if not plan:
        conn.close()
        return {"income": [], "expense": [], "dismissed": {"income": 0, "expense": 0}}

    year, month = plan["plan_date"].split("-")[:2]
    month_first = f"{year}-{month}-01"
    month_last  = f"{year}-{month}-31"

    rows = conn.execute(
        """
        SELECT s.* FROM scheduled_items s
        WHERE s.start_date <= ?
          AND (s.end_date IS NULL OR s.end_date >= ?)
          AND NOT EXISTS (SELECT 1 FROM budget_items b
                          WHERE b.plan_id=? AND b.scheduled_id=s.id)
          AND NOT EXISTS (SELECT 1 FROM scheduled_dismissals d
                          WHERE d.plan_id=? AND d.scheduled_id=s.id)
        ORDER BY s.source
        """,
        (month_last, month_first, plan_id, plan_id)
    ).fetchall()

    dismissed_rows = conn.execute(
        """
        SELECT COALESCE(s.item_type,'income') AS t, COUNT(*) AS n
        FROM scheduled_dismissals d
        JOIN scheduled_items s ON s.id = d.scheduled_id
        WHERE d.plan_id=? AND s.start_date <= ? AND (s.end_date IS NULL OR s.end_date >= ?)
        GROUP BY t
        """,
        (plan_id, month_last, month_first)
    ).fetchall()
    conn.close()

    dismissed = {"income": 0, "expense": 0}
    for r in dismissed_rows:
        dismissed[r["t"] if r["t"] in dismissed else "income"] = r["n"]

    out = {"income": [], "expense": [], "dismissed": dismissed}
    for r in rows:
        d = dict(r)
        out["expense" if d.get("item_type") == "expense" else "income"].append(d)
    return out


def accept_suggestion(plan_id, scheduled_id):
    """Commit a scheduled item into this plan as a real budget item."""
    conn = get_conn()
    s = conn.execute("SELECT * FROM scheduled_items WHERE id=?", (scheduled_id,)).fetchone()
    if not s:
        conn.close()
        return None
    existing = conn.execute(
        "SELECT id FROM budget_items WHERE plan_id=? AND scheduled_id=?", (plan_id, scheduled_id)
    ).fetchone()
    if existing:
        conn.close()
        return None
    # Stored as a freeform item (label, no category) so it never collides with a
    # Quicken category row via UNIQUE(plan_id, category).
    conn.execute(
        "INSERT INTO budget_items(plan_id,category,label,budget_amount,item_type,scheduled_id) "
        "VALUES(?,NULL,?,?,?,?)",
        (plan_id, s["source"], s["amount"], s["item_type"] or "income", scheduled_id)
    )
    conn.execute("DELETE FROM scheduled_dismissals WHERE plan_id=? AND scheduled_id=?",
                 (plan_id, scheduled_id))
    conn.commit()
    row = conn.execute(
        "SELECT id,category,label,budget_amount,item_type,scheduled_id "
        "FROM budget_items WHERE rowid=last_insert_rowid()"
    ).fetchone()
    conn.close()
    return dict(row)


def dismiss_suggestion(plan_id, scheduled_id):
    conn = get_conn()
    conn.execute(
        "INSERT OR IGNORE INTO scheduled_dismissals(plan_id, scheduled_id) VALUES(?,?)",
        (plan_id, scheduled_id)
    )
    conn.commit()
    conn.close()


def restore_suggestions(plan_id, item_type=None):
    """Un-reject dismissed suggestions for this plan, optionally just one type."""
    conn = get_conn()
    if item_type in ("income", "expense"):
        conn.execute(
            """
            DELETE FROM scheduled_dismissals
            WHERE plan_id=? AND scheduled_id IN (
                SELECT id FROM scheduled_items WHERE COALESCE(item_type,'income')=?
            )
            """,
            (plan_id, item_type)
        )
    else:
        conn.execute("DELETE FROM scheduled_dismissals WHERE plan_id=?", (plan_id,))
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
