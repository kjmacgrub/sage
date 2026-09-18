# Decisions

Why things are the way they are. Commit messages record *what* changed; this
records what was decided and on what evidence, so a call doesn't get quietly
relitigated six months later.

Procedure lives in [the BDC audit runbook](bdc-audit-runbook.md). Code traps
live in `../CLAUDE.md`. This file is only for judgment calls.

---

## Standing context

**Three sleeves, each with a different job.** Judge each against its own job —
weak capital gains in the income sleeve are not a failure. Target is roughly
equal thirds, rebalanced annually as a **ratchet** — profits out of the options
sleeve on gains, never added back on losses. Tripwires for when to stop adding
or reduce are in the 2026-09-12 entry; they are measured against the options
sleeve's own backtested behaviour, never against the other two.

| Sleeve | Job | Account |
|---|---|---|
| CEFs and BDCs | Income | Roth — eventually all of it |
| Options (SPX) | Opportunistic growth | Roth at **1 lot** now → taxable **$200k** later (2026-09-08) |
| Managed index, direct indexing | Growth + tax-loss harvesting | Must be taxable |

Target shape, multi-year: a $300k lump sum converted to Roth in annual slices
sized to a reasonable bracket, ending in a **~$400k Roth income bucket**. About
$1M gross from selling the current condo — jointly owned, so **~$500k is the
share that lands here** — funds rent until a future purchase; roughly two years
of rent to money market, the rest to direct indexing.

**The record starts January 2026.** Anything earlier was a different portfolio —
see the 2026-08-22 entry. Don't average across that boundary.

Two mechanics worth not forgetting:

- **Tax-loss harvesting does nothing in a Roth.** The managed sleeve has to be
  taxable for that goal to mean anything.
- **SPX options are Section 1256 contracts** — 60/40 treatment regardless of
  holding period, marked to market at year end. Losses that are dead weight in
  the Roth become usable in taxable, and carry back three years. That's the
  reason for the move — but 60/40 is federal-only (NY State and NYC tax it as
  ordinary), QQQ 360 isn't 1256 at all, and mark-to-market means tax on paper
  gains annually. See 2026-09-08; the risk argument carries this decision, not
  the tax one.
- **Wash sales cross into the Roth, and there the loss is permanently
  disallowed**, not deferred. Direct indexing sells hundreds of individual
  names; keep individual stocks out of the Roth and tell Fidelity it exists.

---

## 2026-09-18 — Iron condors, second attempt: the number, and why sweeps can't move it

Reopened the 0DTE SPX iron condor to add back for diversification. It reaches the
same conclusion as September, but this time with the mechanism, which is what
should stop a third attempt.

**Config tested:** SPX 0DTE, sell 35Δ put / 30Δ call, 50-wide wings, 2:00 PM
entry, daily, 4% allocation, 2022-05-16 → 2026-09-17. All four honest-settings
flags correctly set, intra-minute stops on, re-entry off.

### The number

Measured empirically from 2,550 matched legs across two runs that differed only
in slippage — ground truth, not a leg-count model:

```
slippage 0.20 -> 0.15 changes P/L by +$21,134
=> dP/L per unit of slippage = $422,680
```

| Slippage/leg | Net P/L over 4.3 yrs | $/contract |
|---|---|---|
| 0.00 (gross edge) | $72,932 | $42 |
| 0.05 | $51,798 | $30 |
| 0.10 | $30,664 | $18 |
| 0.15 | $9,530 | $5 |
| **0.173** | **breakeven** | |

**The gross edge is $72,932 over 4.3 years and breakeven slippage is 17¢/leg.**
At the measured live range of 4.5–10¢ it earns **$18–30/contract**, against
Puts $76.76, Hedge $101.83, Calendar $130.51. Three to four times weaker than
the weakest strategy already in the book, on the same underlying and tenor where
two others already trade.

Best configuration found across every sweep: **4 of 5 positive calendar years**,
never 5. Max drawdown −23.6% at the tested settings, past the 20% tripwire on its
own. It does not clear the bar.

### Why delta and stop sweeps cannot fix it

They redistribute the gross edge without touching the friction bill, so every
setting lands near zero. Observed across a 5× range:

| Setting | Result |
|---|---|
| Stop 100%, re-entry on, no intra-minute | "dismal" |
| Stop 400%, re-entry off, intra-minute on | +$19,331 |
| Stop 80%, min premium 1, intra-minute on | −$11,604 |

**That insensitivity is the diagnostic.** A mistuned strategy responds to its
risk settings; one whose edge is consumed by friction does not. When a 5× change
in the stop moves the result by less than the slippage assumption does, stop
sweeping and go measure the friction.

Lowering delta cannot help either, and the reason is structural. At 2:00 PM with
~2h to expiry, SPX's 1σ move is ~40 points, so 35Δ/30Δ places the shorts **7 and
9 points from spot — 0.12% and 0.17%.** Essentially at-the-money, tested almost
every day (86% of condors had a side stop at an 80% stop). Moving far enough out
to matter (~40 pts = 16Δ) collapses the credit while the four-leg friction load
stays fixed. **Friction scales with legs and trade count, never with credit** —
which is the whole trap for a 4-leg daily structure.

### Two modelling errors worth not repeating

- **OO logs an iron condor as three rows** — the long wings, the put side, the
  call side — because `Exit - Puts` and `Exit - Calls` are managed separately.
  Reading rows as trades triples the count and makes the wings row look like
  "33% of entries taken for a debit." Group by (Date Opened, Time Opened).
- **Do not model friction by counting legs.** An 8-leg-side assumption
  overstated it ~3× and produced a $231k "gross edge" that did not exist. OO
  charges slippage per row, and exit slippage only on positions that close early.
  **Derive the friction from two runs differing only in slippage** and read the
  slope. One diff beats any amount of reasoning about leg counts.

### Decision

Not added to the portfolio. If it gets traded it should be small and outside the
sleeve, sized so a bad year doesn't matter — a coherent thing to do for its own
sake, and one that needn't clear a bar designed for capital being relied on. What
it should not be is the fifth strategy in a book where everything else earns 4×
more per contract.

---

## 2026-09-12 — QQQ Leap: the entry rule was never what we thought, and the fix is a trend gate

Worked from the actual Option Omega exports joined to QQQ daily bars back to
1999-03-10 (6,918 sessions), not from memory of the settings.

### The rule had two inert legs

The strategy was believed to be *SMA10 > SMA20, gap down 1.5%, RSI ≤ 69*.
Reconstructed against the 74 real trades:

| Believed leg | Reality |
|---|---|
| SMA10 > SMA20 | true on **28 of 74** entries — not in the rule |
| Gap ≤ −1.5% | matches **all 74** exactly |
| RSI ≤ 69 | blocked **zero** days, 2017–2026 |

`gap ≤ −1.5%` alone reproduces all 74 entries plus 14; 13 of those 14 are the
10-position concurrency cap in 2022 and March-2020 affordability. **The
rising-SMA filter belongs to the put seller, not here.** The RSI cap is
stronger than the old note said — it has never once bound, because a −1.5%
gap-down day is never overbought.

### The backtest window is the benign sample

Validated a proxy against the real log — a signal "wins" if QQQ gains ≥12%
within 252 trading days, calibrated because the 67 profit-target trades needed
a median +12.8% underlying while all six losers topped out at +7.5%. It
reproduces the window at **90.9% modeled vs 90.5% actual**, then extends the
sample from 74 trades to **263 signals**.

| Period | Signals | Win rate |
|---|---|---|
| 1999–2017 | 175 | **70.3%** |
| 2017–2026 (the backtest) | 88 | 90.9% |

2000/2001/2002 ran 47%/54%/65%. **Nine years of testing contains one bear
market; the strategy's worst regime is outside the data entirely.**

### What actually separates good entries from bad

Tested across 263 signals (AUC 0.50 = noise):

| Feature | AUC |
|---|---|
| SMA10/SMA20 spread | **0.49** |
| 60d / 120d prior return ("extended rise") | 0.49 / 0.52 |
| RSI, gap size, realized vol | 0.47 / 0.48 / 0.43 |
| **% below the 252-day high** | **0.61** |
| SMA50 > SMA200 | 0.58 |

Only long-term trend state carries information, and it holds in **both** eras:

| Filter | n | Win | Exp/trade | Pre-2017 |
|---|---|---|---|---|
| Baseline (gap only) | 263 | 77.2% | +26.4 | 70.3% |
| **SMA200 rising** | 129 | 83.7% | +36.0 | **78.1%** |
| **<120d since 252d high** | 137 | 84.7% | +37.4 | **80.6%** |

**This reverses the 2022-derived note.** Winners averaged **23% below** the
252-day high, losers **30% below** — buying deeper drawdowns is worse, not
better. The old "every loser was bought within 7.2% of the high" pattern was
one regime's shape. That filter scores 74.8%, below baseline.

Three caveats that matter more than the table:

- The trend filters work by **not trading in busts, not by picking better
  within them**. In 2000–02 they cut 93 signals to 17 — and those 17 still won
  only 53%.
