# Sage — Personal Finance Suite

## Structure

| Directory | Module | Port | Description |
|-----------|--------|------|-------------|
| `budget/` | Budget Planner + Cash Flow + Tax | 5050 | Flask API + vanilla JS frontend |
| `investments/` | Investments (CEF Tracker) | 8000 | FastAPI + vanilla JS frontend |

## Dev Servers

**Budget / Cash Flow / Tax:**
```bash
cd budget
python3 api.py
# → http://localhost:5050/
# → http://localhost:5050/dashboard.html
# → http://localhost:5050/tax.html
# → http://localhost:5050/buckets.html
```

**Investments:**
```bash
cd investments
python3 -m uvicorn cef.api.app:create_app --factory --host 0.0.0.0 --port 8000 --reload
# → http://localhost:8000/
```

## Git

- Repo root: `/Users/ken/python3/source/sage/`
- GitHub: `https://github.com/kjmacgrub/sage.git`, branch: `main`

## Key Files

### budget/
- `index.html` + `app.js` + `styles.css` — Budget Planner (localStorage, no server)
- `dashboard.html` + `dashboard.js` + `dashboard.css` — Cash Flow (Quicken CSV)
- `tax.html` + `tax.js` + `tax.css` — Tax estimator
- `buckets.html` + `buckets.js` + `buckets.css` — Buckets: one-screen monthly check-in for the three-bucket plan (Spending, Cash, Growth). Instruction card on top, a large live flow picture below it, this month's numbers in a drawer that opens until the month is saved; rule, settings, log and explainer in popups. Draw-rate guardrail pauses/restarts the fixed distributions. Stored as one JSON blob via `/api/reserve`.
- `api.py` — Flask API (port 5050)
- `query.py` — Quicken CSV parsing
- `db.py` — SQLite helpers
- `budget.db` — SQLite database (not committed)
- `category_map.json` — Quicken category → Budget Planner category mapping


### investments/
- `cef/static/` — frontend (HTML/JS/CSS)
- `cef/api/app.py` — FastAPI app factory
- `cef/api/routes/` — funds, prices, holdings, distributions, screener, nav_history, imports
- `cef/database.py` — SQLite schema + migrations
- `cef.db` — production database (not committed)

## Design

- App name: **Sage** — brand color sage green `#5a7a52`
- Apple-inspired: system fonts, light/dark theme toggle
- Shared `styles.css` across Budget Planner, Cash Flow, Tax pages
- Nav links across all tabs with theme persistence

## Archived Repos

- `kjmacgrub/budget` — archived, superseded by this repo
- `kjmacgrub/cef` — archived, superseded by this repo
