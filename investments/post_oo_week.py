"""Post an Option Omega portfolio run into the Live vs Backtest tab.

The optionomega MCP returns a run's trade log and equity curve as JSON; the
tab ingests Option Omega's CSV export shapes. This converts one to the other
and POSTs both to /api/compare/upload.

    python3 post_oo_week.py trades.json equity.json [--label "2027 wk 2026-10-19"]

trades.json : the get_trade_log response ({"tradeColumns": [...], "trades": [[...]]})
              or a list of such pages.
equity.json : the get_equity_curve response ({"pointColumns": [...], "points": [[...]]}).

Column notes (see services/compare.py): `Avg. Closing Cost` is written per
share with two decimals so the parser reads it as a quote, not cents.
"""
import csv
import io
import json
import sys
import urllib.request

API = "http://localhost:8000/api/compare/upload"

TRADE_COLS = ["Date Opened", "Time Opened", "Opening Price", "Legs", "Premium",
              "Closing Price", "Date Closed", "Time Closed", "Days in Trade",
              "Avg. Closing Cost", "Reason For Close", "P/L", "P/L %",
              "No. of Contracts", "Funds at Close", "Margin Req.", "Underlying",
              "Strategy", "Opening Commissions + Fees", "Closing Commissions + Fees",
              "Opening VIX", "Closing VIX"]
EQ_COLS = ["Date", "Net Liquidity", "Current Funds", "Withdrawn", "Trading Funds",
           "P/L", "P/L %", "Drawdown %"]


def rows_from(page):
    cols = page["tradeColumns"]
    for r in page["trades"]:
        yield dict(zip(cols, r))


def trades_csv(pages):
    if isinstance(pages, dict):
        pages = [pages]
    out = io.StringIO()
    w = csv.DictWriter(out, fieldnames=TRADE_COLS, quoting=csv.QUOTE_ALL)
    w.writeheader()
    n = 0
    for page in pages:
        for t in rows_from(page):
            acc = t.get("averageClosingCostPerContract")
            w.writerow({
                "Date Opened": t.get("dateOpened"), "Time Opened": t.get("timeOpened"),
                "Opening Price": t.get("openingUnderlyingPrice"), "Legs": t.get("legs"),
                "Premium": t.get("premiumPerContract"),
                "Closing Price": t.get("closingUnderlyingPrice"),
                "Date Closed": t.get("dateClosed"), "Time Closed": t.get("timeClosed"),
                "Days in Trade": t.get("daysInTrade"),
                "Avg. Closing Cost": "" if acc is None else f"{acc / 100:.2f}",
                "Reason For Close": t.get("reasonClosed"), "P/L": t.get("profit"),
                "P/L %": t.get("profitPercentage"),
                "No. of Contracts": t.get("numberOfContracts"),
                "Funds at Close": t.get("fundsAtClose"),
                "Margin Req.": t.get("buyingPowerRequired"),
                "Underlying": t.get("underlying"), "Strategy": t.get("strategyName"),
                "Opening Commissions + Fees": t.get("openingFees"),
                "Closing Commissions + Fees": t.get("closingFees"),
                "Opening VIX": t.get("openingVix"), "Closing VIX": t.get("closingVix"),
            })
            n += 1
    return out.getvalue(), n


def equity_csv(curve):
    cols = curve["pointColumns"]
    out = io.StringIO()
    w = csv.DictWriter(out, fieldnames=EQ_COLS, quoting=csv.QUOTE_ALL)
    w.writeheader()
    n = 0
    for p in curve["points"]:
        d = dict(zip(cols, p))
        w.writerow({"Date": d["date"], "Net Liquidity": d["netLiquidity"],
                    "Current Funds": d.get("realizedFunds"), "Withdrawn": d.get("withdrawnFunds", 0),
                    "Trading Funds": d.get("tradingFunds"), "P/L": d["profitLoss"],
                    "P/L %": d.get("profitLossPercentage"), "Drawdown %": d.get("drawdownPercentage")})
        n += 1
    return out.getvalue(), n


def post(csv_text, filename):
    req = urllib.request.Request(API, data=json.dumps({"csv": csv_text, "filename": filename}).encode(),
                                 headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req))


def main(argv):
    label = "oo-run"
    if "--label" in argv:
        i = argv.index("--label"); label = argv[i + 1]; argv = argv[:i] + argv[i + 2:]
    trades_path, equity_path = argv[1], argv[2]
    tcsv, tn = trades_csv(json.load(open(trades_path)))
    ecsv, en = equity_csv(json.load(open(equity_path)))
    print("trades:", tn, post(tcsv, f"trade-log {label}.csv"))
    print("equity:", en, post(ecsv, f"portfolio {label}.csv"))


if __name__ == "__main__":
    main(sys.argv)