- They block **0 of the 6 actual 2022 losers** and slightly *hurt* 2017–2026.
  This is insurance against a regime the backtest doesn't contain.
- "Within 20% of the high" is actively dangerous: in 2000–02 it kept 9 signals
  at an **11% win rate**. Proximity to the high is not the same lever as trend.

**Rejected: entry spacing.** A 30-day minimum between entries moved the win
rate 77.2% → 78.5% while cutting volume 60%. Clustered entries are not worse
per trade — the 2022 stack was the same edge repeated with correlated risk, a
sizing problem, not a filter problem.

### The affordability cliff, at a new allocation

One 0.974-strike LEAP costs **$9,264** (chain checked 2026-09-11). The first
backtest contract, 2018-04-04, cost **$1,881** — **4.9× cheaper**.

| Allocation | Per entry on $200k | Contracts | Signals affordable |
|---|---|---|---|
| 3% | $6,000 | **0** | **0 / 45** |
| 5% | $10,000 | 1 | 42 / 45 |
| 7% | $14,000 | 1 | 45 / 45 |

At 3% the strategy is switched **off** until the sleeve reaches ~$309k. The
backtest hides this: its first QQQ trade came when net liq was already
**$301,783**, after the other three strategies compounded **+51% in 6.7 months**
while the trigger stayed silent.

**A $200k account starting in 2017 is, for QQQ affordability, a ~$41k account
in today's terms.** Reproducing today's 0.65-contracts-per-signal ratio at 2018
prices needs a **$40,609** start — and `decisions.md` already records what $40k
looks like: zero entries in 2020, and a 100% win rate that is an artifact of
affordability skipping every loser.

**Not one trade in any configuration tested is under 4 contracts.** The
1-contract, all-or-nothing regime the live account starts in does not appear
anywhere in this backtest.

### Sizing: settled at 5% with a 3-position cap

All runs identical except QQQ; other three strategies at 1422/1026/913 trades
throughout.

| | OLD 3% cap10 | QQQ′ 3% nocap | QQQ′ 5% cap5 | **QQQ′ 5% cap3** |
|---|---|---|---|---|
| CAGR | 77.0% | 73.4% | 76.7% | **74.4%** |
| Max drawdown | −10.82% | **−7.88%** | −13.34% | **−9.86%** |
| Ulcer | 2.06% | **1.44%** | 1.80% | 1.65% |
| MAR | 7.12 | **9.32** | 5.75 | **7.55** |
| QQQ trades / losses | 74 / 6 | 45 / 1 | 41 / 1 | **30 / 1** |

All four are positive in every calendar year. **The SMA200 filter is the win;
raising the allocation is a loss.** At constant 3% the filter cut max DD from
−10.82% to −7.88% and 2022 from −9.60% to −4.07%. Going 3% → 5% cost 5.5 points
of drawdown and doubled QQQ peak margin.

**The cap trims the tail; the allocation sets the body.** Cap 3 at 5% nearly
matches the 3% run's *peak* exposure (15.5% vs 18.1%) but carries **1.7× the
sustained** exposure (4.3% vs 2.5% median) — and drawdown tracks the body.

3% is the better profile and is **unavailable at $200k**. 5%/cap 3 is the best
configuration that can actually be executed, and it beats the old rule on
drawdown, ulcer, Sortino, MAR and loss count for 2.6 points of CAGR.

**Untested and worth knowing before the sleeve clears ~$309k: 3% with a cap of
5.** Same 15% peak exposure, smaller positions.

### Rejected: partial profit-taking

Per-trade expectancy modelled at +29.8% → +52.0% for taking 50% at +60% and
running the rest. The mechanism worked exactly as predicted and the portfolio
still got worse.

| | Control PT60 full | 50%@60 → DTE | 50%@60 → 150% |
|---|---|---|---|
| CAGR | **74.4%** | 74.2% | 74.1% |
| Max drawdown | **−9.86%** | −13.10% | −11.33% |
| MAR | **7.55** | 5.66 | 6.54 |
| QQQ trades | 30 | 15 | 22 |
| QQQ P/L | $4,771,413 | $2,966,106 | **$5,063,961** |
| Median hold | 102d | 403d | 262d |
| Median trade P/L% | 60.1% | 127.5% | 105.1% |

**QQQ's own P/L ranges 71% across these runs and ending net liquidity moves
less than 1.3%.** The portfolio is nearly insensitive to which is chosen.

The reason is **capital velocity**: 0.589%/day for the control against
0.401% and 0.316%. Sixty percent in 102 days beats 105% in 262 days, because
freed capital compounds in the other three strategies. Holding longer earns
more per trade and less per day, and in a compounding book the second one wins.
Same circularity as the contribution-% trap.

Drawdown was the only thing that really moved, and it moved the wrong way —
average concurrency 1.28 → 2.03, days flat 31.7% → 8.0%.

**Corollary: don't raise the cap to compensate.** The three runs span average
concurrency 1.28–2.24 with return flat and risk rising monotonically. More
concurrency buys drawdown, not portfolio return.

### Intraday triggers: a leverage dial, not a better edge

**Superseded an earlier conclusion in this same entry.** The first test compared
an intraday *touch* at the same −1.5% threshold, found it flooded the cap, and
concluded "more exposure, not a better edge." That was an artifact of the
threshold. At −2.5% to −3.0% the touch trigger beat the gap at *matched*
exposure, and `GAP OR TOUCH −3.0%` scored the best of anything modelled —
81.2% win, +32.4 expectancy. Then OO turned out to be unable to express any of
it. What follows is what survived contact with the tool.

**OO's `Move` is not a daily move.** `Movement = entry price − session open`,
measured at whatever time you enter. Proved from the log: on 2026-09-09 the
Double Calendar entered 15:30 with Movement −15.14 at 7645.54, and the Long Put
Hedge entered 11:10 with Movement −24.26 at 7636.42 — both imply a session open
of 7660.68. At the QQQ strategy's **9:35 entry that is a five-minute window**,
which is why `Move Down 0.5%` yields 5 trades and 0.6% yields 1. `Gap` is the
separate field, `open − prev_close`, and it is the one validated against all 74
original trades.

Consequence: **a true intraday touch — "fell 3% below yesterday's close at any
point" — is not expressible in OO at any entry time.** The nearest available
thing is a late entry, which widens the Move window to most of the session.

Tested at a 15:30 entry, everything else at the settled config:

| Config | End | CAGR | Max DD | MAR | Ulcer | Avg conc |
|---|---|---|---|---|---|---|
| **GAP −1.5% @9:35** | $29.8M | 74.4% | **−9.86%** | **7.55** | **1.65%** | **1.28** |
| MOVE −1.75% @15:30 | $30.7M | 75.0% | −11.43% | 6.56 | 2.37% | 2.14 |
| MOVE −1.25% @15:30 | **$33.9M** | **76.9%** | −11.91% | 6.46 | 2.60% | 2.49 |

Return rises monotonically with exposure, risk-adjusted return falls
monotonically, and every intermediate point interpolates. Uncapped win rates
across thresholds are 78.2% / 77.1% / 79.4% (−1.25% / −1.75% / −2.5%) — flat
against error bars of 2–4 points. **The threshold is a leverage dial, not an
edge parameter.** There is no better signal hiding in it.

**Settled on the gap version**, on the same logic as every other exposure
decision here: it wins on MAR, ulcer, Sortino, loss count, and drawdown in
*every one of ten years*. And the 2–3× drawdown understatement this book has
already suffered once puts the control at −19.7% under a 2× miss (inside the
tripwire) and the −1.25% version at −23.8% (past it). The dial can be turned up
in an afternoon; drawdown cannot be bought back.

One modelling lesson: a per-trade expectancy model ranked −1.75% above −1.25%,
and OO disagreed. **Expectancy × count cannot see compounding.** In a
percentage-sized book more trades compound into larger positions, so the denser
trigger wins even at flat per-trade quality. Don't rank triggers on summed
expectancy units.

### Settled configuration

**Gap ≤ −1.5% at 9:35 · price above SMA200 · 5% allocation · max 3 concurrent
positions · take 100% at +60% · close at 3 DTE.**

### Five Option Omega mechanics worth not rediscovering

- **The byte-identical export is real and reproduces.** A cap-3 run returned
  files with MD5s identical to the cap-5 run, 79 minutes apart — max concurrent
  still 5. Cap 5 *had* bound in the prior run, so the setting is unreliable
  per-run rather than broken. **Verify the effect in the output before reading
  any result**, and prefer a change that must be unmissable (set the cap to 1).
- **The top-level Profit Target fires alongside the profit action.** With both
  at 60%, the action closed 50% and the global target closed the rest in the
  same second — two fills, one instant, identical price, and it looks like a
  working scale-out. Clear the top-level field, or set it to the runner's
  second target.
- **`Move` and `Gap` are different fields.** `Gap = open − prev_close`.
  `Movement = entry price − session open`, measured at your entry time — so at a
  9:35 entry it is a five-minute window, which is why `Move Down 0.5%` returns 5
  trades. A true intraday touch below the prior close is not expressible at any
  entry time. Widen the window by entering later.
