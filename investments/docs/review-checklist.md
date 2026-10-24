# Options sleeve — review checklist

Step-by-step procedure for the quarterly and annual review of each strategy in
the options sleeve. Written in plain terms on purpose: the point of a checklist
is that it can be followed on a tired evening in December without re-reading
the decisions log. The *reasons* behind each step live in `decisions.md`
(dated entries) and the traps in `../CLAUDE.md`; this file is only the steps.

Status: **QQQ Leap written (2026-10-22). CIC-10am and Long Put Hedge are stubs**
— they carry the tripwires already decided, but the full procedure is still to
be written.

---

## QQQ Leap

**What the strategy is.** Buy one QQQ call about a year out (60 delta) on a day
QQQ has fallen 1.75% or more from its open by 15:30, as long as QQQ is above its
200-day average. Sell at an 80% gain or 7 days before expiry, whichever comes
first. Hold up to *cap* contracts at once.

**The one dial is the cap.** The filter, the strike, the target and the exit
are settled; do not change them on the strength of a year's results. The
year's P/L mostly says whether QQQ went up, not whether the strategy works.

### Quarterly (15 minutes)

Three numbers, one division.

1. **Equity.** The options sleeve's current balance at Schwab.
2. **Price of one contract.** Pull up the QQQ chain, the expiry nearest 360
   days out, the call nearest 60 delta (strike ≈ 0.975 × QQQ). Write down the
   ask. It runs about 13–14% of the QQQ price, so it rises as QQQ rises.
3. **Loss budget.** 22% of equity. (This is the sleeve's drawdown tripwire.)

Then:

```
cap = loss budget ÷ contract price, rounded down
```

- If the answer is **lower** than the cap you are running, **lower the cap
  now**. Reducing risk never waits for the annual review. This happens when QQQ
  has risen faster than the account: the same two contracts are a bigger bet.
- If the answer is **higher**, do nothing. Raising waits for the annual review.

Worked example, 2026-10-22: equity $80,000 → budget $17,600; contract $8,300;
$17,600 ÷ $8,300 = 2.1 → **cap 2**. In OO the cap is `maxOpenTrades` × contracts
per trade: set to 2 × 1 on 2026-10-23 (was 3 × 1). Raising the cap means raising
`maxOpenTrades`, live and test together.

Also note for the file, no action: number of entries this quarter, and for each
one the mid price when the order went in and the price actually paid.

### Annual (an hour)

1. **Redo the quarterly division** with year-end numbers.

2. **Decide which bear you are budgeting for.** The division above assumes a
   bad year looks like 2022: each contract loses its full price once, then the
   200-day filter keeps you out. A 2000–2002 bear is different: the market
   rallies back above the 200-day each winter, you re-enter, and each slot loses
   its full price about two and a half times before it is over. If that is the
   scenario you want to survive, divide by **2.6 × the contract price** instead.

   At a contract price of $8,300:

   | Cap | Equity needed, 2022-type budget | Equity needed, 2000-type budget |
   |---|---|---|
   | 1 | $38,000 | $98,000 |
   | 2 | $75,000 | $196,000 |
   | 3 | $113,000 | $294,000 |
   | 4 | $151,000 | $392,000 |

   Recompute the table when the contract price moves: equity needed = cap ×
   contract price ÷ 0.22, times 2.6 for the right-hand column. Cap 2 at $80k
   (the 2026 setting) is a 2022-type budget. That is a choice, not an oversight;
   the only judgment in this review is whether it is still the right one. The
   strict formula gives cap 0 below $98k on the 2000-type budget; running 1
   contract there anyway is a decision to carry one contract of uncovered risk.

3. **Veto one: are you in a drawdown?** If sleeve equity is below its high-water
   mark, do not raise the cap this year regardless of the arithmetic. Lowering
   is still allowed.

4. **Veto two: what are the fills costing?** Average the gap between the mid at
   order time and the price paid, across the year's entries (both the buy and
   the sell). Breakeven for this strategy is about **$13 per contract per side**.
   If the average gap is above that, adding contracts adds cost, not profit;
   do not raise, and investigate the execution settings (price increment,
   attempts, interval, in Option Omega). This is the only live measurement
   that means anything for a strategy with three trades a year — win rate and
   profit per trade are noise at that count.

