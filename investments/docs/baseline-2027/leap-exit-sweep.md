# QQQ Leap'' stop-loss and exit sweep (2026-10-16)

Companion to `cic-stop-loss-sweep.md` and `hedge-exit-sweep.md`. The leap buys a 60-delta,
360-day QQQ call at 15:30 on any day QQQ falls 1.75% or more while above its 200-day
average. Exits: 80% profit target, forced close at 7 DTE. No stop loss. Saved range
2022-05-16 to 2026-10-14, 15 trades, all winners, 3 still open. Sizing is a flat 1
contract, so there is no compounding noise in these numbers.

**Result: leave it alone.** A stop loss of any size loses money and deepens the
drawdown. A higher profit target adds a little on paper but on 15 trades it is a
handful of 2024 trades, not a finding.

## Stop loss added (single runs, saved settings otherwise)

| stop | profit (closed) | CAGR | max DD | trades | win % | 2025 | 2026 |
|---|---|---|---|---|---|---|---|
| none (saved) | $60,959 | 13.0% | -14.6% | 15 | 100 | +16,321 | +10,669 |
| 75% | $34,959 | 7.8% | -21.3% | 15 | 80 | -9,679 | +10,669 |
| 50% | $31,070 | 7.2% | -17.2% | 18 | 67 | -5,576 | +7,736 |
| 35% | -$485 | -0.1% | -25.2% | 21 | 38 | -4,995 | -19,149 |
| 25% | -$14,237 | -4.3% | -24.2% | 26 | 19 | -4,315 | -15,358 |

Every stop converts the April 2025 and early-2026 drawdowns from paper losses that
recovered into realized ones, then re-enters on the next signal near the low and gets
stopped again. The drawdown gets worse, not better, because the stop fires at the bottom
and the re-entry is what carries the recovery. A one-year 60-delta call survives a 20%
QQQ drawdown; this strategy's whole edge is holding through it.

## Exit grid: profit target 20% to 200% by 20, exit DTE 7 to 187 by 20

Raw grid in `leap_exit_grid.csv`. Highlights (CAGR / max DD / closed trades):

| profit target | exit DTE 7 (current column) | exit DTE 47 | exit DTE 87 | exit DTE 187 |
|---|---|---|---|---|
| 60% | 10.0 / -15.6 / 15 | 10.0 / -15.6 / 15 | 9.9 / -15.6 / 15 | 7.9 / -15.6 / 15 |
| **80% (saved)** | **13.0 / -14.6 / 15** | 13.0 / -14.6 / 15 | 12.6 / -14.6 / 15 | 10.4 / -14.6 / 15 |
| 100% | 13.8 / -16.9 / 13 | 13.8 / -16.9 / 13 | 13.1 / -16.9 / 13 | 10.9 / -16.9 / 13 |
| 120% | 14.6 / -14.9 / 12 | 15.0 / -14.9 / 12 | 13.7 / -14.9 / 12 | 11.6 / -14.8 / 13 |
| 140% | 15.2 / -17.1 / 11 | 15.6 / -17.1 / 11 | 14.6 / -17.1 / 11 | 13.5 / -14.1 / 13 |
| 200% | 14.8 / -16.3 / 7 | 16.5 / -16.6 / 8 | 16.3 / -17.1 / 11 | 14.9 / -13.9 / 13 |

- Exit DTE does nothing below about 100 days: every trade hits its target first. Past
  that it only shortens the hold and gives up profit, and at 167+ it starts booking
  losers (92% win rate, worst -$1,234).
- Max drawdown is the same down every column for a given target: it is the April 2025
  mark-to-market on open positions, and no exit rule touches it. Only sizing does (see
  the leap sizing rule in README.md).
- Raising the target from 80% to 120-140% adds 2 points of CAGR and $10-15k of closed
  profit, but closes 3-4 fewer trades. With Max Open Trades at 3, a position waiting for
  a bigger target blocks the next signal. The gain comes from a few 2024 trades that ran;
  it would not have shown up in 2022-2023 and is not worth changing a 15-trade strategy
  for.

## Note on the saved model

The saved leap has **Max Open Trades = 3**. The live intent recorded on 2026-10-15 was no
open-position cap, with exposure building through concurrent positions. One of the two
should change so the model describes what is traded.