- **Conflicting strikes are checked across the WHOLE ACCOUNT, not per trade.**
  The platform will not open a position that puts the same strike long and short
  anywhere in the account, across strategies. With `Move Conflicted Strikes`
  **off** the strategy *stops and notifies*; **on**, it silently shifts the new
  entry's strike. Keep it **on** — "stops and notifies" is a manual-intervention
  state on a 0DTE strategy carrying 44% of the book's P/L, reachable at 9:35 on a
  morning nobody is watching. **The backtest does not model this**: it opened 49
  cross-strategy collisions in 13 years that live trading would have blocked or
  moved, ~3.5/yr on each of the hedge and the calendar. Those hedge trades were
  *bad* ones — 46 of them lost $776k at a 9% win rate, only 3 of 46 reaching
  expiry — because a conflict requires quiet, tight strikes, and quiet days are
  when the hedge's long put dies. **Do not turn the setting off to capture that
  $776k**: it is 46 trades and a coincidental correlation with low volatility,
  not an edge, and it would make the hedge's entries depend on where an unrelated
  strategy placed its strikes.
- **The 3 DTE close is about exercise, not assignment.** These are long calls;
  nobody can assign you. It exists because an ITM long call auto-exercises into
  $71,600 of stock per contract. Right rule, wrong reason — probably inherited
  from the three short-premium strategies. It has fired once in 30 trades, but
  it becomes the primary exit for the book under any runner variant.

---

## 2026-09-12 — The hedge is four years old, and per-contract edge cannot detect anything

Backtest extended to **2013-09-12** (13.0 years). Two things came out of it that
matter more than the QQQ work: the hedge's record is far shorter than the window
suggests, and the tripwire built to watch it does not function.

### Daily drawdown is measured from mark-to-market spikes

The 13-year run reports a **−35.31%** max drawdown, peak 2015-08-25 → trough
2016-02-08. It is largely an artifact and must not be quoted as a risk number.

Reconciled: cash **rose** $5,062 through that window (realised P/L on 107 closed
trades, matching to the dollar). The entire decline is open-position marks. The
peak date is the **August 2015 flash crash**, when open positions marked at
$105,918 against $38,911 of cost — a 2.7× mark on long puts that eventually
realised about $62,000. Monthly closes over the same period: $270k peak → $240k
trough, **−11%**.

| Basis | 2013 run | 2017 run (MOVE −1.75%) | 2017 run (control) |
|---|---|---|---|
| Daily | −35.31% | −11.43% | −9.86% |
| Weekly | −14.15% | −9.60% | −9.75% |
| Monthly | **−11.30%** | −8.56% | **−6.97%** |

The book's largest one-day net-liq jumps are **+27.5% (2015-08-24)**, +21.8%
(2022-04-22), +19.6% (2025-10-10) — the hedge marking up. Peaks like those are
not levels anything could have been exited at.

**The 20% drawdown tripwire needs a stated basis.** It fires on the 2013 run at
daily (−35%) and does not at monthly (−11%). Same trap as the "positive in every
calendar year" bar needing a sizing basis: **decide which before it has to be
applied.** Use weekly or monthly for the tripwire; quote daily conservatively.
Note the ranking is preserved on every basis, so no configuration decision
changes.

### The hedge's instrument is four years old

`CLAUDE.md` already says to judge the hedge on post-2022-05-11 data. The reason
is bigger than leg structure: **2022-05-11 is the day SPX Thursday expirations
launched.** With the Tuesday listing weeks earlier, that is when SPX 0DTE became
available *every* trading day. Before it, 0DTE existed only Mon/Wed/Fri — which
is exactly why the pre-period runs 62% 0DTE / 38% 1DTE.

Size-neutral, the break is unmistakable, and it is not a sizing or index-level
artifact:

| Long Put Hedge, 0DTE only | n | Win rate | P/L per contract | as % of SPX |
|---|---|---|---|---|
| Pre 2022-05-11 | 412 | **22.8%** | **−$51.18** | −1.74% |
| Post | 422 | **32.5%** | **+$97.86** | +1.65% |

By year: 2013–2017 run −$54 to −$154/contract; 2018 is a lone good year at +$56;
2019–2022 return to −$15 to −$90; **2023–2026 run +$84 to +$120 at 32–33% win.**

Pre-2022 **0DTE also lost money**, so this is not fixable by excluding the 1DTE
trades. The whole pre-period is a different market.

**Extending the backtest to 2013 adds no evidence for the hedge.** It adds nine
years of evidence that the strategy did not work before its instrument existed.
Reading 13-year figures as "the book, tested longer" is wrong for two-thirds of
the window. The extension remains valid for the other three strategies and for
QQQ, whose structure is unchanged throughout.

### Stress test: the 30% plan is the no-hedge outcome

Post-2022 hedge P/L is **$15.79M against ~$35.5M of total gains — about 44% of
everything the book made.** So the book was re-run without it.

Over 13 years the hedge looks harmful (MAR 4.34 vs 5.27 without it), but that is
the nine contaminated years talking. Restricted to the period its instrument
exists, both rebased to $200k at 2022-05-11:

| | WITH hedge | NO hedge |
|---|---|---|
| Ending value | $1,382,693 | $613,179 |
| **CAGR** | **56.2%** | **29.5%** |
| Max DD (daily) | −11.11% | −10.74% |
| Max DD (monthly) | −6.53% | −6.27% |
| Sortino | 6.03 | 3.45 |
| MAR (monthly) | 8.60 | 4.70 |

**It nearly doubles CAGR for ~0.4 points of extra drawdown.** It earns its place
— on 4.3 years of evidence.

**And the load-bearing result: without the hedge the book returns 29.5%. The
plan assumes 30%.** The planning figure already equals the outcome with the
hedge contributing nothing. Everything the backtest shows above 30% is hedge
contribution resting on the thinnest record in the book — which is exactly the
money the ratchet takes out of the sleeve. If the hedge's edge is regime luck
and evaporates, the result is the number already planned for, with a marginally
*better* drawdown profile and no losing year in thirteen.

**"Hedge" is a misnomer for what it does here.** Drawdown is near-identical with
and without it; it is not buying protection, it is generating return while being
long puts. It did help in the 2022 bear (34.0% vs 17.9%). Hold that distinction
when judging it live.

### Per-contract edge cannot detect anything — corrected

The tripwire table lists **per-contract edge < 50% of backtest** as firing in
"months." It does not. On the hedge's post-2022 distribution:

```
mean $97.16/contract    sd $966.64    median −$232.20    win 32.4%
```

**The noise is ten times the signal.** The edge lives entirely in the 32% that
win big, so the mean is dominated by rare large wins.

| After | 95% CI half-width | Can separate $51 from $102? |
|---|---|---|
| 100 trades (1 yr) | ±$189 | no |
| 200 trades (2 yrs) | ±$134 | no |
| 400 trades (4 yrs) | ±$95 | no |

Separation needs **~1,385 trades ≈ 14 years**. Worse, bootstrapping an *intact*
strategy: the running mean reads below the $50.91 alarm **34.9% of the time after
one year** and 16.8% after four. As a decision rule it fires on healthy
strategies a third of the time. Record it for the eventual long read; **do not
act on it.**

### Win rate is the detector that works — where it works

On the same pre/post regime change, **win rate scores z = 4.89 against
per-contract edge's 2.77.**

| Strategy | Trades/yr | Win rate (post-2022) | Alarm below | Trades to confirm |
|---|---|---|---|---|
| Long Put Hedge | 98 | 32.4% | 26.4% | 234 (**29 mo**) |
| Double Calendar | 139 | 60.6% | 54.6% | 255 (**22 mo**) |
| Sell puts | 152 | 99.8% | — | **useless** |
| QQQ Leap | 3 | 100% | — | **useless** |

A hedge fall back to its pre-2022 22.8% is confirmable in ~92 trades (**11
months**), false-alarm 6.7% at 100 trades. But it only works on the two
strategies that trade often with balanced win rates. The put seller wins 99.8%
of the time and QQQ Leap trades three times a year — **neither produces enough
information to detect anything.** QQQ Leap has no statistical detector at all
and is managed by structure (3-position cap, affordability floor), not by
measurement.

### What to record from day one, and what to do with it

The point of the first weeks is **not** to judge the edge — no measure can. It is
to build the record that makes later judgement possible, and to catch the one
failure that shows up immediately: execution.

**Record per fill (this is the whole job):**

| Field | Why |
|---|---|
| Timestamp of order sent | anchors the mid |
| Strategy | every metric is per-strategy |
| Leg: right, strike, expiry | tenor and width analysis |
| **NBBO bid/ask at order send** | the mid is the benchmark; capture it *before* the fill |
| **Underlying price at order send** | lets the realised strike offset be checked against the rule |
| Limit price sent | separates "bad fill" from "bad price chosen" |
| **Fill price** | slippage = fill − mid, signed against direction |
| Contracts | per-contract normalisation |
| Order duration to fill | worked-limit behaviour, esp. QQQ Leap |

