"""
CEF/Budget/CashFlow Simulation
Compresses ~3 years of heavy use to surface design recommendations.
Writes only to cef_demo.db. Real data untouched.
"""

import sqlite3, random, json, os, sys
from datetime import date, timedelta
from dateutil.relativedelta import relativedelta

DB = os.path.join(os.path.dirname(__file__), "cef_demo.db")
BUDGET_CSV = "/Users/km/Downloads/Time Transaction All.csv"

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python3", "source"))

random.seed(42)

def db():
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    return c

# ─────────────────────────────────────────────────────────────
# PHASE 1: Screen for watchlist (top 10 qualifying funds)
# Criteria: monthly dist, yield>=8%, nav_cagr>=-2, long history
# ─────────────────────────────────────────────────────────────

def screen_watchlist():
    c = db()
    rows = c.execute("""
        SELECT ticker, name, price, nav, premium_discount, avg_discount_1y,
               yield_pct, nav_cagr, dist_cagr, inception_date, category
        FROM screener_cache
        WHERE dist_freq='Monthly'
          AND yield_pct >= 8
          AND yield_pct <= 18
          AND (nav_cagr IS NULL OR nav_cagr >= -2)
          AND inception_date <= '2015-01-01'
          AND premium_discount <= 0
        ORDER BY
            (CASE WHEN premium_discount < avg_discount_1y THEN 1 ELSE 0 END) DESC,
            yield_pct DESC
    """).fetchall()
    c.close()

    # Diversify across categories, pick top 10
    seen_cats = {}
    watchlist = []
    for r in rows:
        cat = (r["category"] or "Unknown").split("-")[0].strip()
        if seen_cats.get(cat, 0) >= 3:
            continue
        seen_cats[cat] = seen_cats.get(cat, 0) + 1
        watchlist.append(dict(r))
        if len(watchlist) == 10:
            break

    return watchlist

# ─────────────────────────────────────────────────────────────
# PHASE 2: Simulate 3 years of CEF portfolio activity
# Start: Jan 2024 — End: Dec 2026
# Portfolio budget: ~$35k invested (~$2k per position)
# Target: 10% annual distribution yield
# ─────────────────────────────────────────────────────────────

def simulate_price_history(ticker, start_price, nav_cagr, yield_pct, months=36):
    """Generate monthly price + NAV + distribution data."""
    records = []
    price = start_price
    nav_annual_change = (nav_cagr or 0.5) / 100
    monthly_nav_change = (1 + nav_annual_change) ** (1/12) - 1
    nav = price / (1 - 0.08)  # assume ~8% discount to start
    monthly_dist = (yield_pct / 100 * price) / 12

    start = date(2024, 1, 1)
    for i in range(months):
        d = start + relativedelta(months=i)
        # Price random walk with mean reversion to nav
        noise = random.gauss(0, 0.015)
        disc = (price - nav) / nav
        mean_rev = -disc * 0.1
        price = round(price * (1 + noise + mean_rev), 2)
        nav = round(nav * (1 + monthly_nav_change + random.gauss(0, 0.008)), 2)
        pct = round((price/nav - 1) * 100, 2)
        actual_yield = round((monthly_dist * 12 / price) * 100, 4)
        records.append({
            "date": d.isoformat(),
            "price": max(price, 0.5),
            "nav": max(nav, 0.5),
            "premium_discount": pct,
            "yield_pct": actual_yield,
            "distribution": round(monthly_dist, 4),
            "dist_freq": "Monthly"
        })
    return records

def build_portfolio(watchlist):
    """Allocate ~$2k per fund, buy at current price."""
    portfolio = []
    for fund in watchlist:
        price = fund["price"] or 10.0
        shares = round(2000 / price, 0)
        cost = round(shares * price, 2)
        portfolio.append({
            "ticker": fund["ticker"],
            "name": fund["name"],
            "shares": shares,
            "cost_basis": cost,
            "price": price,
            "yield_pct": fund["yield_pct"],
            "nav_cagr": fund["nav_cagr"],
            "category": fund["category"],
        })
    return portfolio

