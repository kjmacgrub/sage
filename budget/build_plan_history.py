#!/usr/bin/env python3
"""Build plan_history.json for plan.html from Fidelity/eMoney "Annual Review" PDFs.

Usage:  python3 build_plan_history.py [PDF_DIR]     (default: ~/Downloads)

Needs `pypdf`. Output (plan_history.json) holds personal financial data and is
git-ignored — regenerate it locally whenever a new report arrives.
Add each new report's filename to REPORTS below.
"""
import datetime
import json
import os
import re
import sys

from pypdf import PdfReader

REPORTS = [
    "AUGUST 2019 - Current Position.pdf",
    "FEBRUARY 2020 - Proposed Cash Flow.pdf",
    "JANUARY 2021 -- Current Position with What If Scenarios (3).pdf",
    "JULY 2021 - Annual Review and Proposed Cash Flow (1).pdf",
    "AUGUST 2022 - Proposed Cash Flow.pdf",
    "AUGUST 2023 - Annual Review and Proposed Cash Flow.pdf",
    "AUGUST 2024 - Annual Review and Proposed Cash Flow.pdf",
    "AUGUST 2025 - Annual review and Proposed Cash Flow.pdf",
    "AUGUST 2026 - Annual Review Current Position (1).pdf",
]

# Things the PDFs don't say — supplied by the household.
EVENTS = [
    {"date": "2025-08-14",
     "title": "Inherited IRA became an annuity",
     "text": "Hilary turned the inherited (BDA) IRA into a New York Life cash-refund annuity paying $3,714/month after tax. "
             "Balance-sheet net worth drops because the annuity is income, not an asset."},
    {"date": "2025-08-14",
     "title": "Condo revalued",
     "text": "190 E7 carried at $1.2M instead of $1.1M (a manual update — Fidelity holds real estate values static)."},
    {"date": "2025-08-14",
     "title": "Long-term care premiums begin",
     "text": "Each spouse bought an LTC policy, paid over 10 years and then stopping. "
             "The plan models $17,811/yr of premiums through 2033."},
]

# Milestones in the latest report's projection (read off its cash-flow tables).
PROJECTION_NOTES = [
    {"year": 2027, "title": "Ken's salary ends",
     "text": "Ken's $60K salary stops after 2026; the annuity and Co-Op deferred income carry the gap."},
    {"year": 2029, "title": "Social Security starts",
     "text": "Modeled at $27,381 in 2029, rising to $37,751 in 2030."},
    {"year": 2034, "title": "LTC premiums end",
     "text": "Premiums fall from $17,811 to $3,200 a year after 2033."},
    {"year": 2037, "title": "Planned distributions begin",
     "text": "At age 75 Fidelity models $73.7K of planned distributions (its category for RMDs and annuity "
             "payouts); net cash flow turns positive."},
]

# Commentary shown under the forecast-vs-actual grid (facts checked against the reports above).
FORECAST_NOTES = [
    {"title": "Forecasts are smooth; markets aren't",
     "text": "Fidelity grows the portfolio a steady 4–6% a year. Actual balances fell 14% in the year to Aug 2022 and rose 17% "
             "in the year to Aug 2024. Forecasts made near the 2021 peak ran 15–25% too high; the Aug 2023 one, made near the low, ran 11–15% too low."},
    {"title": "Annuity adjustment",
     "text": "In Aug 2025 the inherited IRA left the portfolio to buy the annuity. For forecasts made before that, the Aug 2025 and Aug 2026 "
             "actuals add back the IRA at its last reported balance ($749K). The amount actually converted isn't in the reports, so treat those cells as roughly ±2%."},
    {"title": "Aug 2019 row: read loosely",
     "text": "That report opened $160K above the balance sheet (it counted expected property proceeds), and real estate then fell from $1.72M to $1.11M "
             "within six months — a transaction the plan never modeled."},
    {"title": "How the timing is read",
     "text": "Fidelity's tables start from balances on the report date and label that first step 'year 1', so a report's year 1 is read here as the 12 months that follow it."},
]

SPENDING_NOTE = ("Actual = Quicken spending excluding insurance, education, taxes and transfers, net of reimbursements. Quicken is not a complete record "
                 "(checking starts Mar 2020, the Fidelity card Aug 2025) and 2025 looks unusually low, so treat this as a rough check. "
                 "Through Sep 4, 2026 Quicken shows $94K spent against a $94.5K assumption for the whole year.")

HOUSEHOLD = {"annuity_monthly_after_tax": 3714}

TYPES = ["Cash Equivalents", "Taxable Investments", "Qualified Retirement",
         "Roth IRAs", "Annuities", "Real Estate", "Personal Property"]


def num(s):
    s = s.replace("$", "").replace(",", "").strip()
    neg = s.startswith("(")
    s = s.strip("()")
    return -float(s) if neg else float(s)


def read_text(path):
    return "\n".join((p.extract_text() or "") for p in PdfReader(path).pages)


def first_val(t, label):
    m = re.search(rf"^\s*{label}\s+(\(?[\d,]+\)?)", t, re.M)
    return num(m.group(1)) if m else None


