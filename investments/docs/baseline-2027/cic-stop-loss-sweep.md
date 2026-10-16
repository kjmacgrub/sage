# CIC - 10am stop-loss sweep (2026-10-16)

Question: is 200% / 200% (put side / call side) the best stop for the CIC, judged on
drawdown and P/L, over the full 2017-05-16 to 2026-10-15 history?

Answer: 200/200 is already on the plateau. The one change worth considering is widening
the **put** stop to 300% and leaving the call at 200%. Nothing else beats it on both axes.
Not adopted in the saved 2027 baseline; recorded here for a later decision.

## Method

1. Optimizer grid on the saved CIC backtest (id 5aargokIPaskkxi3VTma): put stop x call
   stop, 50% to 500% in 50% steps, 100 cells, full range. Raw grid in
   `cic_stop_loss_grid.csv`. The saved backtest compounds (Capital Per Contract $45k,
   cap 7), so cell-level CAGR and drawdown are noisy: the contract count path changes
   with every stop. Example: 200/200 shows -13.3% drawdown while its four neighbours show
   -19% to -21%. That is sizing noise, not signal. The per-contract average P/L column
   is the robust read.
2. Ten candidates re-run as individual backtests at a fixed 1 contract, $80k, same
   range, to get a clean per-year and per-regime comparison.

## Per-contract edge from the grid (avg P/L per contract, $)

| put \ call | 50 | 100 | 150 | 200 | 250 | 300 | 350 | 400 |
|---|---|---|---|---|---|---|---|---|
| 200 | 11.0 | 10.5 | 11.4 | **12.8** | 12.2 | 12.8 | 11.8 | 10.8 |
| 250 | 10.8 | 10.3 | 11.2 | 12.6 | 12.0 | 12.6 | 11.7 | 10.6 |
| 300 | 12.3 | 11.7 | 12.7 | **14.0** | 13.5 | 14.1 | 13.1 | 12.1 |
| 350 | 12.9 | 12.3 | 13.2 | 14.6 | 14.1 | 14.7 | 13.7 | 12.7 |
| 400 | 12.2 | 11.6 | 12.6 | 13.9 | 13.4 | 14.0 | 13.0 | 12.0 |
| 450 | 9.8 | 9.2 | 10.1 | 11.5 | 11.0 | 11.6 | 10.6 | 9.5 |

Put side peaks at 350, falls off a cliff above 400. Call side peaks at 200 and 300; a call
stop of 400% or more admits a single -$8,340 trade (worst loss per contract jumps from
about -$4,400 to -$8,340 in every row).

## Fixed 1-contract comparison, $80k, 2017-05-16 to 2026-10-15

| put/call | profit | CAGR | max DD | MAR | avg loss/ct | losing years | worst year |
|---|---|---|---|---|---|---|---|
| 300/200 | $80,023 | 7.63% | -7.19% | 1.06 | -$240 | 1 | -$939 (2018) |
| 200/200 (current) | $72,852 | 7.11% | -7.95% | 0.89 | -$223 | 0 | +$33 (2018) |
| 350/200 | $83,408 | 7.87% | -9.03% | 0.87 | -$245 | 2 | -$1,063 |
| 300/250 | $76,973 | 7.41% | -9.10% | 0.81 | -$251 | 2 | -$2,441 |
| 300/300 | $80,166 | 7.64% | -9.47% | 0.81 | -$259 | 2 | -$665 |
| 300/50 | $70,092 | 6.90% | -8.79% | 0.79 | -$172 | 1 | -$2,091 |
| 250/200 | $71,689 | 7.02% | -9.34% | 0.75 | -$234 | 1 | -$835 |
| 350/300 | $83,550 | 7.88% | -11.04% | 0.71 | -$264 | 3 | -$3,406 |
| 350/50 | $73,476 | 7.16% | -10.31% | 0.69 | -$176 | 2 | -$2,216 |
| 400/200 | $79,521 | 7.60% | -13.37% | 0.57 | -$252 | 3 | -$4,488 |

P/L by year, 1 contract ($):

| put/call | 2017 | 2018 | 2019 | 2020 | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|---|---|
| 300/200 | 1,003 | -939 | 4,986 | 5,474 | 2,920 | 13,327 | 13,860 | 16,722 | 18,934 | 3,735 |
| 200/200 | 1,019 | 33 | 4,095 | 1,836 | 5,563 | 12,459 | 10,190 | 14,225 | 21,553 | 1,879 |
| 350/200 | 14 | -1,063 | 5,071 | 9,363 | -160 | 16,974 | 10,840 | 19,024 | 22,963 | 381 |

Regime sums ($, 1 contract) and worst drawdown inside the regime:

| put/call | 2017-19 low vol | 2020-21 covid / melt-up | 2022-23 bear / hikes | 2024-26 recent |
|---|---|---|---|---|
| 300/200 | 5,050 (-7.2%) | 8,395 (-6.4%) | 27,187 (-5.8%) | 39,391 (-6.3%) |
| 200/200 | 5,146 (-6.3%) | 7,399 (-8.0%) | 22,649 (-6.5%) | 37,657 (-5.0%) |
| 350/200 | 4,022 (-9.0%) | 9,203 (-7.8%) | 27,814 (-6.2%) | 42,368 (-7.5%) |

## Reading

- 300/200 beats 200/200 in 7 of 10 years and in all four regimes on profit, with a
  shallower overall drawdown. The cost is 2018 (-$939 vs +$33) and a slightly larger
  average loser. Both are inside noise for a single contract.
- Wider put stops (350, 400) earn more in 2020 and 2022 but pay for it in 2018 and 2021
  with bigger drawdowns. The 2017-2019 low-premium regime punishes any put stop above 300.
- A tight call stop (50%) looks attractive on average loser size but gives up most of the
  2022-2023 edge, when the call side was getting tested and recovering intraday.
- The improvement is about +$1.26 per contract per trade (12.78 to 14.04), roughly 10%
  of the CIC's edge. In the live portfolio at 2 to 6 contracts that is real but modest.

## If adopted

Edit the saved CIC backtest's Put group stop to 300% (call stays 200%), re-run the saved
2027 portfolio, and replace `equity_2027_baseline.csv` and the README numbers so the
model keeps describing what is traded live. Change the live Trade tab to match on the
same day.
