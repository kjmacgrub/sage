# Options sleeve — action sheet

One page of steps. Every number has a footnote; the notes (page 2 on) carry
the reasoning and the worked examples. Dated reasons live in `decisions.md`,
traps in `../CLAUDE.md`. Rewritten 2026-11-11.[^status]

## The account shape · redo every month

1. **Loss I can bear** = 22% × account → **$18k** on $80k.[^bearable]
2. **Contracts** whose measured worst drop fits inside line 1, and that have
   passed a review → **condor 1 · hedge 2 · leap 1 open**.[^contracts]
3. **Cash** = highest collateral for those contracts + $6k for a bad day →
   $15k + $3k + $6k = **$24k**. No leap open → add the price of one.[^cash]
4. **Treasuries (SGOV)** = the rest of line 1 ($18k − $6k = $12k) + money
   waiting for the next contract → **$29k**.[^sgov]
5. **Index fund** = account − open leap − cash − SGOV → **$20k**.[^index]

Not there yet: on 11/10 cash $41k, CEFs ~$32k (retired, to be sold), the
leap ~$6k, no SGOV.[^transition]

## Warning levels

A warning level is a number that says something may be broken. Crossing one
is not a signal to trade; it is a signal to stop and look.[^warning]

- Account more than **22% below its high** ($18k on $80k).
- Condor: average profit per trade under **$35** over three months (expected $70).
- Hedge: average profit per trade under **$48** for a year (expected $97).
- Condor or hedge fills worse than **15¢ a leg** from the mid.
- **One crossed** → find the cause before the next review; nothing is raised.
- **Two crossed** → nothing is raised and no new money goes into the sleeve
  until both are back inside.
- A strategy with **two losing years in a row** gets no more contracts.

## Weekly · Friday · step 1 before 4pm · 10 min

1. **Before 4pm:** read the cash balance at Schwab. Under **$21k** → sell
   SGOV to bring it back to $24k. $21k or more → nothing to do.[^line]
2. **After the close:** export four files, each for Monday → Friday: OO
   trade log + portfolio CSV (`2027` portfolio, sized to what live traded);
   autotrader strategy log; Schwab transactions.[^weekly-files]
3. Drop all four on **Sage › Investments › Options › Live vs Backtest**.
4. Read in order: live − backtest tile → flagged rows → stop fill vs 3×
   trigger → entry credit live − test → Schwab SPX cash = live SPX
   total.[^weekly-read] Then **Open positions**: the leap, its cost, days held.
5. Any `manual exit` flag → tick *Exclude manual exits*.
6. One line in `decisions.md` only if something is outside the usual
   range.[^tolerances]

## Monthly · first trading day · 20 min

Nothing goes up here except the condor, and only at step 3.

1. Redo the account shape with today's account value. Move money to match:
   cash above $24k → SGOV.
2. **Condor:** closed profit over the last three calendar months ÷ number of
   trades, mechanical exits only. Under $35 → a warning level.[^condor]
3. **Condor to 2?** All three: that three-month profit is above zero ·
   account at least **~$108k** · $15k more cash moved in first.[^condor-size]
4. **Leap:** `0.22 × account ÷ price of one contract`, rounded down.[^price]
   Lower than the number you run → lower it today. Higher → wait for the
   annual.[^lower-only]
5. **Leap fills:** for any leap bought or sold, log the mid and the price
   paid.[^veto-fills]
6. **Collateral:** the highest condor and hedge collateral in the month's
   live trades. Above $15k / $3k → raise line 3.[^vol-margin]
7. Type Fidelity's 1M return into **Sleeve vs Fidelity
   managed**.[^monthly-fidelity]
8. Read the warning levels.

## Annual · 1 hour

The only review where the leap can go up.

1. Re-measure the worst drop with a portfolio backtest at today's contract
   counts.[^buffer-test]
2. **Leap:** redo the division with year-end numbers. Choose the bear:
   2022-type → divide by the price; 2000-type → divide by 2.6 × the
   price.[^bear]
3. Account below its high → **no raise** of anything.[^veto-dd]
4. Leap fill gap averaging over **$13 a share** ($1,300 a contract) per
   side → **no leap raise**.[^veto-fills]