**Record per trade at close:** entry/exit timestamps, contracts, P/L, exit
reason. P/L ÷ contracts is derived, not recorded.

The two that cannot be reconstructed later are **NBBO mid at order send** and
**underlying price at order send**. Neither appears on a broker statement.
Without the first there is no slippage measurement at all; without the second
there is no way to tell whether a strike was the one the rule asked for.
Everything else can be back-filled from the Schwab export.

**Why the underlying price earns its row.** OO checks the *whole account* for
conflicting strikes — the same strike held long and short across any two
strategies — and with `Move Conflicted Strikes` on it silently shifts the new
entry's strike. It happens about **3.5 times a year**, always the 0DTE hedge
walking into a strike the Double Calendar already holds short (47 of 49 cases
in 13 years are hedge BTO against calendar STO). With spot and strike recorded,
the realised offset is computable and a moved strike shows up as ~5 points off
what the rule implies; cross-referencing the same day's open calendar strikes
confirms the cause. **OO's own Strategy Activity Log cannot be used for this** —
it is overwritten within days and cleared when a strategy goes idle. The general
rule: *any diagnostic that depends on OO retaining state is unreliable, so the
live record has to be self-sufficient.*

**Weeks 1–4 — execution only.** Roughly 1,000 leg-fills a year across the book
means slippage resolves in weeks while every P/L measure is still noise.

- Slippage per leg vs mid, by strategy and by tenor. Breakevens: Calendar 16¢,
  Hedge 19¢, Puts 19¢, QQQ Leap $13.28/contract. Tripwire >15¢/leg.
- Prior live measurement was **4.5–10¢/leg on 583 matched pairs at one
  contract** — that is the comparison, and it is already in hand.
- Fill rate and time-to-fill, especially QQQ Leap: the chain carries ~12
  contracts/day of volume in its strike region, so a fill is a worked limit over
  days. A missed entry is data, not a non-event — **log signals not taken.**

**Months 2–6 — add structural conformance, still not edge.** Does the book look
like the backtest in shape rather than in profit?

- Trade counts per strategy per month vs backtest rate (98 / 139 / 152 / 3 per
  year).
- Exit-reason distribution vs backtest. The QQQ 3 DTE exit should fire ~1 in 30.
- Concurrency distribution vs modelled (QQQ avg 1.28, at cap 22.8%, flat 31.7%).
- Days at cap and days flat.

A divergence here is a configuration or execution problem and is findable. A
P/L divergence at this stage is noise.

**Months 6–24 — win rate, hedge and calendar only.** Running count, alarm at
26.4% and 54.6%, and **do not read either before ~30 trades** — a healthy hedge
reads below 26% about 19% of the time at that point.

**Never, in the first two years — per-contract edge, QQQ Leap anything, or
annual return.** Record them; they are not evidence yet.

**The correction that matters:** the tripwire line "track fill-versus-mid and
per-contract edge by strategy from day one" should read **fill-versus-mid and
win rate.** Instrumenting per-contract edge as an early warning would have meant
watching a number that cannot move while the one that can — execution — went
unrecorded.

---

## 2026-09-12 — Three sleeves, a ratchet, and the tripwires

### Target shape

Roughly equal thirds: **options (taxable) · CEFs (Roth) · managed index (taxable)**,
rebalanced about annually. The Roth also receives **$300k of lump-sum
conversions** over the next few years, which keeps it in step during that window.

