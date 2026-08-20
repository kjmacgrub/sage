# Decisions

Why things are the way they are. Commit messages record *what* changed; this
records what was decided and on what evidence, so a call doesn't get quietly
relitigated six months later.

Procedure lives in [the BDC audit runbook](bdc-audit-runbook.md). Code traps
live in `../CLAUDE.md`. This file is only for judgment calls.

---

## Standing context

**Three sleeves, each with a different job.** Judge each against its own job —
weak capital gains in the income sleeve are not a failure.

| Sleeve | Job | Account |
|---|---|---|
| CEFs and BDCs | Income | Roth |
| Options (SPX) | Opportunistic growth | Roth today, **moving to taxable** |
| Managed index, direct indexing | Growth + tax-loss harvesting | Must be taxable |

Target shape, multi-year: a $300k lump sum converted to Roth in annual slices
sized to a reasonable bracket, ending in a **~$400k Roth income bucket**. About
$1M from selling the current condo funds rent until a future purchase; roughly
two years of rent to money market, the rest to direct indexing.

Two mechanics worth not forgetting:

- **Tax-loss harvesting does nothing in a Roth.** The managed sleeve has to be
  taxable for that goal to mean anything.
- **SPX options are Section 1256 contracts** — 60/40 treatment regardless of
  holding period, marked to market at year end. Losses that are dead weight in
  the Roth become usable in taxable. That's the reason for the move.
- **Wash sales cross into the Roth, and there the loss is permanently
  disallowed**, not deferred. Direct indexing sells hundreds of individual
  names; keep individual stocks out of the Roth and tell Fidelity it exists.

---

## 2026-08-18 — BDC rotation settled at five

**ARCC, BBDC (held), MAIN, HTGC, GLAD (tracked).** Roughly 75 minutes a quarter.

Nine was tried and was too many. A rotation that slips is worse than a short
one, because a half-updated set looks current and isn't.

**Assessed and passed over**, with their quarters still in `bdc_fundamentals`
so reinstating one costs no re-entry:

| | Grade | Why |
|---|---|---|
| BXSL | D+ | NII fell every quarter and slipped below the flat $0.77 dividend; NAV $27.15 → $25.53 |
| GSBD | D+ | Q1 2026 covered only 0.69×; non-accruals 3.2% at fair value |
| MSIF | C− | Coverage 0.86×; NII fell to $0.26 against a $0.35 regular |
| SLRC | C+ | Cut its distribution 24% to restore coverage |
| OBDC | C− | Coverage 1.00×, 16% base cut, NAV down every quarter. **Deleted**, not deactivated — never held, no history worth keeping |

TSLX screened well and was passed over on premium, not on quality.

---

## 2026-08-18 — Screener coverage measures a different thing from the audit

The BDC screener reads SEC XBRL, which tags **total** distributions including
supplementals. The position audit measures against the **regular** dividend,
because that's the standing commitment.

So the same company can screen at 0.91× and grade A+ — MAIN does exactly that.
Neither number is wrong; they answer different questions. Don't reconcile them.

---

## 2026-08-17 — Lifetime score is CEF/BDC only

**+$12,470 since June 2021**: realized −$1,208, distributions +$11,501,
unrealized +$2,177.

Scoped to funds. Including the account's ETF and options activity nearly
doubled it — SSO +$4,688 and QLD +$4,140 alone — from strategies that aren't
CEF investing. Sixteen tickers the old importer had filed as "CEF" were
reclassified to ETF, MUTF, STOCK or BOND. They keep their history and stay
visible under inactive funds; they just don't count toward a fund score.

**The number that matters here:** realized trading is −$1,208 against +$11,501
of distributions. Every dollar of lifetime gain has come from income, not from
buying and selling. The premium/discount arbitrage thesis has not paid. That's
acceptable because income was the point — but it means the trading is a small
net drag, which the current-positions scoreboard was hiding.

---

## 2026-08-17 — BDC sleeve kept, and expanded

Nearly sold on instinct. The audit said otherwise: **ARCC covers its dividend
1.08×, BBDC 1.05×**, both from filed net investment income.

The reason for nearly dropping them was wrong, too. "There's no parallel way to
grade them" is backwards — BDCs *publish* NII coverage every quarter, which is
a better answer to "is the yield paying for itself" than the NAV total return
the CEF audit has to infer. It just isn't in any free API.

Circle of competence was the sound reason to consider exiting, and it happened
to point the other way once the data was in. Do not assume he wants out of BDCs.

---

## 2026-08-17 — Schwab's export is the authoritative record

The app had been inferring share counts and income. It was wrong in both
directions, and every correction came from the export:

- **DMA was recorded as 229 shares; it was 220.** Two buys totalling $1,986.39,
  matching the stored cost basis to the cent, and a $24.75 dividend against a
  declared $0.1125 rate — exactly 220.00 shares.
- **Income understated by $2,802.** `div_tracking_since` was 2026-03-01, so
  everything earlier was simply absent.
- **USA overstated by $30.86** — Yahoo gives a per-share rate that gets
  multiplied by *today's* share count, and USA held 145 shares until Nov 2025,
  not 304.
- **245 duplicate rows, $5,776 of dividends that were never paid**, because the
  Yahoo sync inserted at the ex-date while the import recorded the pay date.

Rule going forward: **prices refresh themselves; anything about a position
comes from the export.** Always the "All" date range — a short window can't
rebuild share counts for anything sold in it.

---

## 2026-08-17 — DMA sold

Coverage 0.20×. Over the trailing year it earned +0.6% while paying 12.1%, and
had raised its distribution 55% into a falling NAV — $11.91 → $9.09 since 2022.
Grade F on every window measured.

Lifetime result: **+$117** — a realized loss of $313 against $430 of
distributions. A 17% headline yield returned roughly cash over 1.7 years.

Note for calibration: the first pass on this understated the return badly
(+$48 on 229 phantom shares and nine months of missing income). The
*conclusion* held, but the position had done better than the broken data
suggested. Check the data before sharpening a verdict.

---

## Rubric design

Decisions baked into `services/audit.py` that are easy to second-guess later:

- **Coverage is 50% of the CEF grade**, blended 1Y/3Y/long-run at 25/40/35.
  Longer windows weighted heavier so one market year can't dominate.
- **Long-run means the median of rolling 3-year windows**, not inception-to-
  today. A single anchor makes the grade hostage to one day: BSTZ's series
  starts 2021-08-20, near the tech peak, which alone dragged it to a D despite
  covering its distribution 2× over three years.
- **Insufficient data returns no grade, never an F.** "Couldn't measure" must
  not render as "bad" — XFLT was scoring F on one surviving component.
- **Data discrepancies never move a grade**, only confidence. A stale figure is
  a tooling problem, not a fund problem.
- **Scoring curve anchors are deliberately not user-tunable.** Weights and
  thresholds are, in Settings. If every curve were adjustable the grade could be
  tuned until everything scored an A, which would make it useless as a check on
  judgment. Every audit snapshots the rubric it ran under for the same reason.
