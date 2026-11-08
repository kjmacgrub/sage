# Budget / Sage (Cash Flow + Budget Planner)

## Dev Server
- `python3 -m uvicorn budget.api:app --host 0.0.0.0 --port 5050 --reload` (if needed — Budget Planner is mostly client-side)
- Budget Planner (`index.html`) can be opened directly as a file or served from port 5050
- Cash Flow dashboard: `http://localhost:5050/dashboard.html`

## Git / Remote
- Repo root: `/Users/ken/python3/source/budget/`
- GitHub: `https://github.com/kjmacgrub/budget.git`, branch: `master`
- This is a **nested repo** inside `/Users/ken/python3/source/` — always use `git -C /Users/ken/python3/source/budget` or cd into it

## Key Files
- `index.html` + `app.js` + `styles.css` — Budget Planner (pure client-side, localStorage)
- `dashboard.html` + `dashboard.js` + `dashboard.css` — Cash Flow dashboard (reads Quicken CSV)
- `tax.html` + `tax.js` + `tax.css` — Tax estimator
- `reserve.html` + `reserve.js` + `reserve.css` — Reserve: one-screen monthly check-in for the two-year cash bucket. Steps on the left (three balances, expenses from the newest Planner plan, guaranteed income list, fixed monthly distributions with an on/paused switch), the action card on the right with exact instructions. Rule: draw rate (yearly gap ÷ managed accounts) against a guardrail band over a baseline; above the band → pause distributions and live off the reserve; back inside → restart and top up to 24 months; under 12 months → sell/restart regardless. Annual items with sinking-fund float, rule table, settings, log and a family explainer live in popups. One JSON blob in the `reserve` table via `/api/reserve` GET/PUT.
- `api.py` — Flask API (port 5050), serves dashboard data
- `query.py` — Quicken CSV parsing logic
- `db.py` — SQLite helpers
- `budget.db` — SQLite database
- `category_map.json` — maps Quicken categories to Budget Planner categories

## Data Sources
- Budget Planner: localStorage only — no server needed
- Cash Flow: reads `/Users/ken/Downloads/Time Transaction All.csv` (Quicken export)
  - Skip 7 header rows; columns: `_t`, `_blank`, Date, Account, Payee, Category, Amount
  - Category format: "Group:SubCategory" (e.g. "Food:Groceries")
- CEF investment income → Cash Flow auto-feed is a planned feature (not yet built)

## Design
- App name: **Sage** — brand color sage green `#5a7a52`
- Apple-inspired: system fonts, light theme
- Shared `styles.css` used across Budget Planner, Cash Flow, Tax pages