def simulate_distributions(portfolio, price_history):
    """Generate 36 months of distributions per fund."""
    distributions = []
    start = date(2024, 1, 1)
    for fund in portfolio:
        ticker = fund["ticker"]
        hist = price_history.get(ticker, [])
        shares = fund["shares"]
        for i, month_data in enumerate(hist):
            ex_date = (start + relativedelta(months=i)).replace(day=15)
            dist_amount = month_data["distribution"]
            total = round(dist_amount * shares, 2)
            distributions.append({
                "ticker": ticker,
                "ex_date": ex_date.isoformat(),
                "amount": dist_amount,
                "shares": shares,
                "total": total,
            })
    return distributions

def detect_nav_erosion(ticker, price_history):
    """Flag fund if NAV declines more than 15% over any 12-month period."""
    hist = price_history.get(ticker, [])
    for i in range(12, len(hist)):
        nav_now = hist[i]["nav"]
        nav_year_ago = hist[i-12]["nav"]
        if nav_year_ago > 0 and (nav_now - nav_year_ago) / nav_year_ago < -0.15:
            return True, hist[i]["date"], round((nav_now/nav_year_ago - 1)*100, 1)
    return False, None, None

def simulate_portfolio_management(portfolio, price_history, watchlist):
    """
    Simulate sell decisions (NAV erosion) and buy decisions (discount > avg).
    Returns list of trade events and decision log.
    """
    trades = []
    decisions = []
    current_holdings = {f["ticker"]: f.copy() for f in portfolio}
    watchlist_map = {f["ticker"]: f for f in watchlist}

    start = date(2024, 1, 1)

    for month_i in range(36):
        month = start + relativedelta(months=month_i)

        # Check each holding for NAV erosion
        for ticker, holding in list(current_holdings.items()):
            if holding["shares"] == 0:
                continue
            eroded, erode_date, erode_pct = detect_nav_erosion(ticker, price_history)
            if eroded and month.isoformat()[:7] == erode_date[:7]:
                hist = price_history.get(ticker, [])
                sell_price = hist[month_i]["price"] if month_i < len(hist) else holding["price"]
                proceeds = round(sell_price * holding["shares"], 2)
                trades.append({
                    "date": month.replace(day=20).isoformat(),
                    "action": "Sell",
                    "ticker": ticker,
                    "shares": holding["shares"],
                    "price": sell_price,
                    "amount": proceeds,
                    "reason": f"NAV erosion {erode_pct}% over 12mo"
                })
                decisions.append({
                    "date": month.isoformat(),
                    "decision": f"SELL {ticker}: NAV eroded {erode_pct}% — rotating to watchlist",
                    "friction": "Had to manually check NAV trend; no alert system"
                })
                holding["shares"] = 0

                # Find best watchlist replacement not already held
                candidates = [
                    f for f in watchlist if f["ticker"] not in current_holdings
                    or current_holdings[f["ticker"]]["shares"] == 0
                ]
                if candidates:
                    best = candidates[0]
                    buy_hist = price_history.get(best["ticker"], [])
                    buy_price = buy_hist[month_i]["price"] if month_i < len(buy_hist) else best["price"]
                    new_shares = round(proceeds / buy_price, 0)
                    current_holdings[best["ticker"]] = {
                        "ticker": best["ticker"],
                        "name": best["name"],
                        "shares": new_shares,
                        "cost_basis": round(new_shares * buy_price, 2),
                        "price": buy_price,
                        "yield_pct": best["yield_pct"],
                        "nav_cagr": best["nav_cagr"],
                        "category": best["category"],
                    }
                    trades.append({
                        "date": month.replace(day=21).isoformat(),
                        "action": "Buy",
                        "ticker": best["ticker"],
                        "shares": new_shares,
                        "price": buy_price,
                        "amount": -round(new_shares * buy_price, 2),
                        "reason": f"Replaced {ticker}, yield {best['yield_pct']:.1f}%"
                    })
                    decisions.append({
                        "date": month.isoformat(),
                        "decision": f"BUY {best['ticker']}: {best['yield_pct']:.1f}% yield, discount {best.get('premium_discount',0):.1f}%",
                        "friction": "No watchlist ranking by current discount vs avg discount; had to manually compare"
                    })

            # Check for unusual discount opportunity (discount > 5% wider than avg)
            hist = price_history.get(ticker, [])
            if month_i < len(hist):
                curr = hist[month_i]
                avg_disc = fund_avg_discount(ticker)
                if curr["premium_discount"] < avg_disc - 5 and holding["shares"] > 0:
                    extra_shares = round(500 / curr["price"])
                    cost = round(extra_shares * curr["price"], 2)
                    trades.append({
                        "date": month.replace(day=10).isoformat(),
                        "action": "Buy",
                        "ticker": ticker,
                        "shares": extra_shares,
                        "price": curr["price"],
                        "amount": -cost,
                        "reason": f"Discount opportunity: {curr['premium_discount']:.1f}% vs avg {avg_disc:.1f}%"
                    })
                    holding["shares"] += extra_shares
                    holding["cost_basis"] += cost
                    decisions.append({
                        "date": month.isoformat(),
                        "decision": f"ADD {ticker}: discount {curr['premium_discount']:.1f}% vs avg {avg_disc:.1f}%",
                        "friction": "No alert when discount widens beyond threshold"
                    })

    return trades, decisions, current_holdings

