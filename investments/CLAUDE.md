# CEF — Closed-End Fund Tracker (Sage › Investments)

> ⚠️ **This is the LIVE code**, served on :8000 as the Investments personality of Sage.
> It lives in the **`sage` repo** at `/Users/ken/python3/source/sage/investments/`.
> The top-level `/Users/ken/python3/source/cef/` repo is **ARCHIVED** and serves nothing — do not edit it.

## Dev Server
- `cd /Users/ken/python3/source/sage/investments && /Users/ken/python3/source/sage/.venv/bin/python -m uvicorn cef.api.app:create_app --factory --host 0.0.0.0 --port 8000 --reload`
- Port **8000** — do not use this port for other apps (Sage's main Budget/Cash Flow/Tax app is :5050)
- App served at `http://localhost:8000`
- The Python package is still named `cef` (import path `cef.api.app`), even though the product is "Investments."

## Git / Remote
- Part of the **`sage`** monorepo — repo root is `/Users/ken/python3/source/sage/`, this app is the `investments/` subtree.
- Use `git -C /Users/ken/python3/source/sage` for all git ops. GitHub: `kjmacgrub/sage`.
- Live DB: `/Users/ken/python3/source/sage/investments/cef.db`.

## Key Files
- `cef/static/` — frontend (HTML/JS/CSS), dark theme
- `cef/static/styles.css` — dark theme + white nav override; uses `.global-tab-nav` / `.global-tab-link`
- `cef/api/app.py` — FastAPI app factory
- `cef/api/routes/` — funds, prices, holdings, distributions, screener, nav_history, imports, settings, audit, bdc_screener
- `cef/services/audit.py` — position audit engine (grading, coverage windows, discrepancy checks)
- `cef/services/schwab_import.py` — Schwab CSV -> DB; shared by the Import tab and the CLI
- `cef/services/bdc_screener.py` — BDC universe + metrics from SEC XBRL (CEFConnect has no BDCs)
- `import_schwab_transactions.py` — command-line front end for the same importer
- `cef/settings.py` — user-tunable settings; code defaults, DB rows override
- `cef/database.py` — SQLite schema + migrations
- `docs/bdc-audit-runbook.md` — quarterly BDC procedure (also published as a shareable page)
- `docs/decisions.md` — why calls were made (what to sell, what to track, rubric
  design). Read before reversing anything that looks arbitrary.
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
- `settings` table — key/JSON overrides; a missing row means "use the code default"
- `audits` table — one row per audit run, history kept; `settings_json` snapshots the
  rubric each grade was computed under, so old grades stay interpretable after retuning
- `bdc_fundamentals` table — manually entered BDC quarterly figures (NII/NAV/dividend/special)
- `bdc_screener_cache` table — BDC universe from SEC XBRL; coverage here is against
  **total** payout incl. supplementals, unlike the audit's regular-dividend basis

## Position Audit
Answers one question per holding: is the yield paying for itself, or is the payout
coming out of principal? Badge sits in the sticky ticker cell — click to run, hover
for a summary, click again for the full breakdown.

- **CEFs** grade on earned yield (NAV total return) vs distributed yield, blended
  across trailing 1Y/3Y plus a long-run figure. That long-run figure is the **median
  of rolling 3-year windows**, not a single inception-to-today measurement — one
  start date landing on a market peak would otherwise decide the grade (BSTZ anchors
  on 2021-08-20, the tech top).
- **BDCs** grade on filed NII coverage instead. Not available from any free API, so
  it comes from manual quarterly entry. See the runbook.
- Blended scores map to A–F via `audit.grade_bands`, with hard caps that fire
  regardless of score. A fund with too little data is graded `None`, never `F` —
  "couldn't measure" must not read as "bad".
- Data discrepancies are reported but never move the grade; they lower confidence.
- Settings live behind the Sage logo. Changing the rubric marks every stored audit
  stale rather than silently mixing incomparable grades.

### Gotchas found while building this
- CEFConnect row ordering is **not consistent across windows**: `/5D` returns
  newest-first, `/1Y` and `/5Y` return oldest-first. Always sort by date.
- `/5D` returns zero rows for funds that report NAV weekly (SPE). The fetch falls
  back `5D → 1Y → 5Y`; without it those funds look like they don't exist.
- The 5Y series is sparse for some tickers (XFLT: 15 rows vs 95 for 1Y), so the
  audit merges windows rather than trusting the widest one.
- Yahoo's dividend feed has real gaps (DMA is missing Jul 2023–Nov 2024 and
  Sep 2025–Jan 2026). Broker records in `distributions` fill them. Coverage *ratios*
  are unaffected either way — a missing payment shifts earned and distributed equally.
- `holdings.acquired_date` is often null and falls back to the first *recorded*
  distribution, which post-dates the actual purchase. Never annualize a hold shorter
  than 6 months off that guess.

## Portfolio Context
- 19 positions (17 CEF, 2 BDC) — ~$38,596 cost, ~$40,727 market value
- Held in a **Roth IRA**: distributions are tax-free, so ROC and tax basis don't matter here
- Lifetime CEF/BDC score is +$12.5k since Jun 2021, and essentially all of it is
  distributions — realized trading is slightly negative. See `docs/decisions.md`.
- Three-sleeve plan (income / options / managed index) is in `docs/decisions.md`;
  judge this sleeve on income, not capital gains.

## Design
- Dark theme throughout
- Part of the **Sage** financial app suite
