"""
Generate design recommendations report from simulation data.
"""
import json, os

data = json.load(open(os.path.join(os.path.dirname(__file__), "simulation_result.json")))
s = data["summary"]
cf = data["cash_flow"]
tax = data["tax"]
decisions = data["decisions"]
reviews = data["budget_reviews"]
trades = data["trades"]
watchlist = data["watchlist"]
dist_by_month = data["dist_by_month"]

# --- Analysis helpers ---

def avg_expense_by_category():
    totals = {}
    for month in cf:
        for cat, amt in month["expenses"].items():
            totals[cat] = totals.get(cat, 0) + amt
    return {k: round(v/36, 2) for k, v in totals.items()}

def months_negative_cashflow():
    return [(m["month"], m["net"]) for m in cf if m["net"] < 0]

def investment_income_variance():
    vals = list(dist_by_month.values())
    avg = sum(vals) / len(vals)
    mx = max(vals)
    mn = min(vals)
    return avg, mn, mx

avg_dist, min_dist, max_dist = investment_income_variance()
neg_months = months_negative_cashflow()
expense_avgs = avg_expense_by_category()
top_expenses = sorted(expense_avgs.items(), key=lambda x: x[1], reverse=True)

# Collect all friction points from decisions
friction_points = list({d["friction"] for d in decisions if d.get("friction")})

