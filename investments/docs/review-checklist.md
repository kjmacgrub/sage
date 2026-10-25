# Options sleeve — action sheet

One page of steps and formulas. Every number on this page has a footnote; the
footnotes (page 2 on) carry the reasoning, worked examples and the one-off
notes. Dated reasons live in `decisions.md`, traps in `../CLAUDE.md`.
Status: QQQ Leap and the cash floor are written; the condor and the hedge are
stubs carrying only their tripwires.[^status]

## Weekly · Friday after the close · 10 min

1. Export four files: OO trade log + portfolio CSV from the `2027` portfolio
   (funded at actual equity, Monday → Friday); autotrader strategy log; Schwab
   transactions.[^weekly-files]
2. Drop all four on **Sage › Investments › Options › Live vs Backtest**.
3. Read in order: live − backtest tile → flagged by-trade rows → stop fill vs
   3× trigger → entry credit live − test (tripwire **0.15/leg**) → Schwab SPX
   cash = live SPX total.[^weekly-read]
4. Any `manual exit` flag → tick *Exclude manual exits*.
5. One line in `decisions.md` only if outside tolerances.[^tolerances]
6. Cash balance below the action line (**$40,000**) → Cash floor, below.

## QQQ Leap[^leap]

**Quarterly · 15 min.** Three inputs, one division.

- **E** = sleeve equity at Schwab · **P** = ask of the ~360 DTE call nearest
  60Δ (strike ≈ 0.975 × QQQ)[^price] · **B** = 0.22 × E
- `cap = ⌊ B ÷ P ⌋` — in OO: `maxOpenTrades` = cap, 1 contract per trade.[^example]
- Lower than the cap you run → **lower it now**. Higher → do nothing until
  the annual.[^lower-only]
- Log, no action: entries this quarter, mid at order vs price paid.

**Annual · 1 hour.**

1. Redo the division with year-end numbers.
2. Choose the bear: 2022-type → divide by **P**; 2000-type → divide by
   **2.6 × P**. Equity needed = cap × P ÷ 0.22 (× 2.6).[^bear]
3. Veto one: equity below its high-water mark → **no raise**.[^veto-dd]
4. Veto two: average fill gap > **$13 / contract / side** → **no raise**;
   check OO execution settings.[^veto-fills]
5. `cap = min( division, current cap + 1 )`[^one-slot]
6. Record in `decisions.md`: E, P, B, the division, the bear chosen, both
   vetoes, the cap set.

## CIC-10am · SPX 0DTE iron condor · stub[^condor]

- Edge per trade: benchmark **$70** · tripwire **$35**. Readable quarterly.
- Fill slippage: tripwire **15¢ / leg** vs mid.
- Margin: read peak margin deployed, grouped per trade, never contract
  count.[^margin-rows]
- Size **1 contract**. → 2 only after a positive live calendar quarter
  (mechanical exits only), at a quarterly review. → 3 only after a positive
  live year.[^condor-size]

## Long Put Hedge · stub[^hedge]

- Edge per trade: benchmark **$97** · tripwire **$48**. Needs a full year.
- Fill slippage: tripwire **15¢ / leg**.
- Size: **$40k of equity per contract** (2 at $80k, 3 at $120k).

## Cash floor[^floor]

- **C** = peak collateral at the current caps · target **T = C + $18,000** ·
  action line **L = C + $10,000**.
- 2026 Q4 (from 10/26): condor 1 · hedge 2 · leap 1 × 2 open → **C ≈ $30,000 ·
  T $48,000 · L $40,000**.[^collateral]
- Cash < L → sell Treasuries up to T, same day.
- Treasuries empty and cash < L → cut caps to what cash carries. **Never sell
  CEFs.**[^never-cefs]
- Conversion or contribution lands → Treasuries (SGOV), not cash, not
  CEFs.[^parking]
- A review raises a cap → move ΔC + buffer from Treasuries to cash **before**
  changing the live setting.
- Recompute C each quarter; a volatile year costs ~1.5× a calm one at the
  same SPX.[^vol-margin]
- Transition, 2026-10-24: cash $35,637 · CEFs ~$45,800 · Treasuries $0. Seed
  with the **2026 Roth contribution, $8,600 → SGOV**. Leap cap 1 until cash
  carries a second entry.[^transition]

## Sleeve-level · every review

- Drawdown > **$18k on $80k** (22%): one tripwire = investigate, two = stop
  adding.
- Two consecutive losing years for a strategy → stop adding to it.
- Rebalance is a ratchet: profits out on gains, never added back on
  losses.[^ratchet]
- Overnight share of the sleeve (open LEAP premium) vs the succession
  note.[^succession]
- The sleeve trades Ken's Schwab Roth only. No other account is ever added,
  whatever the record.[^only-roth]

