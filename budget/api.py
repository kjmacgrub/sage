"""
budget/api.py — Flask backend for Budget Planner + Cash Flow
Run: python3 budget/api.py
"""
from flask import Flask, jsonify, request, send_from_directory
import sys, os, json, io

STATIC_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, STATIC_DIR)

import db
from query import df as _initial_df

app = Flask(__name__, static_folder=STATIC_DIR)

# ── Init ──────────────────────────────────────────────────────────────────

db.init_db(_initial_df if not _initial_df.empty else None)   # Creates tables, imports CSV on first run

# ── Static files ──────────────────────────────────────────────────────────

@app.route('/')
def index():
    return send_from_directory(STATIC_DIR, 'index.html')

@app.route('/<path:filename>')
def static_files(filename):
    return send_from_directory(STATIC_DIR, filename)

@app.after_request
def cors(r):
    r.headers["Access-Control-Allow-Origin"] = "*"
    r.headers["Access-Control-Allow-Methods"] = "GET,POST,PUT,DELETE,OPTIONS"
    r.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return r

@app.route('/<path:p>', methods=['OPTIONS'])
def options(p):
    return '', 204

# ── Categories ────────────────────────────────────────────────────────────

@app.route("/api/categories")
def categories():
    cats_flat, groups = db.get_categories_flat()
    years_rows = db.get_conn().execute(
        "SELECT DISTINCT year FROM transactions ORDER BY year"
    ).fetchall()
    years = [r["year"] for r in years_rows]
    return jsonify({
        "categories": [c["category"] for c in cats_flat],
        "groups": {g: [c["category"] for c in cats]
                   for g, cats in groups.items()},
        "category_types": {c["category"]: c["type"] for c in cats_flat},
        "years": years
    })

# ── Accounts ──────────────────────────────────────────────────────────────

@app.route("/api/accounts")
def accounts():
    conn = db.get_conn()
    rows = conn.execute("SELECT DISTINCT account FROM transactions ORDER BY account").fetchall()
    conn.close()
    return jsonify([r["account"] for r in rows])

# ── Actuals ───────────────────────────────────────────────────────────────

@app.route("/api/actuals")
def actuals():
    month = int(request.args.get("month", 0))
    year  = int(request.args.get("year",  0))
    if not month or not year:
        return jsonify({})
    return jsonify(db.get_actuals(month, year))

# ── Cash Flow Summary (dashboard) ─────────────────────────────────────────

@app.route("/api/summary")
def summary():
    conn = db.get_conn()
    cats_param  = request.args.get("cats", "")
    accts_param = request.args.get("accts", "")
    year_from   = int(request.args.get("year_from", 2000))
    year_to     = int(request.args.get("year_to",   2100))
    date_from   = request.args.get("date_from", "")
    date_to     = request.args.get("date_to",   "")
    cat_list    = [c.strip() for c in cats_param.split(",")  if c.strip()]
    acct_list   = [a.strip() for a in accts_param.split(",") if a.strip()]

    if date_from and date_to:
        where  = "WHERE date BETWEEN ? AND ?"
        params = [date_from, date_to]
    else:
        where  = "WHERE year BETWEEN ? AND ?"
        params = [year_from, year_to]
    if cat_list:
        placeholders = ",".join("?" * len(cat_list))
        where += f" AND category IN ({placeholders})"
        params += cat_list
    if acct_list:
        placeholders = ",".join("?" * len(acct_list))
        where += f" AND account IN ({placeholders})"
        params += acct_list

    rows = conn.execute(f"SELECT year, amount FROM transactions {where}", params).fetchall()

    if date_from and date_to:
        from datetime import date as _date
        d1 = _date.fromisoformat(date_from)
        d2 = _date.fromisoformat(date_to)
        n_months = max(1, (d2.year - d1.year) * 12 + d2.month - d1.month + 1)
    else:
        n_months = (year_to - year_from + 1) * 12
    expenses = sum((r["amount"] or 0) for r in rows if (r["amount"] or 0) < 0)
    income   = sum((r["amount"] or 0) for r in rows if (r["amount"] or 0) > 0)

    by_year = {}
    for r in rows:
        y = r["year"]
        by_year.setdefault(y, {"year": y, "expenses": 0, "income": 0, "count": 0})
        by_year[y]["count"] += 1
        amt = r["amount"] or 0
        if amt < 0:
            by_year[y]["expenses"] += amt
        else:
            by_year[y]["income"] += amt

    # Top payees
    payee_rows = conn.execute(
        f"SELECT payee, SUM(amount) as total FROM transactions {where} AND amount<0 GROUP BY payee ORDER BY total LIMIT 10",
        params
    ).fetchall()
    top_payees = [
        {"payee": r["payee"], "amount": r["total"]}
        for r in payee_rows
    ]

    # Income by category (C3)
    income_rows = conn.execute(
        f"SELECT category, SUM(amount) as total FROM transactions {where} AND amount>0 GROUP BY category ORDER BY total DESC LIMIT 30",
        params
    ).fetchall()
    income_by_cat = [{"category": r["category"], "amount": r["total"]} for r in income_rows]

    # Expense by category
    expense_rows = conn.execute(
        f"SELECT category, SUM(amount) as total FROM transactions {where} AND amount<0 GROUP BY category ORDER BY total ASC LIMIT 40",
        params
    ).fetchall()
    expense_by_cat = [{"category": r["category"], "amount": r["total"]} for r in expense_rows]

    conn.close()
    return jsonify({
        "expenses": expenses,
        "income": income,
        "count": len(rows),
        "monthly_avg": expenses / n_months if n_months else 0,
        "monthly_avg_income": income / n_months if n_months else 0,
        "by_year": sorted(by_year.values(), key=lambda x: x["year"]),
        "top_payees": top_payees,
        "income_by_cat": income_by_cat,
        "expense_by_cat": expense_by_cat
    })