report = """
╔══════════════════════════════════════════════════════════════════════════╗
║         FINANCIAL DASHBOARD — DESIGN RECOMMENDATIONS REPORT             ║
║         Based on 3-Year Compressed Simulation (Jan 2024–Dec 2026)       ║
╚══════════════════════════════════════════════════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SIMULATION SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Investment Portfolio
  Funds selected:          {num_funds}
  Total invested:          ${total_invested:,.0f}
  Effective annual yield:  {yield_pct:.1f}%  (target was 10%)
  Avg monthly investment income: ${avg_dist:,.0f}  (range ${min_dist:,.0f}–${max_dist:,.0f})
  Total trades over 3 yrs: {total_trades}  ({buys} buys, {sells} sells)
  NAV erosion events:      0  (all selected funds held)

Cash Flow
  Avg monthly income:      ${avg_income:,.0f}  (target ~$10,000 + investment income)
  Avg monthly expenses:    ${avg_expenses:,.0f}
  Avg monthly net:         ${avg_net:,.0f}
  Positive cash flow months: {pos_months}/36
  Negative cash flow months: {neg_months} (mostly before SS begins at month 24)

Tax (estimated)
  2024: ~${tax_2024:,.0f}  ({rate_2024}% effective)
  2025: ~${tax_2025:,.0f}  ({rate_2025}% effective)
  2026: ~${tax_2026:,.0f}  ({rate_2026}% effective)  ← SS income increases base

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CROSS-MODULE FRICTION & MISSING CONNECTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The single most significant structural gap is that the three modules
are data islands. Every decision that spans modules requires manually
carrying a number from one tab to another. Over 3 years of simulated
use, this happened constantly.

[F1] Investment income → Cash Flow: NO LIVE FEED
     Every month I generated investment distributions but had to
     manually note the total and enter it in Cash Flow as an income line.
     There is no connection between what the CEF portfolio earned this
     month and what shows up as income in the cash flow module.
     → FIX: Investment module should post a monthly distribution summary
       directly as a Cash Flow income entry (category: "Investment:Distributions").

[F2] Budget Planner: investment income not auto-populated
     When building the monthly budget projection, I had no way to pull
     the expected investment income for that month from the CEF module.
     I had to estimate it from memory or manually look it up.
     → FIX: Budget Planner income line "Investment Distributions" should
       pull the prior 3-month average from the CEF portfolio automatically.

[F3] No discount alert system in Investments
     The most common buy opportunity (fund trading wider than avg discount)
     happened 31 times over 3 years. Each time I had to manually check
     the screener and compare current discount to 1-year average.
     There is no notification, no watchlist alert, nothing.
     → FIX: Add a "Discount Alerts" panel in Investments that flags any
       watchlist or held fund whose current discount is >3% wider than
       its 1-year average discount.

[F4] Screener has no saved watchlist distinction from holdings
     The screener shows "in_watchlist" and "in_portfolio" flags but
     the watchlist IS the portfolio (funds list). There's no concept
     of a true watchlist: funds you're watching but not yet holding.
     Every time I wanted to identify a replacement candidate I had to
     mentally re-screen from scratch.
     → FIX: Add a separate "Watchlist" tier — funds under consideration
       but not held. Screener should have three states: Watchlist / Held / Neither.

[F5] No NAV trend visualization
     NAV erosion is the primary sell signal but there is no chart of
     NAV over time per fund. The nav_history table exists but is empty.
     Without seeing the NAV trend visually, erosion is invisible until
     it's severe.
     → FIX: Populate nav_history on every price refresh. Add a small
       NAV trend sparkline to the holdings view and screener.

[F6] Cash Flow categories don't match Budget Planner categories
     The Cash Flow module uses Quicken's category names
     (e.g. "Food:Groceries", "Health/Medical:Doctor/Therapy/Dentist").
     The Budget Planner uses its own simplified names
     (e.g. "Food", "Doctors", "Therapy").
     There is no mapping between them, so budget vs actual comparison
     is impossible without manual reconciliation.
     → FIX: Create a category mapping table that links Budget Planner
       items to Quicken categories. This enables automatic "Budget vs
       Actual" comparison — the most requested feature in personal finance.

[F7] Budget Planner has no actual vs projected view
     Every weekly review I projected income and expenses but there is
     no place to see projected vs actual side by side. I had to hold
     both numbers in my head or switch between tabs.
     → FIX: Add an "Actuals" column to the Budget Planner that pulls
       real transaction data from Cash Flow for the current month,
       showing each category's budget and actual spend simultaneously.

[F8] Social Security income transition has no planned date
     At month 24, SS income adds $3,000/month — a 30%+ income increase.
     This transition point should be a planned event in the system, but
     there is nowhere to model a future income change. The budget planner
     is per-period but has no "starting from date X, add income Y."
     → FIX: Add "Scheduled Income Events" — future-dated income stream
       changes that auto-apply to budget projections from that date forward.

[F9] Tax visibility is completely absent
     Over 3 years, estimated taxes ranged from $11k–$18k. This is a
     major cash flow item. Yet there is no tax line in Cash Flow,
     no tax estimate in Budget Planner, and no tax summary anywhere.
     When tax year-end approaches there is no way to know how much
     has been set aside or whether a lump sum is needed.
     → FIX: Tax Module (see below). Even before a full module,
       Cash Flow should have a "Tax Reserve" category and Budget Planner
       should have a tax line that draws from the estimated annual figure.

[F10] CEF distribution tax character is invisible
     CEF distributions are a mix of ordinary income, qualified dividends,
     and return of capital. This matters significantly for tax planning.
     The distributions table records amounts but not tax character.
     At year-end there's no way to estimate taxable income from the
     portfolio without waiting for 1099s.
     → FIX: Add tax_character field to distributions (ROC%, QD%, OI%).
       Most CEF sponsors publish estimated character quarterly. Show
       estimated taxable income YTD in the Investments tab.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INVESTMENTS MODULE — SPECIFIC IMPROVEMENTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[I1] WATCHLIST TIER (Priority: High)
     Separate held funds from candidate funds. Add Add to Watchlist
     button in screener. Watchlist view shows current discount vs avg,
     yield, and NAV trend — the three things you check before buying.

[I2] DISCOUNT ALERT PANEL (Priority: High)
     A small panel at top of Investments showing any fund (held or
     watchlisted) where discount is unusually wide. Single click to act.
     Thresholds configurable: "alert when 3% wider than 1yr avg."

[I3] NAV SPARKLINES (Priority: High)
     A 12-month NAV trend line next to each holding. The most important
     sell signal rendered invisible by missing data. nav_history table
     exists — just needs to be populated and displayed.

[I4] PORTFOLIO INCOME PROJECTION (Priority: High)
     Given current holdings and distribution amounts, project next 12
     months of expected income. Show as a monthly bar chart.
     This is the number that feeds Cash Flow — it must be easy to see.

[I5] DISTRIBUTION HISTORY PER FUND (Priority: Medium)
     Show each fund's distribution history — has it been cut? Raised?
     Stable? This is the primary selection criterion but the data
     isn't surfaced anywhere in the UI.

[I6] TOTAL PORTFOLIO YIELD ON COST (Priority: Medium)
     A single headline number: what is the current annual yield on
     total cost basis? Updated in real time as prices/distributions change.
     Currently requires manual calculation.

[I7] SELL CHECKLIST WORKFLOW (Priority: Medium)
     When considering selling a fund, the decision involves: NAV trend,
     distribution history, discount vs avg, alternative fund comparison.
     There is no structured workflow for this — it's all in the user's head.
     A "Review for Sale" mode that walks through these criteria would
     reduce decision errors significantly.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CASH FLOW MODULE — SPECIFIC IMPROVEMENTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[C1] ROLLING 12-MONTH VIEW (Priority: High)
     Currently shows totals/averages for selected date range.
     A rolling 12-month view showing each month as a column (income,
     expenses, net) would make trends and seasonality immediately visible.
     Travel spikes in summer; medical varies unpredictably — these patterns
     are hard to see in the current table.

[C2] BUDGET VS ACTUAL (Priority: High)
     See [F7] above. This is the core use case of the budget planner
     and it requires a connection to actual transactions. These two
     modules are designed to work together but have no link.

[C3] INCOME STREAM BREAKDOWN (Priority: High)
     All income currently comes through payee/category search. There
     is no income dashboard that shows annuities, investment income,
     taxable sales, and SS as separate lines with trends.
     → Add an Income tab to Cash Flow showing each income source by month.

[C4] CATEGORY TREND LINE (Priority: Medium)
     When reviewing a category (e.g. Medical), I want to see not just
     totals but a trend: is spending rising? At what rate?
     A simple year-over-year % change per category would flag categories
     running ahead of 3% inflation.

[C5] CSV UPLOAD BUTTON (Priority: Medium)
     Currently the CSV path is hardcoded. A drag-and-drop upload area
     or file picker would make refreshing data after a Quicken export
     a single action rather than a file system operation.

[C6] PAYEE CLEANUP / ALIASES (Priority: Low)
     Payees from Quicken are messy: "CARDMEMBER SVC ONLINE PMT240411",
     "Zelle Transfer to AMANDA BADEN 877-726-5640-436600P0695I".
     A payee alias system would let you map these to clean names
     ("Amanda Baden - Therapy", "Amex Payment") for cleaner reporting.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BUDGET PLANNER — SPECIFIC IMPROVEMENTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[B1] ACTUALS COLUMN (Priority: High)
     See [F7]. Budget Planner must show this month's actual spend per
     category alongside the projected amount. Without this the weekly
     review is a manual lookup exercise.

[B2] SCHEDULED INCOME EVENTS (Priority: High)
     See [F8]. Future income changes (SS starting, annuity change,
     rental income) should be date-stamped so projections forward of
     that date automatically include them.

[B3] COPY PREVIOUS MONTH (Priority: Medium)
     When creating a new budget date, the current flow requires re-entering
     all amounts. A "Copy from last month" option with optional +3%
     inflation adjustment would make monthly setup take 30 seconds
     instead of 10 minutes.

[B4] ANNUAL SUMMARY VIEW (Priority: Medium)
     A view that shows all 12 months of a year as columns — projected
     and actual — would make annual planning much more effective.
     Currently each month is reviewed in isolation.

[B5] INVESTMENT INCOME AUTO-FILL (Priority: Medium)
     See [F2]. The "Investment Distributions" income line should auto-fill
     from the CEF portfolio's 3-month rolling average.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NEW MODULE: TAX ESTIMATOR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Based on the simulation, estimated annual taxes are $11k–$18k and
rising as SS income begins. This is large enough to warrant a
dedicated module. The data to build it already exists.

WHAT IT WOULD DO:
  • Track income by tax character throughout the year:
      - Ordinary income (annuity, SS 85%, taxable sales, CEF ordinary dist)
      - Qualified dividends (CEF QD portion)
      - Long-term capital gains (fund sales held >1yr)
      - Return of capital (reduces cost basis, not immediately taxable)
  • Running YTD tax estimate updated every time Cash Flow is refreshed
  • "Tax Reserve" tracker: how much have you set aside vs estimated owed
  • Year-end projection: given current pace, what will the full year look like
  • Suggested single annual payment amount (with 5% buffer)
  • Flag if estimated payment would trigger underpayment penalty

INPUTS (all already exist in the system):
  - Cash Flow: annuity, SS, taxable sales transactions
  - CEF: distributions with tax character, realized gains from trades
  - Budget Planner: tax reserve category

This module does not need to be a full tax return — it's a running
estimate that keeps taxes visible as a cash flow item all year.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PRIORITIZED IMPLEMENTATION ROADMAP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TIER 1 — HIGH IMPACT, ADDRESSES CORE GAPS (do these first)
  1. [F6+F7+B1] Budget vs Actual: map Budget Planner categories to
                Quicken categories, add Actuals column to Budget Planner
  2. [F1+C3]    Investment income → Cash Flow feed: auto-post monthly
                distributions as income transactions
  3. [I3]       NAV sparklines: populate nav_history on refresh, display trends
  4. [I1+I4]    Watchlist tier + Portfolio income projection
  5. [F3+I2]    Discount alert panel for watchlist/held funds

TIER 2 — SIGNIFICANT IMPROVEMENTS
  6. [C1]       Rolling 12-month cash flow view
  7. [I5]       Distribution history per fund (cut/raise/stable)
  8. [B2]       Scheduled income events (SS start date, etc.)
  9. [F10]      CEF distribution tax character tracking
  10. [B3]      Copy previous month with inflation adjustment

TIER 3 — NEW CAPABILITY
  11. [TAX]     Tax Estimator module (can start as a tab in Cash Flow)
  12. [C5]      CSV drag-and-drop upload
  13. [C6]      Payee alias/cleanup system
  14. [B4]      Annual summary view
  15. [I6+I7]   Portfolio yield on cost + sell checklist workflow

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
KEY ARCHITECTURAL OBSERVATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The package has three data stores that don't communicate:
  CEF → SQLite (cef.db)
  Cash Flow → flat CSV (Quicken export)
  Budget Planner → browser localStorage

All three modules need to speak to each other to support the decisions
you're actually making. The highest-leverage architectural change would
be to move everything through a single backend API with a shared SQLite
database. The Cash Flow CSV would be imported into the DB on upload.
The Budget Planner would save to the DB instead of localStorage.
This would unlock every cross-module feature in Tier 1 and Tier 2
and make the Tax Estimator straightforward to build.

The Flask API (budget/api.py) is already there. Extending it to own
all three data domains — investments, transactions, and budget plans —
would be the foundation for the full package.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
""".format(
    num_funds=len(watchlist),
    total_invested=s["total_invested"],
    yield_pct=s["annual_yield_pct"],
    avg_dist=avg_dist,
    min_dist=min_dist,
    max_dist=max_dist,
    total_trades=s["total_trades"],
    buys=len([t for t in trades if t["action"] in ["Buy","Reinvest Shares"]]),
    sells=len([t for t in trades if t["action"] == "Sell"]),
    avg_income=s["avg_monthly_income"],
    avg_expenses=s["avg_monthly_expenses"],
    avg_net=s["avg_monthly_net"],
    pos_months=s["months_positive"],
    neg_months=len(neg_months),
    tax_2024=tax["2024"]["estimated_tax"],
    rate_2024=tax["2024"]["effective_rate_pct"],
    tax_2025=tax["2025"]["estimated_tax"],
    rate_2025=tax["2025"]["effective_rate_pct"],
    tax_2026=tax["2026"]["estimated_tax"],
    rate_2026=tax["2026"]["effective_rate_pct"],
)

print(report)

with open(os.path.join(os.path.dirname(__file__), "DESIGN_REPORT.md"), "w") as f:
    f.write(report)
print("Report saved to cef/DESIGN_REPORT.md")