Assumed returns: CEF **10%**, managed **7%**, options **30%** (see 2026-09-11 for
why 30 and not the backtest's 74).

### Rebalancing is a RATCHET, not symmetric

**Take profits out of the options sleeve on gains. Never add back on losses.**

Classical rebalancing buys the loser on an assumption of mean reversion — the
asset is cheap, its long-run return intact. **That assumption does not hold for a
strategy.** An options book underperforming is evidence the edge may have stopped
working, not a discount. Adding to it turns a hypothesis you are losing money on
into a bigger one.

This sleeve exists as a response to watching a managed account fall through 2022
with no lever. If it is declining relative to the other two, the premise is in
question and that is not the moment to increase it.

### What rebalancing costs, and why it's worth it

Ten years, $200k per sleeve:

| Options return | Rebalanced | Un-rebalanced | Give-up |
|---|---|---|---|
| 20% | $1.92M | $2.15M | $231k |
| **30%** | **$2.57M** | **$3.67M** | **$1.10M** |
| 40% | $3.42M | $6.70M | $3.28M |
| 50% | $4.50M | $12.4M | $7.94M |

About **4 points of portfolio CAGR** at a 30% options return (15.7% vs 19.9%).
That is the premium for not being concentrated in an unproven strategy, and it is
well priced given that 30% is a guess and three of nine backtest years carry the
whole result.

**Section 1256 makes it free at the margin.** Mark-to-market taxes the options
sleeve's gains annually whether or not the money moves, so unlike a normal
appreciated position there is no tax cost to taking profits out. A real synergy
with the taxable placement.

### Rebalancing solves most of the capacity problem

The sleeve grows at the *total portfolio's* rate, not its own. At 30% options
return that is 15.7%/yr, so $200k → **$857k at year 10** rather than $35M.

| Cap | Binds at | At 30% options return |
|---|---|---|
| Sell puts, 100 contracts | $3,141,360 | **18.9 years** — ignore it |
| **Double Calendar (MTW), 50** | **$624,453** | **7.8 years** — real |

At an $857k sleeve the hedge runs ~30 contracts and QQQ Leap ~14. The entire
liquidity analysis — 833 contracts, 1,850 put spreads, chain depth — only ever
mattered because the backtest compounded unchecked. **The one exception is the
Double Calendar, whose 50-cap binds inside a decade** (5.6 years at 50%
returns, 4.3 at 74%).

### The Roth drifts, and that is the plan working

Conversions keep it near a third during the conversion window. Afterwards it grows
at 10% against a total compounding at ~15.7%, so its share erodes ~5%/yr in
relative terms — roughly **a third at the end of conversions, ~20% a decade
later**. That is the known cost of putting the *safest* asset in the tax-free
account for risk reasons (see 2026-09-08). Recognise it as designed, not drifting.

Also: **you cannot rebalance into the Roth.** Contribution limits mean the flow is
options → managed, both taxable. The real structure is "options and managed
rebalanced against each other, Roth on its own track."

### TRIPWIRES — options sleeve only, absolute, not relative

The ratchet is a **policy** and needs no diagnosis: below target weight, don't top
up. These tripwires are a **diagnosis** and trigger something more serious — stop
adding entirely, or reduce.

**Measured against the sleeve's own backtested behaviour, never against CEF or the
managed account.** Relative comparison is a bad detector: it conflates "the
strategies broke" with "equities had a great year," which is the entire point of
holding something uncorrelated. It also fires late — options would have to fall
below CEF's 10% before it registered.

| Tripwire | Measured against | Fires in |
|---|---|---|
| **Fill slippage > 15¢/leg** | measured 4.5–10¢ entry; 16¢ is calendar breakeven | **weeks** |
| ~~Per-contract edge < 50% of backtest~~ | Hedge $101.83 · Calendar $130.51 · Puts $76.76 · QQQ $2,655.51 | **never — see below** |
| **Win rate by strategy** | Hedge 32.4% → alarm 26.4% · Calendar 60.6% → alarm 54.6% | 11–29 months |
| **Drawdown > 20%** | sleeve NAV, absolute — backtest max 11.01% | immediately |
| **MTW win rate ~52% in 2027** | its own 58–71% history; 2025–26 ran 54.6% / 51.6% | a year |
| **Two consecutive losing years** | zero losing years across 9 backtest years | two years |

**One signal = investigate. Two together = stop adding, probably reduce.**

**Amended 2026-09-12 — per-contract edge does not work as a tripwire.** Its
noise is ~10× its signal (hedge: mean $97.16/contract, sd $966.64), so
separating "half the backtest edge" from "full edge" needs ~1,385 trades, about
14 years, and an *intact* strategy reads below the alarm 34.9% of the time after
one year. It was replaced above by **win rate**, which scores z = 4.89 against
its 2.77 on the same regime change — but only on the hedge and the calendar.
The put seller (99.8% win) and QQQ Leap (3 trades/yr) have no statistical
detector and are managed structurally. Full working in the 2026-09-12 hedge
entry.

Slippage remains the one fast detector: it converges in weeks because every leg
of every fill is a data point. The rest are confirmations that arrive later.

**Track fill-versus-mid and win rate by strategy from day one. Compare monthly.
Treat drawdown depth as the circuit breaker** — and state whether that drawdown
is daily, weekly or monthly, because the answer differs by 3× on the same data.
The annual measures are for the record, not for decisions.

The value here is not the specific thresholds — it is that they were chosen before
money was at stake. The alternative is discovering during a 15% drawdown that you
never decided what would change your mind, which is how a thing built in response
to 2022 becomes a thing being rationalised in 2029.

---

## 2026-09-11 — Measuring it honestly: drawdown, slippage, liquidity

### Use the portfolio CSV for every risk number. The trade log lies.

`Funds at Close` in a trade-log export only updates **when a trade closes** —
unrealized losses on open positions never appear. Every drawdown figure derived
from it in the 2026-09-10 entry and before is understated by **2–3×**.

Measured from the daily Net Liquidity export instead:

| | trade log | **portfolio CSV** |
|---|---|---|
| Max drawdown | 3.6% | **11.01%** |
| Time underwater | ~50% | **71%** |

Worst episodes: **−11.01% over 107 days** (2024-12-18 → 2025-04-04), −9.97%
(2022-09-12 → 2022-11-04, 53d), −9.50% (2019), −8.52% (2022), −8.10% (2023).
Note the deepest one is **not** a crisis window.

**Always export the portfolio CSV alongside the trade log.**

### Slippage is the single biggest uncertainty, and it is not uniform

Breakeven slippage — cents per option per side before the edge is entirely gone:

| Strategy | Legs | Edge/contract | Breakeven |
|---|---|---|---|
| Double Calendar (MTW) | 4 | $130.51 | **16¢** |
| Long Put Hedge | 3 | $101.83 | **19¢** |
| Sell puts on rising SMA | 2 | $76.76 | **19¢** |
| QQQ Leap | 1 | $2,655.51 | **$13.28** |

Portfolio P/L surviving at various assumptions: **0¢ → 100%, 5¢ → 78%,
10¢ → 57%, 15¢ → 35%, 25¢ → −8%.** And that is a linear subtraction, so it
*understates* the damage — losses compound down through position sizing.

**The finding that matters: under realistic friction the book converges to
QQQ Leap plus noise.** At 10¢ QQQ is the largest contributor; at 15¢ it is 58%
of all P/L; at 25¢ it is the only strategy still positive. The three strategies
with thousands of trades are the fragile ones; the robust one is the one with
**74 trades and 6 losses**.

**Planning numbers: 30% CAGR, 20% max drawdown.** 30% corresponds to roughly
20–25¢ with compounding drag. The 20% is *not* a haircut — slippage lowers the
curve without much changing its shape. It reflects that nine years contains no
tail event (COVID and 2022 both produced ~10% here) and that the delta/VIX exits
assume acting at the trigger, which live execution will not match.

**The one number worth collecting from day one: your fill versus the mid, per
leg.** Three of four strategies live or die inside a 16–19¢ band and no
backtest can locate you within it.

### Liquidity is per-order, per-tenor — and OI accumulates

Real SPX chain, checked 2026-09-10 with SPX ~7,700:

| Series | DTE | Put OI across the strip |
|---|---|---|
| 6 NOV 26 (weekly Friday) | 57 | **0–8** |
| 20 NOV 26 (monthly, AM) | 70 | 77–450, **8,778** at 7600 |

Three lessons:

- **Open interest at 57 DTE is not the OI that strike will ever have** — it
  accumulates toward expiry. But the put seller *enters* at ~65 DTE and mostly
  closes within a week, so it trades the window before OI builds. It is the
  early flow, which is the harder side.
- **A vertical is limited by its thinner leg.** Sell the 7600 (OI 8,778) and buy
  the 7595 (OI 125) and your size is capped at 125. Liquidity concentrates at
  round strikes and the round strike's depth does you no good.
- **Width buys size.** Same dollar risk: a 5-wide needs 1,850 contracts, a
  25-wide needs **370**, and lands its long leg on a strike with 8× the OI.
  Roughly a 40× improvement in size-to-depth. Worth testing; wider spreads
  generally collect a lower % of width, but "slightly worse and executable"
  beats "better and imaginary."

Where each strategy actually trades (legs, from the log):

| Strategy | Friday expirations | Third Friday (monthly) | DTE |
|---|---|---|---|
| Sell puts on rising SMA | **79%** | **46%** | 60–73 |
| Long Put Hedge | 31% | 7% | 0–1 |
| Double Calendar (MTW) | 22% | 5% | 2–7 |

The put seller is already concentrated where the depth is. Restricting it to
monthlies only is worth testing — it chooses them 46% of the time unprompted.

### The 0DTE regime: the risk is pricing, not depth

Framed wrongly at first as "what if 0DTE reverts to 1–2 DTE." **It won't.**
Exchanges do not delist revenue and the direction has only ever gone one way —
monthlies, weeklies (2005), Mon/Wed (2016), Tue/Thu (2022), daily. There is no
mechanism for reversal.

The real risk is that **flow moves sideways** into whatever is next, and
**three of four strategies are net short premium** — the calendars sell the near
leg, the put seller sells the spread, and the Long Put Hedge is *net credit*
(sample legs: −0.80 + 9.75 − 3.75 = **+5.20**), with 197 of its winners exiting
as "Expired," i.e. keeping the credit. Only QQQ Leap is net long premium.

So the book depends on premium **richness**, not 0DTE depth. If the seller
population thins or buyers migrate, skew reprices and three strategies earn less
with nothing visibly breaking. Harder to see coming than a liquidity event.

**Tested for it. Only one strategy shows decay:**

| | 2017–2024 | 2025 | 2026 |
|---|---|---|---|
| MTW Double Calendar win rate | 58–71% | **54.6%** | **51.6%** |
| MTW median P/L% | 2.4–7.6% | **1.3%** | **0.5%** |

The put seller shows the opposite — median P/L% rose 21.7% (2017) → 44.1%
(2026), better at every VIX tercile in 2022–26 than 2017–21. The hedge's mean
P/L% went −36.6% (2017) to consistently positive from 2022 (+14% to +24%).

**Caveat: the MTW decline is two years, not a nine-year slope.** Equally
consistent with a 2025–26 regime as with crowding. **Watch the MTW win rate and
median P/L% annually** — near 52% / 0.5% again in 2027 makes it a trend.

### Current configuration — checked, and it holds

Contributions: Long Put Hedge 41.9%, QQQ Leap 20.9%, Sell puts 20.6%,
Double Calendar 16.6%. Caps: calendar **50**, put seller **100**, hedge and QQQ
percentage-only.

**Peak margin 35.7% (2022), otherwise 11–33%.** Compare the 107% breach earlier
in this process. Nothing degenerate; sizes are genuine percentage scaling.

Two still compounding: **hedge to 833 contracts** (deliberate — 0 DTE SPX, the
deepest book there is) and **QQQ Leap to 133**. QQQ Leap is the open item: it
went from 1–4% of P/L to **20.9%** while attention was elsewhere, it is
long-dated QQQ rather than 0 DTE SPX so the depth argument does not transfer,
and it is the thinnest-evidence strategy in the book.

**Chain checked 2026-09-11 — the constraint is volume, not open interest.** Only
two expirations exist in its 362–448 DTE window (2027-09-17 at 371 DTE,
2027-12-17 at 462). OI in the 60-delta region is adequate at **10,658**, but
**total volume across those nine strikes was 12 contracts.** That OI is stale
inventory, not daily liquidity — every order is effectively the day's whole trade
in that strike. The backtest's **133 contracts is 39% of OI at the 705 strike
against 3 contracts of daily volume, which is not a fill.** At the sizes
rebalancing produces (~14 contracts at year 10, ~30 at $2M) it works as a worked
limit over several days, helped by the 389-day median hold. Bid-ask runs
$2.85–4.08 on options priced $65–131, so friction is ~2% of a contract against a
$2,655 per-contract edge — slippage was never this strategy's problem.

**And the contract price was wrong by 18%.** The strategy buys at strike ≈
**0.974 × spot**, which is ~66 delta, not 60. At QQQ $716.66 that costs
**~$9,264**, against the ~$7,800 a true 60-delta implies. Every threshold moves:

| Allocation | Sleeve needed | On $200k | Switches off after |
|---|---|---|---|
| 5% | $185,000 | 1 contract | **−8% drawdown** |
| 7% | $132,000 | 1 contract | −34% drawdown |

**The 5% cliff now sits inside the backtest's own 11% max drawdown** — an ordinary
drawdown would switch off the second-largest contributor and hold it off until
recovery. That makes 7% necessary rather than merely preferable.

Source for future checks:
`https://cdn.cboe.com/api/global/delayed_quotes/options/QQQ.json` — carries OI,
volume and greeks for the full chain. Yahoo's options endpoint now returns 401.

### Analytical traps hit during this work — all the same mistake

Three times, a **conditional distribution was read as if it were causal**:

- **`Max Profit` cannot evaluate a wider profit target.** The column is censored
  by the exit being assessed — trades that closed at the 10% target have their
  Max Profit measured only up to that moment. It piles up at the target and
  looks like there is no headroom.
- **Exit-reason P/L cannot evaluate a threshold change.** The "Above Delta"
  bucket is negative *because* it collects the trades that went against you.
  Tightening the put stop from 90 to 70/80 tested worse, not better — it pulls
  more trades into the bucket and converts recoveries into realized losses.
- **Arithmetic removal is not a counterfactual.** Subtracting QQQ's P/L left the
  other trades at their QQQ-inflated contract counts and understated its value
  fivefold. Only a re-run with sizing re-derived answers the question.

**Rule: to know what changing a condition does, re-run with the condition
changed. Nothing else works.**

One related pattern worth remembering: **this book wants room.** Wider profit
target beat narrower; the deep put stop (90) beat the shallow ones; and the
hedge's every dollar comes from letting positions expire while its two
management exits lose $4.66M combined. Defined-risk structures recover; cutting
early converts recoveries into losses.

### thinkorswim: per-leg Greeks

The **Position Statement does not populate per-leg Greeks** — it rolls them up
to the position. Use a **watchlist of the option symbols** (`.SPXW260910P7625`
format, visible in the right-click menu) with a Delta column, or read the option
chain by strike. OO's leg-delta thresholds are *position* deltas; in ToS watch
for **absolute 0.90 on the short put, 0.60 on the short call**.

---

## 2026-09-10 — The book rebuilt, and how to size it

The four strategies of 2026-09-08 are not the four strategies now. Composition,
exits and sizing all changed. This records what was learned rebuilding them.

**Current book:** MTW Double Calendar, Long Put Hedge, QQQ Leap, Sell puts on
rising SMA. **Daily Calendar 14/16 was cut** — it earned $13/contract across
2,143 trades, half the trade count for a tenth of the profit.

### mae_check.py no longer applies

Exits are now Greek- and volatility-based — Below Delta, Above Delta, Below
Short/Long Ratio, VIX Move Down, Expired, Profit Target. **There are no stop
losses anywhere**, so `mae_check.py` reports "no stops in use" for every
strategy and can't run. That is **not a clean bill of health, it is an
unverified backtest.** Risk is still structurally bounded (all defined-risk
multi-leg debit/credit structures), so removing stops is defensible — but the
tool that caught the $22k-live/$90k-backtest gap no longer covers this book.
Needs a replacement check before the numbers are trusted.

### Contribution % is circular in a compounding book

Removing QQQ Leap looked cheap: it showed **3.6% of total P/L**. A proper
re-run with sizing re-derived ended at **$5.5M instead of $19.8M**, CAGR 42.8%
vs 63.9%, and drawdown *worse* without it.

The reason: percentage sizing feeds every dollar a strategy earns into the
position size of every other strategy, forever after. QQQ's own P/L was
$699,660; it *caused* ~$14.3M of the others' gains, all of it delivered
2019–2021 while the account was between $176k and $500k. Its share of the total
is small precisely because it inflated the total.

**Never judge a strategy by contribution % in a compounding portfolio — re-run
without it.** An earlier arithmetic subtraction of QQQ's P/L (leaving the other
trades at their QQQ-inflated contract counts) understated its value by a factor
of five.

