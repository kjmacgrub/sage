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

| Strategy | Cap | Share | $/ctr | Notes |
|---|---|---|---|---|
| Sell puts on rising SMA | 100 | 37.3% | +78 | 65 DTE credit put spread, goes flat before dislocations. Filter is `Compare SMA, 10 > 20` — a **crossover**, despite the name; no RSI leg |
| Double Calendar (MTW) | 50 | 24.6% | +98 | 2/7 DTE, Mon/Tue/Wed only. Lifetime fine but **−$30/ctr in 2026** — track it separately |
| **CIC - AM** | **2** | 18.8% | +42 | 10:00 SPX 0DTE condor, 15Δ shorts / ~1Δ wings, 200% stop. Replaced both afternoon condors. **Never traded live** |
| QQQ Leap | none | 9.7% | +1,849 | 37 trades in 7.4 yrs; absent in 2022 (gate). **NOT absent in 2026** — corrected 2026-10-05, that came from a log ending 2025-12-17 |
| Long Put Hedge | none, 2% | 9.6% | +95 | 0 DTE, net credit. $95 is the **post-2022-05-11** figure; see the blended-figure trap below |

> **LIVE BASELINE (2026-09-27).** What is actually being traded for the rest of
> 2026 is a **three-strategy subset at $80k**: Sell puts (2 ctr) · CIC-AM (1) ·
> Long Put Hedge (1). Backtested 2022-05-16 → 2026-09-25: **33.7% CAGR, worst
> drawdown 5.5% of funded capital, structural bound 27%.** Dropping QQQ Leap and
> the Double Calendar cost ~6 points of CAGR and cut worst drawdown **four-fold**
> — both carry overnight and both saw margin/trade grow 5-6x with the index,
> which is what made the five-strategy drawdown creep 6.4% → 23.7%.
> **Plan for 5-6%, be solvent at 27%.** Full detail and the untested parts in the
> 2026-09-27 decisions entry. The five-strategy figures below are the research
> book, not the live one.

**Measured 2019-05-16 → 2026-09-25 at FIXED sizing** (2/2/2/1/3 contracts, flat
across eight years), from the **portfolio export**: $200k → **$904,622**,
**22.8% CAGR**, **−5.50% max drawdown** marked daily with open positions
included, **positive in 8 of 8 calendar years**, zero days worse than −10% in
1,851 sessions. **Plan against 20% CAGR and 10% drawdown** — this supersedes the
old 30%/20% figures, which came from a run that compounded position size.

Shares here are not comparable to the pre-2026-09-26 table, where floating
sizing put the Hedge at 41.9% and QQQ Leap at 20.9%.

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
- **`Max Loss` in the trade log is COARSER than the stop engine — you cannot
  simulate a tighter stop from it (2026-10-04).** With `Use 0-DTE Intra-Minute
  Stops` ON the stop sees intra-minute ticks; the logged MAE does not. Simulating
  a 125% stop off the 200% log **under-fired by 95 of 1,390 legs**, and because
  those legs swing from profit to full stop the error was **-$57,407** — the
  entire gap between a simulation that said *+$67k, change it* and an OO re-run
  that said *-$22.6k, don't*. One leg logs -19.9% MAE and trips a 125% stop.
- **A calibration that doesn't exercise the model is not a calibration.** The
  same simulation "validated" at X=200 where its own guard (`if X<200`) meant
  nothing fired — it compared the baseline to itself and reported 2% error.
  **Check that the model actually fires at the calibration point.**

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
- **Iron condors: three attempts. The third (2026-09-26) cleared the bar.**
  `CIC - AM` — 10:00 SPX entry, 0 DTE, one contract, no re-entry, **15Δ shorts /
  ~1Δ wings, 200% stop** — is positive in all five calendar years *and* its carry covers
  its ticket cost in all five. +$78,530 carry, +$63,389 total, ~$11,443 margin.
  **The two levers that mattered: stop rate 52% → 28% — which took BOTH pulling
  the shorts from 20Δ/30Δ out to 15Δ/15Δ AND widening the stop from 100% to 200%
  (the carry is a knife edge on it — 47.8% pays $41/short, 53.0% pays $3) — and
  delta-set rather than fixed-point wings (a ±100 offset was a 3.09% tail at SPX 3,900 and a 1.61%
  tail at 7,400, tripling ticket costs).** Fits the capital only on its own —
  running it alongside the afternoon pair puts 58 of 184 days over budget. Never
  traded live. See the 2026-09-26 decisions entry for the full sequence; the
  final config is half the value.