5. Leap goes up **one slot a year at most**. Two open also needs an account
   of **~$109k**.[^leap-two]
6. **Hedge:** nothing to decide. It follows the account, one contract per
   **$40k**, no cap (3 at $120k).[^hedge]
7. **Condor to 3:** only after a positive live year.
8. Profits come out to the other sleeves; nothing goes back in after
   losses.[^ratchet]
9. For any raise: move the cash from SGOV first, then change the setting on
   live and test together.
10. Record in `decisions.md`: account, contract price, the division, the
    bear chosen, both leap checks, the measured worst drop, the counts set.

## Cash and Treasuries[^floor]

- SGOV empty and cash under $21k → cut contracts to what the cash carries.
  **Do not sell the index fund to keep trading.**[^never-index]
- Conversion or contribution lands → SGOV, not cash (next: the 2026 Roth
  contribution, **$8,600**, due by April 2027).[^parking]

## Standing rules

- The sleeve trades Ken's Schwab Roth only.[^only-roth]
- Overnight exposure is the price of the one open leap.[^succession]

[^status]: First written 2026-10-22 (leap) and 2026-10-24 (cash). Rewritten
    2026-11-11 to match the decisions of 11-10 and 11-11: the account shape
    starts from the bearable loss, the CEF sleeve is retired, the leap is held
    at one open, cash is sized from the collateral live trades actually
    used, and the reviews are weekly, monthly and annual (no quarterly). The word "tripwire" in older notes means a warning level.

[^bearable]: 22% is your own figure for the most you are willing to see the
    sleeve fall from its high. Everything below it on the sheet is sized so a
    bad run stays inside it. If the measured worst drop is bigger than this
    line, the choices are fewer contracts or a larger stated loss, decided on
    purpose and written down.

[^contracts]: "Measured worst drop" is the largest fall from a high to the
    following low in a portfolio backtest at these exact counts (see the
    annual step 1). Measured 2026-11-10, May 2022 → Nov 2026: one condor with
    two leaps open **$24.0k**; two condors with two leaps open **$30.5k**.
    About $16k of each is two leaps bought near the QQQ high in June 2026.
    With one leap open, measured 2026-11-11 (May 2022 → 2026-11-10): **$16.3k**
    at one condor and **$23.7k** at two, both from the June 2026 high to
    2026-11-02. So the counts
    that fit $18k today are condor 1, hedge 2, leap 1 open. Leap held at one
    open from 2026-11-11; `maxOpenTrades` is 1 on live and on the saved test.

[^cash]: Cash is sized so that any trade the strategies can place today is
    already covered; SGOV never funds a same-day trade, because a sale
    settles the next business day. SGOV only refills cash after losses have
    used up the slack. A leap entry fires without warning at 15:30 and is
    paid for in full (about $8,500), so whenever no leap is open that amount
    waits in cash too, not in SGOV (added 2026-11-12). Only cash can secure
    an option trade. From the live trades through
    2026-11-06: the condor held $10,000 on an ordinary day and $15,000 at
    most (the wings are capped at 150 points, so that is the ceiling for one
    contract); the two hedges held $3,000. The $6k on top is slack: the worst
    single day in the one-condor backtest this year was about $3,800, and
    without slack one losing day forces a Treasury sale the next morning just
    to place the trade. Schwab's sweep pays very little on this cash; that is
    the cost of being able to trade.

[^sgov]: SGOV is a fund of Treasury bills under three months: it does not
    fall in a crash and sells in a day. It holds two things. First, the rest
    of the bearable loss: $18k less the $6k already sitting in cash. Second,
    money that is not yet allowed to trade and is waiting for the next
    contract (about $17k today; a second condor needs $15k of cash). Holding
    the waiting money here rather than in the index fund means a raise never
    has to be funded by selling stocks after a fall.

[^index]: What is left once the open leap, the cash and the SGOV are
    counted. An S&P 500 index fund was the plan discussed on 2026-11-10; the
    fund and the date are not yet settled. It is not part of the option
    strategy and is never sold to refill trading cash.