5. **Set the cap** to the smaller of: the division's answer, and the current
   cap plus one. Never jump two slots in a year.

6. **Record** in `decisions.md`: the three inputs, the division, the bear
   scenario chosen, both vetoes, and the cap set. One short dated entry.

### What each extra contract is worth and costs (for reference)

From the replay in `leap_replay.py`, QQQ 2000–2026, one contract per slot:

- Every slot earns the same per trade (about +40% of the contract price);
  the entries a higher cap picks up are not worse entries.
- Each slot adds about **one contract price** of drawdown in a 2022-type year
  and about **2.6 contract prices** in a 2000-type bear.
- Each slot earns roughly 0.7–0.9 contract prices a year, 2017 onward.

---

## CIC-10am (SPX 0DTE iron condor) — STUB

Full procedure to be written. Until then, the numbers already decided:

- **Per-trade edge:** benchmark $70; tripwire **$35** (half the honest backtest).
  The condor is the sleeve's only fast detector, ~250 trades a year, so this
  is measurable quarterly.
- **Fill slippage:** tripwire **15¢ per leg** against the mid.
- **Margin:** read peak margin deployed, not contract count. Group the three
  rows OO writes per condor before summing (`Margin Req.` is per trade).
- **Drawdown:** sleeve tripwire $18k on $80k (22%).
- **Sizing (2026-10-24): 1 contract.** Raise to 2 only after a positive live
  calendar quarter (closed P/L above zero, mechanical exits only), and only at
  a quarterly review. Measured with and without on 2022–26: the condor is half
  the book's profit and adds $0.6–4.3k a year of dollar drawdown; at 2
  contracts its own 2026-type drawdown is ~$20k, the sleeve tripwire alone.
- **Nothing is raised to a third contract until the condor has a positive
  live year.**

## Long Put Hedge — STUB

Full procedure to be written. Until then:

- **Per-trade edge:** benchmark $97; tripwire **$48**. Needs a full year of
  trades to be readable.
- **Fill slippage:** tripwire 15¢ per leg.
- Its value is the 2022-type year (+34% against 17.9% without), on an
  instrument that has existed since 2022-05-11 — n = 1. Size the reliance to that.

## Weekly (10 minutes, Friday after the close)

1. Export four files: Option Omega trade log and portfolio CSV for the week
   from the `2027` portfolio (funded at the account's actual equity, range
   Monday → Friday), the autotrader strategy trade log, and the Schwab
   transaction export.
2. Drop all four on **Sage › Investments › Options › Live vs Backtest**. Each
   is recognised by its header and replaces the same dates from last time.