- **CLOSED: the IC stop level is swept in BOTH directions; 200% is the peak
  (2026-10-04).** Nine isolated runs, 2017-09-05 -> 2026-10-02, $200k, 1 ctr:
  100/125/150/175% earn 30.2/43.3/54.4/56.5k, **200% earns 65.9k**, 250/300/400%
  earn 32.3/38.7/41.9k, no stop earns **-$0.2k at -30.75% drawdown**. 200% is the
  peak in every crisis-exclusion column. **The tight side is systematic** (clean
  gradient, mechanism below); **the loose side is crisis-dominated** — strip April
  2025 and the ordering scrambles — but its **drawdown is monotonic** (-4.13% ->
  -30.75%), so "don't loosen" is a risk result, not a P/L one.
  **Mechanism: break-even recovery rate for moving the stop S -> S' is
  `(S'-S)/(S'+100)`.** Tightening 200 -> 125 needs recovery below 25.0%; observed
  is 25.8%, and 97% of the legs a 125% stop kills were profitable when left alone.
  Loosening fails because the formula assumes you exit *at* the trigger and the
  rare failure gaps far past it.
- **Exits on VIX, VIX9D, IV or underlying price movement cannot work on a
  delta-selected short.** A 15Δ strike is ~15% likely to be touched regardless of
  VIX — OO places it further out when vol is high, so strike selection is already
  a vol normalizer and a surge exit double-counts. Binned by the day's adverse SPX
  move, $/leg goes +70 / +40 / +35 / **-40** / **+147** / **+201** — non-monotonic
  and inverting at the top. **The 200% stop is itself a price-and-volatility
  trigger**, greek-weighted on the actual position; VIX is one unweighted input
  measured on the index. Every surge exit is a noisier proxy for it.
- **Calendar-year positivity is a qualification gate, not a parameter optimizer.**
  At 1 ctr from 2017, 125%/150% read 9/10 positive years against 200%'s 8/10 while
  earning $11.5-22.6k less; two of 200%'s negatives are -$305 and -$471 on $200k.
  Use the bar to decide whether a strategy enters the book, never to rank configs.
- **Friction must be measured, not assumed.** Commissions are **1.175 open /
  1.22 close** (not 1.75 — that overstated by 49%); entry slippage **0.035/leg**
  on shorts and **−0.027** on wings (not 0.20). Exit slippage is still
  unmeasured because matched stop-outs fire at different moments; 0.05 is an
  assumption and does not bind (breakeven 0.539/leg).
- **`Use 0-DTE Intra-Minute Stops` ON is conservative by ~$50/contract.**
  Measured on 272 matched stop-outs: live fills −$78.7, OO −$129.2, t=2.71.
  Leave it ON; every backtest result carries that pessimism.
- **Schwab holds FULL spread width as collateral in the IRA**; OO holds
  width-minus-credit. **Ratio 1.073x — corrected 2026-10-04** from measuring 1,852
  condors (median width $6,000 vs max loss $5,355); the old 1.15x came from a
  single observation ($5,000 / $4,348) and overstates collateral by ~7%.
