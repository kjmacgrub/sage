# Budget Planner

A clean, minimal budget planner application with a focus on simplicity and user experience.

## Features

### Core Functionality
- **Monthly Budget Tracking** - Separate budgets for each date period
- **Custom Categories** - Create your own income and expense categories
- **Starting Balance** - Track your projected balance across months
- **Auto-Save** - Changes saved automatically to browser localStorage
- **Export/Import** - Backup and restore your data as JSON files

### User Interface
- **Two-Column Layout** - Income on left, Expenses on right
- **Collapsible Sections** - Expand/collapse categories for focused view
- **Inline Editing** - Click to edit item names and amounts
- **Zero-Value Toggle** - Show/hide items with zero amounts
- **Smart Number Formatting** - Automatic comma formatting and decimal handling
- **Historical Averages** - Hover over amounts to see average across months

### Interactive Controls
- **Balance Panel** - Starting Balance → Projected Balance with toggle controls
- **Multiple Toggle Options**:
  - Arrow (→) → Show/hide both income and expenses
  - Green up arrow (▲) → Show income only
  - Orange down arrow (▼) → Show expenses only
  - Projected balance → Click to toggle both sections
- **Mobile Responsive** - Optimized for touch interactions

### Design
- **Apple-Inspired Aesthetic** - Clean, minimal interface with system fonts
- **Sage Green Accent** - Calm, professional color palette
- **System Fonts** - SF Pro / Helvetica Neue for native feel
- **Subtle Interactions** - Light shadows, gentle hover states, scale feedback

## Getting Started

### Installation
1. Clone this repository or download the files
2. Open `index.html` in any modern web browser
3. Start adding your income and expenses!

No server, no account, no installation required.

### Quick Start
1. Select your date from the dropdown
2. Expand "Future Income" section
3. Click "New Income Items" to add income sources
4. Expand "Future Expenses" section
5. Click "New [Category]" to add expenses
6. Watch your projected balance update automatically

## Data Storage

All data is stored **locally in your browser** using localStorage. This means:

- **Private** - Data never leaves your device
- **Fast** - Instant load and save
- **Offline** - Works without internet
- **No account needed** - Start using immediately

**Important**: Export your data regularly as backups! Clearing browser data will delete your budgets.

See `budget-planner-data-storage-explained.md` for detailed information.

## Usage Tips

### Organization
- Create custom categories that match your spending patterns
- Use "show all" to see zero-value placeholders you've set up
- Rename categories by clicking on their names

### Navigation
- Use individual toggle arrows (▲▼) to focus on income or expenses
- Click projected balance or main arrow to see everything
- Date selector shows all created dates for quick switching

### Data Management
- **Export regularly** - Download your complete budget as JSON
- **Import on new devices** - Transfer your data easily
- **Delete old dates** - Use the × next to dates you don't need

## Browser Compatibility

Works in all modern browsers:
- Chrome/Edge (recommended)
- Firefox
- Safari
- Opera

Requires JavaScript and localStorage support.

## Technical Details

- **Pure client-side** - No backend required
- **No dependencies** - Vanilla JavaScript, no frameworks
- **localStorage** - ~5-10MB storage capacity (plenty for years of budgets)
- **Responsive design** - Mobile-first approach with desktop enhancements

## File Structure

```
budget/
├── index.html       # HTML shell
├── styles.css       # Styles (Apple-inspired design system)
├── app.js           # Application logic
├── budget-planner-data-storage-explained.md
└── README.md
```

## Version History

**v2.0** (Current)
- Refactored from single HTML file into index.html + styles.css + app.js
- Fixed critical bug: custom categories now properly saved
- Removed ~700 lines of dead code (unused storage API, dead functions, debug logging)
- Extracted reusable storage helpers (loadBudgetData / saveBudgetData)
- Restyled with Apple-inspired design system (system fonts, CSS variables, subtle shadows)
- Replaced canvas arrow with clean CSS layout
- Removed SVG header illustrations for cleaner look
- Section cards now use left-border color coding (green = income, orange = expenses)

**v1.59** (Previous)
- Full arrow clickable area in balance section
- Styled text controls throughout (consistent minimal design)
- Zero-value item toggle with "show all" / "hide zeros"
- Individual section toggles (income/expense)
- Mobile-optimized controls

## Privacy & Security

This application:
- Runs entirely in your browser
- Makes no network requests (except loading the page itself)
- Stores no data on servers
- Collects no analytics
- Uses no cookies
- Requires no authentication

Your financial data is completely private and under your control.

## License

Free to use and modify for personal use.
