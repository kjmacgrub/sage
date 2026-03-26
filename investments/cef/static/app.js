// === STATE ===
let _tab = 'portfolio';
let _prices = [];       // latest price data for all active funds
let _holdings = [];     // holdings with computed gains
let _sortCol = null;
let _sortAsc = false;
let _lastUpdated = null;
let _hideHeld = true;
let _distributions = [];
let _screenData = [];
let _screenState = { running: false, done: 0, total: 0, errors: [] };
let _screenFilters = { minYield: null, maxPremium: null, monthlyOnly: false, minHistory: null, minNavChange: null, hideWatchlist: false };
let _importParsed = null;
let _showInactive = false;
let _inactiveFunds = null;  // null = not yet loaded
let _screenPollTimer = null;
let _navSparklines = {};    // {ticker: [{date, nav}]}
let _alertThreshold = 3;    // pp wider than avg triggers alert
let _showIncomeProjection = false;

// === API ===
async function GET(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function POST(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function PUT(url, body) {
  const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function DELETE(url) {
  const r = await fetch(url, { method: 'DELETE' });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function PATCH(url, body) {
  const r = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// === INIT ===
async function init() {
  renderApp();
  await loadAll();
  renderApp();
  // Auto-refresh prices from Yahoo Finance, then re-render with live data
  try {
    const qr = await POST('/api/prices/quick-refresh', {});
    [_prices, _holdings] = await Promise.all([
      GET('/api/prices/latest'),
      GET('/api/holdings'),
    ]);
    _lastUpdated = new Date().toISOString();
    renderApp();
    if (qr.split_alerts?.length) {
      for (const sa of qr.split_alerts) showSplitAlert(sa);
    }
  } catch(e) {
    console.error('Quick refresh failed:', e);
  }
}

async function loadAll() {
  try {
    [_prices, _holdings, _distributions] = await Promise.all([
      GET('/api/prices/latest'),
      GET('/api/holdings'),
      GET('/api/distributions'),
    ]);
    if (_prices.length) _lastUpdated = _prices[0].fetched_at;
  } catch(e) {
    console.error(e);
  }
}

async function loadSparklines() {
  try {
    _navSparklines = await GET('/api/prices/nav-sparklines');
  } catch(e) {
    _navSparklines = {};
  }
}

// === RENDER ===
function renderApp() {
  document.getElementById('app').innerHTML = `
    <header id="app-header">
      <div class="header-title">CEF<span>.</span></div>
      <div class="header-right">
        ${_lastUpdated ? `<span class="last-updated">Updated ${formatTime(_lastUpdated)}</span>` : ''}
        <button class="btn btn-ghost btn-sm" onclick="refreshPrices()" id="refresh-btn">
          ↻ Refresh
        </button>
      </div>
    </header>

    <div class="tabs">
      <button class="tab ${_tab === 'portfolio' ? 'active' : ''}" onclick="setTab('portfolio')">Portfolio</button>
      <button class="tab ${_tab === 'watchlist' ? 'active' : ''}" onclick="setTab('watchlist')">Watchlist</button>
      <button class="tab ${_tab === 'screen' ? 'active' : ''}" onclick="setTab('screen')">Screen</button>
      <button class="tab ${_tab === 'import' ? 'active' : ''}" onclick="setTab('import')">Import</button>
      <button class="tab ${_tab === 'add' ? 'active' : ''}" onclick="setTab('add')">+ Add Fund</button>
    </div>

    <div id="main">
      ${_tab === 'portfolio' ? renderPortfolio() : ''}
      ${_tab === 'watchlist' ? renderWatchlist() : ''}
      ${_tab === 'screen' ? renderScreen() : ''}
      ${_tab === 'import' ? renderImport() : ''}
      ${_tab === 'add' ? renderAddFund() : ''}
    </div>

    <div id="toast"></div>
    <div id="modal-root"></div>
  `;
}

// === PORTFOLIO TAB ===
function renderPortfolio() {
  const positions = _holdings.filter(h => h.shares > 0);

  if (!positions.length) {
    return `
      <div class="empty-state">
        <h3>No positions yet</h3>
        <p>Add funds to your watchlist, then record your holdings.</p>
      </div>`;
  }

  // Summary bar
  const totalCost = positions.reduce((s, h) => s + (h.cost_basis || 0), 0);
  const totalMkt  = positions.reduce((s, h) => s + (h.market_value || 0), 0);
  const totalDivs = _distributions.reduce((s, d) => s + d.total, 0);
  const totalUnr  = totalMkt - totalCost;

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentYearStr = String(currentYear);
  const lastYearStr = String(currentYear - 1);

  // Dividends by year from distributions
  const divsByYear = {};
  for (const d of _distributions) {
    const yr = d.ex_date.substring(0, 4);
    divsByYear[yr] = (divsByYear[yr] || 0) + d.total;
  }
  const ttmCutoff = new Date(now);
  ttmCutoff.setFullYear(ttmCutoff.getFullYear() - 1);
  const ttmCutoffStr = ttmCutoff.toISOString().slice(0, 10);
  const ttmDivs = _distributions
    .filter(d => d.ex_date > ttmCutoffStr)
    .reduce((s, d) => s + d.total, 0);
  const yieldOnCost = totalCost && ttmDivs ? (ttmDivs / totalCost * 100) : null;

  // Last month's dividends
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthStr = lastMonthDate.toISOString().slice(0, 7); // "YYYY-MM"
  const lastMonthDivs = _distributions
    .filter(d => d.ex_date.substring(0, 7) === lastMonthStr)
    .reduce((s, d) => s + d.total, 0);
  const lastMonthLabel = lastMonthDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

  // Tooltip: each year oldest→newest, current year labeled YTD, then last month
  const divTooltipLines = Object.keys(divsByYear).sort().map(yr =>
    `${yr === currentYearStr ? 'YTD ' : ''}${yr}: ${fmt$(divsByYear[yr])}`
  );
  if (lastMonthDivs > 0) divTooltipLines.push(`${lastMonthLabel}: ${fmt$(lastMonthDivs)}`);
  const divTooltip   = divTooltipLines.join('&#10;');
  const unrTooltip   = [
    `Cost basis: ${fmt$(totalCost)}`,
    ...divTooltipLines,
  ].join('&#10;');

  const posWithDelta = positions.map(h => ({
    ...h,
    disc_vs_avg: h.premium_discount != null && h.avg_discount_1y != null ? h.premium_discount - h.avg_discount_1y : null
  }));
  const sorted = sortData(posWithDelta, _sortCol || 'ticker', _sortCol ? _sortAsc : true);

  return `
    <div class="summary-bar">
      <div class="summary-item" title="Cost basis: ${fmt$(totalCost)}" style="cursor:help">
        <div class="summary-label">Market Value <span style="font-size:10px;opacity:0.5">ⓘ</span></div>
        <div class="summary-value">${fmt$(totalMkt)}</div>
      </div>
      <div class="summary-item" title="${unrTooltip}" style="cursor:help">
        <div class="summary-label">Unrealized <span style="font-size:10px;opacity:0.5">ⓘ</span></div>
        <div class="summary-value ${totalUnr >= 0 ? 'positive' : 'negative'}">${fmtGain$(totalUnr)}</div>
      </div>
      <div class="summary-item" title="${divTooltip}" style="${divTooltip ? 'cursor:help' : ''}">
        <div class="summary-label">Dividends ${divTooltip ? '<span style="font-size:10px;opacity:0.5">ⓘ</span>' : ''}</div>
        <div class="summary-value positive">${totalDivs ? fmt$(totalDivs) : '—'}</div>
      </div>
      <div class="summary-item">
        <div class="summary-label">Yield on Cost <span style="font-size:10px;opacity:0.5">TTM</span></div>
        <div class="summary-value positive">${yieldOnCost != null ? yieldOnCost.toFixed(2) + '%' : '—'}</div>
      </div>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            ${th('ticker', 'Ticker', true, 1)}
            ${th('name', 'Name', true, 2)}
            ${th('type', 'Type', true, 3)}
            ${th('shares', 'Shares')}
            ${th('price', 'Price')}
            ${th('price_change_pct', 'Day %')}
            ${th('cost_per_share', 'Cost/Sh')}
            ${th('yield_pct', 'Yield', false, false, 'Current market yield')}
            ${th('yoc', 'YoC', false, false, 'Yield on cost basis (annualized distributions / total cost)')}
            ${th('nav_cagr', 'NAV/yr', false, false, '5-year annualized NAV growth rate (from CEFConnect history)')}
            ${th('disc_vs_avg', 'δ vs Avg', false, false, 'Current disc/premium relative to its 1-year average. Negative = trading cheaper than usual.')}
            <th title="12-month NAV trend">NAV Trend</th>
            ${th('unrealized_gain', 'Unr. Gain')}
            ${th('dividends_received', 'Divs')}
            ${th('total_return', 'Total Ret')}
            ${th('total_return_pct', 'Ret %')}
            ${th('market_value', 'Mkt Val')}
            ${th('weight', '% Port')}
          </tr>
        </thead>
        <tbody>
          ${sorted.map(h => portfolioRow(h, totalMkt)).join('')}
        </tbody>
      </table>
    </div>
    ${renderIncomeProjection(positions)}`;
}

function portfolioRow(h, totalMkt) {
  const costPerShare = h.shares ? (h.cost_basis / h.shares) : null;
  // Yield on cost: annualized distributions / cost basis
  const p = _prices.find(p => p.ticker === h.ticker);
  const distPerShare = p?.distribution;
  const distFreq = (p?.dist_freq || '').toLowerCase();
  const periodsPerYear = distFreq.includes('month') ? 12 : distFreq.includes('quarter') ? 4 : distFreq.includes('annual') ? 1 : 12;
  const yoc = (distPerShare && h.shares && h.cost_basis)
    ? (distPerShare * h.shares * periodsPerYear / h.cost_basis * 100)
    : null;

  return `
    <tr onclick="openHoldingModal('${h.ticker}')">
      <td class="left col-sticky">
        <a class="ticker-link" href="${tickerUrl(h.ticker, h.type)}" target="_blank" onclick="event.stopPropagation()">${h.ticker}</a>
      </td>
      <td class="left col-sticky-2" style="color:var(--text-2)">${h.name || ''}</td>
      <td class="left col-sticky-3"><span class="badge-type ${(h.type||'').toLowerCase()}">${h.type || ''}</span></td>
      <td>${h.shares != null ? h.shares.toLocaleString() : '—'}</td>
      <td>${fmt$(h.price)}</td>
      <td class="${gainClass(h.price_change_pct)}">${h.price_change_pct != null ? (h.price_change_pct >= 0 ? '+' : '') + h.price_change_pct.toFixed(2) + '%' : '—'}</td>
      <td>${costPerShare != null ? fmt$(costPerShare) : '—'}</td>
      <td title="Current market yield">${h.yield_pct != null ? h.yield_pct.toFixed(2) + '%' : '—'}</td>
      <td class="positive" title="Yield on cost basis">${yoc != null ? yoc.toFixed(2) + '%' : '—'}</td>
      <td class="${gainClass(h.nav_cagr)}" title="5Y annualized NAV change">${h.nav_cagr != null ? (h.nav_cagr >= 0 ? '+' : '') + h.nav_cagr.toFixed(2) + '%' : '—'}</td>
      <td>${fmtDiscCell(h.premium_discount, h.avg_discount_1y)}</td>
      <td>${renderSparkline(_navSparklines[h.ticker])}</td>
      <td class="${gainClass(h.unrealized_gain)}">${fmtGain$(h.unrealized_gain)}</td>
      <td class="positive" onclick="event.stopPropagation(); openDivModal('${h.ticker}')" style="cursor:pointer;text-decoration:underline dotted" title="Click to view distribution history">${fmt$(h.dividends_received)}</td>
      <td class="${gainClass(h.total_return)}">${fmtGain$(h.total_return)}</td>
      <td class="${gainClass(h.total_return_pct)}">${h.total_return_pct != null ? fmtPct(h.total_return_pct) : '—'}</td>
      <td>${fmt$(h.market_value)}</td>
      <td>${totalMkt && h.market_value ? (h.market_value / totalMkt * 100).toFixed(1) + '%' : '—'}</td>
    </tr>`;
}

// === WATCHLIST TAB ===
function renderWatchlist() {
  if (!_prices.length) {
    return `
      <div class="empty-state">
        <h3>No funds tracked yet</h3>
        <p>Use <strong>+ Add Fund</strong> to add CEFs and BDCs to your watchlist.</p>
      </div>`;
  }

  const held = new Set(_holdings.filter(h => h.shares > 0).map(h => h.ticker));
  const visible = _hideHeld ? _prices.filter(p => !held.has(p.ticker)) : _prices;
  const visWithDelta = [...visible].map(p => ({
    ...p,
    disc_vs_avg: p.premium_discount != null && p.avg_discount_1y != null ? p.premium_discount - p.avg_discount_1y : null
  }));
  const sorted = sortData(visWithDelta, _sortCol || 'name', _sortCol ? _sortAsc : true);

  const inactiveCount = _inactiveFunds ? _inactiveFunds.length : '?';
  return `
    <div class="toolbar">
      <span style="color:var(--text-2);font-size:13px">${_prices.length} funds · ${held.size} held</span>
      <button class="btn btn-ghost btn-sm${_hideHeld ? ' active' : ''}" onclick="toggleHideHeld()">
        ${_hideHeld ? 'Show All' : 'Hide Held'}
      </button>
      <button class="btn btn-ghost btn-sm${_showInactive ? ' active' : ''}" onclick="toggleInactive()" title="Funds previously held but no longer in portfolio">
        ${_showInactive ? 'Hide Inactive' : 'Show Inactive'}
      </button>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            ${th('ticker', 'Ticker', true, 1)}
            ${th('name', 'Name', true, 2)}
            ${th('type', 'Type', true, 3)}
            ${th('disc_vs_avg', 'δ vs Avg', false, false, 'Current disc/premium relative to its 1-year average. Negative = trading cheaper than usual.')}
            ${th('price', 'Price')}
            ${th('nav', 'NAV')}
            ${th('yield_pct', 'Yield')}
            ${th('nav_cagr', 'NAV/yr', false, false, '5-year annualized NAV growth rate (from CEFConnect history)')}
            ${th('dist_freq', 'Freq', true)}
            ${th('date', 'As Of', true)}
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map(p => watchlistRow(p, held.has(p.ticker))).join('')}
        </tbody>
      </table>
    </div>
    ${renderInactiveFunds()}`;
}

function watchlistRow(p, isHeld = false) {
  return `
    <tr onclick="openHoldingModal('${p.ticker}')">
      <td class="left col-sticky">
        ${isHeld ? '<span title="In portfolio" style="color:var(--green);font-size:8px;margin-right:4px;vertical-align:middle">●</span>' : ''}
        <a class="ticker-link" href="${tickerUrl(p.ticker, p.type)}" target="_blank" onclick="event.stopPropagation()">${p.ticker}</a>
      </td>
      <td class="left col-sticky-2" style="color:var(--text-2)">${p.name || ''}</td>
      <td class="left col-sticky-3"><span class="badge-type ${(p.type||'').toLowerCase()}">${p.type || ''}</span></td>
      <td>${fmtDiscCell(p.premium_discount, p.avg_discount_1y)}</td>
      <td>${fmt$(p.price)}</td>
      <td>${fmt$(p.nav)}</td>
      <td>${p.yield_pct != null ? p.yield_pct.toFixed(2) + '%' : '—'}</td>
      <td class="${gainClass(p.nav_cagr)}" title="5Y annualized NAV change">${p.nav_cagr != null ? (p.nav_cagr >= 0 ? '+' : '') + p.nav_cagr.toFixed(2) + '%' : '—'}</td>
      <td style="color:var(--text-2)">${p.dist_freq || '—'}</td>
      <td style="color:var(--text-muted)">${p.date || ''}</td>
      <td><button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();confirmRemove('${p.ticker}')">Remove</button></td>
    </tr>`;
}

function renderInactiveFunds() {
  if (!_showInactive) return '';
  const funds = _inactiveFunds || [];
  const rows = [...funds].sort((a, b) => a.ticker < b.ticker ? -1 : 1);
  const totalDivs = funds.reduce((s, f) => s + (f.dividends_received || 0), 0);
  const totalRealized = funds.reduce((s, f) => s + (f.realized_gain || 0), 0);

  return `
    <div style="margin-top:28px">
      <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-bottom:10px;text-transform:uppercase;letter-spacing:0.05em;display:flex;align-items:center;gap:12px">
        Previously Held
        <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--text-muted)">${funds.length} funds · ${fmt$(totalDivs)} divs · <span class="${gainClass(totalRealized)}">${fmtGain$(totalRealized)}</span> realized</span>
      </div>
      ${rows.length ? `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="left col-sticky">Ticker</th>
              <th class="left col-sticky-2">Name</th>
              <th class="left col-sticky-3">Type</th>
              <th>Last Price</th>
              <th>Last NAV</th>
              <th>As Of</th>
              <th>Divs Received</th>
              <th>Realized Gain</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(f => inactiveRow(f)).join('')}
          </tbody>
        </table>
      </div>` : '<div style="color:var(--text-muted);font-size:13px">No inactive funds.</div>'}
    </div>`;
}

function inactiveRow(f) {
  return `
    <tr style="opacity:0.7" onclick="openDivModal('${f.ticker}')">
      <td class="left col-sticky">
        <a class="ticker-link" href="${tickerUrl(f.ticker, f.type)}" target="_blank" onclick="event.stopPropagation()">${f.ticker}</a>
      </td>
      <td class="left col-sticky-2" style="color:var(--text-2)">${f.name !== f.ticker ? f.name : '—'}</td>
      <td class="left col-sticky-3"><span class="badge-type ${(f.type||'').toLowerCase()}">${f.type || ''}</span></td>
      <td>${fmt$(f.price)}</td>
      <td>${fmt$(f.nav)}</td>
      <td style="color:var(--text-muted)">${f.last_date || '—'}</td>
      <td class="positive" style="cursor:pointer;text-decoration:underline dotted" title="Click to view dividend history">${fmt$(f.dividends_received)}</td>
      <td onclick="event.stopPropagation()">
        <input type="number" step="0.01"
          value="${f.realized_gain != null ? f.realized_gain : ''}"
          placeholder="—"
          style="width:90px;text-align:right;background:transparent;border:none;border-bottom:1px dashed var(--border);color:${f.realized_gain == null ? 'var(--text-muted)' : f.realized_gain >= 0 ? 'var(--green)' : 'var(--red)'};font-size:13px"
          onchange="saveRealizedGain('${f.ticker}', this)"
          onfocus="this.style.borderBottomColor='var(--accent)'"
          onblur="this.style.borderBottomColor='var(--border)'">
      </td>
      <td><button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();reactivateFund('${f.ticker}')" title="Add back to watchlist">+ Watch</button></td>
    </tr>`;
}

async function saveRealizedGain(ticker, input) {
  const val = input.value.trim() === '' ? null : parseFloat(input.value);
  try {
    await PATCH('/api/holdings/' + ticker + '/realized-gain', { realized_gain: val });
    input.style.color = val == null ? 'var(--text-muted)' : val >= 0 ? 'var(--green)' : 'var(--red)';
    _inactiveFunds = await GET('/api/funds/inactive');
    renderApp();
  } catch(e) {
    toast('Failed to save: ' + e.message);
  }
}

async function reactivateFund(ticker) {
  try {
    await POST('/api/funds', { ticker, name: ticker, type: 'CEF' });
    await POST('/api/prices/refresh-one', { ticker });
    _inactiveFunds = await GET('/api/funds/inactive');
    await loadAll();
    renderApp();
    toast(`${ticker} added back to watchlist`);
  } catch(e) {
    toast('Error: ' + e.message);
  }
}

// === IMPORT TAB ===
const DIVIDEND_ACTIONS = new Set([
  'Cash Dividend', 'Non-Qualified Div', 'Qualified Dividend',
  'Pr Yr Cash Div', 'Special Dividend', 'Long Term Cap Gain', 'Pr Yr Div Reinvest',
]);
const TRADE_ACTIONS = new Set(['Buy', 'Sell', 'Reinvest Shares']);

function parseSchwabDate(s) {
  const m = s.match(/as of (\d{2}\/\d{2}\/\d{4})/);
  const d = m ? m[1] : s.trim();
  const [mo, dy, yr] = d.split('/');
  return `${yr}-${mo}-${dy}`;
}

function parseSchwabAmt(s) {
  return parseFloat((s || '').replace(/[$,]/g, '')) || 0;
}

function renderImport() {
  return `
    <div style="max-width:600px;margin:0 auto;display:flex;flex-direction:column;gap:24px">
      <div>
        <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-bottom:10px;text-transform:uppercase;letter-spacing:0.05em">Import Schwab Transactions</div>
        <p style="font-size:13px;color:var(--text-2);margin:0 0 12px">
          In Schwab: go to <strong>Accounts → History → Export</strong>, select <strong>All</strong> date range, download the CSV, then select it below.
        </p>
        <input type="file" accept=".csv" onchange="onSchwabUpload(this)" style="color:var(--text-2)">
      </div>
      <div id="import-preview" style="display:none">
        <div id="import-preview-content"></div>
        <div style="margin-top:16px;display:flex;gap:10px;align-items:center">
          <button class="btn btn-primary" id="import-confirm-btn" onclick="confirmImport()" disabled>Confirm Import</button>
          <span id="import-result" style="font-size:13px;color:var(--text-2)"></span>
        </div>
      </div>
    </div>`;
}

async function onSchwabUpload(input) {
  const file = input.files[0];
  if (!file) return;
  const text = await file.text();
  const lines = text.split(/\r?\n/);

  // Find header row — Schwab wraps fields in quotes: "Date","Action","Symbol",...
  let headerIdx = lines.findIndex(l => /^"?Date"?,/.test(l) && l.includes('Action') && l.includes('Symbol'));
  if (headerIdx < 0) { toast('Could not find header row in CSV'); return; }

  const distributions = [];
  const trades = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Simple CSV split respecting quoted fields
    const cols = parseCsvLine(line);
    if (cols.length < 8) continue;

    const [dateRaw, action, symbol, , quantityRaw, priceRaw, feesRaw, amountRaw] = cols;

    // Skip options (symbol contains a space)
    if (!symbol || symbol.includes(' ')) continue;
    const ticker = symbol.trim().toUpperCase();
    if (!/^[A-Z]{1,6}$/.test(ticker)) continue;

    const date = parseSchwabDate(dateRaw);
    const amount = parseSchwabAmt(amountRaw);

    if (DIVIDEND_ACTIONS.has(action)) {
      distributions.push({ ticker, date, amount });
    } else if (TRADE_ACTIONS.has(action)) {
      trades.push({
        ticker,
        date,
        action,
        shares: parseFloat(quantityRaw) || null,
        price: parseSchwabAmt(priceRaw) || null,
        fees: parseSchwabAmt(feesRaw) || null,
        amount,
      });
    }
  }

  _importParsed = { distributions, trades };

  // Show preview panel
  const previewEl = document.getElementById('import-preview');
  if (previewEl) previewEl.style.display = '';

  try {
    const summary = await POST('/api/imports/preview', _importParsed);
    const d = summary.distributions;
    const t = summary.trades;
    const dr = summary.date_range;
    const newTickers = summary.new_tickers || [];
    const previewContent = document.getElementById('import-preview-content');
    if (previewContent) {
      previewContent.innerHTML = `
        <table style="width:100%;font-size:13px;border-collapse:collapse">
          <thead>
            <tr>
              <th class="left" style="position:static;padding:6px 10px;border-bottom:1px solid var(--border)">Category</th>
              <th style="position:static;padding:6px 10px;border-bottom:1px solid var(--border)">Total</th>
              <th style="position:static;padding:6px 10px;border-bottom:1px solid var(--border)">In Portfolio</th>
              <th style="position:static;padding:6px 10px;border-bottom:1px solid var(--border)">Watchlist</th>
              <th style="position:static;padding:6px 10px;border-bottom:1px solid var(--border)" title="New tickers added as inactive">New (inactive)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="left" style="padding:6px 10px">Distributions</td>
              <td style="padding:6px 10px">${d.total}</td>
              <td style="padding:6px 10px;color:var(--green)">${d.in_portfolio}</td>
              <td style="padding:6px 10px;color:var(--text-2)">${d.in_watchlist}</td>
              <td style="padding:6px 10px;color:var(--accent)">${d.new_inactive}</td>
            </tr>
            <tr>
              <td class="left" style="padding:6px 10px">Trades</td>
              <td style="padding:6px 10px">${t.total}</td>
              <td style="padding:6px 10px">—</td>
              <td style="padding:6px 10px">—</td>
              <td style="padding:6px 10px">—</td>
            </tr>
          </tbody>
        </table>
        ${newTickers.length ? `<div style="font-size:12px;color:var(--accent);margin-top:8px">New tickers: ${newTickers.join(', ')}</div>` : ''}
        ${dr.min ? `<div style="font-size:12px;color:var(--text-muted);margin-top:4px">Date range: ${dr.min} → ${dr.max}</div>` : ''}`;
    }
    const btn = document.getElementById('import-confirm-btn');
    if (btn) btn.disabled = false;
  } catch(e) {
    toast('Preview failed: ' + e.message);
  }
}

async function confirmImport() {
  if (!_importParsed) return;
  const btn = document.getElementById('import-confirm-btn');
  const resultEl = document.getElementById('import-result');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Importing…'; }
  try {
    const res = await POST('/api/imports/confirm', _importParsed);
    if (resultEl) resultEl.innerHTML = `<span style="color:var(--green)">✓ Saved ${res.distributions_saved} distributions, ${res.trades_saved} trades</span>`;
    await loadAll();
    renderApp();
    toast(`Import complete: ${res.distributions_saved} distributions, ${res.trades_saved} trades`);
  } catch(e) {
    if (resultEl) resultEl.innerHTML = `<span style="color:var(--red)">Error: ${e.message}</span>`;
    if (btn) { btn.disabled = false; btn.textContent = 'Confirm Import'; }
  }
}

function parseCsvLine(line) {
  const cols = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === ',' && !inQuote) {
      cols.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cols.push(cur.trim());
  return cols;
}

// === ADD FUND TAB ===
function renderAddFund() {
  return `
    <div style="max-width:560px;margin:0 auto;display:flex;flex-direction:column;gap:24px">

      <!-- Single lookup -->
      <div>
        <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-bottom:10px;text-transform:uppercase;letter-spacing:0.05em">Single Fund</div>
        <div class="form-group" style="margin-bottom:8px">
          <div style="display:flex;gap:8px">
            <input type="text" id="add-ticker" placeholder="Ticker, e.g. PDI" style="text-transform:uppercase" oninput="this.value=this.value.toUpperCase()"
              onkeydown="if(event.key==='Enter')lookupFund()">
            <button class="btn btn-primary" onclick="lookupFund()" id="lookup-btn">Look Up</button>
          </div>
        </div>
        <div id="lookup-result"></div>
      </div>

      <!-- Bulk entry -->
      <div>
        <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-bottom:10px;text-transform:uppercase;letter-spacing:0.05em">Bulk Add</div>
        <div class="form-group" style="margin-bottom:8px">
          <label>Comma-separated tickers</label>
          <textarea id="bulk-tickers" rows="3" placeholder="PDI, ARCC, EXG, AOD, FCST, ..."></textarea>
        </div>
        <div class="form-group" style="margin-bottom:8px">
          <label>Or upload a CSV file (one ticker per row, or comma-separated)</label>
          <input type="file" id="bulk-csv" accept=".csv,.txt" onchange="onCsvUpload(this)" style="color:var(--text-2)">
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <select id="bulk-type" style="width:100px">
            <option value="CEF">CEF</option>
            <option value="BDC">BDC</option>
          </select>
          <button class="btn btn-primary" onclick="bulkAdd()" id="bulk-btn">Add All</button>
          <span id="bulk-status" style="font-size:13px;color:var(--text-2)"></span>
        </div>
        <div id="bulk-results" style="margin-top:12px"></div>
      </div>

    </div>`;
}

async function lookupFund() {
  const ticker = document.getElementById('add-ticker')?.value.trim().toUpperCase();
  if (!ticker) return;
  const btn = document.getElementById('lookup-btn');
  const resultEl = document.getElementById('lookup-result');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  resultEl.innerHTML = '';

  try {
    const res = await POST('/api/prices/refresh-one', { ticker });
    const data = res.data;
    resultEl.innerHTML = `
      <div class="lookup-result">
        <div class="fund-name">${data.name || ticker}</div>
        <div class="lookup-row"><span>Price</span><span>${fmt$(data.price)}</span></div>
        <div class="lookup-row"><span>NAV</span><span>${fmt$(data.nav)}</span></div>
        <div class="lookup-row"><span>Disc/Prem</span><span class="${discClass(data.premium_discount)}">${fmtDisc(data.premium_discount)}</span></div>
        <div class="lookup-row"><span>Yield</span><span>${data.yield_pct != null ? data.yield_pct.toFixed(2) + '%' : '—'}</span></div>
        <div class="lookup-row"><span>Distribution</span><span>${data.distribution != null ? fmt$(data.distribution) : '—'} ${data.dist_freq || ''}</span></div>
        <div style="margin-top:12px;display:flex;gap:8px">
          <select id="add-type" style="width:100px">
            <option value="CEF">CEF</option>
            <option value="BDC">BDC</option>
          </select>
          <button class="btn btn-primary" onclick="addFund('${ticker}', '${(data.name || ticker).replace(/'/g, "\\'")}')">Add to Watchlist</button>
        </div>
      </div>`;
  } catch(e) {
    resultEl.innerHTML = `<div style="color:var(--red);font-size:13px;margin-top:8px">Could not fetch ${ticker}. Check the ticker and try again.</div>`;
  }
  btn.disabled = false;
  btn.textContent = 'Look Up';
}

async function addFund(ticker, name) {
  const type = document.getElementById('add-type')?.value || 'CEF';
  try {
    await POST('/api/funds', { ticker, name, type });
    toast(`${ticker} added to watchlist`);
    await loadAll();
    setTab('watchlist');
  } catch(e) {
    toast('Error: ' + e.message);
  }
}

function onCsvUpload(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const text = e.target.result;
    // Extract all uppercase ticker-like tokens
    const tickers = text.split(/[\n,\r]+/).map(t => t.trim().toUpperCase()).filter(t => /^[A-Z]{1,6}$/.test(t));
    const textarea = document.getElementById('bulk-tickers');
    if (textarea) textarea.value = tickers.join(', ');
  };
  reader.readAsText(file);
}

async function bulkAdd() {
  const raw = document.getElementById('bulk-tickers')?.value || '';
  const type = document.getElementById('bulk-type')?.value || 'CEF';
  const tickers = raw.split(/[\s,]+/).map(t => t.trim().toUpperCase()).filter(t => /^[A-Z]{1,6}$/.test(t));
  if (!tickers.length) { toast('No valid tickers found'); return; }

  const btn = document.getElementById('bulk-btn');
  const statusEl = document.getElementById('bulk-status');
  const resultsEl = document.getElementById('bulk-results');
  btn.disabled = true;
  resultsEl.innerHTML = '';

  const ok = [], errors = [];
  for (let i = 0; i < tickers.length; i++) {
    const ticker = tickers[i];
    if (statusEl) statusEl.textContent = `Fetching ${ticker} (${i + 1}/${tickers.length})…`;
    try {
      const res = await POST('/api/prices/refresh-one', { ticker });
      const data = res.data;
      await POST('/api/funds', { ticker, name: data.name || ticker, type });
      ok.push(ticker);
    } catch(e) {
      errors.push(ticker);
    }
  }

  await loadAll();
  btn.disabled = false;
  if (statusEl) statusEl.textContent = '';

  resultsEl.innerHTML = `
    <div style="font-size:13px">
      ${ok.length ? `<div style="color:var(--green);margin-bottom:6px">✓ Added: ${ok.join(', ')}</div>` : ''}
      ${errors.length ? `<div style="color:var(--red)">✗ Failed: ${errors.join(', ')}</div>` : ''}
    </div>`;

  toast(`Added ${ok.length} fund${ok.length !== 1 ? 's' : ''}${errors.length ? `, ${errors.length} failed` : ''}`);
}

// === HOLDING MODAL ===
async function openHoldingModal(ticker) {
  const holding = _holdings.find(h => h.ticker === ticker) || {};
  const price = _prices.find(p => p.ticker === ticker) || {};
  const merged = { ...price, ...holding };

  let navHistory = [];
  if (merged.type === 'BDC') {
    try { navHistory = await GET('/api/nav_history/' + ticker); } catch(e) {}
  }

  // Ensure sparklines are loaded
  if (!_navSparklines[ticker]) {
    try { _navSparklines = await GET('/api/prices/nav-sparklines'); } catch(e) {}
  }

  document.getElementById('modal-root').innerHTML = `
    <div class="modal-backdrop" onclick="closeModal()">
      <div class="modal" onclick="event.stopPropagation()">
        <div class="modal-header">
          <div>
            <h2>${ticker}</h2>
            <div style="font-size:12px;color:var(--text-2);margin-top:2px">${merged.name || ''}</div>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body">
          <div style="display:flex;gap:20px;margin-bottom:16px;padding:10px;background:var(--surface2);border-radius:var(--radius-sm);flex-wrap:wrap">
            <div><div style="font-size:11px;color:var(--text-muted)">Price</div><div>${fmt$(merged.price)}</div></div>
            <div><div style="font-size:11px;color:var(--text-muted)">NAV</div><div>${fmt$(merged.nav)}</div></div>
            <div><div style="font-size:11px;color:var(--text-muted)">Disc/Prem</div><div class="${discClass(merged.premium_discount)}">${fmtDisc(merged.premium_discount)}</div></div>
            <div><div style="font-size:11px;color:var(--text-muted)">Yield</div><div>${merged.yield_pct != null ? merged.yield_pct.toFixed(2) + '%' : '—'}</div></div>
            <div><div style="font-size:11px;color:var(--text-muted)">NAV Trend (12M)</div><div>${renderSparkline(_navSparklines[ticker], 120, 32)}</div></div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Shares Owned</label>
              <input type="number" id="h-shares" min="0" step="0.001" value="${merged.shares || ''}">
            </div>
            <div class="form-group">
              <label>Total Cost Basis ($)</label>
              <input type="number" id="h-cost" min="0" step="0.01" value="${merged.cost_basis || ''}">
            </div>
          </div>
          <div class="form-group">
            <label>Dividends Received ($)</label>
            <input type="number" id="h-divs" min="0" step="0.01" value="${merged.dividends_received || ''}">
          </div>
          ${merged.type === 'BDC' ? `
          <div class="form-group">
            <label>NAV (manual — update quarterly)</label>
            <div style="display:flex;gap:8px;align-items:center">
              <input type="number" id="h-nav" min="0" step="0.01" value="${merged.manual_nav || ''}" placeholder="From quarterly report" style="flex:1">
              <input type="date" id="h-nav-date" value="${merged.manual_nav_date || ''}" title="Quarter-end date this NAV represents" style="width:140px">
            </div>
          </div>
          <div class="form-group">
            <label style="margin-bottom:6px;display:block">NAV History</label>
            <div id="nav-history-wrapper">${buildNavHistoryHtml(ticker, navHistory)}</div>
          </div>` : ''}
          <div class="form-group">
            <label>Notes</label>
            <input type="text" id="h-notes" value="${merged.notes || ''}" placeholder="Optional">
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" onclick="saveHolding('${ticker}')">Save</button>
        </div>
      </div>
    </div>`;
}

function buildNavHistoryHtml(ticker, rows) {
  const tableHtml = rows.length ? `
    <table style="width:100%;margin-bottom:8px">
      <thead>
        <tr>
          <th class="left" style="position:static;font-size:12px;padding:4px 6px">Date</th>
          <th style="position:static;font-size:12px;padding:4px 6px">NAV</th>
          <th style="position:static;padding:4px 6px"></th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td class="left" style="color:var(--text-2);padding:3px 6px">${r.date}</td>
            <td style="padding:3px 6px">${fmt$(r.nav)}</td>
            <td style="padding:3px 6px"><button class="btn btn-ghost btn-sm" style="padding:1px 6px;font-size:11px" onclick="deleteNavHistory('${ticker}','${r.date}')">✕</button></td>
          </tr>`).join('')}
      </tbody>
    </table>` : `<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">No history yet.</div>`;
  return `${tableHtml}
    <div style="display:flex;gap:8px;align-items:center">
      <input type="date" id="nh-date" style="width:140px">
      <input type="number" id="nh-nav" min="0" step="0.01" placeholder="NAV" style="width:90px">
      <button class="btn btn-ghost btn-sm" onclick="addNavHistory('${ticker}')">Add</button>
    </div>`;
}