- **`Margin Req.` IS the theoretical max loss, and it is a hard cap (2026-10-04).**
  Margin / (width - credit) = **1.001** across 1,852 condors, p10 1.000, p90 1.001
  — and it already reflects that only one side of a condor can lose. Realized loss
  never exceeded it: worst case 43% of margin at the 200% stop, and exactly 1.00x
  (plus ~$11 commissions) with no stop. **So the collateral figure doubles as the
  disaster number — read margin as what you lose if the stop fails completely**,
  which is the 2026-09-28 API-outage scenario and the reason the resting stop
  (which rests at the exchange) matters. No separate risk calculation is needed.
- **Check large stop breaches against the day's actual high/low.** OO priced a
  0DTE call at $51.60 that was 36 points OTM at the session high (2026-05-18) —
  −$5,000, 22% of that run's total. 20 of 22 breaches beyond 3x credit were
  genuine; two were impossible.
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
  (Date Opened, Time Opened) or trade counts triple. **`Margin Req.` is carried on
  every one of those rows and is per-TRADE, not per-row** — summing it across open
  rows inflated 2026 peak margin from $21,683 to $50,129 (2.3x) and nearly drove a
  live funding decision. Group first, then sum.
- **Never read a CAGR or a drawdown off a backtest funded differently from the
  account you trade.** The live book at $200k reads 13.40% CAGR / -3.14% DD and
  looks like it merely matches SPX; the identical trades at the $40k actually
  committed read **31.10% / -10.66%**. Mean utilisation was 3.9% of net liquidity.
  Since contracts are fixed, dollar P/L is constant — re-express the curve at real
  funding before judging anything. See the 2026-10-04 decisions entry.
- **Never size by contract cap alone — *history, pre-cap era*.** Percentage sizing
  divides an allocation by margin-per-contract, which collapses toward zero on
  degenerate calendars and produced a 1,402-contract position. The fix then was a
  **minimum premium filter** (`$1.00` debit). Contract caps removed that failure
  mode entirely, so the filter now protects against nothing.
- **The minimum-entry-premium filter is inert. Don't sweep it (checked
  2026-09-28).** On the put seller it is set to `0.20` = $20/contract, while the
  strategy's actual credit runs **$163–208 (p10–p90), minimum $48** across 2,179
  trades — **it has never blocked a single entry.** Nor is there signal to
  optimise toward: P/L is a flat **31–38% of credit collected** in every band
  from $150 to $350+, and the 17 losers' credits (median $178) are
  indistinguishable from the population (median $178). Harmless to keep as a
  backstop if the delta ever changes; **credit it with nothing**, because any
  result attributed to it is coming from somewhere else.
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
  filtering anything. `gap ≤ −1.5%` alone reproduced every one of those 74.
  **That is history, not the live config — see the entry rule below.** The warning
  against tuning still stands for *fitted* filters — the one that removes the six
  2022 losers gives up $723k to save $24k, and the 2022 pattern reverses over 27
  years — but an **SMA200 trend gate is not that**: it holds in both eras
  (78.1% pre-2017 against a 70.3% baseline) and is part of the settled config.
  **That study described a *rising* gate; the live config tests *above* — see the
  correction above. Don't cite the 78.1% figure for the live rule.**
  Threshold and delta sweeps remain a leverage dial, not an edge parameter. Full
  working in the 2026-09-12 decisions entry.
- **This book wants room.** A wider profit target beat a narrower one; the deep put
  stop (90) beat 70/80; the hedge's every dollar comes from letting positions expire
  while its two management exits lose $4.66M. Defined-risk structures recover.
