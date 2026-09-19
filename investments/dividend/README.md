# Dividend growth screener

Tools for the fourth sleeve — individual dividend-growth companies. Rationale,
the screen criteria and the rejected alternatives are in
[`../docs/decisions.md`](../docs/decisions.md), entry **2026-09-19**.

## The two pages

| Page | What it does | Live |
|---|---|---|
| `yield-on-cost.html` | Model total-return CAGR and yield on cost from starting yield, dividend growth and price growth. Includes a yield × growth grid for setting screen targets. | [artifact](https://claude.ai/artifact/TzkcXLXRMnWHXWLXwdUGmb) |
| `dividend-compounders.html` | Screen ~1,000 S&P 1500 dividend payers on yield, dividend CAGR, price CAGR, history, payout, FCF coverage and 52-week position. | [artifact](https://claude.ai/artifact/7oCuksREYjb1ViNXvDdnqT) |

**The published screener holds a frozen snapshot.** Prices, yields and
fundamentals are embedded in the page at build time — it does not refresh
itself. Re-run the pipeline below to update it.

## Rebuilding

```bash
cd investments/dividend
../../.venv/bin/python build.py            # full rebuild, ~10 min
../../.venv/bin/python render.py           # assemble the HTML
```

Then republish **to the existing URL** so the link and your saved picks survive:
ask Claude to publish `dividend-compounders.html` passing
`url=https://claude.ai/artifact/7oCuksREYjb1ViNXvDdnqT`. Publishing without the
URL creates a second artifact instead of updating this one.

For a price-only refresh (52-week position, yields — not fundamentals):

```bash
../../.venv/bin/python build.py --quotes-only && ../../.venv/bin/python render.py
```

## Files

```
build.py            universe -> prices/dividends -> fundamentals -> quotes -> screen_data.json
render.py           screen_data.json + page/*.html -> dividend-compounders.html
screen_data.json    the dataset (~1,000 records)
page/head.html      styles and theme tokens
page/body.html      markup, filter controls, methodology notes
page/tail.html      filtering, sorting, sparklines, pick list
yield-on-cost.html  the calculator (standalone, no data dependency)
```

## Methodology notes worth not rediscovering

- **Both CAGRs use the same window.** Yahoo returns dividends back to 1962 but
  monthly prices only to ~1985 for most names. Measuring each over its own span
  flatters one against the other — KO reads 9.24%/10.58% aligned versus
  9.58%/10.75% mismatched. The window is the first full dividend year the price
  series also covers, through the last complete calendar year, and it is shown
  per row.
- **`range=max` truncates dividend history.** Use an explicit `period1`. With
  `range=max&interval=1mo` KO returns dividends for 1962–2003 and then jumps to
  2026; with `period1=-2208988800` it returns all 65 years.
- **Yahoo's quoteSummary and options endpoints need a crumb** — fetch
  `fc.yahoo.com` for a cookie, then `/v1/test/getcrumb`. The chart endpoint does
  not.
- **Quotes batch 50 symbols per call**; quoteSummary does not batch.
- **FCF coverage is computed against the cash cost of the dividend**
  (shares outstanding × trailing dividend per share), not against the payout
  ratio. The two disagree often, and the cash version is the one that matters.
- **The payout column is meaningless for REITs** — they distribute ~90% of
  taxable income and are assessed on FFO, not EPS. FFO is non-GAAP and absent
  from Yahoo. A REIT screen needs its own denominator, not another column here.
- **Universe is current index constituents**, so survivorship bias is baked in.
  Companies dropped for cutting dividends are absent.
