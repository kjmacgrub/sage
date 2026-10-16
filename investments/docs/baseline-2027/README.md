# 2027 portfolio baseline (decided 2026-10-15)

Option Omega saved portfolio "2027", id QIS1X8BW7HaDIcWhbyKE.
Range 2022-05-16 to 2026-10-14, $80,000 starting funds, open trades left open.

| Strategy | Capital Per Contract | Max contracts |
|---|---|---|
| CIC - 10am | $29,000 | 6 |
| Long Put Hedge | $32,000 | 3 |
| QQQ Leap'' | $42,000 | 1 |

Result: ending $589,226, CAGR 56.9%, max DD -12.12% (2022-11-04), MAR 4.69, Sharpe 1.74.

Why caps: uncapped Capital Per Contract keeps risk a constant share of equity, so
late-year drawdowns stay 12-15%; caps de-lever as the account grows (2026 DD 5.8%)
at the cost of ending value. Chosen 2026-10-15 to hold until proved out live for a
year or two. The caps cannot be set in the live Trade tab, hence the two manual
switches to Fixed Quantity above.

Live equivalents: Leap = Fixed Quantity 1 from day one. Hedge = Capital Per Contract
$32k, switch to Fixed Quantity 3 at ~$128k equity. CIC = Capital Per Contract $29k,
switch to Fixed Quantity 6 at ~$203k equity.

Files: equity_2027_baseline.csv (daily net liquidity, P/L, drawdown of this baseline),
equity_2027_80k_uncapped.csv (same portfolio with percentage sizing and no caps, for
reference), equity_2027_compare.html (chart of both), make_chart.py (regenerates it:
`python3 make_chart.py out.html "Label=file.csv" ...`).