- **QQQ Leap's live entry is `Move Down ≥ 1.75%` at a 15:30 entry, ABOVE the
  200-day SMA** — *above*, not *rising* (**corrected 2026-10-05**: verified on all
  37 entries, above 37/37 vs rising 36/37; **2023-02-09 entered with SMA200
  falling**). **The distinction matters: a level gate only turns defensive after
  price has already fallen through the average**, so it protects in a broken trend
  (2022: QQQ above SMA200 on 6% of days, entries blocked) and not in an extended
  one (2026: above on 94% of days, trading all year). It is not a bubble detector. — profit target 60%, exit at 3 DTE, round strike to 5.
  Verified against all 37 entries in the 2019–2026 run: Movement median −2.29%,
  every entry qualifying, while **only 3 of 37 would have passed `gap ≤ −1.5%`**.
  A late entry widens OO's `Move` window to most of the session, so this is an
  intraday slide caught near the close — the nearest thing OO can express to a
  true intraday touch. **The gap-vs-move table in the 2026-09-12 decisions entry
  predates fixed sizing and is not a live comparison**; it was measured on $30M
  endings with floating position size.
- **The hedge's management exits are NOT dead weight — tested 2026-09-29, do not
  retest.** They appear to cost $69,924 against $109,016 of expiry profit.
  Removing them is **worse by $17,633**: the `Expired` average collapses from
  +$973 (n=112) to +$46 (n=425), 112 trades reach the −$965 floor where none did
  before, and 2024 flips negative. Confirmed standalone and at portfolio level.
  **A conditional average cannot be extended to the population conditioned out** —
  +$973 was a property of which trades survived to expiry, not of expiry.
- **Entry filters and exits are different objects.** Removing the SMA filter, the
  minimum premium and the QQQ RSI legs all cost nothing — a declined entry is
  only a missed opportunity. An exit caps what is already open; removing one
  hands you the left tail. Do not carry "filters are usually inert" across that
  line.
- **Put-seller DTE 60 vs 70 is noise (2026-09-29).** Headline says +$7,754 and
  two fewer losers; paired on the 1,890 trades both runs took it is
  **+$0.07/trade, t = 0.05**, and 48% of the gap is trades the other run never
  took. Per-trade SD $59 means detecting $1/trade needs 12,342 paired trades.
  Margin, hold and concurrency are identical. **Stop sweeping DTE.**
- **CLOSED: do not re-test closing the IC early (2026-10-03).** Late stops are
  **1.05% of short legs at −$603**; break-even residual is **$6**, so holding to
  expiry is +EV almost always. Stops cluster early — 59% before noon, only 3.8%
  after 15:30. Time-close (15:00/15:30/15:45) and profit-target have both been
  tested and rejected. A *conditional* close (only if ≥80% captured) is not
  expressible in OO **and would not help**: it fires in the safe states and skips
  the dangerous ones. **thinkScript** (thinkorswim's language — not
  PineScript) computes studies and fires alerts but **cannot place orders**, and
  TOS conditional orders reduce this rule to a profit target, already rejected.
  A custom Schwab-API engine means owning the outage risk yourself.
- **`Use Resting Stop Market Order` CONFIRMED WORKING (2026-09-30).** First live
  stop-out under it fired at 16:00 on expiry day — worst possible gamma — and
  overshot the 3x stop level by only **0.70**, against 1.10 in the backtest's own
  intra-minute model and 1.89 on the API-outage day. **It executes better than
  the model assumes.** On that trade it also converted a −$1,558 expiry outcome
  into −$650 (SPX settled 18.48 inside the short strike). A stop that looks like
  it destroyed a position is usually the reason the loss was bounded.
- **`Use Resting Stop Market Order` must be ON for CIC - AM.** It was off on day
  one (2026-09-28) when Schwab's API went down 10:06–10:38: the stop was breached
  and could not execute for 38 minutes, finally filling at 9.00 against a 7.10
  stop, logged as `MaxLoss`. With it off, stops are managed by OO over the API —
  **no connection means no stop**, on $8,775 of defined risk per side. No
  slippage setting models an API outage. The Long Put Hedge cannot use this (its
  exit is `Below Delta`; a resting order is price-triggered and cannot express a
  Greek) but its risk is ~$965/trade, so it matters far less.
