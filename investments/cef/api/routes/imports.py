from fastapi import APIRouter
from pydantic import BaseModel
from typing import Any
from ...database import get_db

router = APIRouter()


class ImportPayload(BaseModel):
    distributions: list[dict[str, Any]]
    trades: list[dict[str, Any]]


@router.post("/preview")
def preview_import(payload: ImportPayload):
    with get_db() as conn:
        held_tickers = {
            row["ticker"]
            for row in conn.execute("SELECT ticker FROM holdings WHERE shares > 0").fetchall()
        }
        all_fund_tickers = {
            row["ticker"]
            for row in conn.execute("SELECT ticker FROM funds").fetchall()
        }

    in_portfolio  = sum(1 for d in payload.distributions if d.get("ticker") in held_tickers)
    in_watchlist  = sum(1 for d in payload.distributions if d.get("ticker") in all_fund_tickers
                                                         and d.get("ticker") not in held_tickers)
    new_tickers   = sorted({d.get("ticker") for d in payload.distributions
                            if d.get("ticker") and d.get("ticker") not in all_fund_tickers})

    dates = [d["date"] for d in payload.distributions] + [t["date"] for t in payload.trades]
    date_range = {"min": min(dates), "max": max(dates)} if dates else {}

    return {
        "distributions": {
            "total":        len(payload.distributions),
            "in_portfolio": in_portfolio,
            "in_watchlist": in_watchlist,
            "new_inactive": len(new_tickers),
        },
        "trades":      {"total": len(payload.trades)},
        "date_range":  date_range,
        "new_tickers": new_tickers,
    }


@router.post("/confirm")
def confirm_import(payload: ImportPayload):
    with get_db() as conn:
        held = {
            row["ticker"]: row["shares"]
            for row in conn.execute("SELECT ticker, shares FROM holdings WHERE shares > 0").fetchall()
        }
        all_fund_tickers = {
            row["ticker"]
            for row in conn.execute("SELECT ticker FROM funds").fetchall()
        }

        # Ensure all current portfolio funds are active
        conn.execute("UPDATE funds SET active = 1 WHERE ticker IN (SELECT ticker FROM holdings WHERE shares > 0)")

        distributions_saved = 0
        affected_tickers = set()

        for d in payload.distributions:
            ticker = d.get("ticker")
            if not ticker:
                continue

            # Auto-add unknown tickers as inactive funds + empty holding
            if ticker not in all_fund_tickers:
                conn.execute(
                    "INSERT OR IGNORE INTO funds (ticker, name, type, active) VALUES (?, ?, 'CEF', 0)",
                    (ticker, ticker),
                )
                all_fund_tickers.add(ticker)

            conn.execute(
                "INSERT OR IGNORE INTO holdings (ticker, shares, cost_basis, dividends_received) VALUES (?, 0, 0, 0)",
                (ticker,),
            )

            ex_date   = d["date"]
            total     = d["amount"]          # total cash received
            shares    = held.get(ticker, 0)  # current shares (0 for inactive/historical)
            per_share = total / shares if shares else 0

            conn.execute(
                """
                INSERT INTO distributions (ticker, ex_date, amount, shares, total, source)
                VALUES (?, ?, ?, ?, ?, 'broker')
                ON CONFLICT(ticker, ex_date) DO UPDATE SET
                    total=excluded.total,
                    shares=excluded.shares,
                    amount=excluded.amount,
                    source='broker'
                """,
                (ticker, ex_date, per_share, shares, total),
            )
            distributions_saved += 1
            affected_tickers.add(ticker)

        # Remove Yahoo-sourced entries within 15 days of any broker entry for affected tickers
        for ticker in affected_tickers:
            conn.execute(
                """
                DELETE FROM distributions
                WHERE ticker = ? AND source = 'yahoo'
                AND EXISTS (
                    SELECT 1 FROM distributions b
                    WHERE b.ticker = distributions.ticker
                    AND b.source = 'broker'
                    AND ABS(julianday(distributions.ex_date) - julianday(b.ex_date)) <= 15
                )
                """,
                (ticker,),
            )

        # Recompute dividends_received for all affected tickers
        for ticker in affected_tickers:
            total_divs = conn.execute(
                "SELECT COALESCE(SUM(total), 0) FROM distributions WHERE ticker = ?",
                (ticker,),
            ).fetchone()[0]
            conn.execute(
                "UPDATE holdings SET dividends_received = ? WHERE ticker = ?",
                (total_divs, ticker),
            )

        trades_saved = 0
        for t in payload.trades:
            try:
                conn.execute(
                    """
                    INSERT OR IGNORE INTO broker_trades (date, action, ticker, shares, price, fees, amount)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (t["date"], t["action"], t["ticker"], t.get("shares"), t.get("price"), t.get("fees"), t.get("amount")),
                )
                trades_saved += conn.execute("SELECT changes()").fetchone()[0]
            except Exception:
                pass

    return {"distributions_saved": distributions_saved, "trades_saved": trades_saved}
