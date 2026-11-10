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
- `buckets.html` + `buckets.js` + `buckets.css` — Buckets: one-screen monthly check-in for the two-bucket plan (Cash bucket = money market holding two years of my draw, Growth bucket = everything invested; expenses are paid from shared checking, which is not a bucket). Top to bottom: header (person, month, button that opens the numbers drawer), the card with exact instructions and the distributions switch, then a large live SVG picture: guaranteed income and the two buckets feeding the Expenses column, with the months-of-cover gauge inside the Cash bucket tile and the draw-rate gauge (band shaded, pause line on top, review line below) inside the Growth bucket tile. The numbers (two balances, deposit from the newest Planner plan, own spending, annual items, income list, distributions) live in a drawer that opens by itself until the month is saved. Rule: draw rate (yearly draw ÷ Growth bucket) against a guardrail band over a baseline; above the band → pause distributions, live from the Cash bucket; paused and back at the baseline (not merely under the pause line) → restart and top up to 24 months; under 12 months → sell/restart regardless; no baseline → only the Cash bucket rows apply. The draw at the time the baseline was set is stored as `baselineGap`; when the current draw differs by more than 10% the card adds a step saying the baseline is stale. Any step that sells adds a pre-tax note. Annual items and income lines have start/end months (blank income dates = always); their twelfths stay in the Cash bucket and a bill is added to the transfer in the month it is due. Rule table, settings, log and a family explainer in popups. "Draw" in the UI is `gap` in the code and saved data. One JSON blob in the `reserve` table via `/api/reserve` GET/PUT (route and table keep the old name).
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
