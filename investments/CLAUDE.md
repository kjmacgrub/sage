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
- `cef/api/routes/` — funds, prices, holdings, distributions, screener, nav_history, imports, settings, audit, bdc_screener, dividend_screener
- `cef/services/audit.py` — position audit engine (grading, coverage windows, discrepancy checks)
- `cef/services/schwab_import.py` — Schwab CSV -> DB; shared by the Import tab and the CLI
- `cef/services/bdc_screener.py` — BDC universe + metrics from SEC XBRL (CEFConnect has no BDCs)
- `cef/services/exposure.py` — exposure taxonomy + category→exposure default map
- `cef/services/dividend_growth.py` — S&P 1500 dividend-growth screen (sleeve four).
  Both CAGRs measured over the SAME window; `range=max` truncates dividend
  history so an explicit `period1` is required. Standalone copies of the same
  pipeline live in `dividend/` for rebuilding the published artifact.
- `backfill_leverage.py` — populate leverage for already-cached screener rows without a full refresh
- `import_schwab_transactions.py` — command-line front end for the same importer
- `cef/settings.py` — user-tunable settings; code defaults, DB rows override
- `cef/database.py` — SQLite schema + migrations
- `docs/bdc-audit-runbook.md` — quarterly BDC procedure (also published as a shareable page)
- `docs/decisions.md` — why calls were made (what to sell, what to track, rubric
  design). Read before reversing anything that looks arbitrary.
- `docs/backtest-autopsy.html` — options sleeve: the four Option Omega settings that
  inflated every backtest, why the iron condors came out, and where the rebuilt
  portfolio landed. Snapshot — the live copy is a published Artifact.
- `mae_check.py` — audits an Option Omega trade-log export for stop-outs the backtest
  skipped. Run on any new strategy before trusting its P/L.
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
- Currently hand-set: BSTZ (Tech equity), NXG + ASGI (Energy infrastructure),
  EXG (Global equity), BMEZ (Healthcare equity), BANX (Credit / loans).
  Nothing on the watchlist is unclassified; most screener funds map
  automatically from category.
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
  which resolved it to Credit / loans. Overridden to Energy infrastructure —
  the source data is wrong, and an override is the only fix.
- `Healthcare equity` was added to the taxonomy rather than filing BMEZ under
  US equity, which would have repeated the exact NXG/BSTZ merge this column
  exists to prevent. Add a bucket before forcing a fund into a wrong one.

## Portfolio Context
- 19 positions (17 CEF, 2 BDC) — ~$38,596 cost, ~$40,727 market value
- Held in a **Roth IRA**: distributions are tax-free, so ROC and tax basis don't matter here
- Lifetime CEF/BDC score is +$12.5k since Jun 2021, and essentially all of it is
  distributions — realized trading is slightly negative. See `docs/decisions.md`.
- Three-sleeve plan (income / options / managed index) is in `docs/decisions.md`;
  judge this sleeve on income, not capital gains.

### Options sleeve (backtested in Option Omega, not tracked in `cef.db`)

Full writeup in `docs/backtest-autopsy.html`; decisions and evidence in
`docs/decisions.md` (entries 2026-09-08 through 2026-09-12).

**Current book** — rebuilt Sept 2026, backtested 2017-05-16 → 2026-09-08 on $200k:

| Strategy | Cap | Share | Notes |
|---|---|---|---|
| Long Put Hedge | none, 2% | 41.9% | 0 DTE, net credit — the crash convexity |
| QQQ Leap | none | 20.9% | 74 trades, 6 losses — thinnest evidence in the book |
| Sell puts on rising SMA | 100 | 20.6% | 65 DTE credit put spread, goes flat before dislocations |
| Double Calendar (MTW) | 50 | 16.6% | 2/7 DTE, Mon/Tue/Wed only |

Backtest CAGR 74.3%, max drawdown 11.01%, peak margin 35.7%.
**Plan against 30% CAGR and 20% drawdown**, not the backtest figures.

**Daily Calendar 14/16 was cut** — $13/contract across 2,143 trades. Stop losses
were removed entirely in favour of Greek/VIX exits.

#### Measurement rules — read these before analysing any export