# ── Budget Plans ──────────────────────────────────────────────────────────

@app.route("/api/plans", methods=["GET"])
def list_plans():
    return jsonify(db.list_plans())

@app.route("/api/plans", methods=["POST"])
def create_plan():
    data = request.get_json() or {}
    plan_date = data.get("plan_date")
    if not plan_date:
        return jsonify({"error": "plan_date required"}), 400
    try:
        plan = db.create_plan(
            plan_date,
            label=data.get("label"),
            starting_balance=data.get("starting_balance", 0)
        )
        return jsonify(plan), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 409

@app.route("/api/plans/<int:plan_id>", methods=["GET"])
def get_plan(plan_id):
    plan = db.get_plan(plan_id)
    if not plan:
        return jsonify({"error": "not found"}), 404
    return jsonify(plan)

@app.route("/api/plans/<int:plan_id>", methods=["PUT"])
def update_plan(plan_id):
    data = request.get_json() or {}
    db.update_plan(plan_id, **data)
    return jsonify(db.get_plan(plan_id))

@app.route("/api/plans/<int:plan_id>", methods=["DELETE"])
def delete_plan(plan_id):
    db.delete_plan(plan_id)
    return jsonify({"ok": True})

# ── Budget Items ──────────────────────────────────────────────────────────

@app.route("/api/plans/<int:plan_id>/items", methods=["POST"])
def add_item(plan_id):
    data = request.get_json() or {}
    category      = (data.get("category") or "").strip() or None
    label         = (data.get("label")    or "").strip() or None
    budget_amount = float(data.get("budget_amount", 0))
    item_type     = data.get("item_type", "expense")
    if not category and not label:
        return jsonify({"error": "category or label required"}), 400
    item = db.add_item(plan_id, category, budget_amount, item_type, label=label)
    return jsonify(item), 201

@app.route("/api/items/<int:item_id>", methods=["PUT"])
def update_item(item_id):
    data = request.get_json() or {}
    db.update_item(item_id, float(data.get("budget_amount", 0)))
    return jsonify({"ok": True})

@app.route("/api/items/<int:item_id>", methods=["DELETE"])
def del_item(item_id):
    db.delete_item(item_id)
    return jsonify({"ok": True})

# ── CSV Reload ────────────────────────────────────────────────────────────

@app.route("/api/csv/reload", methods=["POST"])
def csv_reload():
    """Reimport from the configured CSV path."""
    from query import load
    new_df = load()
    db.reimport_df(new_df)
    return jsonify({"count": len(new_df)})