[^transition]: Schwab, 2026-11-10: account $79,169; cash $41,083; CEFs about
    $31,984; one leap worth about $6,100 (Dec 2027 720 call, bought
    2026-10-16 for $8,433). To reach the shape: sell the CEFs (~$32k), buy
    ~$29k of SGOV and ~$20k of the index fund, leave ~$24k in cash. The CEF
    sleeve was retired as a strategy on 2026-11-10; the positions are held
    until sold.

[^warning]: The levels are half of what the honest backtest earned per trade
    in 2022–26 (condor $70, hedge $97), a fill cost at which the strategies
    stop paying (15¢ a leg), and the bearable loss. "Find the cause" means:
    was it one unusual day, a setting that changed, worse fills, or the
    strategy no longer working? The levels are absolute and never compared
    with how the other accounts are doing. The condor is the only fast
    signal, about 250 trades a year; the hedge needs a full year; the leap
    trades about three times a year and has no per-trade level at all, which
    is why its checks are the fill gap and the account high instead.

[^weekly-files]: Each upload is recognised by its header and replaces the
    same dates from last time, so re-dropping a week is safe. The week alone
    is enough for every file, Schwab included: earlier weeks stay stored, and
    the open leap is read from them. A wider range does no harm. The `2027` OO
    portfolio must be sized to the contracts live actually traded, or the
    comparison is against a different book.

[^weekly-read]: The tile is the week's gap. The flagged rows say which day
    made it and why. Live stop fills should stay well under the backtest's
    3× trigger. Entry credit live − test worse than 15¢ a leg is a warning
    level. Schwab's SPX cash and the live SPX total agree to the dollar on an
    all-0DTE week; the leap only reconciles when it is sold.

[^monthly-fidelity]: Use the **1M** button and read its window from the
    pencil beside the return (`From Sep-30-2026 to Oct-29-2026` is
    close-to-close, so the return covers Oct 1 → Oct 29). On the tab, start =
    the day after Fidelity's From date, end = its To date. A month is mostly
    the market; judge the table over several months, not one.

[^tolerances]: The 2026-10-24 week-one entry in `decisions.md` lists what an
    ordinary gap looks like (live −$393 against backtest +$724, all of it one
    day).

[^condor]: Count only trades that ran to their own exit; the manual exits
    are excluded because they are a different trade. OO writes three rows per
    condor (wings, put side, call side), so group them before counting or the
    trade count triples.

[^condor-size]: Size 1 since 2026-10-26. The test was first written as "a
    positive live calendar quarter"; checked monthly it is the last three
    full calendar months, the same amount of evidence (about 60 trades), with
    closed profit above zero on mechanical exits only. One good month is not
    enough: about 21 trades is mostly luck. The account figure: two
    condors with one leap open measured a $23.7k worst drop (2026-11-11), and
    $23.7k ÷ 0.22 = about $108k. With two leaps open it is $30.5k, about
    $139k. Live through 2026-11-06 the condor is at −$1,294 since
    August.

[^price]: Pull up the QQQ chain, the expiry nearest 360 days out, the call
    nearest 60 delta (strike about 0.975 × QQQ). Write down the ask. It runs
    about 13–14% of the QQQ price. Example, 2026-10-22: $80,000 × 0.22 =
    $17,600; contract $8,300; 17,600 ÷ 8,300 = 2.1 → 2.

[^lower-only]: Reducing risk never waits for the annual review. The division
    falls when QQQ has risen faster than the account: the same contracts are
    a bigger bet. Raising waits because a few months of leap results is noise at
    three trades a year. The division says 2 at $80k; you run 1 by choice
    (2026-11-11), which is allowed. The division only sets the most you may
    run.

[^veto-fills]: The gap is the difference between the mid price when the
    order went in and the price actually paid, on both the buy and the sell.
    At about $13 a share ($1,300 a contract) per side the strategy stops
    paying, so above that more contracts add cost, not profit; look at the
    execution settings in Option Omega (price increment, attempts, interval).
    **Where the numbers come from:** the price paid is in the Schwab upload.
    The mid is recorded nowhere, so rebuild it: a one-day Option Omega
    backtest of the leap on the entry date, no entry filters, zero slippage
    and fees, entry 15:30, `closeOpenTradesAtTestCompletion` on. Its fill is
    the 15:30 mid; confirm it picked the same strike and expiry as live.
    Claude can run this. First use, 2026-10-16: mid $83.72, paid $84.32, gap
    **$0.60**.

