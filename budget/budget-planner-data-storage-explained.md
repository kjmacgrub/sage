# Budget Planner - Data Storage Explained

## Where Your Data Lives

Your budget data is stored **locally in your web browser** using localStorage.

### localStorage
- **Location**: Built into your browser (Chrome, Firefox, Safari, etc.)
- **Technology**: `localStorage` API
- **Visibility**: Private to you, stored on your device only

## How It Works

### Storage Key Format
Each date's budget is stored with a unique key:
```
budget:1.8.26
budget:2.15.26
budget:3.1.26
...etc
```

### Data Structure
Each date stores a JSON object like this:
```json
{
  "startingBalance": 18000,
  "income": [
    {"name": "Salary", "amount": 5000},
    {"name": "Freelance", "amount": 1500}
  ],
  "credit": [
    {"name": "Amex", "amount": 500}
  ],
  "monthly": [
    {"name": "Rent", "amount": 2000},
    {"name": "Groceries", "amount": 600}
  ],
  "utils": [
    {"name": "Electric", "amount": 150}
  ],
  "customCategories": {
    "income": {"displayName": "Income Items", "type": "income"},
    "credit": {"displayName": "Credit Cards", "type": "expense"},
    "monthly": {"displayName": "Recurring Expenses", "type": "expense"},
    "utils": {"displayName": "Utilities", "type": "expense"}
  }
}
```

## Key Functions

### Saving Data
**Function**: `saveBudget()` / `saveBudgetData()`
- Triggered automatically when you:
  - Add/edit/delete an item
  - Change amounts
  - Modify category names
  - Update starting balance
- Saves to: `localStorage.setItem('budget:1.8.26', JSON.stringify(data))`

### Loading Data
**Function**: `loadBudgetData()`
- Called when:
  - Page loads
  - You switch dates
  - You import data
- Reads from: `localStorage.getItem('budget:1.8.26')`

### Export/Import
**Export**: Downloads all dates as a single JSON file
**Import**: Reads the JSON file and saves each date back to localStorage

## Important Notes

### Advantages
- **No account needed** - works immediately
- **Private** - data never leaves your device
- **Fast** - instant load/save
- **Offline** - works without internet

### Limitations
- **Device-specific** - data only exists on this browser/device
- **Can be cleared** - clearing browser data deletes your budget
- **Not synced** - won't sync to other devices
- **No cloud backup** - only exists locally

## Protecting Your Data

### Best Practices
1. **Export regularly** - Use the Export button to save a backup JSON file
2. **Keep backups** - Save exported files to Google Drive, Dropbox, etc.
3. **Don't clear browser data** - Be careful with "Clear browsing data"
4. **Import on new devices** - Use Import to transfer data to another device

### How to Backup
1. Click the **Export** button at the bottom
2. Save the `.json` file somewhere safe
3. To restore: Click **Import** and select your saved file

## Checking Your Data

You can view your stored data in the browser:

**Chrome/Edge**:
1. Press F12 (Developer Tools)
2. Go to "Application" tab
3. Look under "Storage" → "Local Storage"
4. Find keys starting with `budget:`

**Firefox**:
1. Press F12
2. Go to "Storage" tab
3. Look under "Local Storage"
4. Find keys starting with `budget:`

## Summary

**Your data is stored:**
- In your browser (localStorage)
- On your device only
- Automatically when you make changes
- For each date separately

**Your data is NOT:**
- Sent to any server
- Shared with anyone
- Synced to the cloud
- Accessible from other devices

This is a **client-side-only** application - all data storage happens in your browser, which gives you complete privacy and control!