@app.route("/api/csv/upload", methods=["POST"])
def csv_upload():
    """Upload a new Quicken CSV and reload transactions."""
    import traceback, tempfile, os
    from query import load as _load
    try:
        f = request.files.get("file")
        if not f:
            return jsonify({"error": "no file"}), 400
        # Save to a temp file so query.load() can parse it
        suffix = os.path.splitext(f.filename or "upload.csv")[1] or ".csv"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            f.save(tmp.name)
            tmp_path = tmp.name
        try:
            df2 = _load(tmp_path)
        finally:
            os.unlink(tmp_path)
        db.reimport_df(df2)
        return jsonify({"count": len(df2)})
    except Exception as e:
        return jsonify({"error": str(e), "traceback": traceback.format_exc()}), 500


# ── Copy plan (B3) ────────────────────────────────────────────────────────

@app.route("/api/plans/<int:source_id>/copy", methods=["POST"])
def copy_plan(source_id):
    from datetime import date as _date
    data      = request.get_json() or {}
    plan_date = data.get("plan_date")
    if not plan_date:
        return jsonify({"error": "plan_date required"}), 400
    source = db.get_plan(source_id)
    if not source:
        return jsonify({"error": "source not found"}), 404
    try:
        d      = _date.fromisoformat(plan_date)
        months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December']
        label    = f"{months[d.month-1]} {d.day}, {d.year}"
        new_plan = db.create_plan(plan_date, label=label,
                                  starting_balance=source.get("starting_balance", 0))
        for item in source.get("items", []):
            db.add_item(new_plan["id"], item.get("category"),
                        item["budget_amount"], item["item_type"],
                        label=item.get("label"))
        return jsonify(db.get_plan(new_plan["id"])), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 409


# ── Annual summary (B4) ───────────────────────────────────────────────────

@app.route("/api/annual-summary")
def annual_summary():
    from datetime import date as _date
    year = int(request.args.get("year", _date.today().year))
    return jsonify(db.annual_summary(year))


# ── Scheduled income (B2) ─────────────────────────────────────────────────

@app.route("/api/scheduled-income", methods=["GET"])
def list_scheduled_income():
    return jsonify(db.list_scheduled_income())

@app.route("/api/scheduled-income", methods=["POST"])
def add_scheduled_income():
    data = request.get_json() or {}
    item = db.add_scheduled_income(
        source    = data.get("source", ""),
        amount    = float(data.get("amount", 0)),
        start_date= data.get("start_date", ""),
        end_date  = data.get("end_date") or None,
        frequency = data.get("frequency", "monthly"),
        notes     = data.get("notes", "")
    )
    return jsonify(item), 201

@app.route("/api/scheduled-income/<int:item_id>", methods=["DELETE"])
def del_scheduled_income(item_id):
    db.delete_scheduled_income(item_id)
    return jsonify({"ok": True})

@app.route("/api/scheduled-income/for-month")
def scheduled_income_for_month():
    year  = int(request.args.get("year",  0))
    month = int(request.args.get("month", 0))
    if not year or not month:
        return jsonify([])
    return jsonify(db.get_scheduled_income_for_month(year, month))


# ── All transactions for current filter ───────────────────────────────────

@app.route("/api/all-transactions")
def all_transactions():
    cats_param  = request.args.get("cats", "")
    accts_param = request.args.get("accts", "")
    year_from   = int(request.args.get("year_from", 2000))
    year_to     = int(request.args.get("year_to",   2100))
    date_from   = request.args.get("date_from", "")
    date_to     = request.args.get("date_to",   "")
    cat_list    = [c.strip() for c in cats_param.split(",")  if c.strip()]
    acct_list   = [a.strip() for a in accts_param.split(",") if a.strip()]

    conn = db.get_conn()
    if date_from and date_to:
        where  = "WHERE date BETWEEN ? AND ?"
        params = [date_from, date_to]
    else:
        where  = "WHERE year BETWEEN ? AND ?"
        params = [year_from, year_to]
    if cat_list:
        placeholders = ",".join("?" * len(cat_list))
        where  += f" AND category IN ({placeholders})"
        params += cat_list
    if acct_list:
        placeholders = ",".join("?" * len(acct_list))
        where  += f" AND account IN ({placeholders})"
        params += acct_list

    rows = conn.execute(
        f"SELECT date, category, payee, amount FROM transactions {where} ORDER BY date DESC",
        params
    ).fetchall()
    conn.close()
    return jsonify([
        {"date": r["date"], "category": r["category"], "payee": r["payee"], "amount": r["amount"]}
        for r in rows
    ])


