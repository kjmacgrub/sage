import pandas as pd
import sys, glob, os

# Auto-find the most recent matching export in ~/Downloads
def _find_csv():
    patterns = [
        os.path.expanduser("~/Downloads/Family Budget-All transactions for import to cash flow-Summary-*.csv"),
        os.path.expanduser("~/Downloads/Family Budget-All transactions for import to cash flow-*.csv"),
    ]
    for pattern in patterns:
        matches = sorted(glob.glob(pattern), key=os.path.getmtime, reverse=True)
        if matches:
            return matches[0]
    return None

CSV = _find_csv()

def load(path=None):
    """Parse the Quicken Summary-by-Category CSV export.

    Format (6 columns): Category-group, Subcategory, Date, Account, Payee, Amount
    Categories are in header rows; data rows have a date in col 2.
    """
    src = path or CSV
    if not src or not os.path.exists(src):
        raise FileNotFoundError(f"Quicken CSV not found. Expected in ~/Downloads: {src}")

    raw = pd.read_csv(src, skiprows=0, header=None, dtype=str,
                      names=["c0","c1","Date","Account","Payee","Amount"],
                      on_bad_lines='skip')

    date_re = r"^\d+/\d+/\d+$"
    current_cat    = ""
    current_subcat = ""
    rows = []

    def _s(v):
        return "" if pd.isna(v) else str(v).strip().strip('"')

    for _, r in raw.iterrows():
        c0 = _s(r["c0"])
        c1 = _s(r["c1"])
        date_val = _s(r["Date"])

        # Main category group header (col0 has value like "Income" / "Expenses")
        if c0 and c0 not in ("Category",) and not c0.startswith("-"):
            # Don't reset cat/subcat here — col0 is just the top-level group
            pass

        # Category or subcategory header (col1 has value, no date)
        if c1 and not pd.Series([date_val]).str.match(date_re)[0]:
            if c1.startswith("- "):
                current_subcat = c1[2:].strip()
            else:
                current_cat    = c1.strip()
                current_subcat = ""
            continue

        # Data row — col2 (Date) matches date pattern
        if not pd.Series([date_val]).str.match(date_re)[0]:
            continue

        cat = f"{current_cat}:{current_subcat}" if current_subcat else current_cat
        amt_str = _s(r["Amount"]).replace(",", "")
        try:
            amt = float(amt_str)
        except ValueError:
            continue

        rows.append({
            "Date":     date_val,
            "Account":  _s(r["Account"]),
            "Payee":    _s(r["Payee"]),
            "Category": cat,
            "Amount":   amt,
        })

    df = pd.DataFrame(rows)
    if df.empty:
        raise ValueError("No transactions parsed — check CSV format")
    df["Date"] = pd.to_datetime(df["Date"])
    df["Year"] = df["Date"].dt.year
    return df[["Date", "Year", "Account", "Payee", "Category", "Amount"]]


try:
    df = load()
except FileNotFoundError:
    import pandas as pd
    df = pd.DataFrame(columns=["Date","Year","Account","Payee","Category","Amount"])


def search_payee(term):
    mask = df["Payee"].str.contains(term, case=False, na=False)
    return df[mask]

def search_category(term):
    mask = df["Category"].str.contains(term, case=False, na=False)
    return df[mask]

def by_year(sub):
    return sub.groupby("Year")["Amount"].sum().reset_index()

def top_payees(year=None, n=20):
    sub = df[df["Year"] == year] if year else df
    sub = sub[sub["Amount"] < 0]
    return sub.groupby("Payee")["Amount"].sum().sort_values().head(n)

def category_summary(year=None):
    sub = df[df["Year"] == year] if year else df
    sub = sub[sub["Amount"] < 0]
    return sub.groupby("Category")["Amount"].sum().sort_values()


if __name__ == "__main__":
    if len(sys.argv) > 1:
        query = " ".join(sys.argv[1:])
        result = search_payee(query)
        if result.empty:
            result = search_category(query)
        if result.empty:
            print(f"No results for '{query}'")
        else:
            print(f"\n=== '{query}' transactions ===")
            print(result.to_string(index=False))
            print(f"\n=== By year ===")
            print(by_year(result).to_string(index=False))
            print(f"\nTotal: {result['Amount'].sum():,.2f}")
    else:
        print(f"CSV: {CSV}")
        print(f"Rows: {len(df)}")
        print(df.head())