async function addNavHistory(ticker) {
  const date = document.getElementById('nh-date')?.value;
  const nav = parseFloat(document.getElementById('nh-nav')?.value);
  if (!date || !nav) { toast('Enter a date and NAV value'); return; }
  try {
    await POST('/api/nav_history/' + ticker, { date, nav });
    const rows = await GET('/api/nav_history/' + ticker);
    const wrapper = document.getElementById('nav-history-wrapper');
    if (wrapper) wrapper.innerHTML = buildNavHistoryHtml(ticker, rows);
    _holdings = await GET('/api/holdings');
  } catch(e) {
    toast('Error: ' + e.message);
  }
}

async function deleteNavHistory(ticker, date) {
  try {
    await DELETE('/api/nav_history/' + ticker + '/' + date);
    const rows = await GET('/api/nav_history/' + ticker);
    const wrapper = document.getElementById('nav-history-wrapper');
    if (wrapper) wrapper.innerHTML = buildNavHistoryHtml(ticker, rows);
    _holdings = await GET('/api/holdings');
  } catch(e) {
    toast('Error: ' + e.message);
  }
}

function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
}

async function openDivModal(ticker) {
  const holding = _holdings.find(h => h.ticker === ticker) || {};
  document.getElementById('modal-root').innerHTML = `
    <div class="modal-backdrop" onclick="closeModal()">
      <div class="modal" onclick="event.stopPropagation()" style="max-width:480px">
        <div class="modal-header">
          <div>
            <h2>${ticker} — Dividends</h2>
            <div style="font-size:12px;color:var(--text-2);margin-top:2px">Total received: ${fmt$(holding.dividends_received)}</div>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body" id="div-modal-body">
          <div style="color:var(--text-muted);font-size:13px">Loading…</div>
        </div>
      </div>
    </div>`;

  try {
    const rows = await GET('/api/distributions/' + ticker);
    const body = document.getElementById('div-modal-body');
    if (!body) return;
    if (!rows.length) {
      body.innerHTML = '<div style="color:var(--text-muted);font-size:13px">No distributions recorded yet.</div>';
      return;
    }
    // Distribution trend analysis
    const amounts = rows.map(d => d.amount);
    const latest = amounts[0];
    const prev6avg = amounts.slice(1, 7).reduce((s, v) => s + v, 0) / Math.min(6, amounts.slice(1, 7).length);
    let trendBadge = '';
    if (amounts.length >= 3 && prev6avg > 0) {
      const chg = ((latest - prev6avg) / prev6avg * 100);
      if (chg <= -5) trendBadge = `<span style="color:var(--red);font-weight:600">▼ Cut ${chg.toFixed(1)}%</span>`;
      else if (chg >= 5) trendBadge = `<span style="color:var(--green);font-weight:600">▲ Raised ${chg.toFixed(1)}%</span>`;
      else trendBadge = `<span style="color:var(--text-2)">≈ Stable</span>`;
    }
    const totalIncome = rows.reduce((s, d) => s + d.total, 0);

    body.innerHTML = `
      <div style="display:flex;gap:16px;margin-bottom:12px;padding:8px;background:var(--surface2);border-radius:var(--radius-sm)">
        <div><div style="font-size:11px;color:var(--text-muted)">Latest</div><div>${fmt$(latest)}/sh</div></div>
        <div><div style="font-size:11px;color:var(--text-muted)">6-Period Avg</div><div>${prev6avg > 0 ? fmt$(prev6avg) + '/sh' : '—'}</div></div>
        <div><div style="font-size:11px;color:var(--text-muted)">Trend</div><div>${trendBadge || '—'}</div></div>
        <div><div style="font-size:11px;color:var(--text-muted)">Total Received</div><div class="positive">${fmt$(totalIncome)}</div></div>
      </div>
      <table style="width:100%">
        <thead>
          <tr>
            <th class="left" style="position:static">Ex-Date</th>
            <th style="position:static">Per Share</th>
            <th style="position:static">Shares</th>
            <th style="position:static">Total</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((d, i) => {
            const prev = rows[i + 1];
            const chg = prev ? (d.amount - prev.amount) / prev.amount * 100 : null;
            const chgStr = chg != null && Math.abs(chg) >= 0.5
              ? `<span style="font-size:10px;color:${chg > 0 ? 'var(--green)' : 'var(--red)'}"> ${chg > 0 ? '▲' : '▼'}${Math.abs(chg).toFixed(1)}%</span>`
              : '';
            return `
            <tr>
              <td class="left" style="color:var(--text-2)">${d.ex_date}</td>
              <td>${fmt$(d.amount)}${chgStr}</td>
              <td>${d.shares.toLocaleString()}</td>
              <td class="positive">${fmt$(d.total)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  } catch(e) {
    const body = document.getElementById('div-modal-body');
    if (body) body.innerHTML = `<div style="color:var(--red);font-size:13px">Error: ${e.message}</div>`;
  }
}

async function saveHolding(ticker) {
  const shares = parseFloat(document.getElementById('h-shares')?.value) || 0;
  const cost_basis = parseFloat(document.getElementById('h-cost')?.value) || 0;
  const dividends_received = parseFloat(document.getElementById('h-divs')?.value) || 0;
  const manual_nav = parseFloat(document.getElementById('h-nav')?.value) || null;
  const manual_nav_date = document.getElementById('h-nav-date')?.value || null;
  const notes = document.getElementById('h-notes')?.value || '';
  try {
    await PUT(`/api/holdings/${ticker}`, { ticker, shares, cost_basis, dividends_received, manual_nav, manual_nav_date, notes });
    closeModal();
    await loadAll();
    renderApp();
    toast(`${ticker} updated`);
  } catch(e) {
    toast('Error: ' + e.message);
  }
}

// === NAV SPARKLINES (F5/I3) ===
function renderSparkline(navData, width = 64, height = 22) {
  if (!navData || navData.length < 3) return '<span style="color:var(--text-muted);font-size:11px">—</span>';
  const navs = navData.map(d => d.nav);
  const min = Math.min(...navs), max = Math.max(...navs);
  const range = max - min || 0.001;
  const n = navs.length;
  const pts = navs.map((v, i) => {
    const x = (i / (n - 1)) * width;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const trend = navs[navs.length - 1] >= navs[0];
  const color = trend ? 'var(--green)' : 'var(--red)';
  const pct = ((navs[navs.length - 1] - navs[0]) / navs[0] * 100).toFixed(1);
  const tip = `NAV: ${fmt$(navs[0])} → ${fmt$(navs[navs.length - 1])} (${pct >= 0 ? '+' : ''}${pct}% over ${navData.length} data points)`;
  return `<span title="${tip}" style="cursor:default">
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="display:block">
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>
    </svg>
  </span>`;
}

// === INCOME PROJECTION (I4) ===
function renderIncomeProjection(positions) {
  if (!positions.length) return '';

  const months = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    months.push({
      label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      total: 0
    });
  }

  for (const h of positions) {
    const p = _prices.find(p => p.ticker === h.ticker);
    if (!p?.distribution || !h.shares) continue;
    const freq = (p.dist_freq || '').toLowerCase();
    const amt = p.distribution * h.shares;
    if (freq.includes('month')) {
      months.forEach(m => m.total += amt);
    } else if (freq.includes('quarter')) {
      months.forEach((m, i) => { if (i % 3 === 0) m.total += amt; });
    } else {
      // Annual or unknown: spread evenly
      months.forEach(m => m.total += amt / 12);
    }
  }

  const annual = months.reduce((s, m) => s + m.total, 0);
  const maxTotal = Math.max(...months.map(m => m.total), 1);
  const chartH = 80;
  const barW = 36;
  const gap = 8;
  const totalW = months.length * (barW + gap);

  const bars = months.map((m, i) => {
    const barH = Math.max(2, (m.total / maxTotal) * chartH);
    const x = i * (barW + gap);
    const y = chartH - barH;
    return `
      <rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="var(--green)" rx="2" opacity="0.85"/>
      <text x="${x + barW / 2}" y="${chartH + 12}" text-anchor="middle" font-size="9" fill="var(--text-muted)">${m.label}</text>
      ${m.total > 0 ? `<text x="${x + barW / 2}" y="${y - 4}" text-anchor="middle" font-size="9" fill="var(--text-2)">$${Math.round(m.total)}</text>` : ''}`;
  }).join('');

  return `
    <div class="income-projection">
      <div class="proj-header" onclick="_showIncomeProjection=!_showIncomeProjection;renderApp()" style="cursor:pointer">
        <span class="proj-title">12-Month Income Projection</span>
        <span class="proj-annual">Est. annual: <strong>${fmt$(annual)}</strong></span>
        <span style="color:var(--text-muted);font-size:12px">${_showIncomeProjection ? '▲' : '▼'}</span>
      </div>
      ${_showIncomeProjection ? `
      <div class="proj-chart">
        <svg viewBox="0 0 ${totalW} ${chartH + 20}" style="width:100%;height:${chartH + 30}px;overflow:visible">
          ${bars}
        </svg>
      </div>` : ''}
    </div>`;
}

// === REMOVE FUND ===
async function confirmRemove(ticker) {
  if (!confirm(`Remove ${ticker} from watchlist?`)) return;
  try {
    await DELETE(`/api/funds/${ticker}`);
    await loadAll();
    renderApp();
    toast(`${ticker} removed`);
  } catch(e) {
    toast('Error: ' + e.message);
  }
}

// === REFRESH ===
async function refreshPrices() {
  const btn = document.getElementById('refresh-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Refreshing…'; }
  try {
    const [res, divRes] = await Promise.all([
      POST('/api/prices/refresh', {}),
      POST('/api/distributions/check', {}),
    ]);
    await loadAll();
    renderApp();
    const newDivs = divRes.added?.length || 0;
    toast(`Updated ${res.ok?.length || 0} funds${newDivs ? ` · ${newDivs} new distribution${newDivs > 1 ? 's' : ''}` : ''}${res.errors?.length ? `, ${res.errors.length} errors` : ''}`);
  } catch(e) {
    toast('Refresh failed: ' + e.message);
    if (btn) { btn.disabled = false; btn.innerHTML = '↻ Refresh'; }
  }
}

async function checkDividends() {
  const btn = document.getElementById('divs-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Checking…'; }
  try {
    const res = await POST('/api/distributions/check', {});
    await loadAll();
    renderApp();
    if (res.added?.length) {
      const total = res.added.reduce((s, d) => s + d.total, 0);
      const lines = res.added.map(d => `${d.ticker} ${d.ex_date}: +$${d.total.toFixed(2)}`).join('\n');
      alert(`${res.added.length} new distribution${res.added.length > 1 ? 's' : ''} added (+$${total.toFixed(2)} total)\n\n${lines}`);
    } else {
      toast('No new distributions found');
    }
  } catch(e) {
    toast('Check failed: ' + e.message);
    if (btn) { btn.disabled = false; btn.innerHTML = '$ Divs'; }
  }
}

// === SCREEN TAB ===
async function loadScreenData() {
  try {
    const res = await GET('/api/screener/funds');
    _screenData = res.funds || [];
    if (res.state) _screenState = res.state;
    if (_screenState.running) startScreenPoll();
    renderApp();
  } catch(e) {
    console.error(e);
  }
}

async function startScreenRefresh() {
  try {
    await POST('/api/screener/refresh', {});
    startScreenPoll();
    renderApp();
  } catch(e) {
    toast('Refresh failed: ' + e.message);
  }
}

function startScreenPoll() {
  if (_screenPollTimer) return;
  _screenPollTimer = setInterval(async () => {
    try {
      _screenState = await GET('/api/screener/status');
      if (!_screenState.running) {
        clearInterval(_screenPollTimer);
        _screenPollTimer = null;
        const res = await GET('/api/screener/funds');
        _screenData = res.funds || [];
      }
      renderApp();
    } catch(e) {}
  }, 2000);
}

function applyScreenFilters(funds) {
  const wlTickers = new Set(_prices.map(p => p.ticker));
  return funds.filter(f => {
    if (_screenFilters.hideWatchlist && wlTickers.has(f.ticker)) return false;
    if (_screenFilters.monthlyOnly && f.dist_freq !== 'Monthly') return false;
    if (_screenFilters.minYield != null && (f.yield_pct == null || f.yield_pct < _screenFilters.minYield)) return false;
    if (_screenFilters.maxPremium != null && (f.premium_discount == null || f.premium_discount > _screenFilters.maxPremium)) return false;
    if (_screenFilters.minHistory != null) {
      const yrs = inceptionYears(f.inception_date);
      if (yrs == null || yrs < _screenFilters.minHistory) return false;
    }
    if (_screenFilters.minNavChange != null && (f.nav_cagr == null || f.nav_cagr < _screenFilters.minNavChange)) return false;
    return true;
  });
}

function inceptionYears(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  return Math.floor((Date.now() - d) / (365.25 * 24 * 60 * 60 * 1000));
}

function readScreenFilters() {
  const v = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  const cb = id => { const el = document.getElementById(id); return el ? el.checked : false; };
  const num = s => s === '' ? null : parseFloat(s);
  _screenFilters = {
    minYield:      num(v('sf-yield')),
    maxPremium:    num(v('sf-disc')),
    monthlyOnly:   cb('sf-monthly'),
    minHistory:    num(v('sf-history')),
    minNavChange:  num(v('sf-navchg')),
    hideWatchlist: cb('sf-hide-wl'),
  };
  renderApp();
}

function clearScreenFilters() {
  _screenFilters = { minYield: null, maxPremium: null, monthlyOnly: false, minHistory: null, minNavChange: null, hideWatchlist: false };
  renderApp();
}

function renderScreen() {
  const state = _screenData.length === 0 ? 'empty' : 'loaded';
  const isRunning = _screenPollTimer != null;

  const filtered = applyScreenFilters(_screenData);
  const defaultSort = _sortCol ? _sortCol : 'premium_discount';
  const defaultAsc  = _sortCol ? _sortAsc : true;
  const sorted = sortData(filtered, defaultSort, defaultAsc);

  const wlTickers = new Set(_prices.map(p => p.ticker));
  const heldTickers = new Set(_holdings.filter(h => h.shares > 0).map(h => h.ticker));

  // Progress bar
  const progressHtml = isRunning ? (() => {
    const done  = _screenState.done  || 0;
    const total = _screenState.total || 0;
    const errors = _screenState.errors?.length || 0;
    const pct = total ? Math.round(done / total * 100) : 0;
    const errStr = errors ? ` · <span style="color:var(--red)">${errors} error${errors > 1 ? 's' : ''}</span>` : '';
    return `<div style="margin-bottom:12px">
      <div style="font-size:12px;color:var(--text-2);margin-bottom:4px">Fetching fund data… ${done} / ${total}${errStr}</div>
      <div style="height:4px;background:var(--surface2);border-radius:2px">
        <div style="height:4px;background:var(--accent);border-radius:2px;width:${pct}%;transition:width 0.3s"></div>
      </div>
    </div>`;
  })() : '';

  const lastFetched = _screenData.length ? _screenData[0].fetched_at : null;

  return `
    <div style="padding:0 0 24px">
      ${progressHtml}

      <div class="filter-panel">
        <div class="filter-row">
          <label class="filter-label">Min Yield</label>
          <div class="filter-input-group">
            <input type="number" id="sf-yield" class="filter-input" placeholder="8" value="${_screenFilters.minYield ?? ''}" oninput="readScreenFilters()">
            <span class="filter-unit">%</span>
          </div>
          <label class="filter-label">Max Disc/Prem</label>
          <div class="filter-input-group">
            <input type="number" id="sf-disc" class="filter-input" placeholder="-5" value="${_screenFilters.maxPremium ?? ''}" oninput="readScreenFilters()">
            <span class="filter-unit">%</span>
          </div>
          <label class="filter-label">Min History</label>
          <div class="filter-input-group">
            <input type="number" id="sf-history" class="filter-input" placeholder="10" value="${_screenFilters.minHistory ?? ''}" oninput="readScreenFilters()">
            <span class="filter-unit">yr</span>
          </div>
          <label class="filter-label">NAV Δ1Y ≥</label>
          <div class="filter-input-group">
            <input type="number" id="sf-navchg" class="filter-input" placeholder="-5" value="${_screenFilters.minNavChange ?? ''}" oninput="readScreenFilters()">
            <span class="filter-unit">%</span>
          </div>
          <label class="filter-check"><input type="checkbox" id="sf-monthly" ${_screenFilters.monthlyOnly ? 'checked' : ''} onchange="readScreenFilters()"> Monthly</label>
          <label class="filter-check"><input type="checkbox" id="sf-hide-wl" ${_screenFilters.hideWatchlist ? 'checked' : ''} onchange="readScreenFilters()"> Hide watchlist</label>
          <button class="btn btn-ghost btn-sm" onclick="clearScreenFilters()" style="margin-left:auto">Clear</button>
          <button class="btn btn-ghost btn-sm${isRunning ? ' disabled' : ''}" onclick="startScreenRefresh()" ${isRunning ? 'disabled' : ''}>
            ${isRunning ? '<span class="spinner"></span> Fetching…' : '↻ Refresh Results'}
          </button>
        </div>
      </div>

      <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;display:flex;gap:16px">
        <span>Showing <strong>${filtered.length}</strong> of ${_screenData.length} funds</span>
        ${lastFetched ? `<span>Updated ${formatTime(lastFetched)}</span>` : ''}
        ${state === 'empty' && !isRunning ? `<span style="color:var(--accent)">No data yet — click ↻ Refresh Data to populate</span>` : ''}
      </div>

      ${sorted.length ? `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              ${th('ticker', 'Ticker', true, 1)}
              ${th('name', 'Name', true, 2)}
              ${th('category', 'Category', true, 3)}
              ${th('yield_pct', 'Yield')}
              ${th('dist_freq', 'Freq', true)}
              ${th('premium_discount', 'Disc/Prem')}
              ${th('nav_cagr', 'NAV/yr', false, false, '5-year annualized NAV growth rate (from CEFConnect history)')}
              ${th('dist_cagr', 'Dist/yr', false, false, 'Annualized distribution change rate since inception (first → last complete year)')}
              ${th('inception_date', 'Since', true)}
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${sorted.map(f => screenRow(f, wlTickers, heldTickers)).join('')}
          </tbody>
        </table>
      </div>` : (state !== 'empty' ? `<div class="empty-state"><p>No funds match the current filters.</p></div>` : '')}
    </div>`;
}

function screenRow(f, wlTickers, heldTickers) {
  const inWl = wlTickers.has(f.ticker);
  const inPort = heldTickers.has(f.ticker);
  const yrs = inceptionYears(f.inception_date);
  const statusDot = inPort
    ? `<span title="In portfolio" style="color:var(--green);margin-right:4px">●</span>`
    : inWl
    ? `<span title="In watchlist" style="color:var(--accent);margin-right:4px">●</span>`
    : '';
  const navChg = f.nav_cagr != null
    ? `<span class="${f.nav_cagr >= 0 ? 'positive' : 'negative'}" title="5Y annualized NAV change">${f.nav_cagr >= 0 ? '+' : ''}${f.nav_cagr.toFixed(2)}%</span>`
    : '—';
  const distChg = f.dist_cagr != null
    ? `<span class="${f.dist_cagr >= 0 ? 'positive' : 'negative'}">${f.dist_cagr >= 0 ? '+' : ''}${f.dist_cagr.toFixed(2)}%</span>`
    : '—';
  return `
    <tr>
      <td class="left col-sticky">
        ${statusDot}<a class="ticker-link" href="${tickerUrl(f.ticker, f.type)}" target="_blank">${f.ticker}</a>
      </td>
      <td class="left col-sticky-2" style="color:var(--text-2)">${f.name || ''}</td>
      <td class="left col-sticky-3" style="color:var(--text-muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;max-width:120px">${f.category || '—'}</td>
      <td>${f.yield_pct != null ? f.yield_pct.toFixed(2) + '%' : '—'}</td>
      <td style="color:var(--text-2)">${f.dist_freq || '—'}</td>
      <td class="${discClass(f.premium_discount)}" title="${f.avg_discount_1y != null ? '1Y avg: ' + fmtDisc(f.avg_discount_1y) : ''}">${fmtDisc(f.premium_discount)}</td>
      <td>${navChg}</td>
      <td>${distChg}</td>
      <td style="color:var(--text-muted)">${yrs != null ? yrs + 'y' : '—'}</td>
      <td>${inWl ? '' : `<button class="btn btn-ghost btn-sm" onclick="addFromScreener('${f.ticker}','${(f.name||'').replace(/'/g,"\\'")}')">+ Watch</button>`}</td>
    </tr>`;
}

async function addFromScreener(ticker, name) {
  try {
    await POST('/api/funds', { ticker, name, type: 'CEF' });
    await POST('/api/prices/refresh-one', { ticker });
    await Promise.all([loadAll(), loadScreenData()]);
    renderApp();
    toast(`${ticker} added to watchlist`);
  } catch(e) {
    toast('Error: ' + e.message);
  }
}

// === SORT ===
function th(col, label, left = false, sticky = 0, title = '') {
  const pos = sticky === true ? 1 : +sticky;
  const stickyClass = pos === 1 ? 'col-sticky ' : pos === 2 ? 'col-sticky-2 ' : pos === 3 ? 'col-sticky-3 ' : '';
  const sorted = _sortCol === col;
  return `<th class="${left ? 'left ' : ''}${stickyClass}${sorted ? 'sorted' : ''}${sorted && _sortAsc ? ' asc' : ''}"${title ? ` title="${title}"` : ''} onclick="setSort('${col}')">${label}</th>`;
}

function setSort(col) {
  if (_sortCol === col) _sortAsc = !_sortAsc;
  else { _sortCol = col; _sortAsc = false; }
  // Preserve horizontal scroll positions across all table containers
  const scrollPositions = [...document.querySelectorAll('.table-wrap')].map(el => el.scrollLeft);
  renderApp();
  document.querySelectorAll('.table-wrap').forEach((el, i) => {
    if (scrollPositions[i]) el.scrollLeft = scrollPositions[i];
  });
}

function sortData(arr, col, asc) {
  return arr.slice().sort((a, b) => {
    const av = a[col] ?? (typeof a[col] === 'number' ? -Infinity : '');
    const bv = b[col] ?? (typeof b[col] === 'number' ? -Infinity : '');
    if (av < bv) return asc ? -1 : 1;
    if (av > bv) return asc ? 1 : -1;
    return 0;
  });
}

// === TAB ===
function setTab(tab) {
  if (_tab === 'watchlist' && tab !== 'watchlist') _inactiveFunds = null;
  _tab = tab;
  _sortCol = null;
  _hideHeld = tab === 'watchlist';
  if (tab === 'screen' && !_screenData.length) loadScreenData();
  if (tab === 'portfolio' && !Object.keys(_navSparklines).length) {
    loadSparklines().then(renderApp);
  }
  renderApp();
}

function toggleHideHeld() {
  _hideHeld = !_hideHeld;
  renderApp();
}

async function toggleInactive() {
  _showInactive = !_showInactive;
  if (_showInactive && _inactiveFunds === null) {
    _inactiveFunds = await GET('/api/funds/inactive');
    renderApp();
    // Fill placeholder names in background, then refresh the list
    const hasStubs = _inactiveFunds.some(f => f.name === f.ticker);
    if (hasStubs) {
      POST('/api/funds/fill-names', {}).then(async () => {
        _inactiveFunds = await GET('/api/funds/inactive');
        renderApp();
      }).catch(() => {});
    }
  }
  renderApp();
}


// === HELPERS ===
function tickerUrl(ticker, type) {
  return (type || '').toUpperCase() === 'BDC'
    ? `https://finance.yahoo.com/quote/${ticker}`
    : `https://www.cefconnect.com/fund/${ticker}`;
}
function fmt$(n) { return n != null ? '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'; }
function fmtGain$(n) { return n != null ? (n >= 0 ? '+' : '') + fmt$(n) : '—'; }
function fmtPct(n) { return n != null ? (n >= 0 ? '+' : '') + n.toFixed(2) + '%' : '—'; }

function fmtDisc(n) {
  if (n == null) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

function fmtDiscCell(current, avg) {
  if (current == null) return '—';
  if (avg == null) return fmtDisc(current);
  const delta = current - avg;
  const sign = delta >= 0 ? '+' : '';
  const tooltip = `Current: ${fmtDisc(current)}  |  1Y avg: ${fmtDisc(avg)}`;
  const cls = delta <= 0 ? 'disc-mild' : 'prem-mild';
  return `<span title="${tooltip}" style="border-bottom:1px dotted var(--text-muted);cursor:default" class="${cls}">${sign}${delta.toFixed(2)}%</span>`;
}

function discClass(n) {
  if (n == null) return 'disc-neutral';
  if (n <= -8) return 'disc-deep';
  if (n < 0)   return 'disc-mild';
  if (n === 0) return 'disc-neutral';
  if (n <= 5)  return 'prem-mild';
  return 'prem-high';
}

function gainClass(n) {
  if (n == null) return '';
  return n >= 0 ? 'positive' : 'negative';
}

function formatTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr.endsWith('Z') ? isoStr : isoStr + 'Z');
  return d.toLocaleTimeString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Given a quarter-end date string (YYYY-MM-DD), estimate when the next 10-Q/10-K report is due.
// BDCs typically file ~45 days after quarter-end.
function fmtNavCell(h) {
  if (!h.manual_nav_date) return fmt$(h.nav);
  const reportDate = nextBDCReportDate(h.manual_nav_date);
  const stale = reportDate && reportDate < new Date();
  const reportStr = reportDate
    ? reportDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;
  const tooltip = stale
    ? `NAV as of ${fmtNavDate(h.manual_nav_date)} — new data available since ${reportStr}, update needed`
    : `NAV as of ${fmtNavDate(h.manual_nav_date)} — next report est. ${reportStr}`;
  const style = stale
    ? 'color:var(--red);border-bottom:1px dotted var(--red);cursor:default'
    : 'border-bottom:1px dotted var(--text-muted);cursor:default';
  return `<span title="${tooltip}" style="${style}">${fmt$(h.nav)}</span>`;
}

function nextBDCReportDate(navDateStr) {
  if (!navDateStr) return null;
  const d = new Date(navDateStr + 'T00:00:00');
  const qEnds = [[2, 31], [5, 30], [8, 30], [11, 31]];
  let nextQEnd = null;
  for (const [m, day] of qEnds) {
    const qe = new Date(d.getFullYear(), m, day);
    if (qe > d) { nextQEnd = qe; break; }
  }
  if (!nextQEnd) nextQEnd = new Date(d.getFullYear() + 1, 2, 31);
  return new Date(nextQEnd.getTime() + 45 * 24 * 60 * 60 * 1000);
}

function nextBDCReport(navDateStr) {
  const d = nextBDCReportDate(navDateStr);
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
}

function fmtNavDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

let _toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

// === REVERSE SPLIT DETECTION ===
function showSplitAlert(sa) {
  document.getElementById('modal-root').innerHTML = `
    <div class="modal-backdrop">
      <div class="modal" onclick="event.stopPropagation()" style="max-width:440px">
        <div class="modal-header">
          <h2>Reverse Split Detected — ${sa.ticker}</h2>
          <button class="btn btn-ghost btn-sm" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body">
          <p style="margin-bottom:12px">
            <strong>${sa.ticker}</strong> price jumped from <strong>$${sa.old_price.toFixed(2)}</strong>
            to <strong>$${sa.new_price.toFixed(2)}</strong> — this looks like a
            <strong>1-for-${sa.ratio}</strong> reverse stock split.
          </p>
          <table style="width:100%;font-size:13px;margin-bottom:12px">
            <tr><td style="color:var(--text-muted)">Current shares</td><td style="text-align:right">${sa.current_shares.toLocaleString()}</td></tr>
            <tr><td style="color:var(--text-muted)">Adjusted shares (÷${sa.ratio}, rounded down)</td><td style="text-align:right"><strong>${sa.suggested_shares.toLocaleString()}</strong></td></tr>
            ${sa.fractional_shares > 0 ? `<tr><td style="color:var(--text-muted)">Fractional shares cashed out</td><td style="text-align:right">${sa.fractional_shares.toFixed(4)}</td></tr>
            <tr><td style="color:var(--text-muted)">Cost basis reduction</td><td style="text-align:right">−$${sa.cost_basis_reduction.toFixed(2)}</td></tr>` : ''}
          </table>
          <p style="font-size:12px;color:var(--text-muted)">
            Shares rounded down to whole number. Cost basis reduced proportionally for the cashed-out fractional portion.
          </p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal()">Dismiss</button>
          <button class="btn btn-primary" onclick="applySplit('${sa.ticker}', ${sa.ratio})">Adjust Shares</button>
        </div>
      </div>
    </div>`;
}

async function applySplit(ticker, ratio) {
  const holding = _holdings.find(h => h.ticker === ticker);
  if (!holding) { closeModal(); return; }
  const exact = holding.shares / ratio;
  const newShares = Math.floor(exact);
  const fractionLost = exact - newShares;
  const costPerShare = holding.cost_basis / holding.shares;
  const costReduction = fractionLost * ratio * costPerShare;  // cost basis of fractional pre-split shares
  const newCostBasis = +(holding.cost_basis - costReduction).toFixed(2);
  try {
    await PUT(`/api/holdings/${ticker}`, {
      ticker,
      shares: newShares,
      cost_basis: newCostBasis,
      dividends_received: holding.dividends_received,
      manual_nav: holding.manual_nav || null,
      manual_nav_date: holding.manual_nav_date || null,
      notes: holding.notes || '',
    });
    closeModal();
    await loadAll();
    renderApp();
    toast(`${ticker} shares adjusted: ${holding.shares} → ${newShares} (1:${ratio} reverse split)`);
  } catch(e) {
    toast('Error adjusting shares: ' + e.message);
  }
}

// === START ===
init();