# ── Transaction drill-down ────────────────────────────────────────────────

@app.route("/api/transactions")
def transactions():
    cat       = request.args.get("cat", "")
    payee     = request.args.get("payee", "")
    year_from = int(request.args.get("year_from", 2000))
    year_to   = int(request.args.get("year_to",   2100))
    date_from = request.args.get("date_from", "")
    date_to   = request.args.get("date_to",   "")
    if not cat and not payee:
        return jsonify([])
    conn = db.get_conn()
    if date_from and date_to:
        date_clause = "date BETWEEN ? AND ?"
        date_params = [date_from, date_to]
    else:
        date_clause = "year BETWEEN ? AND ?"
        date_params = [year_from, year_to]
    if cat:
        rows = conn.execute(
            f"SELECT date, payee, category, amount FROM transactions "
            f"WHERE category=? AND {date_clause} ORDER BY date DESC",
            [cat] + date_params
        ).fetchall()
    else:
        rows = conn.execute(
            f"SELECT date, payee, category, amount FROM transactions "
            f"WHERE payee=? AND {date_clause} ORDER BY date DESC",
            [payee] + date_params
        ).fetchall()
    conn.close()
    return jsonify([
        {"date": r["date"], "payee": r["payee"], "category": r["category"], "amount": r["amount"]}
        for r in rows
    ])


# ── Monthly view (C1) ─────────────────────────────────────────────────────

@app.route("/api/monthly")
def monthly():
    """Return month-by-month expense/income sums for rolling chart."""
    conn = db.get_conn()
    cats_param  = request.args.get("cats", "")
    accts_param = request.args.get("accts", "")
    months_back = int(request.args.get("months", 24))
    date_from   = request.args.get("date_from", "")
    date_to     = request.args.get("date_to",   "")
    cat_list    = [c.strip() for c in cats_param.split(",")  if c.strip()]
    acct_list   = [a.strip() for a in accts_param.split(",") if a.strip()]

    if date_from and date_to:
        where  = "WHERE date BETWEEN ? AND ?"
        params = [date_from, date_to]
    else:
        where  = "WHERE 1=1"
        params = []
    if cat_list:
        placeholders = ",".join("?" * len(cat_list))
        where += f" AND category IN ({placeholders})"
        params += cat_list
    if acct_list:
        placeholders = ",".join("?" * len(acct_list))
        where += f" AND account IN ({placeholders})"
        params += acct_list

    rows = conn.execute(
        f"SELECT year, month, amount FROM transactions {where} ORDER BY year, month",
        params
    ).fetchall()
    conn.close()

    by_month = {}
    for r in rows:
        key = f"{r['year']}-{r['month']:02d}"
        by_month.setdefault(key, {"label": key, "expenses": 0, "income": 0, "count": 0})
        by_month[key]["count"] += 1
        amt = r["amount"] or 0
        if amt < 0:
            by_month[key]["expenses"] += amt
        else:
            by_month[key]["income"]   += amt

    sorted_months = sorted(by_month.values(), key=lambda x: x["label"])
    return jsonify(sorted_months[-months_back:])

# ── Tax Estimator (Phase 5) ───────────────────────────────────────────────

@app.route("/api/tax/config", methods=["GET"])
def get_tax_config():
    return jsonify(db.get_tax_config())

@app.route("/api/tax/config", methods=["POST"])
def set_tax_config():
    data = request.get_json() or {}
    db.set_tax_config(data)
    return jsonify({"ok": True})

@app.route("/api/tax/income")
def tax_income():
    from datetime import date as _date
    year = int(request.args.get("year", _date.today().year))
    rows = db.get_income_by_category(year)
    return jsonify({"year": year, "rows": rows})


# ── Category Map (legacy, kept for dashboard.js compat) ──────────────────

@app.route("/api/category_map", methods=["GET"])
def category_map_get():
    map_path = os.path.join(STATIC_DIR, "category_map.json")
    if os.path.exists(map_path):
        with open(map_path) as f:
            return jsonify(json.load(f))
    return jsonify({})

if __name__ == "__main__":
    print("Starting Budget API on http://localhost:5050")
    app.run(port=5050, debug=False)