- **Margin grows on its own, and vol moves it harder than the correlations imply
  (2026-10-04).** Delta-set strikes sit further from spot when EITHER the index or
  implied vol rises, so width — and margin — rise with both. CIC-AM median
  per-trade margin ran **SPX +36% against margin +107%** over 2024 -> 2026. The
  margin/SPX ratio is ~1.0 in calm years and **~1.5-1.6 in volatile ones**. The
  "+0.71 SPX vs +0.26 VIX" correlation below measures *consistency*, not
  magnitude. **Size against next year's peak, and assume a volatile year costs
  ~1.5x a calm one at the same index level.**
- **Margin is the spread width — not the premium (measured 2026-09-29).**
  Correlation of margin with width **+1.00**, SPX level +0.71, credit +0.54,
  VIX **+0.26**. A vol spike raises margin only because a 15Δ strike sits further
  from spot, widening the spread; Schwab holds full width with no credit offset,
  so the premium cannot affect it. **The index level matters ~3x more than
  volatility** — a vol spike adds ~9%, a new SPX high adds permanently.
- **Compute peak concurrent margin on a continuous timeline, not grouped by open
  date** — Sell puts holds ~2 days, so grouping understates. True 2026 peak
  $19,113 ($21,980 at Schwab). **One condor is 82% of peak margin**; carried
  positions are a rounding error.
- **Collateral releases at the open, not across sessions (confirmed
  2026-09-29).** A condor's call-spread width is held overnight pending
  settlement and freed at 9:30. `Available Funds For Trading` = Cash − open
  collateral, and that is what gates orders. **`Intraday Buying Power` is dead**
  — $8,046.40 unchanged across three snapshots and a full round trip.
- **Fixed contracts is not fixed risk.** At flat 2/2/2/2/3 contracts the book's
  total margin per session went **$4,796 (2017) → $27,866 (2026)** — strikes are
  delta/percentage-based while SPX went 2,400 → 7,700. Caps still beat
  percentages because index drift is slow and visible, but **the annual review
  must read margin deployed, not contract count.**
- **Raise contract counts once a year, on live evidence, never mid-drawdown.**
  A percentage responds only to account equity — a lagging record of past P/L —
  and cannot see whether the edge still works, whether fills have degraded, or
  whether the strategy can absorb another contract (QQQ Leap: 12 contracts of
  daily volume). It looks adaptive because it moves; it moves to the wrong
  signal.
- **Sizing is by CONTRACT CAP, not percentage allocation (2026-09-26).** Each
  strategy runs a fixed count — 2 / 2 / 2 / 1 / 3 for Puts, Calendar, CIC-AM,
  QQQ Leap, Hedge. A strategy's configured percentage (QQQ Leap still reads 5%)
  is **deliberately overridden by the cap** and the effective allocation is far
  lower — QQQ Leap runs at ~0.89% of the account. That is the design, not a
  misconfiguration: caps are what made the book measurable, and they get raised
  methodically on live evidence rather than by restoring a percentage. The
  percentage-sizing warnings below are history from the pre-cap era.
- **QQQ Leap sizing — historical, from the percentage era; superseded by the cap
  above.**
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
- **Ignore any portfolio backtest that lets position sizing float.** The same
  book unconstrained reached $18.7M and an 85.3% CAGR on median 211-contract
  hedges and 79-contract QQQ Leaps — the latter unfillable per the chain check.
  Fix sizing to what you would actually trade, then read the portfolio export.
- **Share of P/L is a function of sizing, not merit.** At fixed size the Hedge
  is 9.6% of P/L rather than 41.9%; `CIC - AM` read 0.7% in the floating run
  purely because it is capped at 2 while everything else scaled 25–100×. Judge
  on per-contract edge.
- **The Long Put Hedge's blended per-contract edge is a false alarm on any window
  reaching before 2022-05-11**, when its instrument launched: −$22/contract
  before (n=315), **+$95 after (n=427)**, against a $51 alarm. A full-history run
  will keep reporting ~$45 and look like a tripwire. It is not.
