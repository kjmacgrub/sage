# BDC Audit Runbook

**Do this four times a year, about 15 minutes per company.**

This is a checklist for keeping the BDC positions honest. It assumes you know
nothing about BDCs and have never done this before. Follow it top to bottom.

---

## Why this exists

Every position in the portfolio gets graded on one question:

> **Is the yield paying for itself, or am I paying for the yield?**

A fund can send you a large cheque every month and simply be handing back your
own money. The cheque looks identical either way. The only way to tell is to
compare what the thing **earned** against what it **paid out**.

For closed-end funds the app answers this automatically — it fetches NAV history
and distribution records and works it out. For BDCs it cannot, because BDCs are
operating companies rather than funds and no free data source publishes what we
need.

The good news: **BDCs answer the question directly.** They report *net investment
income* every quarter, which is exactly "what we earned." You just have to read
it off the filing and type it in. Four numbers, four times a year.

---

## When to do it

BDCs file a 10-Q after each of the first three quarters and a 10-K after the
fourth. They land roughly:

| Quarter ending | Filing appears |
|---|---|
| March 31 | early-to-mid May |
| June 30 | early-to-mid August |
| September 30 | early-to-mid November |
| December 31 | late February |

The app nudges you: any BDC whose newest entered quarter is more than 135 days
old shows a warning in its audit. You do not need to track the calendar — wait
for the flag.

---

## What you need

- The company's investor relations page, or [SEC EDGAR](https://www.sec.gov/edgar/searchedgar/companysearch)
- The Investments app at `http://localhost:8000`

### The rotation

Four companies, every quarter. Two you own, two you're tracking as candidates —
both get the same treatment, because a candidate you haven't been following is
a candidate you can't judge.

| Ticker | Company | Why it's in the rotation |
|---|---|---|
| **ARCC** | Ares Capital | Held |
| **BBDC** | Barings BDC | Held |
| **MAIN** | Main Street Capital | Candidate |
| **HTGC** | Hercules Capital | Candidate |

Two of these need extra care:

- **MAIN** has paid a $0.30 supplemental for twenty consecutive quarters. Enter it
  in the Special field. Its net investment income covers the regular dividend
  comfortably but only about 0.9x of the *total* payout — the rest comes from
  realized gains on equity stakes. Watch whether that gap widens.
- **HTGC** pays a $0.40 base plus a $0.07 supplemental, and states the split
  explicitly in a separate exhibit (99.2) rather than the main release.

**OBDC** (Blue Owl) was graded once and left on the watchlist without being added
to the rotation. Its data will go stale. Either add it here or remove it from the
watchlist, rather than leaving a stale grade on screen.

---

## Step 1 — Find the filing

Easiest route is the company's own investor relations site, which usually posts
a quarterly earnings press release that puts all four numbers on the first page.

1. Search the web for `<TICKER> investor relations quarterly results`.
2. Open the most recent quarter's **earnings press release** (not the slide deck).
3. If you can't find it, go to EDGAR, search the ticker, and open the latest
   **10-Q** (or **10-K** for a Q4).

!!! tip "Press release beats the full filing"
    The press release states these figures in plain language near the top. The
    10-Q has them too, but buried across several statements. Only go to the
    10-Q if the press release is missing something.

---

## Step 2 — Read off four numbers

Find these. The exact wording varies slightly between companies; the alternatives
below are the phrasings you're most likely to meet.

### 1. Net investment income per share

> Also called: "NII per share", "net investment income per weighted average share",
> "core net investment income per share"

**This is what the company earned.** It's interest and fees collected from its
loans, minus its own operating costs and interest expense.

If you see both "net investment income" and "core" or "adjusted" net investment
income, **take the plain one**. Adjusted figures exclude items management would
rather you ignored.

!!! warning "Do not use earnings per share"
    EPS for a BDC includes unrealized mark-ups and mark-downs on the loan
    portfolio, which swing wildly and are not cash. NII is the number that
    corresponds to the dividend. Using EPS here would defeat the purpose.

### 2. Dividend declared per share

> Also called: "dividends declared per share", "distributions declared per share"

**This is what they paid you** for that quarter. Use the *regular* dividend.

If there's a *supplemental* or *special* dividend on top, put it in the separate
**Special dividend / share** field — not added into the regular figure, and not
merely described in Notes.

Coverage is measured against the regular dividend, because that's the standing
commitment. But a company that quietly stops paying specials has cut your income
without touching the headline dividend, and the grade has to see that. Barings
did exactly this: total payout went from $0.31 to $0.26, a 16% cut, while the
regular never moved.

### 3. Net asset value per share

> Also called: "NAV per share", "net asset value per share at period end"

**This is what a share is actually worth** — assets minus debt, divided by shares.
Take the figure as of the quarter end date.

### 4. Non-accruals, % of fair value

> Also called: "investments on non-accrual status", usually stated as a percentage
> of total portfolio "at fair value" and separately "at cost"

**These are the loans that stopped paying.** A borrower in trouble goes on
non-accrual and the BDC stops booking interest from it.

**Use the "at fair value" percentage**, not "at cost." Fair value already reflects
the writedown, so it's the more current picture. If the release gives only a
dollar amount, divide by total portfolio fair value.

Some companies don't put this in the earnings release at all — **Barings is one**,
it appears only in the 10-Q. Leave the field blank in that case rather than
hunting for it; the grade just weights the other components more heavily. Ares
does state it, in the portfolio discussion near the end.