def parse_report(path):
    t = read_text(path)
    d = datetime.datetime.strptime(
        re.search(r"Prepared on ([A-Za-z]+ \d+, \d{4})", t).group(1), "%B %d, %Y").date()
    nw = num(re.search(r"^Total Net Worth \$([\d,]+)", t, re.M).group(1))
    usd = {}
    for k in TYPES:
        m = re.search(rf"^{k} ([\d.]+)%", t, re.M)
        usd[k] = round(nw * float(m.group(1)) / 100) if m else 0
    m = re.search(r"(?:Managed IRA - BDA|Hilary BDA -\d+) \$([\d,]+)", t)
    bda = num(m.group(1)) if m else 0

    groups = {
        "real_estate": usd["Real Estate"] + usd["Personal Property"],
        "taxable_cash": usd["Cash Equivalents"] + usd["Taxable Investments"],
        "retirement": usd["Qualified Retirement"] + usd["Roth IRAs"] - bda,
        "bda_ira": bda,
        "annuities": usd["Annuities"],
    }
    # Asset-type dollars come from rounded percentages; absorb the few-hundred-dollar
    # drift into the largest financial bucket so the groups sum to net worth exactly.
    groups["retirement"] += nw - sum(groups.values())

    living = first_val(t, "Living Expenses")
    insurance = first_val(t, "Insurance Premiums")
    taxes = first_val(t, "Taxes")
    total_out = first_val(t, "Total Cash Outflows")
    edu = first_val(t, "Education Expense")
    year = re.search(r"^Year/Age (\d{4})", t, re.M)
    other = None
    if None not in (living, insurance, taxes, total_out):
        other = max(0, total_out - living - insurance - taxes)

    ann = re.search(r"Annuity \(cash refund\)\s+([\d,]+)", t)
    mc = re.search(r"Above Average 80\.0% \$([\d,]+)\s+Median 50\.0% \$([\d,]+)\s+Below Average 20\.0% \$([\d,]+)", t)

    boy = re.search(r"Total Portfolio Asset Balances \(Beginning of Year\)\s+([\d,]+)", t)
    rep = {
        "date": d.isoformat(),
        "label": d.strftime("%b %Y"),
        "first_year": int(year.group(1)) if year else d.year,
        "net_worth": nw,
        "groups": groups,
        "year1": {"living": living, "insurance": insurance, "taxes": taxes,
                  "other": other, "education": edu, "total": total_out},
        "annuity_income": num(ann.group(1)) if ann else 0,
        "forecast": {"boy": num(boy.group(1)) if boy else None, "path": parse_forecast(t)},
        "monte_carlo": ({"p80": num(mc.group(1)), "p50": num(mc.group(2)), "p20": num(mc.group(3))}
                        if mc else None),
    }
    return rep, t


def _numbers(text):
    out = []
    for m in re.finditer(r"\(?\$?[\d,]+\)?", text):
        tok = m.group(0)
        v = float(re.sub(r"[^\d]", "", tok) or 0)
        out.append(-v if tok.startswith("(") else v)
    return out


def parse_forecast(t):
    """Year-by-year projection ('Cash Flow Details'). Older reports print one extra column, so
    read from the right: portfolio is last, net second-last, outflows third-last. A row is only
    accepted if inflows - outflows == net, which keeps it apart from the similar 'Overview' table."""
    rows, seen = [], set()
    for m in re.finditer(r"^\s*(\d{4}) (\d+)\s*/\s*(\d+|—)\s+(.*)$", t, re.M):
        year, n = int(m.group(1)), _numbers(m.group(4))
        if len(n) < 9 or year in seen or abs(n[4] - n[-3] - n[-2]) > 2:
            continue
        seen.add(year)
        rows.append({"year": year, "age": int(m.group(2)), "inflows": n[4],
                     "outflows": n[-3], "net": n[-2], "portfolio": n[-1]})
    return rows


def quicken_living_by_year(db_path):
    """Actual household spending from Sage's Quicken-fed budget.db, in the plan's 'Living Expenses'
    sense: everything except insurance, education, taxes, transfers and income, net of reimbursements.
    Approximate — Quicken doesn't hold every account (checking starts Mar 2020, Fidelity card Aug 2025)."""
    import sqlite3
    if not os.path.exists(db_path):
        return {}
    skip = ("Wages", "Fidelity", "Reimbursement", "Tax", "Tax Refund", "Transfer", "Rent Income",
            "Gift Received", "Refund", "Other Inc", "Insurance", "Education", "Auto")
    con = sqlite3.connect(db_path)
    out = {}
    for year, category, amount in con.execute("SELECT year, category, amount FROM transactions"):
        group = (category or "").split(":")[0]
        d = out.setdefault(year, {"spend": 0.0, "reimb": 0.0})
        if group == "Reimbursement":
            d["reimb"] += amount
        elif group not in skip:
            d["spend"] += -amount
    return {y: round(d["spend"] - d["reimb"]) for y, d in out.items() if y >= 2019}


def main():
    src = os.path.expanduser(sys.argv[1]) if len(sys.argv) > 1 else os.path.expanduser("~/Downloads")
    reports, latest_text = [], ""
    for name in REPORTS:
        rep, t = parse_report(os.path.join(src, name))
        reports.append(rep)
        latest_text = t
        print(f"{rep['label']:9} net worth ${rep['net_worth']:>10,.0f}   {name}")
    reports.sort(key=lambda r: r["date"])
    projection = reports[-1]["forecast"]["path"]
    db = os.path.join(os.path.dirname(os.path.abspath(__file__)), "budget.db")
    actuals = {"living": quicken_living_by_year(db)}
    out = {"generated": datetime.date.today().isoformat(), "reports": reports,
           "projection": projection, "projection_notes": PROJECTION_NOTES,
           "events": EVENTS, "household": HOUSEHOLD, "actuals": actuals,
           "forecast_notes": FORECAST_NOTES, "spending_note": SPENDING_NOTE}
    dest = os.path.join(os.path.dirname(os.path.abspath(__file__)), "plan_history.json")
    with open(dest, "w") as fh:
        json.dump(out, fh, indent=1)
    print(f"wrote {dest}  ({len(reports)} reports, {len(projection)} projection years)")


if __name__ == "__main__":
    main()