- **A margin-starved run silently selects losers.** At $40k the book took **13 of
  137** Double Calendar signals in Q4 2024 and they were the bad ones, making the
  strategy read $46/contract (below alarm) where at tradeable size it is **+$98
  lifetime**. Check trade counts against a full-size run before trusting any
  per-contract figure.
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

One of three: **options (Roth) · CEFs (Roth) · Fidelity managed (all taxable)**,
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

**A tripwire is now a portfolio event, not a sleeve event.** Everything outside
the Roth is a 66/34 Fidelity book with no drawdown defence of its own, so this
sleeve is the portfolio's only crash-positive stream — and only ~42% of it is
(QQQ Leap is long QQQ, correlated with that equity). The hedge does not reduce
drawdown (−11.11% with, −10.74% without); what it does is return +34% in the
2022 bear against 17.9% without, on an instrument that has existed since
2022-05-11. **n = 1.** Size the reliance to that.

## Sleeve four — dividend growth (RETIRED 2026-09-19, never funded)

**Do not rebuild the case for this without re-running the index comparison** —
the test the original work skipped. Over 10 years the screen returned 8.25%/yr
against SPY's 15.39% and SCHD's 13.01%, having taken full single-stock equity
risk to deliver balanced-portfolio returns; the selection bias flatters even
that. It would also have wash-saled against direct indexing in the same taxable
space. See the 2026-09-19 decisions entry.

The code stays and works — it is a research tool, not a sleeve. Everything
below still describes it accurately. Lives behind the **Dividend Growth** sleeve
switch in the header — Holdings · Screen · Calculators · Import.

- **Its own database, `dividend.db`** — not `cef.db`. The two sleeves want
  different schemas and this one may move to Fidelity; see the 2026-09-19
  decisions entry. Code in `cef/dividend/`, routes at `/api/dividend*`.
- `screener_cache` — 1,025 S&P 1500 payers. Rebuild from the UI
  (**↻ Rebuild**, ~10 min, three phases with progress) or `dividend/build.py`.
- **`initial_cost` is written once and never updated.** Under DRIP every
  reinvestment inflates `cost_basis`, so yield on cost measured against it
  understates by ~3.7× at year 20. It cannot be reconstructed later without
  replaying every transaction.
- **Imports are refused when the account can't be read from the filename.**
  Schwab gives one file per account with no account column; the name carries it.
  Guessing would file a taxable export under the Roth, silently.
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

## Navigation — the sleeve switch

The header carries a two-way switch (**Income** · **Dividend Growth**) with the
account named beside it; the tab row below belongs to whichever sleeve is
selected. It replaced a `CEF.` wordmark that named the archived `cef` repo and
had stopped describing the app.

Sleeve is **not** a peer of Portfolio/Watchlist/Screen — those are views *of* a
sleeve. Putting the dividend holdings in that row would have left two unlabelled
portfolios side by side, and one Import tab would have had to guess whether a
Schwab CSV was the Roth or the taxable account — the exact guess
`cef/api/routes/dividend.py` refuses to make. Sleeve context answers it instead.

- Tab keys are namespaced (`screen` / `div-screen`, `import` / `div-import`) so a
  `_tab` restored from a previous session can never render one sleeve's view
  under the other's header. `normalizeTab()` runs before the first paint.
- Selection persists in `localStorage` under `sage-sleeve`.
- `screenKindToggle()` belongs to the **income** sleeve only, and appears in
  exactly two places (`renderScreen`, `renderBdcScreen`). A string-replace that
  strips it will match `renderBdcScreen` first — both blocks open identically
  with `padding:0 0 24px` followed by a `${running ? …}` progress bar.
- `holdings` is keyed on **ticker alone**, so the same ticker held in two
  accounts would collide on import. Fine while this sleeve is one taxable
  account; revisit before adding a second.

## Design
- Dark theme throughout
- Part of the **Sage** financial app suite