---

## Step 3 — Enter them

1. Open `http://localhost:8000`. Held BDCs (ARCC, BBDC) are on the **Portfolio**
   tab; candidates (MAIN, HTGC) are on the **Watchlist**. Both tabs group them
   under a **BDC** heading, which shows how current the data is.
2. Click the small badge to the right of the ticker (a `?` or a letter grade).
3. In the audit window, click **Enter quarter**.
4. Fill in:
   - **Quarter end** — the last day of the quarter, as `YYYY-MM-DD`
     (e.g. `2026-06-30`). Not the filing date.
   - **Net investment income / share**
   - **Dividend declared / share** (regular only)
   - **Special dividend / share** (blank if none)
   - **NAV / share**
   - **Non-accruals (% of fair value)** — leave blank if not stated
5. Click **Save quarter**.
6. Close, then click the badge again and choose **Re-run audit**.

The grade appears on the badge. Hover it for the summary; click for the full
breakdown.

!!! note "It needs two quarters before it will grade"
    One quarter is a data point, not a trend. Until there are two, the badge
    shows `?` and says how many more it needs. Entering a few past quarters from
    older filings is worth doing once — four quarters gets you to full confidence.

---

## Step 4 — Read the result

The single number that matters is **coverage**: net investment income divided by
the dividend.

| Coverage | Meaning |
|---|---|
| **1.10× and up** | Earning comfortably more than it pays. Room to absorb a bad quarter. |
| **1.00× – 1.10×** | Covered, with little margin. Normal for a mature BDC. |
| **0.90× – 1.00×** | Slightly short. One quarter is noise; three in a row is a pattern. |
| **Below 0.90×** | Not earning its dividend. The gap is coming from somewhere else — spillover income, return of capital, or borrowing. |

### Red flags, in rough order of seriousness

1. **Coverage below 1.0× for three consecutive quarters.** A cut is likely.
2. **A dividend increase while NAV per share is falling.** This is the BDC
   version of paying you with your own capital, and the app penalizes it harder
   than a cut. A company that raises the payout into a shrinking balance sheet
   is managing the share price, not the business.
3. **Specials that quietly stop.** The regular dividend holds, so nothing looks
   wrong, but your actual income drops. Recording specials in their own field is
   what lets the grade catch this.
4. **Non-accruals above ~2% of fair value and rising.** Credit is deteriorating.
   One-off spikes happen; a rising trend across quarters does not resolve itself.
5. **NAV per share declining several quarters running** while the dividend holds
   flat. The dividend is being funded out of the balance sheet.

A dividend **cut** is a demerit in the grade, but it is not automatically a
reason to sell. A company that cuts to a level it can actually earn is behaving
more honestly than one that holds an uncovered dividend to protect the share
price. Look at whether coverage was restored.

---

## Worked example

Suppose a quarter reports:

- Net investment income per share: **$0.52**
- Regular dividend declared per share: **$0.48**
- NAV per share: **$19.94** (previous quarter: $19.81)
- Non-accruals: **1.2%** of fair value

Coverage is 0.52 ÷ 0.48 = **1.08×**. The dividend is earned with a small cushion.
NAV per share rose. Non-accruals are below 2%. This is a healthy quarter — the
yield is paying for itself.

Now suppose the next quarter shows NII of **$0.41** against the same $0.48
dividend. Coverage falls to **0.85×**. One quarter like this is worth noting, not
acting on. If it repeats, the dividend is no longer being earned and the position
needs a decision.

---

## Using this before you buy

The same four numbers work as a screen for a BDC you're considering. There are
only about 40–50 public BDCs, so reading the whole universe by hand is realistic
in a way it isn't for the ~450 closed-end funds.

Enter two to four quarters for a candidate ticker and run the audit before
buying. The app grades tickers it has price data for whether or not you own
them — the "your return" component simply sits out and the other three reweight
to fill the gap.

---

## If something looks wrong

**The badge stays `?` after entering data.**
It needs at least two quarters with both NII and dividend filled in. Check that
neither field was left blank.

**The grade seems too harsh given good coverage.**
Open the audit and look at *How the grade was built*. Coverage is half the grade;
NAV trend, dividend stability, and your own realized return make up the rest. A
company with fine coverage but a shrinking NAV will grade lower, by design.

**Every audit suddenly shows a stale marker.**
Someone changed the rubric in Settings (behind the Sage logo). Grades computed
under different rules aren't comparable, so the app flags them all rather than
silently mixing them. Re-run the audits.

**The numbers disagree with what the app shows elsewhere.**
The audit re-fetches from public sources on every run and reports any
disagreement under *Data checks*. Those flags never change the grade — a stale
figure is a tooling problem, not a company problem — but they tell you which
number to trust.

---

## Quick reference card

```
Every quarter, per BDC:

  1. Find the earnings press release
  2. Write down:
       NII / share          ← what it earned  (NOT EPS)
       Dividend / share     ← what it paid    (regular only)
       Special / share      ← blank if none
       NAV / share          ← what it's worth
       Non-accruals %       ← at fair value
  3. Portfolio → click badge → Enter quarter → Save
  4. Click badge → Re-run audit

  Coverage = NII ÷ dividend
       1.0× or better = the yield pays for itself
       under 0.9×     = you are paying for the yield
```