### MTW: the Double Calendar can only trade Mon/Tue/Wed

Every entry uses a (2, 7) DTE pair. The short leg needs an expiration two
calendar days out — from Thursday that's Saturday, from Friday it's Sunday.
**Those days can never produce a trade.** Renamed to MTW Double Calendar so
nobody rediscovers this.

Entries also jumped from ~90/yr to ~138/yr in 2022, when SPX added Thursday
expirations and unlocked Tuesday entries — the same fact already recorded for
the Long Put Hedge. Ceiling is ~60% of trading days; actual fill is 45%.

A complementary short DTE would cover the rest: short 2 → Mon/Tue/Wed,
short 3 → Mon/Tue/Fri, short 4 → Mon/Thu/Fri. Running **2/7 alongside 4/9**
reaches all five weekdays. Untested.

### Concurrency is emergent unless something caps it

The SPX strategies peak at 2 concurrent, but **that is not a setting** — it
falls out of 0–2 day holds against a 2–3 day entry cadence. QQQ Leap peaks at
**10** for the same reason in reverse: a 78-day median hold against a 14-day
entry cadence makes stacking arithmetically unavoidable.

Consequence: **anything that lengthens holds removes the accidental
protection.** Widening the calendar profit target from 10% toward 50% — which
tested well in isolation — does exactly that. Pair any such change with an
explicit concurrency or allocation cap, or peak margin goes from 53% to ~80%
in a cash account.

### `Max Open Positions` DOES survive the portfolio tester

Contradicts the note in `../CLAUDE.md`. The put seller's 5-position cap held in
the portfolio run with a time-at-cap distribution nearly identical to
standalone (9.4% vs 9.2%). Either OO fixed it or the original finding applied
to a different setting. **Re-test deliberately and correct the note** — the old
belief has been shaping designs around a constraint that may not exist.

### Sell puts on rising SMA — added

5-wide SPX credit put spread, daily entry, SMA filter, 1% allocation, 5 max
open. Standalone: 26.5% CAGR, **1.9% max drawdown**, 7 losers in 1,317 trades.
Went flat through COVID, Aug 2024 and Apr 2025 — zero positions open at the
midpoint of each. In the portfolio it improved **every** metric at once:

| | Without | With |
|---|---|---|
| CAGR | 45.7% | 69.1% |
| Max drawdown | 5.5% | **3.6%** |
| Longest drawdown | 88 days | **17 days** |
| Days underwater | 77% | **50%** |

The protection is the *hold time*, not the filter — median hold is 0–1 days, so
positions rarely live long enough to be caught. On 2020-02-19, the exact market
top, it held five positions; they closed for +$225 within days and entries
stopped 2020-02-26, one day before the crash proper. **Not foresight. A fast
turn and a day's margin.**

Two standing caveats: **7 losses is not a loss distribution**, six of them in
2018 — the whipsaw environment an SMA filter is worst in, sampled once. And it
sells the risk the Long Put Hedge is bought to own.

### Sizing: a uniform contract cap is the wrong instrument

Capping everything at 40 contracts cost CAGR 69.1% → 52.9% and changed
drawdown **not at all** (3.6% either way). It buys fillability, nothing else.
But 40 is arbitrary, because margin per contract varies 6×:

| Strategy | Margin/contract | 40 contracts = |
|---|---|---|
| Sell puts on rising SMA | $320 | $12,800 |
| Long Put Hedge | $970 | $38,800 |
| MTW Double Calendar | $1,961 | **$78,440** |
| QQQ Leap | $4,001 | $52,000 (at 13) |

**Three controls, each measuring one thing:**

