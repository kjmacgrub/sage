# Budget / Sage (Cash Flow + Budget Planner)

## Dev Server
- `python3 -m uvicorn budget.api:app --host 0.0.0.0 --port 5050 --reload` (if needed — Budget Planner is mostly client-side)
- Budget Planner (`index.html`) can be opened directly as a file or served from port 5050
- Cash Flow dashboard: `http://localhost:5050/dashboard.html`

## Git / Remote
- Repo root: `/Users/km/python3/source/budget/`
- GitHub: `https://github.com/kjmacgrub/budget.git`, branch: `master`
- This is a **nested repo** inside `/Users/km/python3/source/` — always use `git -C /Users/km/python3/source/budget` or cd into it

## Key Files
- `index.html` + `app.js` + `styles.css` — Budget Planner (pure client-side, localStorage)
- `dashboard.html` + `dashboard.js` + `dashboard.css` — Cash Flow dashboard (reads Quicken CSV)
- `tax.html` + `tax.js` + `tax.css` — Tax estimator
- `api.py` — Flask API (port 5050), serves dashboard data
- `query.py` — Quicken CSV parsing logic
- `db.py` — SQLite helpers
- `budget.db` — SQLite database
- `category_map.json` — maps Quicken categories to Budget Planner categories

## Data Sources
- Budget Planner: localStorage only — no server needed
- Cash Flow: reads `/Users/km/Downloads/Time Transaction All.csv` (Quicken export)
  - Skip 7 header rows; columns: `_t`, `_blank`, Date, Account, Payee, Category, Amount
  - Category format: "Group:SubCategory" (e.g. "Food:Groceries")
- CEF investment income → Cash Flow auto-feed is a planned feature (not yet built)

## Design
- App name: **Sage** — brand color sage green `#5a7a52`
- Apple-inspired: system fonts, light theme
- Shared `styles.css` used across Budget Planner, Cash Flow, Tax pages