[^status]: Written 2026-10-22 (QQQ Leap), 2026-10-24 (cash floor, condor
    sizing). The condor and hedge full procedures are still to be written;
    until then their sections carry only the numbers already decided.

[^weekly-files]: Each upload is recognised by its header and replaces the
    same dates from last time, so re-dropping a week is safe. The `2027` OO
    portfolio must be run at the account's actual equity and sized to the
    contracts live actually traded, or the comparison is against a different
    book.

[^weekly-read]: The tile is the week's gap. The flagged rows say which day
    made it and why. Live stop fills should stay well under the backtest's
    3× trigger (the resting stop executes better than the model assumes).
    Schwab's SPX cash and the live SPX total agree to the dollar on an
    all-0DTE week; a multi-day position only reconciles over its whole life.

[^tolerances]: The 2026-10-24 week-one entry in `decisions.md` lists the
    known tolerances (live −$393 against backtest +$724, all of it one
    knife-edge day).

[^leap]: **What it is.** Buy one QQQ call about a year out (60 delta) on a
    day QQQ has fallen 1.75% or more from its open by 15:30, as long as QQQ is
    above its 200-day average. Sell at an 80% gain or 7 days before expiry,
    whichever comes first. Hold up to *cap* contracts at once.
    **The one dial is the cap.** The filter, the strike, the target and the
    exit are settled; do not change them on the strength of a year's results.
    The year's P/L mostly says whether QQQ went up, not whether the strategy
    works. **What a slot is worth** (replay in `leap_replay.py`, QQQ
    2000–2026): every slot earns the same per trade, about +40% of the
    contract price, so the entries a higher cap picks up are not worse
    entries; each slot adds about one contract price of drawdown in a
    2022-type year and about 2.6 in a 2000-type bear; each slot earns roughly
    0.7–0.9 contract prices a year, 2017 onward.

[^price]: Pull up the QQQ chain, the expiry nearest 360 days out, the call
    nearest 60 delta. Write down the ask. It runs about 13–14% of the QQQ
    price, so it rises as QQQ rises.

[^example]: Worked example, 2026-10-22: equity $80,000 → budget $17,600;
    contract $8,300; $17,600 ÷ $8,300 = 2.1 → cap 2. In OO the cap is
    `maxOpenTrades` × contracts per trade, set to 2 × 1 on 2026-10-23 (was
    3 × 1). Raising the cap means raising `maxOpenTrades`, live and test
    together. B is 22% of equity because that is the sleeve's drawdown
    tripwire.

[^lower-only]: Reducing risk never waits for the annual review. The
    division falls when QQQ has risen faster than the account: the same two
    contracts are a bigger bet. Raising waits because a quarter's result is
    noise at three trades a year.

[^bear]: The quarterly division assumes a bad year looks like 2022: each
    contract loses its full price once, then the 200-day filter keeps you out.
    A 2000–2002 bear is different: the market rallies back above the 200-day
    each winter, you re-enter, and each slot loses its full price about two
    and a half times before it is over. At a contract price of $8,300 the
    equity needed is: cap 1 → $38,000 (2022-type) / $98,000 (2000-type);
    cap 2 → $75,000 / $196,000; cap 3 → $113,000 / $294,000; cap 4 →
    $151,000 / $392,000. Recompute when the contract price moves. Cap 2 at
    $80k (the 2026 setting) is a 2022-type budget. That is a choice, not an
    oversight; the only judgment in this review is whether it is still the
    right one. The strict formula gives cap 0 below $98k on the 2000-type
    budget; running 1 contract there anyway is a decision to carry one
    contract of uncovered risk.

[^veto-dd]: If sleeve equity is below its high-water mark, do not raise the
    cap this year regardless of the arithmetic. Lowering is still allowed.

[^veto-fills]: Average the gap between the mid at order time and the price
    paid, across the year's entries, both the buy and the sell. Breakeven for
    this strategy is about $13 per contract per side. Above that, adding
    contracts adds cost, not profit: do not raise, and look at the execution
    settings in Option Omega (price increment, attempts, interval). This is
    the only live measurement that means anything for a strategy with three
    trades a year; win rate and profit per trade are noise at that count.

[^one-slot]: Never jump two slots in a year. The cap is purely a loss
    budget, and a slot added mid-drawdown or on degraded fills is the one
    that hurts.

[^condor]: Full procedure to be written. The condor is the sleeve's only
    fast detector, about 250 trades a year, so its edge per trade is
    measurable quarterly where the hedge needs a year and the leap has no
    detector at all. Benchmark $70 is the 2022–26 honest backtest; the
    tripwire is half of it. Drawdown tripwire is the sleeve's: $18k on $80k.

[^margin-rows]: OO writes three rows per condor (wings, put side, call side)
    and carries `Margin Req.` on every one of them; it is per trade, not per
    row. Group the rows first, then sum, or peak margin reads 2.3× too high.
    Schwab holds the full spread width as collateral.