- **`% allocation` = risk.** Scales with the account.
- **`Max $ allocation` = liquidity.** Set per strategy as *(contracts you
  believe fill) × (that strategy's own margin per contract)*.
- **`Max concurrent` = capacity.** The dial to turn as the account grows.

**Liquidity is per-order, not per-strategy.** Ten orders of 40 at different
strikes and times fill where one order of 400 does not. So when % allocation
outgrows the fill ceiling, raise concurrency and hold order size fixed — but
that lever only exists where entry frequency allows. The put seller has it
(daily entries, cap binding 9.4%). **The MTW calendar and the Long Put Hedge do
not** — they are entry-frequency constrained at 2 concurrent.

### Capacity is finite, and that is planning information

All three SPX caps engage around **$2.5M** and never release. Contribution as a
share of account then decays: MTW Double 23% → 35% → 10% → **1.2%** across
2020/2022/2024/2026. By 2026 the whole sleeve yields roughly **11% annualized
on $10.4M**.

That is the terminal size these caps imply. Don't engineer around it — decide
what size the options sleeve should reach, set caps to make that size fillable,
and route capital beyond it to the managed sleeve. Trying to make this sleeve
absorb unlimited capital is how the 1,318-contract position happened.

### Still unresolved

- **The exit redesign may be overfit.** 2018 went from −6.3% to +84.5% and max
  drawdown halved, achieved by adding delta, ratio and VIX conditions. Each is
  a tuning knob. Hold out 2017–2020, tune on 2021–2026, and see whether the
  drawdown survives data the exits never saw.
- **The Long Put Hedge is going vestigial** — 22.5% of P/L down to 5.0% once the
  put seller was added, capped at 40 contracts while the account compounds. The
  crash hedge shrinks as the thing it hedges grows.
- Whether either account permits trading on unsettled proceeds.

---

## 2026-09-08 — Options sleeve: one lot now, $200k in taxable later

Six Option Omega portfolio runs, 2017-09-07 → 2026-09-04, all four strategies
together, honest settings. Only two things varied: options capital (**O**) and
the QQQ 360 allocation. Full writeup published as an Artifact; this is the
decision and the evidence.

**O is not the account.** $40k of the $80k Roth is committed to CEFs, and those
shares provide **no buying power** against options — checked with the broker.
Every earlier backtest set OO's starting capital to $80k, so every allocation
was double its real size and the 52.8% peak margin actually needed $42k of a
$40k sleeve. Those peaks were unfillable. Set starting capital to the sleeve,
never the account.

| Run | O | QQQ | CAGR | Max DD | Peak margin | End-2019 | Runs? |
|---|---|---|---|---|---|---|---|
| A′ | $40k | 5% | 36.0% | 29.4% | 47% | 0.92× | yes |
| C′ | $120k | 5% | 71.9% | 20.9% | 78% | **unfunded** |
| C″ | $120k | 7% | 86.4% | 20.6% | **107%** | 1.28× | **breach** |
| C‴ | $120k | 7%+cap | 71.6% | 20.6% | 95% | 1.28× | yes |
| D′ | $200k | 5% | 75.1% | 21.6% | 84% | 1.14× | yes |
| **D″** | **$200k** | **7%+cap** | **69.0%** | **20.3%** | **70%** | **1.29×** | **yes** |

**Settled: $200k, QQQ 360 at 7%, `Max Allocation $25,000`.** It has the lowest
headline CAGR of the workable runs and that is the point — best drawdown, lowest
margin, best performance through every year that happens at plausible account
size. D′ only overtakes it from 2023, past $2M, where the numbers describe a
portfolio that will never exist.

**At $40k the book does not function.** Four losing years (−10.2% cumulative at
end-2021), the deepest drawdown of any run, QQQ 360 with **zero entries in 2020,
2021, 2022 and 2023**, and the Long Put Hedge pinned at one contract on 100% of
trades. Rounding delivers 76–85% of each target allocation.

**The whole $40k→$120k gap is QQQ 360 affordability.** In 2020 it was 0 trades
vs 20 and 56% of that year's P/L; in 2021, 0 vs 11 and 82%; in 2019 it produced
188% of the year's profit — the other three lost money. Strip it out of C′ and
CAGR barely moves (71.9% → 68.2%) but drawdown nearly doubles (20.9% → 35.8%).
**It is the stabiliser, not the return engine.**

**The granularity cliff is what decides the configuration, and no backtest shows
it.** QQQ 360 buys whole contracts — below the price of one the allocation buys
nothing. One contract is ~$7,800 at QQQ $718.96, above *every* price in the
sample ($163–$596). So 5% of $120k ($6,000) cannot fund it going forward even
though C′ shows it trading 74 times. Drawdown absorbed before the sleeve
switches itself off: $120k/7% → **−7%**; $200k/5% → −22%; $200k/7% → **−44%**.
Observed drawdowns run 20.3–29.4%, so only the last clears the range. At $120k
it would have switched off inside the first three years' −12.4% trough and
stayed off through the recovery.

**Above $200k adds dollars, not efficiency.** Every gain from $40k up was a
threshold effect; those resolve at $200k. Allocations are percentages after
that, so CAGR is flat. Only remaining step is a second QQQ contract near $250k.
Excess goes to the managed sleeve, not here.

**Placement: taxable, for risk reasons — not the tax reasons.** Asset location
argues the opposite of what we're doing. The rule is highest *return × rate*,
not highest rate, and that's the options sleeve by a wide margin: $200k over ten
years at a conservative 25% is 9.3× sheltered vs 5.0× taxed. Two corrections to
the 1256 case in Standing context, both narrowing it:

- **NY State (6.85%) and NYC (3.88%) don't recognise 60/40.** The benefit is
  federal-only; blended lands near 29–33%, not 18.6%.
- **QQQ 360 is not a 1256 contract** — equity option, short-term rates, wash
  sale rules apply. Only 3.3% of P/L at D″ sizing, so ~97% of the book qualifies.

It goes in taxable anyway because **the Roth is irreplaceable and this strategy
has never traded a day.** A 29% drawdown there permanently destroys $58k of
shelter; the same loss in taxable is deductible and 1256 losses carry back three
years. Given that three of nine years carry the entire result and QQQ 360's loss
profile is six trades, putting an unvalidated edge in the account that can never
be refilled is the aggressive choice, not the neutral one. Staged conversion
means it's revisable after two or three years of live results.

Also: **1256 marks to market at year end**, so ~30% of each year's gains leave
for tax whether or not anything closed. The sleeve cannot fully compound and a
good year produces a bill that must be funded. Already in the 5.0× above, but
it's a cash-flow event to plan for, not just a rate.

**What survives all six runs, and should temper all of it:**

- 2022–2026 produce the entire result. 2017–2021 range from −10% to +2.8×
  depending on nothing but whether QQQ 360 could afford to fire.
- **2018 loses in every configuration** (−6.3% to −2.0%). The "positive in every
  calendar year" bar that killed the iron condors is not met by the portfolio
  itself under actual sizing. Normalised to one lot it is — decide which basis
  the rule is about before applying it again.
- QQQ 360 is 74 trades with **6 losses**. It's the difference between 36% and
  75% CAGR. At $40k it shows a 100% win rate across 22 trades because
  affordability skipping removed every loser — that number is an artifact, not
  a record.
- **The Long Put Hedge's ~46% of P/L in every run is a sizing artifact.**
  Normalised to one lot it's 10.5%, profit factor 1.20, and the largest per-lot
  drawdown in the book. It earned its dollars by being allocated late, at size.
- Late-year figures describe a $10M+ account. Read as arithmetic, not forecast.

**Still open:** whether the IRA (and the taxable account) permit trading on
unsettled proceeds. Daily-entry strategies in a cash account can be starved by
T+1 settlement even when cash is nominally free, and no backtest models it. It
would bite hardest at the margin levels D″ runs at.

### Amendment, same day — fixed one-lot sizing, and the sleeve stays running

The conclusion above was nearly "stand the sleeve down until the money arrives."
That was wrong, and the reason is worth keeping: **every run above sizes by
percentage of equity, which compounds a losing stretch.** Take that out — one
contract, at most one open position per strategy — and the same four strategies
on the same nine years of signals behave completely differently.

| Rule | Signals taken | P/L per yr | Peak margin | Worst DD | Losing years |
|---|---|---|---|---|---|
| **1 open per strategy** | 2,754 / 4,092 | **$19,999** | **$13,598** | **$4,849** | **none** |
| …without QQQ 360 | 2,738 / 3,172 | $16,694 | $8,701 | $4,849 | none |
| 1 open portfolio-wide | 750 / 4,092 | $7,119 | $6,660 | $6,369 | 2022 |

By year, per-strategy: +$128, +$13,136, +$1,481, +$22,725, +$10,830, +$27,184,
+$17,742, +$31,927, +$45,340, +$9,501.

**Positive in every calendar year, including 2018** — the bar that killed the
iron condors, cleared here and nowhere else in the study. 2018 was never a
strategy failure; it was a sizing failure, which is precisely what the
normalised Analyze view said (+$8.7k) while actual sizing reported −$1.4k.
**Whenever that rule is invoked again, say which sizing basis it means.**

Peak margin of $13,598 uses historical QQQ contract prices; at today's ~$7,800
it is nearer **$18,000** — inside the existing $40k Roth with room to spare.

**So the sleeve keeps running now, at one lot, one open per strategy, in the
Roth**, and converts to percentage sizing in taxable when the condo money
arrives. That also solves a problem the sizing analysis never addressed: going
from zero straight to $200k of live size after a year away, with no fills, no
slippage data and no experience of an 89%-underwater equity curve. A year of
one-lot trading supplies all three and pays for itself.

What it costs, and both are real:

- **It does not scale.** ~$20k/yr whether the account holds $40k or $400k. The
  figure tracks the index level, not the account — 2025 pays $45k, 2018 paid
  $13k, because SPX tripled.
- **The one-concurrent rule takes the worst entries by our own data.** Win rate
  runs 73% at one open position and 84% at four; this rule declines every
  stacked entry, and QQQ 360 fires 16 times out of 74. Treat these figures as
  the edge's floor, not its middle.

It revalidates nothing. Same nine years, same regime concentration. It shows
only that the strategies survive being sized safely — a narrower claim than any
CAGR above, and the only one this study actually establishes.

---

## 2026-08-22 — The current portfolio starts January 2026

**Performance before 2026 is a different strategy and should not be averaged in.**
Everything prior was learning, testing and mistakes. Schwab's "since available"
column reaches back to May 2024 and shows +$19,908 of investment change over
2.3 years — *less* than 2026 alone — but that comparison is meaningless, because
the thing being measured changed.

**2026 to 22 August, both Schwab accounts combined:**

| | |
|---|---|
| Average capital at work | $73,728 |
| Investment change | +$22,029 |
| **Period return** | **29.9%** |
| Annualized | 50.7% |

Modified Dietz, weighting each of nine withdrawals by its actual date — the
$25,000 car wire on 27 March matters most, since capital that left early wasn't
working. The naive figure (change ÷ beginning value) is 23.6% and understates it.

Split of the gain: **options trading +$19,788, CEF/BDC income +$2,587**, less
about $338 of net price change on holdings. Reconciles with Schwab's own
Investment Gain/Loss and Income lines to within rounding.

**The two halves need judging separately.** QQQ 360 and a single Long Put Hedge
trade produced 62% of the options profit. Powerhour and Consecutive IC — 1,640
legs between them — made $5,838. The systematic strategies roughly paid their
way while a few directional calls carried the year. Eight months is also a
short record: quoting 50% as a run rate assumes the rest of the year resembles
this one, and the monthly path (February −$1,680, March +$7,849) says it may not.

**Account note:** the Schwab Portfolio Performance screen aggregates the Roth
(····6967) and the Designated Beneficiary account (····9267). A figure read off
it is both accounts, not one. 9267 stopped trading 17 April and now just holds
money; it was abandoned because of pattern-day-trading limits that have since
been relaxed, so consolidating is worth revisiting.

---

## 2026-08-30 — Exposure is a separate axis from category

The energy-infrastructure concentration was invisible for a structural reason,
not an attention one: **CEFConnect's category describes how a fund is packaged,
and correlation runs along what it holds.**

Category split the position across `Equity-MLP` (TYG, NML, SRV) and
`Equity-Sector Equity` (NXG), and inside that second bucket merged NXG's
midstream exposure with BSTZ's tech. It separates what should group and groups
what should separate — so a category column on screen the whole time never had
a chance of surfacing it.

**Named `exposure`, not the alternatives.** `category` is taken and is
CEFConnect's. `industry` implies a GICS sector of operating companies, which is
meaningless for a convertibles or preferreds fund. `focus` is vague. `sleeve`
already means the three-sleeve income/options/managed-index plan above and
would collide.

**One bucket per fund.** The moment a fund can sit in two, the concentration
total stops being a number you can read off the screen — which is the only
thing this column is for.

**Defaults derived, exceptions by hand.** 332 of 370 funds map mechanically
from category. The rest resolve to null rather than a guess: `Equity-Sector
Equity` genuinely contains different bets, and asserting one would be worse
than leaving a gap. Covered-call turned out to be the same trap in miniature —
it's a strategy, not an exposure, so EXG needed an override to stop being
filed as US equity.

Resulting picture, which is the point: **energy infrastructure 23.7%** across
four funds that move as one, then convertibles 16.7%, global equity 13.4%,
US equity 11.4%. The trim-to-two suggestion from the leverage work stands.

---

## 2026-08-30 — Leverage tracked as risk, separate from the grade

Prompted by asking how exposed the sleeve is to a violent downturn. The audit
answered "is the yield earned" and had nothing to say about "how far can the
market fall before this fund is forced to sell into it" — the mechanism that
turns a drawdown into a permanent loss.

**The objection was that all CEFs run ~30% leverage, so screening on it would
flunk everything.** The data says otherwise. Across the 17 held CEFs:

| | Share of sleeve |
|---|---|
| Levered ≥20% | 61% |
| Levered <5% | 39% |

Six funds are effectively unleveraged (EXG at 0%, ECAT 0.17%, BSTZ 0.76%,
AOD 2.78%, HGLB 2.79%, USA 4.98%). Eleven run 24–41%. Look-through borrowed
exposure is ~$7,958, about 20% of the sleeve.

**The metric is the preferred/debt split, not the ratio.** Debt is tested at
300% asset coverage, preferred at 200%. At an identical 30% ratio that's a 10%
cushion versus a 40% one. Only NCV, NCZ and TYG carry preferred; the five most
levered — XFLT 40.6%, NPFD 36.9%, AVK 36.6%, NXG 34.2%, FSCO 32.6% — are all
debt, the fragile kind. So it ranks, and the ranking is not the one the headline
ratio gives you.

**Reported beside the grade, never inside it.** Same reasoning as the screener-
vs-audit coverage split: different questions, don't reconcile them. A levered
fund is not a badly-run fund. It's also kept out of `flags`, which lower
confidence when data is doubtful — a known leverage ratio isn't doubtful.

**Deliberately not precise.** CEFConnect refreshes assets daily and leverage
monthly-to-semi-annually, so the two can't be mixed into real breach math; NPFD
reads 271% coverage, which is below the statutory floor and therefore stale
rather than true. The cushion is suppressed rather than guessed whenever the
figures don't reconcile. Bands rank; the cushion is indicative only.

**Findings that reshaped the portfolio picture, not just the tooling:**
the sleeve is *not* mainly corporate debt. Energy infrastructure is the largest
single factor at 24% across four funds (TYG, NML, NXG, SRV) that will move as
one. Equity is 31%, converts 17%, credit and BDC together ~21%. The open
suggestion is trimming the energy overlap from four names to two.

---

## 2026-08-18 — BDC rotation settled at five

**ARCC, BBDC (held), MAIN, HTGC, GLAD (tracked).** Roughly 75 minutes a quarter.

Nine was tried and was too many. A rotation that slips is worse than a short
one, because a half-updated set looks current and isn't.

**Assessed and passed over**, with their quarters still in `bdc_fundamentals`
so reinstating one costs no re-entry:

| | Grade | Why |
|---|---|---|
| BXSL | D+ | NII fell every quarter and slipped below the flat $0.77 dividend; NAV $27.15 → $25.53 |
| GSBD | D+ | Q1 2026 covered only 0.69×; non-accruals 3.2% at fair value |
| MSIF | C− | Coverage 0.86×; NII fell to $0.26 against a $0.35 regular |
| SLRC | C+ | Cut its distribution 24% to restore coverage |
| OBDC | C− | Coverage 1.00×, 16% base cut, NAV down every quarter. **Deleted**, not deactivated — never held, no history worth keeping |

TSLX screened well and was passed over on premium, not on quality.

---

## 2026-08-18 — Screener coverage measures a different thing from the audit

The BDC screener reads SEC XBRL, which tags **total** distributions including
supplementals. The position audit measures against the **regular** dividend,
because that's the standing commitment.

So the same company can screen at 0.91× and grade A+ — MAIN does exactly that.
Neither number is wrong; they answer different questions. Don't reconcile them.

---

## 2026-08-17 — Lifetime score is CEF/BDC only

**+$12,470 since June 2021**: realized −$1,208, distributions +$11,501,
unrealized +$2,177.

Scoped to funds. Including the account's ETF and options activity nearly
doubled it — SSO +$4,688 and QLD +$4,140 alone — from strategies that aren't
CEF investing. Sixteen tickers the old importer had filed as "CEF" were
reclassified to ETF, MUTF, STOCK or BOND. They keep their history and stay
visible under inactive funds; they just don't count toward a fund score.

**The number that matters here:** realized trading is −$1,208 against +$11,501
of distributions. Every dollar of lifetime gain has come from income, not from
buying and selling. The premium/discount arbitrage thesis has not paid. That's
acceptable because income was the point — but it means the trading is a small
net drag, which the current-positions scoreboard was hiding.

---

## 2026-08-17 — BDC sleeve kept, and expanded

Nearly sold on instinct. The audit said otherwise: **ARCC covers its dividend
1.08×, BBDC 1.05×**, both from filed net investment income.

The reason for nearly dropping them was wrong, too. "There's no parallel way to
grade them" is backwards — BDCs *publish* NII coverage every quarter, which is
a better answer to "is the yield paying for itself" than the NAV total return
the CEF audit has to infer. It just isn't in any free API.

Circle of competence was the sound reason to consider exiting, and it happened
to point the other way once the data was in. Do not assume he wants out of BDCs.

---

## 2026-08-17 — Schwab's export is the authoritative record

The app had been inferring share counts and income. It was wrong in both
directions, and every correction came from the export:

- **DMA was recorded as 229 shares; it was 220.** Two buys totalling $1,986.39,
  matching the stored cost basis to the cent, and a $24.75 dividend against a
  declared $0.1125 rate — exactly 220.00 shares.
- **Income understated by $2,802.** `div_tracking_since` was 2026-03-01, so
  everything earlier was simply absent.
- **USA overstated by $30.86** — Yahoo gives a per-share rate that gets
  multiplied by *today's* share count, and USA held 145 shares until Nov 2025,
  not 304.
- **245 duplicate rows, $5,776 of dividends that were never paid**, because the
  Yahoo sync inserted at the ex-date while the import recorded the pay date.

Rule going forward: **prices refresh themselves; anything about a position
comes from the export.** Always the "All" date range — a short window can't
rebuild share counts for anything sold in it.

---

## 2026-08-17 — DMA sold

Coverage 0.20×. Over the trailing year it earned +0.6% while paying 12.1%, and
had raised its distribution 55% into a falling NAV — $11.91 → $9.09 since 2022.
Grade F on every window measured.

Lifetime result: **+$117** — a realized loss of $313 against $430 of
distributions. A 17% headline yield returned roughly cash over 1.7 years.

Note for calibration: the first pass on this understated the return badly
(+$48 on 229 phantom shares and nine months of missing income). The
*conclusion* held, but the position had done better than the broken data
suggested. Check the data before sharpening a verdict.

---

## Rubric design

Decisions baked into `services/audit.py` that are easy to second-guess later:

- **Coverage is 50% of the CEF grade**, blended 1Y/3Y/long-run at 25/40/35.
  Longer windows weighted heavier so one market year can't dominate.
- **Long-run means the median of rolling 3-year windows**, not inception-to-
  today. A single anchor makes the grade hostage to one day: BSTZ's series
  starts 2021-08-20, near the tech peak, which alone dragged it to a D despite
  covering its distribution 2× over three years.
- **Insufficient data returns no grade, never an F.** "Couldn't measure" must
  not render as "bad" — XFLT was scoring F on one surviving component.
- **Data discrepancies never move a grade**, only confidence. A stale figure is
  a tooling problem, not a fund problem.
- **Scoring curve anchors are deliberately not user-tunable.** Weights and
  thresholds are, in Settings. If every curve were adjustable the grade could be
  tuned until everything scored an A, which would make it useless as a check on
  judgment. Every audit snapshots the rubric it ran under for the same reason.