def fund_avg_discount(ticker):
    c = db()
    r = c.execute("SELECT avg_discount_1y FROM screener_cache WHERE ticker=?", (ticker,)).fetchone()
    c.close()
    return r["avg_discount_1y"] if r and r["avg_discount_1y"] else -8.0

# ─────────────────────────────────────────────────────────────
# PHASE 3: Cash Flow simulation
# $10k/month base income, 3% inflation on expenses, 36 months
# ─────────────────────────────────────────────────────────────

def simulate_cash_flow(distributions_by_month, start_year=2024):
    """Simulate 36 months of income and expenses."""
    # Base income sources
    annuity_monthly = 3500
    ss_starts_month = 24  # month index when SS begins ($3k/mo added)
    ss_monthly = 3000
    taxable_sales_base = 2500  # variable

    # Historical expense baseline from real data (monthly averages 2021-2025)
    expense_categories = {
        "Food:Groceries": 1525,
        "Food:Meals Out": 509,
        "Health/Medical:Doctor/Therapy/Dentist": 900,
        "Insurance:Auto Insurance": 265,
        "Auto/Transportation:MTA": 128,
        "Auto/Transportation:Fuel": 118,
        "Entertainment:Coffee": 150,
        "Household": 400,
        "Housing:Cleaning": 150,
        "Clothing": 120,
        "Utilities": 200,
        "Entertainment:Travel": 300,
        "Education:Cont Ed - Writing": 120,
        "Children:Activities": 80,
        "Entertainment:Gifts": 80,
        "Misc/Personal": 200,
    }

    monthly_records = []
    start = date(start_year, 1, 1)

    for i in range(36):
        month = start + relativedelta(months=i)
        inflation_factor = (1.03 ** (i / 12))

        # Income
        inv_income = distributions_by_month.get(month.isoformat()[:7], 0)
        taxable = round(taxable_sales_base * (1 + random.gauss(0, 0.3)), 0)
        taxable = max(0, taxable)
        ss = ss_monthly if i >= ss_starts_month else 0
        total_income = annuity_monthly + inv_income + taxable + ss

        # Expenses with inflation + variance
        total_expenses = 0
        cat_breakdown = {}
        for cat, base in expense_categories.items():
            variance = random.gauss(1.0, 0.12)
            # Travel spikes in summer
            if "Travel" in cat and month.month in [6, 7, 8]:
                variance *= 2.5
            # Medical more stable
            if "Medical" in cat:
                variance = random.gauss(1.0, 0.05)
            amt = round(base * inflation_factor * variance, 2)
            cat_breakdown[cat] = amt
            total_expenses += amt

        net = round(total_income - total_expenses, 2)
        monthly_records.append({
            "month": month.isoformat()[:7],
            "income": {
                "annuity": annuity_monthly,
                "investment": round(inv_income, 2),
                "taxable_sales": taxable,
                "social_security": ss,
                "total": round(total_income, 2),
            },
            "expenses": cat_breakdown,
            "total_expenses": round(total_expenses, 2),
            "net": net,
        })

    return monthly_records