[^condor-size]: Decided 2026-10-24, live from 2026-10-26 (was 2 for the week
    of 10/19). Measured with and without on 2022–26: the condor is half the
    book's profit and adds $0.6–4.3k a year of dollar drawdown. At 2 contracts
    its own 2026-type drawdown is ~$20k, the sleeve tripwire on its own. A
    positive live calendar quarter means closed P/L above zero on mechanical
    exits only; manual exits are excluded.

[^hedge]: Full procedure to be written. Its value is the 2022-type year
    (+34% against 17.9% without) on an instrument that has existed since
    2022-05-11, so n = 1; size the reliance to that. It does not reduce
    drawdown (−11.11% with, −10.74% without). Its figures from before
    2022-05-11 are a different instrument and will read like a tripwire;
    they are not.

[^floor]: Only cash can secure a trade. A drawdown comes out of that same
    cash; once it is gone Schwab rejects the next order and the autotrader
    logs a skipped entry, a quiet way to diverge from the backtest. The Roth
    therefore holds three things with three jobs: **trading cash** (Schwab's
    sweep fund, sized by contract count alone), a **Treasury parking lot**
    (the only refill source), and the **CEF income sleeve** (judged on
    distributions, never sold for cash). Restructured 2026-10-24: until then
    the refill came from selling CEFs, which is wrong because a sleeve
    drawdown is a vol spike or a QQQ drop, exactly when CEF discounts widen,
    so the refill would always be sold at its cheapest. This is a
    buying-power rule, separate from the $18k drawdown tripwire: the tripwire
    asks whether the strategies still work; the floor only keeps the
    autotrader able to place the next order.

[^collateral]: From the week's OO margin figures, 2026-10-24: condor 1
    contract $9.5–11.5k, hedge 2 contracts ~$2k, leap 2 open ~$16.6k, about
    $30,000 together. With a second condor contract about $41,500. The target
    is sized on the leap cap (two open), not on how many are open today,
    because a second entry can fire any day. The buffer is the $18k drawdown
    tripwire figure. Keep a line per quarter: 2026 Q4 · 1 / 2 / 1×2 · C
    ~$30,000 · buffer $18,000 · T $48,000.

[^never-cefs]: Parking lot empty and cash still short means the sleeve is in
    a drawdown the lot could not cover. That is a tripwire event, not a refill
    event: drop contract counts to what the cash supports (hedge rule
    $40k/contract, leap cap division) and read the sleeve-level section. CEFs
    falling while trading cash is above the line is nothing to act on; the
    account total can read lower for two different reasons, and only the
    cash case acts.

[^parking]: SGOV, or a ladder of 3–6 month bills. Does not move in a crash,
    sells at par, settles T+1. The cost is Treasury yield instead of whatever
    the money would earn deployed, on money the sleeve is not yet allowed to
    trade: roughly $2,500 on a $50k conversion that waits a year. Trading cash
    is never topped up directly by a conversion; it is sized by contract
    count, and the lot feeds it when a review raises contracts.

[^vol-margin]: Collateral scales with the index level and with vol: delta-set
    strikes sit further from spot when either rises, so width and margin rise
    with both (see the margin notes in `../CLAUDE.md`).

[^transition]: Schwab, 2026-10-24: cash $35,637 of $81,472, about $45,800 in
    CEFs, no Treasuries, one leap open. Trading cash is $12,400 under the
    $48,000 target and $4,400 under the $40,000 line. Seed the lot without
    selling CEFs: the 2026 Roth contribution ($8,600, from the taxable pot, on
    2026 wages, due by April 2027; conversion income does not count toward
    the contribution income test) bought as SGOV lifts cash + bills to about
    $44,200, above the line. The rest of the gap closes with the first 2027
    conversion. Until then the leap cap stays at 2 only if cash can carry a
    second entry; if it cannot, run the cap at 1 rather than sell CEFs.

[^ratchet]: An options book underperforming is evidence the edge stopped
    working, not a discount. Profits come out to the other sleeves on gains;
    nothing goes back in on losses.

[^succession]: `decisions.md` 2026-10-05. Schwab's API needs weekly re-auth,
    so entries stop on their own if nobody shows up. The condor and hedge are
    flat at 16:00; the stranded exposure is the premium of up to two open
    LEAPs, long options that can at worst expire worthless. The family action
    is "stop entries", never "close positions". Watch the overnight share of
    the sleeve, not contract count.

[^only-roth]: Decided 2026-10-25. Hilary's Roth, her IRA and the taxable pot
    stay in managed money. The sleeve's capital grows only from Ken's
    conversions (about $50k a year to 2033), his Roth contributions from
    wages, and its own compounding. So a good run raises the contract count
    inside one account rather than opening new ones; the sizing question at
    each review is whether the return is holding as the count grows, not
    where the next money comes from.