- **Use the portfolio CSV for every risk number.** The trade log's `Funds at
  Close` only updates when a trade closes, so open-position marks never appear
  and drawdown is understated **2–3×** (3.6% vs the real 11.01%).
- **`mae_check.py` no longer applies.** No strategy uses a stop, so it reports
  "no stops in use" for all four. That is an *unverified* backtest, not a clean
  one. Risk is still structurally bounded (all defined-risk multi-leg), but the
  tool that caught the $22k-live/$90k-backtest gap has no purchase here.
- **Contribution % is circular in a compounding book.** QQQ Leap showed 3.6% of
  P/L; a proper re-run without it ended at $5.5M instead of $19.8M. Percentage
  sizing feeds every dollar a strategy earns into every other strategy's size.
  **Never judge a strategy by its share — re-run without it.**
- **A conditional distribution cannot tell you what changing the condition does.**
  `Max Profit` is censored by the exit being assessed; exit-reason P/L is negative
  *because* that bucket collects the losers. Both misled. Only a re-run answers it.

#### The parts worth not rediscovering

- **Four Option Omega settings must be checked on every new strategy.** Correct
  states: `Ignore Single Bar Stop Loss Breach` OFF, `Cap Non-Opening Stop Outs at
  User-Defined Stop Amount` OFF, `Use 0-DTE Intra-Minute Stops` ON, `Ignore Trades
  with Wide Bid-Ask Spread` OFF, and set `Exit Slippage`. With these wrong, a live
  year that made $22k backtested at $90k.
- **Slippage is the biggest open uncertainty and is not evenly distributed.**
  Breakeven per option per side: Double Calendar **16¢**, Long Put Hedge **19¢**,
  Sell puts **19¢**, QQQ Leap **$13.28**. Portfolio survival: 10¢ → 57%,
  15¢ → 35%, 25¢ → negative. **Under friction the book converges to QQQ Leap
  plus noise.** Measured entry slippage on 583 matched live pairs: **4.5–10¢/leg**
  at one contract.
- **Iron condors were removed (Sept 2026), and re-tested in Sept 2026 with the same
  answer.** With honest settings the original book went from +$281k to −$32k over
  4.3 years, 53% drawdown, test terminated early. The re-test found the mechanism:
  a 0DTE SPX condor has a **$72,932 gross edge over 4.3 years and breaks even at
  17¢/leg**, earning **$18–30/contract** at the measured 4.5–10¢ — 3–4× weaker than
  the weakest strategy in the book. **Delta and stop sweeps cannot move it**; they
  redistribute the edge without touching a friction load that scales with legs, not
  credit. Don't re-add without clearing the bar: positive in every calendar year
  with flags set (best found: 4 of 5). See the 2026-09-18 decisions entry.
- **OO logs an iron condor as three rows** — long wings, put side, call side —
  because `Exit - Puts` and `Exit - Calls` manage separately. Group by
  (Date Opened, Time Opened) or trade counts triple.
- **Never size by contract cap alone.** Percentage sizing divides an allocation by
  margin-per-contract, which collapses toward zero on degenerate calendars and
  produced a 1,402-contract position. Pair it with a **minimum premium filter**
  (`$1.00` debit).
- **Liquidity is per-order and per-tenor, not per-strategy.** A vertical is limited
  by its *thinner* leg — at SPX ~7,700 the 7600 put carried 8,778 OI and the 7595
  carried 125. **Width buys size:** the same dollar risk needs 1,850 contracts of a
  5-wide or **370 of a 25-wide**. 0 DTE SPX is effectively bottomless; 65 DTE is not.
- **MTW: the Double Calendar can only trade Mon/Tue/Wed.** Every entry is a (2,7)
  DTE pair, and the short leg needs an expiration two calendar days out — from
  Thursday that is Saturday. Ceiling ~60% of trading days; actual fill 45%. A
  complementary 4/9 would cover Thu/Fri (untested).
- **Concurrency is emergent unless something caps it.** SPX strategies peak at 2
  because of 0–2 day holds against a 2–3 day cadence; QQQ Leap peaks at 10 because
  a 78-day hold against a 14-day cadence makes stacking unavoidable. **Anything
  that lengthens holds removes the accidental protection.**
- **Don't pause QQQ when positions stack.** The stacking signal is the
  entry-quality signal — pausing at three open costs 42% of the strategy.
- **Superseded 2026-09-12 — the entry filter was never what this note assumed.**
  Reconstructed against all 74 real trades: `SMA10 > SMA20` held on only **28 of
  74** entries and `Max RSI 69` blocked **zero days**, so neither leg was
  filtering anything. `gap ≤ −1.5%` alone reproduces every entry. The warning
  against tuning still stands for *fitted* filters — the one that removes the six
  2022 losers gives up $723k to save $24k, and the 2022 pattern reverses over 27
  years — but a **rising-SMA200 trend gate is not that**: it holds in both eras
  (78.1% pre-2017 against a 70.3% baseline) and is now part of the settled config.
  Threshold and delta sweeps remain a leverage dial, not an edge parameter. Full
  working in the 2026-09-12 decisions entry.
- **This book wants room.** A wider profit target beat a narrower one; the deep put
  stop (90) beat 70/80; the hedge's every dollar comes from letting positions expire
  while its two management exits lose $4.66M. Defined-risk structures recover.
- **QQQ Leap sizing — use 7%, and price it at the strike you actually buy.**
  The strategy enters at **362–448 DTE, strike ≈ 0.974 × spot**, which is ~66
  delta, not 60. At QQQ $716.66 (2026-09-11) that strike costs **~$9,264**, not
  the ~$7,800 a true 60-delta implies — an 18% difference that moves every
  threshold. It buys whole contracts, so the allocation is binary:

  | Allocation | Sleeve needed | On $200k | Switches off after |
  |---|---|---|---|
  | 5% | $185,000 | 1 contract | **−8% drawdown** |
  | 7% | $132,000 | 1 contract | −34% drawdown |

  **The 5% cliff sits inside the backtest's own 11% max drawdown** — an ordinary
  drawdown would switch off the second-largest contributor and keep it off until
  recovery. Recheck the contract price before each sizing decision; it tracks spot.
- **QQQ Leap's constraint is volume, not open interest.** Chain checked
  2026-09-11: only two expirations exist in its window (2027-09-17 at 371 DTE,
  2027-12-17 at 462). OI in the 60-delta region is adequate at **10,658**, but
  **total volume across those nine strikes was 12 contracts**. Open interest there
  is stale inventory, not daily liquidity — every order is effectively the day's
  whole trade in that strike. The backtest's **133 contracts is 39% of OI at the
  705 strike against 3 contracts of daily volume — not a fill.** At the sizes
  rebalancing produces (~14 contracts at year 10, ~30 at $2M) it works, but as a
  worked limit over days, not a market order. Bid-ask runs $2.85–4.08 on options
  priced $65–131. Pull the chain from
  `https://cdn.cboe.com/api/global/delayed_quotes/options/QQQ.json` — it carries
  OI, volume and greeks; Yahoo's options endpoint now 401s.
