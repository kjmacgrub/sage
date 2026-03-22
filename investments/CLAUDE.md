# CEF — Closed-End Fund Tracker

## Dev Server
- `cd /Users/km/python3/source/cef && python3 -m uvicorn cef.api.app:create_app --factory --host 0.0.0.0 --port 8000 --reload`
- Port **8000** — do not use this port for other apps
- App served at `http://localhost:8000`

## Git / Remote
- Repo root: `/Users/km/python3/source/cef/`
- GitHub: `https://github.com/kjmacgrub/cef.git`, branch: `master`
- This is a **nested repo** inside `/Users/km/python3/source/` — always use `git -C /Users/km/python3/source/cef` or cd into it

## Key Files
- `cef/static/` — frontend (HTML/JS/CSS), dark theme
- `cef/static/styles.css` — dark theme + white nav override; uses `.global-tab-nav` / `.global-tab-link`
- `cef/api/app.py` — FastAPI app factory
- `cef/api/routes/` — funds, prices, holdings, distributions, screener, nav_history, imports
- `cef/database.py` — SQLite schema + migrations
- `cef.db` — production database (never commit, never modify directly during dev)
- `cef_demo.db` — simulation/demo copy (safe to use for testing)
- `simulate.py` — 3-year portfolio simulation
- `simulation_result.json` — last simulation output
- `DESIGN_REPORT.md` — full 15-item feature roadmap and simulation results

## Database Notes
- `holdings` table — current portfolio positions
- `prices` table — price/NAV history
- `distributions` table — dividend/distribution records
- `nav_history` table — exists but empty (NAV sparklines is a planned feature)
- `screener_cache` table — pre-computed screener data

## Portfolio Context
- 9-fund CEF portfolio, ~$18k invested, 10.2% yield, ~$153/mo distributions
- Simulation: Jan 2024–Dec 2026, 31 buys, 0 sells, 30/36 positive cash flow months

## Design
- Dark theme throughout
- Part of the **Sage** financial app suite
