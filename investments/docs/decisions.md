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

**The record starts January 2026.** Anything earlier was a different portfolio —
see the 2026-08-22 entry. Don't average across that boundary.

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

## 2026-08-22 — The current portfolio starts January 2026

**Performance before 2026 is a different strategy and should not be averaged in.**
Everything prior was learning, testing and mistakes. Schwab's "since available"
column reaches back to May 2024 and shows +$19,908 of investment change over
2.3 years — *less* than 2026 alone — but that comparison is meaningless, because
the thing being measured changed.

**2026 to 22 August, both Schwab accounts combined:**

| | |
|---|---|
| Average capital at work | $73,728 |
| Investment change | +$22,029 |
| **Period return** | **29.9%** |
| Annualized | 50.7% |

Modified Dietz, weighting each of nine withdrawals by its actual date — the
$25,000 car wire on 27 March matters most, since capital that left early wasn't
working. The naive figure (change ÷ beginning value) is 23.6% and understates it.

Split of the gain: **options trading +$19,788, CEF/BDC income +$2,587**, less
about $338 of net price change on holdings. Reconciles with Schwab's own
Investment Gain/Loss and Income lines to within rounding.

**The two halves need judging separately.** QQQ 360 and a single Long Put Hedge
trade produced 62% of the options profit. Powerhour and Consecutive IC — 1,640
legs between them — made $5,838. The systematic strategies roughly paid their
way while a few directional calls carried the year. Eight months is also a
short record: quoting 50% as a run rate assumes the rest of the year resembles
this one, and the monthly path (February −$1,680, March +$7,849) says it may not.

**Account note:** the Schwab Portfolio Performance screen aggregates the Roth
(····6967) and the Designated Beneficiary account (····9267). A figure read off
it is both accounts, not one. 9267 stopped trading 17 April and now just holds
money; it was abandoned because of pattern-day-trading limits that have since
been relaxed, so consolidating is worth revisiting.

---

## 2026-08-30 — Exposure is a separate axis from category

The energy-infrastructure concentration was invisible for a structural reason,
not an attention one: **CEFConnect's category describes how a fund is packaged,
and correlation runs along what it holds.**

Category split the position across `Equity-MLP` (TYG, NML, SRV) and
`Equity-Sector Equity` (NXG), and inside that second bucket merged NXG's
midstream exposure with BSTZ's tech. It separates what should group and groups
what should separate — so a category column on screen the whole time never had
a chance of surfacing it.

**Named `exposure`, not the alternatives.** `category` is taken and is
CEFConnect's. `industry` implies a GICS sector of operating companies, which is
meaningless for a convertibles or preferreds fund. `focus` is vague. `sleeve`
already means the three-sleeve income/options/managed-index plan above and
would collide.

**One bucket per fund.** The moment a fund can sit in two, the concentration
total stops being a number you can read off the screen — which is the only
thing this column is for.

**Defaults derived, exceptions by hand.** 332 of 370 funds map mechanically
from category. The rest resolve to null rather than a guess: `Equity-Sector
Equity` genuinely contains different bets, and asserting one would be worse
than leaving a gap. Covered-call turned out to be the same trap in miniature —
it's a strategy, not an exposure, so EXG needed an override to stop being
filed as US equity.

Resulting picture, which is the point: **energy infrastructure 23.7%** across
four funds that move as one, then convertibles 16.7%, global equity 13.4%,
US equity 11.4%. The trim-to-two suggestion from the leverage work stands.

---

## 2026-08-30 — Leverage tracked as risk, separate from the grade

Prompted by asking how exposed the sleeve is to a violent downturn. The audit
answered "is the yield earned" and had nothing to say about "how far can the
market fall before this fund is forced to sell into it" — the mechanism that
turns a drawdown into a permanent loss.

**The objection was that all CEFs run ~30% leverage, so screening on it would
flunk everything.** The data says otherwise. Across the 17 held CEFs:

| | Share of sleeve |
|---|---|
| Levered ≥20% | 61% |
| Levered <5% | 39% |

Six funds are effectively unleveraged (EXG at 0%, ECAT 0.17%, BSTZ 0.76%,
AOD 2.78%, HGLB 2.79%, USA 4.98%). Eleven run 24–41%. Look-through borrowed
exposure is ~$7,958, about 20% of the sleeve.

**The metric is the preferred/debt split, not the ratio.** Debt is tested at
300% asset coverage, preferred at 200%. At an identical 30% ratio that's a 10%
cushion versus a 40% one. Only NCV, NCZ and TYG carry preferred; the five most
levered — XFLT 40.6%, NPFD 36.9%, AVK 36.6%, NXG 34.2%, FSCO 32.6% — are all
debt, the fragile kind. So it ranks, and the ranking is not the one the headline
ratio gives you.

**Reported beside the grade, never inside it.** Same reasoning as the screener-
vs-audit coverage split: different questions, don't reconcile them. A levered
fund is not a badly-run fund. It's also kept out of `flags`, which lower
confidence when data is doubtful — a known leverage ratio isn't doubtful.

**Deliberately not precise.** CEFConnect refreshes assets daily and leverage
monthly-to-semi-annually, so the two can't be mixed into real breach math; NPFD
reads 271% coverage, which is below the statutory floor and therefore stale
rather than true. The cushion is suppressed rather than guessed whenever the
figures don't reconcile. Bands rank; the cushion is indicative only.

**Findings that reshaped the portfolio picture, not just the tooling:**
the sleeve is *not* mainly corporate debt. Energy infrastructure is the largest
single factor at 24% across four funds (TYG, NML, NXG, SRV) that will move as
one. Equity is 31%, converts 17%, credit and BDC together ~21%. The open
suggestion is trimming the energy overlap from four names to two.

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