- **`Max Open Positions` is unreliable per-run, which is worse than broken.**
  A cap of 5 bound correctly (peak concurrency fell 7 → 5), then a cap of 3
  returned files **byte-identical** to the cap-5 run — same MD5, 79 minutes apart,
  max concurrent still 5. It had bound once and silently did nothing the next
  time. **Verify the effect in the output before reading any result**, and prefer
  a change that must be unmissable (set the cap to 1). This supersedes the earlier
  "does survive the portfolio tester" correction: both results are real, which is
  the point.
- **Backtest gotcha.** A standalone run of one strategy starves itself and silently
  skips entries it can't afford — QQQ dropped 24 of 34 signals that way, biased
  toward the high-IV ones that perform best.

#### Sleeve structure

One third of a whole: **options (taxable) · CEFs (Roth) · managed index (taxable)**,
rebalanced annually as a **ratchet** — profits out on gains, **never added back on
losses**. An options book underperforming is evidence the edge stopped working, not
a discount. Costs ~4 points of portfolio CAGR; Section 1256 mark-to-market makes it
free at the margin.

Rebalancing means the sleeve grows at the *portfolio's* rate (~15.7%/yr), reaching
~$857k at year 10 rather than $35M — which is why most of the liquidity analysis
stopped applying. The one cap that still binds is **Double Calendar's 50 at $624k,
about 7.8 years out**.

**Tripwires** (options sleeve only, absolute, never relative to the other sleeves):
fill slippage >15¢/leg · per-contract edge <50% of backtest (Hedge $101.83 ·
Calendar $130.51 · Puts $76.76 · QQQ $2,655.51) · drawdown >20% · MTW win rate ~52%
in 2027 · two consecutive losing years. **One = investigate, two = stop adding.**
The first two are the fast detectors — track fill-versus-mid and per-contract edge
by strategy from day one.

## Sleeve four — dividend growth

Individual dividend-growth companies, judged on **yield on cost** twenty years
out rather than current yield. Screener lives under **Screen › Dividend Growth**;
the yield-on-cost calculator under the top-level **Calculators** tab.

- `dividend_screener_cache` — 1,025 S&P 1500 payers. Rebuild from the UI
  (**↻ Rebuild**, ~10 min, three phases with progress) or `dividend/build.py`.
- **The 2–3% starting yield is arithmetic, not a compromise.** Yield today ÷
  yield at the start = (1+g_div)ⁿ ÷ (1+g_price)ⁿ, so a screen demanding both
  CAGRs over 25+ years pins the yield near where it began. Raising the ceiling
  to 8% returns identical names. Above 5% yield the median company pays out more
  than it earns. Never compare this sleeve's yield to the CEF sleeve's.
- **The payout column cannot measure REITs** — they distribute ~90% of taxable
  income and are assessed on FFO, which is non-GAAP and absent from Yahoo.
- **FCF cover** is against the cash cost of the dividend (shares × trailing DPS),
  not inferred from the payout ratio. Free cash flow is lumpy: KO reads 0.58×
  and has no dividend problem.

## Design
- Dark theme throughout
- Part of the **Sage** financial app suite