3. Read, in order: the live − backtest tile (the week's gap), the by-trade
   rows with flags (which day made the gap and why), stop fill vs 3× trigger
   (live should stay well under the test's), entry credit live − test
   (tripwire 0.15 per leg), and Schwab SPX cash against the live SPX total
   (they should agree to the dollar on an all-0DTE week).
4. Anything flagged `manual exit` is a day the record is not mechanical;
   tick *Exclude manual exits* to see the comparison without it.
5. One line in `decisions.md` only if something is outside the known
   tolerances (the 2026-10-24 week-one entry lists them).
6. Read the **cash balance** off the Schwab export or the Balances screen.
   Below the trading-cash line (today $40,000) → the cash-floor rule, next
   section.

## Cash floor and the Treasury parking lot

**Why it exists.** Only cash can secure a trade. Peak cash the sleeve ties up
at today's sizing (2026-10-24, from the week's OO margin figures): condor
1 contract $9.5–11.5k, hedge 2 contracts ~$2k, leap 2 open ~$16.6k → **about
$30,000**. With a second condor contract → about $41,500. A drawdown comes out
of that same cash. Once it is gone Schwab rejects the next order and the
autotrader logs a skipped entry, which is a quiet way to diverge from the
backtest (OO assumes the whole sleeve is available).

**The 2026-10-24 restructure.** Until this date the refill came from selling
CEFs. That is the wrong source: a bad stretch for the sleeve is a vol spike or
a QQQ drop, which is exactly when CEF discounts widen. The refill would be sold
cheapest at the moment it is needed. From now on the Roth holds three things
with three jobs, and only the first two talk to each other:

1. **Trading cash** — Schwab's sweep / money-market fund. Holds peak
   collateral at the current contract count **plus the drawdown buffer**
   (the $18k tripwire figure). Today: $30,000 + $18,000 = **$48,000**.
2. **The parking lot** — short Treasuries (SGOV, or a ladder of 3–6 month
   bills). Every conversion or contribution lands here the day it arrives
   and waits for a review to raise contracts. Does not move in a crash, sells
   at par, settles T+1. **This is where refills come from.** Cost: Treasury
   yield instead of whatever the money would earn deployed, on money the sleeve
   is not yet allowed to trade.
3. **The CEF income sleeve** — judged on distributions (see `decisions.md`,
   three-sleeve plan). **Never the source of emergency cash.** Whether to keep
   it, shrink it or add to it is a separate decision about wanting an income
   sleeve at all, taken at the annual review, never on a down week.

**The rule, measured on trading cash, never on the account total.**

- Trading cash **below collateral + $10,000** (today: below **$40,000**) →
  sell Treasuries to bring it back to **collateral + buffer** (today
  $48,000). Same day; nothing is at a loss, so there is nothing to wait for.
- Parking lot empty and trading cash still below the line → the sleeve is in
  a drawdown the parking lot could not cover. That is a tripwire event, not a
  refill event: drop contract counts to what the cash supports (hedge rule
  $40k/contract, leap cap formula) and read the sleeve-level section. Do not
  sell CEFs to keep contract counts up.
- CEFs fall but trading cash is above the line → nothing to do. The account
  total can read lower for two different reasons; only the cash case acts.
- At a review that raises contracts (condor to 2, hedge to 3, leap cap up):
  recompute collateral at the new counts, move the difference plus the buffer
  from Treasuries to trading cash **before** changing the live setting.
- A conversion lands (December): it goes to Treasuries, not to trading cash
  and not to CEFs. Trading cash is sized by contract count alone.

**Recompute the numbers each quarter.** Collateral scales with the index level
and with vol (see `../CLAUDE.md`, margin notes: a volatile year costs ~1.5× a
calm one at the same SPX). Write the quarter's figure here:

| Quarter | Condor ctr | Hedge ctr | Leap (ctr per entry × open trades) | Peak collateral | Buffer | Trading cash target |
|---|---|---|---|---|---|---|
| 2026 Q4 (from 10/26) | 1 | 2 | 1 × 2 | ~$30,000 | $18,000 | $48,000 |

**Transition from the old structure (one-off, 2026-10-24).** Schwab shows
cash $35,637 of $81,472, so about $45,800 in CEFs and no Treasuries. One leap
open today, but the target is sized on the cap (two open), so trading cash is
$12,400 under the $48,000 target and $4,400 under the $40,000 action line.
The parking lot is seeded without selling CEFs: make the **2026 Roth
contribution ($8,600, from the taxable pot, on 2026 wages, due by April 2027)
now and buy SGOV with it**. That lifts cash + bills to about $44,200, above the
line. The rest of the gap closes with the first 2027 conversion. Until then
the leap cap stays at 2 only if cash can carry a second entry; if it cannot,
run the cap at 1 rather than sell CEFs.

**What it is not.** This is a buying-power rule, separate from the $18k
drawdown tripwire below. The tripwire asks whether the strategies still
work; the cash floor only keeps the autotrader able to place the next order.

## Sleeve-level, every review

- Drawdown > $18k on $80k (22%): one tripwire = investigate, two = stop adding.
- Two consecutive losing years for any strategy: stop adding to it.
- Rebalance is a ratchet: profits out on gains, never added back on losses.
- Check the overnight share of the sleeve (QQQ LEAP premium held) against the
  succession note in `decisions.md` 2026-10-05.
