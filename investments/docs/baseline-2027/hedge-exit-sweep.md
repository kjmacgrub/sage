# Long Put Hedge exit sweep (2026-10-16)

Companion to `cic-stop-loss-sweep.md`. The hedge has no percentage stop loss: its loss is
capped by structure (long 5-delta put, 50-delta call credit spread 15 wide; worst trade
-$462 per contract over the history). The two exits that do the stop's job are what the
optimizer can vary:

- **Delta exit**: close when the short call's delta reaches -65 (the market reversed up).
- **VIX fade exit**: close when VIX has fallen 2% from its level at entry (the selloff is over).

Range is the saved 2022-05-16 to 2026-10-14. It cannot go back to 2017 like the CIC: the
hedge needs daily SPX 0DTE expirations, which only began in May 2022.

**Result: the saved -65 / 2% is the best cell on every metric.** Nothing to change.

## Method

1. Optimizer grid: delta exit -55 to -100 by 5, VIX fade 0.5% to 5% by 0.5%, 100 cells.
   Raw grid in `hedge_exit_grid.csv`. Cell CAGR and drawdown are sizing-noisy (the saved
   backtest compounds at $45k per contract, cap 3); average P/L per contract is the
   robust read. Every cell takes the same 430 trades, so the exits only change how each
   trade ends.
2. Four cells re-run as fixed 1-contract backtests for the per-year view.

## Average P/L per contract from the grid ($)

| delta \ VIX fade | 1.0 | 1.5 | 2.0 | 2.5 | 3.0 | 3.5 | 4.0 | 5.0 |
|---|---|---|---|---|---|---|---|---|
| -55 | 18 | 20 | 21 | 19 | 19 | 19 | 20 | 20 |
| -60 | 69 | 69 | 79 | 76 | 73 | 73 | 74 | 73 |
| **-65** | 88 | 83 | **95** | 88 | 84 | 85 | 85 | 83 |
| -70 | 84 | 76 | 89 | 83 | 74 | 75 | 71 | 71 |
| -75 | 82 | 75 | 92 | 80 | 72 | 73 | 69 | 78 |
| -80 | 82 | 74 | 89 | 73 | 69 | 69 | 68 | 85 |
| -90 | 78 | 73 | 87 | 67 | 61 | 61 | 64 | 86 |
| -100 (off) | 78 | 76 | 88 | 64 | 59 | 55 | 52 | 67 |

A VIX fade of 0.5% (not shown) kills the edge in every row (about $40 per contract): it
closes the trade before the selloff has paid. The plateau is wide on the loose side:
delta -65 to -100 at a 2% fade all land between $87 and $95. The cliff is on the tight
side: -60 drops to $79 and -55 to about $20, because a 55-delta exit fires on ordinary
intraday noise and closes the position before the put has done anything.

## Fixed 1-contract comparison, $80k, 2022-05-16 to 2026-10-14

| delta / VIX fade | profit | CAGR | max DD | MAR | avg loss/ct | worst trade/ct |
|---|---|---|---|---|---|---|
| **-65 / 2.0 (current)** | **$40,642** | 9.74% | **-5.05%** | **1.93** | -$271 | -$462 |
| -100 / 2.0 (delta exit off) | $37,640 | 9.12% | -6.80% | 1.34 | -$342 | -$1,039 |
| -65 / 3.5 | $36,496 | 8.88% | -6.37% | 1.39 | -$300 | -$507 |
| -75 / 2.5 | $34,330 | 8.42% | -6.94% | 1.21 | -$358 | -$682 |

P/L by year, 1 contract ($):

| delta / VIX fade | 2022 | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|
| -65 / 2.0 | 4,236 | 7,293 | 11,654 | 11,969 | 5,491 |
| -100 / 2.0 | 1,190 | 7,675 | 8,897 | 12,065 | 7,814 |
| -65 / 3.5 | 4,792 | 5,446 | 12,233 | 9,248 | 4,776 |
| -75 / 2.5 | 4,653 | 4,719 | 10,554 | 9,529 | 4,877 |

## Reading

- The current exits win on profit, drawdown and MAR, and are positive every year. No
  alternative is better in more than one year.
- Turning the delta exit off (-100) is the only interesting alternative: it does best in
  2026 and ties 2025, because this year's selloffs reversed hard intraday and the delta
  exit closed some winners early. It pays for that in 2022 and 2024 and more than doubles
  the worst trade. Not worth it.
- The risk to the setting is on the tight side. If the live fills show the delta exit
  firing more often than the model (the short call reaching -65 on noise), the loss is
  large: -60 gives up a sixth of the edge and -55 almost all of it. Watch the exit reason
  in the live log, not just the P/L.