[^vol-margin]: Collateral grows with the index level and with volatility,
    because the condor's strikes sit further apart when either rises. A
    volatile year costs about 1.5× a calm one at the same SPX. Schwab holds
    the full width of the spread.

[^buffer-test]: One test on the whole portfolio, not one per strategy,
    because the strategies' bad stretches overlap. Option Omega portfolio of
    the three saved strategies (`IC`, `Long Put Hedge`, `QQQ Leap''`), funded
    at $80k, fixed contract counts as traded, margin requirements ignored,
    2022-05-16 → yesterday. Read the daily equity curve, not the trade log:
    the worst drop is the largest fall from any high to the low that follows
    it, in dollars. Claude can run it; it takes a few minutes. Before 2022-05
    the hedge was a different instrument, so the window starts there.

[^bear]: The division assumes a bad year looks like 2022: each contract
    loses its full price once, then the 200-day filter keeps you out. A
    2000–2002 bear is different: the market rallies back above the 200-day
    each winter, you re-enter, and each slot loses its full price about two
    and a half times. At a contract price of $8,300 the account needed is:
    1 open → $38,000 (2022-type) / $98,000 (2000-type); 2 open → $75,000 /
    $196,000; 3 open → $113,000 / $294,000.

[^veto-dd]: If the account is below its highest value, nothing is raised
    this year whatever the arithmetic says. Lowering is always allowed.

[^leap-two]: Two tests, and both must pass. The division (step 2) budgets
    for the leap's loss alone. The measured worst drop counts the leap and
    the condor falling together: $24.0k with two leaps and one condor, and
    $24k ÷ 0.22 = about $109k. A slot added during a fall or on poor fills is
    the one that hurts, so never two slots in a year.

[^hedge]: Ken, 2026-11-11: the hedge trades one contract for every $40k of
    account and is not capped, so it goes up by itself as the account grows
    and is never a review decision. Measured the same day: with the hedge
    growing from 2 to about 8 contracts the worst drop was $28.4k against
    $16.3k with it fixed at 2, roughly $2k per extra contract, while each
    $40k of account adds $8.8k of bearable loss. So the rule stays inside the
    22% line as it scales. The hedge earns its place in a 2022-type year (+34% for the book
    against 17.9% without it), on an instrument that has existed only since
    2022-05-11, so that is one example, not a pattern. It does not reduce the
    worst drop. Each contract holds $1,500 of collateral. Its backtest
    figures from before 2022-05-11 are a different instrument and read badly;
    ignore them.

[^ratchet]: An options book that is losing is evidence the edge may have
    stopped working, not a bargain. Profits move out on gains; nothing moves
    back in on losses.

[^floor]: A loss comes out of the same cash that secures the trades. Once it
    is gone Schwab rejects the next order and the autotrader logs a skipped
    entry, a quiet way to drift from the backtest. This rule only keeps the
    autotrader able to place the next order; whether the strategies still
    work is the warning levels' job.

[^line]: One look a week is enough: the worst week in the 2026 one-condor
    backtest took about $3,900 out of cash, inside the $6k of slack. No daily
    check. $21k is the $18k of collateral plus half the slack, so a single bad
    day does not trigger a sale but two do. Proposed 2026-11-11, replacing
    the old $40k line that was sized for two leaps and CEFs.

[^never-index]: SGOV empty and cash still short means the sleeve has lost
    more than the bearable loss. That is a warning level, not a refill: drop
    the counts to what the cash supports and read the warning levels. Selling
    the index fund to keep trading would be adding money back after losses.

[^parking]: New money waits in SGOV until a review raises a contract count.
    Trading cash is sized by contracts alone and is never topped up directly
    by a conversion.

[^only-roth]: Decided 2026-10-25. Hilary's Roth, her IRA and the taxable pot
    stay in managed money. The sleeve grows only from Ken's conversions, his
    Roth contributions from wages, and its own profits.

[^succession]: `decisions.md` 2026-10-05. Schwab's connection needs a weekly
    sign-in, so entries stop on their own if nobody shows up. The condor and
    hedge are closed by 16:00 every day; what stays open is one leap, a
    bought option that can at worst expire worthless. The family action is
    "stop entries", never "close positions".
