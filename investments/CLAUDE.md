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
- `cef/services/exposure.py` — exposure taxonomy + category→exposure default map
- `backfill_leverage.py` — populate leverage for already-cached screener rows without a full refresh
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
- `screener_cache` table — pre-computed screener data, including leverage
  (ratio, preferred/debt split, band, indicative cushion, as-of date)
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

## Leverage

Answers a different question from the audit: not "is the yield earned" but
"how far can the market fall before this fund is forced to sell into it".
Reported beside the grade and deliberately **never folded into it** — a levered
fund is not a badly-run fund. It also stays out of `flags`, which exist to lower
confidence when data is doubtful; a known leverage ratio isn't doubtful data.

The load-bearing field is the **preferred/debt split**, not the headline ratio.
The 1940 Act tests debt at 300% asset coverage and preferred at 200%, so at an
identical 30% ratio a debt-levered fund has ~10% of portfolio decline before the
line and a preferred-levered one has ~40%.

### Gotchas found while building this
- Leverage is **not in the CEFConnect v3 JSON API** — only in the fund page
  HTML, in a `…leverageBlock` div. `fetch_screener_data` already fetches that
  page, so parsing costs no extra request.
- CEFConnect **omits the block entirely for unleveraged funds** (EXG). Recorded
  as unknown, never as zero: if the markup ever changes, a risk metric that
  silently reads "unleveraged" for every fund is the failure mode that hurts.
- Asset values refresh daily while leverage amounts refresh monthly-to-
  semi-annually, so mixing them can imply sub-300% coverage on a fund nowhere
  near its limit (NPFD reads 271%). `_leverage_cushion` returns None rather
  than a scary number whenever debt + preferred ≠ regulatory, or the result
  goes negative. Ranks reliably; will not support precise breach math.
- AVK and HGLB report Total Debt ≠ Regulatory Leverage. HGLB's figures are over
  a year stale, which is what `leverage_stale` marks.
- BDCs are tested at **150%** asset coverage (SBCAA 2018), not 300%/200%. Not
  scrapeable, so `total_debt` / `total_equity` ride along with the manual
  quarterly entry in `bdc_fundamentals`.
- `PUT /api/audit/bdc/{ticker}` used to write **every** column on every call,
  so a partial update silently nulled the fields it didn't send — it wiped a
  filed ARCC quarter during development. It now updates only keys present in
  the request body; an explicit null still clears a field.

## Exposure

What a fund actually **holds**, as distinct from `funds.type` (CEF/BDC — the
wrapper) and from the screener's `category` (structure and strategy). Twelve
buckets, one per fund, in `cef/services/exposure.py`.

Category is the wrong axis for spotting concentration and demonstrably so: it
split a 24% energy-infrastructure position across `Equity-MLP` (TYG, NML, SRV)
and `Equity-Sector Equity` (NXG), while merging NXG's midstream exposure with
BSTZ's tech inside that second bucket. Wrong in both directions at once, which
is why the concentration stayed invisible with a category column on screen.

- Default is derived from category; `funds.exposure` overrides it when set.
- Categories too broad to map (`Equity-Sector Equity`) resolve to **None**
  rather than a guess — "not yet classified", not silently wrong.
- Covered-call is a strategy, not an exposure: the category maps to US equity,
  so genuinely global funds like EXG need the override.
- Currently hand-set: BSTZ (Tech equity), NXG (Energy infrastructure),
  EXG (Global equity). 332 of 370 screener funds classify automatically.
- One bucket per fund, deliberately. The moment a fund can sit in two, the
  concentration total stops being readable.
- The portfolio breakdown flags any bucket at ≥20% — roughly 4× equal weight
  across the current book.
- On the **watchlist** the cell carries the weight already committed to that
  bucket, because the question there is not "what is this fund" but "what would
  buying it do to me". `new` means nothing held there yet; a yellow figure means
  the bucket is already ≥20% and a purchase would deepen it.
- Exposure is only as good as the source category. CEFConnect files ASGI (abrdn
  Global Infrastructure Income) under `Fixed Income - Taxable-Global Income`,
  so it resolves to Credit / loans — wrong, and fixable only by override.

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