# ─────────────────────────────────────────────────────────────
# PHASE 4: Budget planner simulation
# Weekly review cycle for 36 months
# ─────────────────────────────────────────────────────────────

def simulate_budget_reviews(cash_flow_records):
    """Simulate monthly budget planning and weekly check-ins."""
    reviews = []
    for i, month in enumerate(cash_flow_records):
        # Monthly projection (start of month)
        projected_income = month["income"]["total"]
        projected_expenses = month["total_expenses"]
        projected_net = projected_income - projected_expenses

        # Simulate 4 weekly check-ins
        weekly_notes = []
        running_expenses = 0
        for week in range(4):
            week_expenses = month["total_expenses"] / 4 * random.gauss(1.0, 0.15)
            running_expenses += week_expenses
            on_track = running_expenses / month["total_expenses"] < ((week + 1) / 4 + 0.1)
            weekly_notes.append({
                "week": week + 1,
                "cumulative_expenses": round(running_expenses, 2),
                "on_track": on_track,
                "action": "No adjustment needed" if on_track else "Review discretionary spending"
            })

        over_budget_cats = [
            cat for cat, amt in month["expenses"].items()
            if amt > 0  # simplified: flag top spenders
        ]
        top_cats = sorted(month["expenses"].items(), key=lambda x: x[1], reverse=True)[:3]

        reviews.append({
            "month": month["month"],
            "projected_income": round(projected_income, 2),
            "projected_expenses": round(projected_expenses, 2),
            "projected_net": round(projected_net, 2),
            "actual_net": month["net"],
            "variance": round(month["net"] - projected_net, 2),
            "weekly_reviews": weekly_notes,
            "top_expense_categories": top_cats,
            "investment_income_used_in_projection": month["income"]["investment"] > 0,
        })
    return reviews

# ─────────────────────────────────────────────────────────────
# PHASE 5: Tax estimation
# ─────────────────────────────────────────────────────────────

def simulate_tax_picture(cash_flow_records, portfolio_trades):
    """Estimate annual tax liability for each year."""
    tax_years = {}
    for month in cash_flow_records:
        year = month["month"][:4]
        if year not in tax_years:
            tax_years[year] = {
                "ordinary_income": 0,
                "qualified_dividends": 0,
                "return_of_capital": 0,
                "short_term_gains": 0,
                "long_term_gains": 0,
            }
        # Investment income: CEF distributions are complex (ROC, QD, ordinary)
        inv = month["income"]["investment"]
        tax_years[year]["return_of_capital"] += inv * 0.30   # typical CEF ROC portion
        tax_years[year]["qualified_dividends"] += inv * 0.40
        tax_years[year]["ordinary_income"] += inv * 0.30
        tax_years[year]["ordinary_income"] += month["income"]["annuity"]
        tax_years[year]["ordinary_income"] += month["income"]["social_security"] * 0.85
        tax_years[year]["ordinary_income"] += month["income"]["taxable_sales"]

    # Add capital gains from trades
    for trade in portfolio_trades:
        year = trade["date"][:4]
        if year not in tax_years:
            continue
        if trade["action"] == "Sell":
            gain = trade["amount"] * 0.15  # rough estimate
            tax_years[year]["long_term_gains"] += gain

    # Estimate tax
    results = {}
    for year, t in tax_years.items():
        ordinary = t["ordinary_income"] + t["short_term_gains"]
        # Rough brackets (single/MFJ $89k = 22%)
        if ordinary < 44725:
            ord_tax = ordinary * 0.12
        elif ordinary < 95375:
            ord_tax = 5367 + (ordinary - 44725) * 0.22
        else:
            ord_tax = 16715 + (ordinary - 95375) * 0.24

        ltcg_rate = 0.15 if ordinary < 553850 else 0.20
        ltcg_tax = t["long_term_gains"] * ltcg_rate
        qd_tax = t["qualified_dividends"] * ltcg_rate

        total_tax = round(ord_tax + ltcg_tax + qd_tax, 2)
        effective_rate = round(total_tax / max(ordinary + t["long_term_gains"], 1) * 100, 1)

        results[year] = {
            "ordinary_income": round(ordinary, 2),
            "qualified_dividends": round(t["qualified_dividends"], 2),
            "long_term_gains": round(t["long_term_gains"], 2),
            "return_of_capital": round(t["return_of_capital"], 2),
            "estimated_tax": total_tax,
            "effective_rate_pct": effective_rate,
            "suggested_payment": round(total_tax * 1.05, 2),  # 5% buffer
        }
    return results

