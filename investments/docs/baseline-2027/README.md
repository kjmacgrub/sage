# 2027 portfolio baseline (decided 2026-10-15, hedge uncapped late that evening)

Option Omega saved portfolio "2027", id QIS1X8BW7HaDIcWhbyKE.
Range 2022-05-16 to 2026-10-14, $80,000 starting funds, open trades left open.

| Strategy | Capital Per Contract | Max contracts |
|---|---|---|
| CIC - 10am | $29,000 | 6 |
| Long Put Hedge | $50,000 | none |
| QQQ Leap'' | $42,000 | 1 |

Result: ending $741,309, CAGR 65.3%, max DD -11.51% (2022-11-04), MAR 5.67, Sharpe 1.68, Sortino 4.05.

Why caps on the CIC and leap: uncapped Capital Per Contract keeps risk a constant
share of equity, so late-year drawdowns stay 12-15%; caps de-lever as the account
grows at the cost of ending value. Chosen 2026-10-15 to hold until proved out live
for a year or two. Caps cannot be set in the live Trade tab, hence the manual switch
to Fixed Quantity on the CIC.

Why the hedge is uncapped: it pays in selloffs, so more hedge contracts cushion the
drawdowns the CIC and leap create. Its worst loss is ~$462 per contract, so 20
contracts on $1M is a ~1% worst entry. With CIC and leap at baseline: hedge cap 3 =
CAGR 56.9% / DD -12.12%; hedge $32k uncapped = 75.8% / -12.90%; hedge $50k uncapped
= 65.3% / -11.51% (chosen: more return AND less drawdown than the cap, and no live
switch). Example: 2026-06-05, SPX -1.6% after the 11:23 entry, the 0DTE 7430 put
went from $0.90 to ~$46; ~$5,170 per contract.

Live equivalents: Leap = Fixed Quantity 1 from day one. Hedge = Capital Per Contract
$50k, set once, never switched (1 contract at $80k, 2 at $100k, 10 at $500k, 20 at $1M).
CIC = Capital Per Contract $29k, switch to Fixed Quantity 6 at ~$203k equity (treat as a
review of live data, not a mechanical flip).

Files: equity_2027_baseline.csv (daily net liquidity, P/L, drawdown of this baseline),
equity_2027_80k_uncapped.csv (same portfolio with percentage sizing and no caps, for
reference), equity_2027_compare.html (chart of both), make_chart.py (regenerates it:
`python3 make_chart.py out.html "Label=file.csv" ...`).

## Leap sizing rule

The leap's drawdown is set by the premium at risk when a crash hits:

    open positions (typically 3) x contracts x premium (~$5-7k), marked down 85-90%

Keep that at roughly 8-10% of equity, which works out to about one contract per
$180-200k of equity. Sweep with everything else at baseline (2026-10-15):

| Leap cap | CAGR | Max DD | Apr 2025 DD | Leap profit | Ending |
|---|---|---|---|---|---|
| 1 (saved) | 56.9% | -12.1% | -11.4% | $61k | $589k |
| 2 | 60.3% | -12.5% | -12.5% | $122k | $650k |
| 3 | 63.4% | -15.0% | -15.0% | $183k | $711k |

At cap 2 the April 2025 exposure was 6 contracts, ~$33k on $390k of equity (8.5%).
The backtest flatters early leap size because the crash arrived when equity was
large; a 2025-style crash with 2 contracts at ~$100k would have cost closer to 30%.
Use the exposure rule for timing, not the table.

Review points (leap stays on Fixed Quantity; each step is a review of live data):

| Equity | Leap contracts |
|---|---|
| under ~$200k | 1 |
| ~$200k to $400k | 2 |
| ~$400k and up | 3 |

Max drawdown comfort line: ~12%.
