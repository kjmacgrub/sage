"""
Exposure — what a fund is actually exposed to, which is a different axis from
CEFConnect's category.

Category describes structure and strategy: how the fund is built and what
wrapper it uses. Correlation doesn't run along that axis. Two funds move
together because of what they hold, not how they're packaged.

The concrete failure that motivated this: a 24% energy-infrastructure
concentration was invisible because category split it across two buckets
(TYG/NML/SRV under "Equity-MLP", NXG under "Equity-Sector Equity") while
merging NXG's midstream exposure with BSTZ's tech under that same
"Equity-Sector Equity" label. Wrong in both directions at once.

One bucket per fund, deliberately. The moment a fund can sit in two, the
concentration total stops being a number you can read off the screen.

Most of the mapping is mechanical from category. The exceptions are the
catch-all categories -- "Equity-Sector Equity" above all -- which have to be
assigned by hand and are stored on funds.exposure as an override.
"""

# Ordered roughly growth -> income; the portfolio breakdown renders in this order.
EXPOSURES = [
    "US equity",
    "Global equity",
    "Tech equity",
    "Healthcare equity",
    "Energy infrastructure",
    "Real estate",
    "Multi-asset",
    "Convertibles",
    "Preferreds",
    "Credit / loans",
    "Municipal",
    "Direct lending",
    "Other",
]

# CEFConnect category -> default exposure. Anything unmapped falls to None so it
# reads as "not yet classified" rather than being silently dumped in "Other".
CATEGORY_MAP = {
    "Equity-U.S. Equity": "US equity",
    "Equity-Covered-Call Funds": "US equity",
    "Equity-Global Equity": "Global equity",
    "Equity-Asia Equity": "Global equity",
    "Equity-Emerging Market Equity": "Global equity",
    "Equity-Single-Country Equity": "Global equity",
    "Equity-MLP": "Energy infrastructure",
    "Equity-Real Estate": "Real estate",
    "Hybrid-U.S. Allocation": "Multi-asset",
    "Hybrid-Global Allocation": "Multi-asset",
    "Fixed Income - Taxable-Convertibles": "Convertibles",
    "Fixed Income - Taxable-Preferreds": "Preferreds",
    "Fixed Income - Taxable-Senior Loans": "Credit / loans",
    "Fixed Income - Taxable-High Yield": "Credit / loans",
    "Fixed Income - Taxable-Multi-Sector": "Credit / loans",
    "Fixed Income - Taxable-Investment Grade": "Credit / loans",
    "Fixed Income - Taxable-Limited Duration": "Credit / loans",
    "Fixed Income - Taxable-Global Income": "Credit / loans",
}

# Categories too broad to map: the funds inside them genuinely differ, so a
# default here would assert something false rather than leave a gap.
AMBIGUOUS_CATEGORIES = {"Equity-Sector Equity"}


def default_for_category(category: str | None, fund_type: str | None = None) -> str | None:
    """Best-guess exposure from category, or None when it must be set by hand."""
    if (fund_type or "").upper() == "BDC":
        return "Direct lending"          # what a BDC is, regardless of category
    if not category:
        return None
    if category in AMBIGUOUS_CATEGORIES:
        return None
    if category.startswith("Fixed Income - Municipal"):
        return "Municipal"
    return CATEGORY_MAP.get(category)


def resolve(stored: str | None, category: str | None, fund_type: str | None = None) -> str | None:
    """A hand-set exposure always wins over the category default."""
    return stored or default_for_category(category, fund_type)