# ─────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("CEF FINANCIAL PACKAGE SIMULATION")
    print("3-year compressed simulation: Jan 2024 — Dec 2026")
    print("=" * 60)

    # --- Step 1: Build watchlist
    print("\n[1] Screening for watchlist...")
    watchlist = screen_watchlist()
    print(f"    Selected {len(watchlist)} funds:")
    for f in watchlist:
        print(f"      {f['ticker']:6} {f['yield_pct']:5.1f}% yield  nav_cagr={f['nav_cagr']}  disc={f['premium_discount']:.1f}%  {f['name'][:40]}")

    # --- Step 2: Build initial portfolio (buy all watchlist funds)
    print("\n[2] Building initial portfolio (~$2k per position)...")
    portfolio = build_portfolio(watchlist)
    total_invested = sum(f["cost_basis"] for f in portfolio)
    print(f"    Total invested: ${total_invested:,.0f}")
    for p in portfolio:
        print(f"      {p['ticker']:6} {p['shares']:6.0f} shares @ ${p['price']:.2f}  cost=${p['cost_basis']:,.0f}  yield={p['yield_pct']:.1f}%")

    # --- Step 3: Generate price history
    print("\n[3] Generating 36 months of price/NAV/distribution data...")
    price_history = {}
    for fund in watchlist:
        price_history[fund["ticker"]] = simulate_price_history(
            fund["ticker"],
            fund["price"] or 10.0,
            fund.get("nav_cagr"),
            fund["yield_pct"]
        )

    # --- Step 4: Generate distributions
    print("[4] Simulating monthly distributions...")
    all_distributions = simulate_distributions(portfolio, price_history)
    total_annual_div = sum(d["total"] for d in all_distributions) / 3
    annual_yield = total_annual_div / total_invested * 100
    print(f"    Total distributions over 3 years: ${sum(d['total'] for d in all_distributions):,.2f}")
    print(f"    Average annual distributions: ${total_annual_div:,.2f}")
    print(f"    Effective annual yield on cost: {annual_yield:.1f}%")

    # Group distributions by month
    dist_by_month = {}
    for d in all_distributions:
        m = d["ex_date"][:7]
        dist_by_month[m] = dist_by_month.get(m, 0) + d["total"]

    avg_monthly_dist = sum(dist_by_month.values()) / max(len(dist_by_month), 1)
    print(f"    Average monthly investment income: ${avg_monthly_dist:,.2f}")

    # --- Step 5: Portfolio management decisions
    print("\n[5] Simulating portfolio management (36 months)...")
    trades, decisions, final_holdings = simulate_portfolio_management(portfolio, price_history, watchlist)
    sells = [t for t in trades if t["action"] == "Sell"]
    buys = [t for t in trades if t["action"] == "Buy"]
    print(f"    Trades: {len(buys)} buys, {len(sells)} sells")
    print(f"    Decisions made: {len(decisions)}")
    for d in decisions[:8]:
        print(f"      [{d['date']}] {d['decision']}")
        if d.get("friction"):
            print(f"        ⚡ FRICTION: {d['friction']}")

    # --- Step 6: Cash flow simulation
    print("\n[6] Simulating 36 months of cash flow...")
    cash_flow = simulate_cash_flow(dist_by_month)
    avg_income = sum(m["income"]["total"] for m in cash_flow) / 36
    avg_expenses = sum(m["total_expenses"] for m in cash_flow) / 36
    avg_net = sum(m["net"] for m in cash_flow) / 36
    months_positive = sum(1 for m in cash_flow if m["net"] > 0)

    print(f"    Avg monthly income:   ${avg_income:,.0f}")
    print(f"    Avg monthly expenses: ${avg_expenses:,.0f}")
    print(f"    Avg monthly net:      ${avg_net:,.0f}")
    print(f"    Months with positive net cash flow: {months_positive}/36")

    # --- Step 7: Budget planning simulation
    print("\n[7] Simulating budget planning (weekly reviews)...")
    budget_reviews = simulate_budget_reviews(cash_flow)
    avg_variance = sum(abs(r["variance"]) for r in budget_reviews) / len(budget_reviews)
    months_inv_income_projected = sum(1 for r in budget_reviews if r["investment_income_used_in_projection"])
    print(f"    Avg monthly budget variance: ${avg_variance:,.0f}")
    print(f"    Months where investment income was in projection: {months_inv_income_projected}/36")

    # --- Step 8: Tax simulation
    print("\n[8] Simulating tax picture...")
    tax = simulate_tax_picture(cash_flow, trades)
    for year, t in tax.items():
        print(f"    {year}: ordinary=${t['ordinary_income']:,.0f}  QD=${t['qualified_dividends']:,.0f}  LTG=${t['long_term_gains']:,.0f}  ROC=${t['return_of_capital']:,.0f}")
        print(f"          est tax=${t['estimated_tax']:,.0f} ({t['effective_rate_pct']}%)  suggested payment=${t['suggested_payment']:,.0f}")

    # --- Step 9: Write to demo DB
    print("\n[9] Writing simulation data to cef_demo.db...")
    c = db()
    for fund in watchlist:
        c.execute("INSERT OR IGNORE INTO funds (ticker, name, type, active) VALUES (?,?,?,1)",
                  (fund["ticker"], fund["name"], "CEF"))
    for trade in trades:
        c.execute("""INSERT INTO broker_trades (date, action, ticker, shares, price, amount, added_at)
                     VALUES (?,?,?,?,?,?,datetime('now'))""",
                  (trade["date"], trade["action"], trade["ticker"],
                   trade["shares"], trade["price"], trade["amount"]))
    for d in all_distributions[-60:]:  # last 60 distributions to demo DB
        c.execute("""INSERT OR IGNORE INTO distributions (ticker, ex_date, amount, shares, total, source, added_at)
                     VALUES (?,?,?,?,?,'simulation',datetime('now'))""",
                  (d["ticker"], d["ex_date"], d["amount"], d["shares"], d["total"]))
    c.commit()
    c.close()
    print("    Done.")

    # Return all simulation data for report generation
    return {
        "watchlist": watchlist,
        "portfolio": portfolio,
        "price_history": price_history,
        "distributions": all_distributions,
        "dist_by_month": dist_by_month,
        "trades": trades,
        "decisions": decisions,
        "final_holdings": final_holdings,
        "cash_flow": cash_flow,
        "budget_reviews": budget_reviews,
        "tax": tax,
        "summary": {
            "total_invested": total_invested,
            "annual_yield_pct": annual_yield,
            "avg_monthly_dist": avg_monthly_dist,
            "avg_monthly_income": avg_income,
            "avg_monthly_expenses": avg_expenses,
            "avg_monthly_net": avg_net,
            "months_positive": months_positive,
            "total_trades": len(trades),
            "decisions_made": len(decisions),
        }
    }


if __name__ == "__main__":
    result = main()
    # Save result for report generation
    import json
    out = os.path.join(os.path.dirname(__file__), "simulation_result.json")
    # Convert non-serializable
    json.dump(result, open(out, "w"), indent=2, default=str)
    print(f"\nSimulation data saved to {out}")
