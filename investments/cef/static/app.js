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
let _importCsv = null;   // raw Schwab CSV awaiting confirm
let _importPlan = null;
let _importResult = null;  // survives the re-render after a confirmed import
let _summaryView = 'current';   // 'current' | 'lifetime'
let _lifetime = null;           // GET /api/holdings/lifetime
let _showInactive = false;
let _inactiveFunds = null;  // null = not yet loaded
let _screenPollTimer = null;
let _navSparklines = {};    // {ticker: [{date, nav}]}
let _alertThreshold = 3;    // pp wider than avg triggers alert
let _showIncomeProjection = false;
let _audits = {};           // {ticker: latest audit} — drives the grade badges
let _settings = {};         // server-side settings (see cef/settings.py)
let _auditRunning = {};     // {ticker: true} while an audit is in flight

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
    let settingsResp;
    [_prices, _holdings, _distributions, _audits, settingsResp] = await Promise.all([
      GET('/api/prices/latest'),
      GET('/api/holdings'),
      GET('/api/distributions'),
      GET('/api/audit').catch(() => ({})),
      GET('/api/settings').catch(() => null),
    ]);
    _settings = settingsResp?.settings || {};
    if (_prices.length) _lastUpdated = _prices[0].fetched_at;
  } catch(e) {
    console.error(e);
  }
}

function setting(key, fallback) {
  const v = _settings[key];
  return v === undefined || v === null ? fallback : v;
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
        ${_tab === 'portfolio' ? `<button class="btn btn-ghost btn-sm" onclick="auditAllHeld()"
          title="Run the distribution audit on every held position, one at a time">⚖ Audit all</button>` : ''}
        ${_tab === 'watchlist' ? `<button class="btn btn-ghost btn-sm" onclick="auditAllWatchlist()"
          title="Audit every fund currently shown on the watchlist, one at a time">⚖ Audit all</button>` : ''}
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

  // Summary bar. Every figure here describes the *current* portfolio, so the
  // distribution rows must be filtered to held tickers too — otherwise income
  // from long-sold positions is measured against today's cost basis, which is
  // how Yield on Cost reached 24.7%.
  const heldTickers = new Set(positions.map(h => h.ticker));
  const heldDists = _distributions.filter(d => heldTickers.has(d.ticker));

  const totalCost = positions.reduce((s, h) => s + (h.cost_basis || 0), 0);
  const totalMkt  = positions.reduce((s, h) => s + (h.market_value || 0), 0);
  const totalDivs = heldDists.reduce((s, d) => s + d.total, 0);
  const totalUnr  = totalMkt - totalCost;

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentYearStr = String(currentYear);
  const lastYearStr = String(currentYear - 1);

  // Dividends by year from distributions
  const divsByYear = {};
  for (const d of heldDists) {
    const yr = d.ex_date.substring(0, 4);
    divsByYear[yr] = (divsByYear[yr] || 0) + d.total;
  }
  const ttmCutoff = new Date(now);
  ttmCutoff.setFullYear(ttmCutoff.getFullYear() - 1);
  const ttmCutoffStr = ttmCutoff.toISOString().slice(0, 10);
  const ttmDivs = heldDists
    .filter(d => d.ex_date > ttmCutoffStr)
    .reduce((s, d) => s + d.total, 0);
  const yieldOnCost = totalCost && ttmDivs ? (ttmDivs / totalCost * 100) : null;

  // Last month's dividends
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthStr = lastMonthDate.toISOString().slice(0, 7); // "YYYY-MM"
  const lastMonthDivs = heldDists
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

  // Earliest recorded distribution per ticker — fallback "owned since" date when acquired_date isn't set
  const earliestDistByTicker = {};
  for (const d of _distributions) {
    if (!earliestDistByTicker[d.ticker] || d.ex_date < earliestDistByTicker[d.ticker]) {
      earliestDistByTicker[d.ticker] = d.ex_date;
    }
  }

  const posWithDelta = positions.map(h => {
    // Pre-compute derived columns so header sort works (sortData reads row fields, not the inline <td>)
    const p = _prices.find(p => p.ticker === h.ticker);
    const distPerShare = p?.distribution;
    const distFreq = (p?.dist_freq || '').toLowerCase();
    const periodsPerYear = distFreq.includes('month') ? 12 : distFreq.includes('quarter') ? 4 : distFreq.includes('annual') ? 1 : 12;
    // Annualized total return (CAGR) from acquired_date, falling back to first recorded distribution
    const startDate = h.acquired_date || earliestDistByTicker[h.ticker] || null;
    let annualized_return = null, hold_years = null;
    if (startDate && h.total_return_pct != null) {
      hold_years = (now - new Date(startDate)) / (365.25 * 24 * 3600 * 1000);
      if (hold_years >= 0.5) {
        annualized_return = +(((1 + h.total_return_pct / 100) ** (1 / hold_years) - 1) * 100).toFixed(2);
      }
    }
    return {
      ...h,
      disc_vs_avg: h.premium_discount != null && h.avg_discount_1y != null ? h.premium_discount - h.avg_discount_1y : null,
      // Normalized coverage ratio — comparable across CEFs (NAV total return ÷
      // distributed) and BDCs (NII ÷ dividend), so one column sorts both.
      coverage_ratio: coverageRatio(h),
      cost_per_share: h.shares ? h.cost_basis / h.shares : null,
      yoc: (distPerShare && h.shares && h.cost_basis) ? distPerShare * h.shares * periodsPerYear / h.cost_basis * 100 : null,
      annualized_return,
      hold_years,
      hold_start: startDate,
      hold_start_estimated: !h.acquired_date && !!startDate,
      weight: totalMkt && h.market_value ? h.market_value / totalMkt * 100 : null
    };
  });
  const sorted = sortData(posWithDelta, _sortCol || 'ticker', _sortCol ? _sortAsc : true);

  return `
    ${_summaryView === 'lifetime'
      ? lifetimeSummaryBar()
      : `<div class="summary-bar">
      ${summaryToggle()}
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
    </div>`}

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th class="col-num">#</th>
            ${th('ticker', 'Ticker', true, 1)}
            ${th('name', 'Name', true, 2)}
            ${th('type', 'Type', true, 3)}
            ${th('shares', 'Shares')}
            ${th('price', 'Price')}
            ${th('price_change_pct', 'Day %')}
            ${th('cost_per_share', 'Cost/Sh')}
            ${th('yield_pct', 'Yield', false, false, 'Current market yield')}
            ${th('yoc', 'YoC', false, false, 'Yield on cost basis (annualized distributions / total cost)')}
            ${th('coverage_ratio', 'Coverage', false, false, 'Is the yield paying for itself? For CEFs: earned yield (NAV total return) ÷ distributed yield, taken over rolling 3-year windows. For BDCs: net investment income ÷ dividend, as filed. At or above 1.0× the payout is earned; below it, the shortfall comes out of principal. Run the audit (badge beside the ticker) to populate.')}
            ${th('disc_vs_avg', 'δ vs Avg', false, false, 'Current disc/premium relative to its 1-year average. Negative = trading cheaper than usual.')}
            ${th('unrealized_gain', 'Unr. Gain')}
            ${th('dividends_received', 'Divs')}
            ${th('total_return', 'Total Ret')}
            ${th('total_return_pct', 'Ret %')}
            ${th('hold_years', 'Held', false, false, 'Time owned — since acquired date, or estimated (~) from the first recorded distribution. This is the period the annualized return is computed over.')}
            ${th('annualized_return', 'Ann Ret', false, false, 'Annualized total return (CAGR) since acquired date — falls back to first recorded distribution if no acquired date is set. Needs ≥6 months held.')}
            ${th('market_value', 'Mkt Val')}
            ${th('weight', '% Port')}
          </tr>
        </thead>
        <tbody>
          ${portfolioBody(sorted, totalMkt)}
        </tbody>
      </table>
    </div>
    ${renderIncomeProjection(positions)}`;
}

/** Rows, optionally grouped by security type with per-group subtotals.
 *  Grouping rather than separate tabs: 18 of the 21 columns mean the same
 *  thing for both types, and a split table would break the whole-portfolio
 *  denominator that makes the % Port column and the summary bar meaningful. */
function portfolioBody(sorted, totalMkt) {
  if (!setting('display.group_by_type', true)) {
    return sorted.map((h, i) => portfolioRow(h, totalMkt, i + 1)).join('');
  }
  const groups = {};
  sorted.forEach(h => { (groups[h.type || '—'] ||= []).push(h); });
  const order = ['CEF', 'BDC'].filter(k => groups[k])
    .concat(Object.keys(groups).filter(k => k !== 'CEF' && k !== 'BDC'));

  let idx = 0;
  const out = [];
  for (const type of order) {
    const rows = groups[type];
    const value = rows.reduce((s, h) => s + (h.market_value || 0), 0);
    const pct = totalMkt ? (value / totalMkt * 100) : null;
    out.push(`
      <tr class="group-header">
        <td colspan="20">
          ${type}
          <span class="group-meta">${rows.length} position${rows.length > 1 ? 's' : ''}
            · ${fmt$(value)}${pct != null ? ` · ${pct.toFixed(1)}% of portfolio` : ''}</span>
        </td>
      </tr>`);
    rows.forEach(h => out.push(portfolioRow(h, totalMkt, ++idx)));
  }
  return out.join('');
}

function portfolioRow(h, totalMkt, idx) {
  const costPerShare = h.shares ? (h.cost_basis / h.shares) : null;
  // Yield on cost: annualized distributions / cost basis
  const p = _prices.find(p => p.ticker === h.ticker);
  const distPerShare = p?.distribution;
  const distFreq = (p?.dist_freq || '').toLowerCase();
  const periodsPerYear = distFreq.includes('month') ? 12 : distFreq.includes('quarter') ? 4 : distFreq.includes('annual') ? 1 : 12;
  const yoc = (distPerShare && h.shares && h.cost_basis)
    ? (distPerShare * h.shares * periodsPerYear / h.cost_basis * 100)
    : null;

  const heldStr = h.hold_years != null
    ? (h.hold_start_estimated ? '~' : '') + (h.hold_years >= 1 ? h.hold_years.toFixed(1) + 'y' : Math.round(h.hold_years * 12) + 'mo')
    : '—';
  const heldTitle = h.hold_start
    ? `Owned since ${h.hold_start}${h.hold_start_estimated ? ' (estimated from first distribution — set an acquired date for accuracy)' : ''}`
    : 'No acquired date or recorded distributions yet';
  const annRetTitle = h.annualized_return != null
    ? `Annualized total return (CAGR) over ${h.hold_years.toFixed(1)} yrs since ${h.hold_start}${h.hold_start_estimated ? ' (estimated from first distribution — set an acquired date for accuracy)' : ''}`
    : h.hold_start
      ? `Held ${h.hold_years != null && h.hold_years >= 1 ? h.hold_years.toFixed(1) + ' yrs' : 'under 1 yr'} — needs ≥6 months to annualize`
      : 'Set an acquired date (or record a distribution) to compute annualized return';

  return `
    <tr onclick="openHoldingModal('${h.ticker}')">
      <td class="col-num">${idx}</td>
      <td class="left col-sticky">
        <span class="ticker-cell"><a class="ticker-link" href="${tickerUrl(h.ticker, h.type)}" target="_blank" onclick="event.stopPropagation()">${h.ticker}</a>${gradeBadge(h.ticker)}</span>
      </td>
      <td class="left col-sticky-2" style="color:var(--text-2)">${h.name || ''}</td>
      <td class="left col-sticky-3"><span class="badge-type ${(h.type||'').toLowerCase()}">${h.type || ''}</span></td>
      <td>${h.shares != null ? h.shares.toLocaleString() : '—'}</td>
      <td>${fmt$(h.price)}</td>
      <td class="${gainClass(h.price_change_pct)}">${h.price_change_pct != null ? (h.price_change_pct >= 0 ? '+' : '') + h.price_change_pct.toFixed(2) + '%' : '—'}</td>
      <td>${costPerShare != null ? fmt$(costPerShare) : '—'}</td>
      ${yieldCell(h)}
      <td class="positive" title="Yield on cost basis">${yoc != null ? yoc.toFixed(2) + '%' : '—'}</td>
      ${coverageCell(h)}
      <td>${fmtDiscCell(h.premium_discount, h.avg_discount_1y)}</td>
      <td class="${gainClass(h.unrealized_gain)}">${fmtGain$(h.unrealized_gain)}</td>
      <td class="positive" onclick="event.stopPropagation(); openDivModal('${h.ticker}')" style="cursor:pointer;text-decoration:underline dotted" title="Click to view distribution history">${fmt$(h.dividends_received)}</td>
      <td class="${gainClass(h.total_return)}">${fmtGain$(h.total_return)}</td>
      <td class="${gainClass(h.total_return_pct)}">${h.total_return_pct != null ? fmtPct(h.total_return_pct) : '—'}</td>
      <td style="color:var(--text-2)" title="${heldTitle}">${heldStr}</td>
      <td class="${gainClass(h.annualized_return)}" title="${annRetTitle}">${h.annualized_return != null ? fmtPct(h.annualized_return) : '—'}</td>
      <td>${fmt$(h.market_value)}</td>
      <td>${h.weight != null ? h.weight.toFixed(1) + '%' : '—'}</td>
    </tr>`;
}

/** Coverage ratio from the audit, falling back to the legacy earned/distributed
 *  figures stored on the prices row when a fund hasn't been audited yet. */
function coverageRatio(h) {
  const a = _audits[h.ticker];
  if (a?.detail?.headline_ratio != null) return a.detail.headline_ratio;
  if (h.earned_yield_life != null && h.dist_yield_life > 0) {
    return h.earned_yield_life / h.dist_yield_life;
  }
  if (h.earned_yield_1y != null && h.dist_yield_1y > 0) {
    return h.earned_yield_1y / h.dist_yield_1y;
  }
  return null;
}

function coverageCell(h) {
  const a = _audits[h.ticker];
  const r = coverageRatio(h);
  if (r == null) {
    return `<td style="color:var(--text-muted)" title="Run the audit (badge beside the ticker) to measure coverage">—</td>`;
  }
  const cls = r >= 1 ? 'cov-good' : r >= 0.7 ? 'cov-mid' : 'cov-bad';
  const src = a
    ? (a.kind === 'bdc'
        ? 'Net investment income ÷ dividend, from filed quarterly figures.'
        : 'Earned yield ÷ distributed yield, median of rolling 3-year windows.')
    : 'From stored lifetime earned/distributed yields — not yet audited.';
  const verdict = r >= 1
    ? 'The payout is fully earned.'
    : `About ${Math.round((1 - r) * 100)}% of the payout is coming out of principal.`;
  return `<td class="cov-ratio ${cls}" title="${src} ${verdict}">${r.toFixed(2)}×</td>`;
}

/** Current vs Lifetime. Both states swap the same four tiles rather than adding
 *  a row, so there is never a mix of current and all-time figures on screen. */
function summaryToggle() {
  const btn = (v, label, tip) =>
    `<button class="summary-toggle-btn${_summaryView === v ? ' active' : ''}"
       onclick="setSummaryView('${v}')" title="${tip}">${label}</button>`;
  return `<div class="summary-toggle">
    ${btn('current', 'Current', 'Positions you hold right now')}
    ${btn('lifetime', 'Lifetime', 'Every CEF and BDC ever held, including closed positions')}
  </div>`;
}

async function setSummaryView(v) {
  _summaryView = v;
  if (v === 'lifetime' && !_lifetime) {
    try { _lifetime = await GET('/api/holdings/lifetime'); }
    catch (e) { toast('Could not load lifetime figures: ' + e.message); _summaryView = 'current'; }
  }
  renderApp();
}

function lifetimeSummaryBar() {
  const L = _lifetime;
  if (!L) return `<div class="summary-bar">${summaryToggle()}
    <div class="summary-item"><div class="summary-label">Loading…</div></div></div>`;

  const note = L.incomplete.length
    ? `${L.incomplete.join(', ')} were bought before your earliest Schwab export, so their `
      + `realized gain can't be reconstructed. Their distributions are counted; the gain is not, `
      + `so this figure is understated by whatever those made or lost.`
    : '';

  return `<div class="summary-bar">
      ${summaryToggle()}
      <div class="summary-item" title="Proceeds minus cost on ${L.closed_positions} closed positions">
        <div class="summary-label">Realized <span style="font-size:10px;opacity:0.5">ⓘ</span></div>
        <div class="summary-value ${L.realized >= 0 ? 'positive' : 'negative'}">${fmtGain$(L.realized)}</div>
      </div>
      <div class="summary-item" title="Every distribution ever received, held and sold positions alike">
        <div class="summary-label">Distributions <span style="font-size:10px;opacity:0.5">ⓘ</span></div>
        <div class="summary-value positive">${fmt$(L.dividends)}</div>
      </div>
      <div class="summary-item" title="Open gain on the ${L.held_positions} positions held now">
        <div class="summary-label">Unrealized <span style="font-size:10px;opacity:0.5">ⓘ</span></div>
        <div class="summary-value ${L.unrealized >= 0 ? 'positive' : 'negative'}">${fmtGain$(L.unrealized)}</div>
      </div>
      <div class="summary-item" title="Realized + distributions + unrealized, CEF and BDC only${L.earliest ? `, from ${L.earliest} onward — the earliest transaction on record` : ''}">
        <div class="summary-label">Lifetime <span style="font-size:10px;opacity:0.5">CEF/BDC${
          L.earliest ? ' · since ' + fmtMonthYear(L.earliest) : ''}</span></div>
        <div class="summary-value ${L.lifetime >= 0 ? 'positive' : 'negative'}">${fmtGain$(L.lifetime)}</div>
      </div>
    </div>
    <div class="lifetime-note">
      ${L.earliest ? `Covers ${L.earliest} to today — the earliest transaction on record. ` : ''}${L.closed_positions} closed + ${L.held_positions} current positions.
      ETF, stock and options activity is excluded.
      ${note ? `<br><span class="grade-tip-warn">${note}</span>` : ''}
    </div>`;
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
    disc_vs_avg: p.premium_discount != null && p.avg_discount_1y != null ? p.premium_discount - p.avg_discount_1y : null,
    coverage_ratio: coverageRatio(p)
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
            ${th('coverage_ratio', 'Coverage', false, false, 'Is the yield paying for itself? For CEFs: earned yield ÷ distributed yield over rolling 3-year windows. For BDCs: net investment income ÷ dividend, as filed. At or above 1.0× the payout is earned. Run the audit (badge beside the ticker) to populate.')}
            ${th('dist_freq', 'Freq', true)}
            ${th('date', 'As Of', true)}
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${watchlistBody(sorted, held)}
        </tbody>
      </table>
    </div>
    ${renderInactiveFunds()}`;
}

function watchlistBody(sorted, held) {
  if (!setting('display.group_by_type', true)) {
    return sorted.map(p => watchlistRow(p, held.has(p.ticker))).join('');
  }
  const groups = {};
  sorted.forEach(p => { (groups[p.type || '—'] ||= []).push(p); });
  const order = ['CEF', 'BDC'].filter(k => groups[k])
    .concat(Object.keys(groups).filter(k => k !== 'CEF' && k !== 'BDC'));

  return order.map(type => {
    const rows = groups[type];
    return `
      <tr class="group-header">
        <td colspan="11">${type}<span class="group-meta">${rows.length} fund${rows.length > 1 ? 's' : ''}</span></td>
      </tr>` + rows.map(p => watchlistRow(p, held.has(p.ticker))).join('');
  }).join('');
}

function watchlistRow(p, isHeld = false) {
  return `
    <tr onclick="openHoldingModal('${p.ticker}')">
      <td class="left col-sticky">
        <span class="ticker-cell"><span class="ticker-name">${isHeld ? '<span title="In portfolio" style="color:var(--green);font-size:8px;margin-right:4px">●</span>' : ''}<a class="ticker-link" href="${tickerUrl(p.ticker, p.type)}" target="_blank" onclick="event.stopPropagation()">${p.ticker}</a></span>${gradeBadge(p.ticker)}</span>
      </td>
      <td class="left col-sticky-2" style="color:var(--text-2)">${p.name || ''}</td>
      <td class="left col-sticky-3"><span class="badge-type ${(p.type||'').toLowerCase()}">${p.type || ''}</span></td>
      <td>${fmtDiscCell(p.premium_discount, p.avg_discount_1y)}</td>
      <td>${fmt$(p.price)}</td>
      <td>${fmt$(p.nav)}</td>
      ${yieldCell(p)}
      ${coverageCell(p)}
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
// The CSV is parsed and applied server-side (cef/services/schwab_import.py) so
// this upload and the command-line importer share one implementation. Parsing
// it here as well is how the two drifted apart in the first place.

function renderImport() {
  return `
    <div style="max-width:640px;margin:0 auto;display:flex;flex-direction:column;gap:24px">
      <div>
        <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-bottom:10px;text-transform:uppercase;letter-spacing:0.05em">Import Schwab Transactions</div>
        <p style="font-size:13px;color:var(--text-2);margin:0 0 12px;line-height:1.55">
          In Schwab: <strong>Accounts → History → Export</strong>, choose the <strong>All</strong>
          date range, download the CSV, then select it below. Re-importing the same file is safe —
          distributions are rebuilt from the export rather than added to.
        </p>
        <input type="file" accept=".csv" onchange="onSchwabUpload(this)" style="color:var(--text-2)">
        <div id="import-status" style="font-size:13px;color:var(--text-2);margin-top:8px"></div>
        ${_importResult ? `<div style="margin-top:12px;padding:10px 12px;border-left:3px solid var(--green);
          background:rgba(46,204,113,0.08);border-radius:var(--radius-sm);font-size:13px;line-height:1.5">
          <strong style="color:var(--green)">Import complete.</strong> ${_importResult}
        </div>` : ''}
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
  _importResult = null;
  const status = document.getElementById('import-status');
  if (status) status.textContent = 'Reading ' + file.name + '…';
  _importCsv = await file.text();

  try {
    const plan = await POST('/api/imports/preview', { csv: _importCsv });
    renderImportPlan(plan);
    if (status) {
      status.innerHTML = `Read <strong>${file.name}</strong> — ${plan.tickers} tickers, `
        + `${plan.date_range.min || ''} to ${plan.date_range.max || ''}`;
    }
  } catch (e) {
    if (status) status.innerHTML = `<span style="color:var(--red)">${e.message}</span>`;
    document.getElementById('import-preview').style.display = 'none';
  }
}

function renderImportPlan(plan) {
  _importPlan = plan;
  document.getElementById('import-preview').style.display = '';
  const btn = document.getElementById('import-confirm-btn');
  if (btn) { btn.disabled = false; btn.textContent = 'Confirm Import'; }

  const section = (title, body) => body
    ? `<h4 style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);margin:16px 0 8px">${title}</h4>${body}`
    : '';

  const acquired = plan.acquired.length ? `<table style="width:100%;font-size:13px">
      <thead><tr><th class="left" style="position:static">Ticker</th>
        <th class="left" style="position:static">Current</th>
        <th class="left" style="position:static">From export</th></tr></thead>
      <tbody>${plan.acquired.map(a => `<tr>
        <td class="left">${a.ticker}</td>
        <td class="left" style="color:var(--text-muted)">${a.from || '—'}</td>
        <td class="left positive">${a.to}</td></tr>`).join('')}</tbody></table>` : '';

  const shares = plan.shares.length ? `<table style="width:100%;font-size:13px">
      <thead><tr><th class="left" style="position:static">Ticker</th>
        <th style="position:static">Stored</th><th style="position:static">Export</th>
        <th style="position:static">Change</th></tr></thead>
      <tbody>${plan.shares.map(s => `<tr>
        <td class="left">${s.ticker}</td><td>${s.from}</td><td>${s.to}</td>
        <td class="${s.to >= s.from ? 'positive' : 'negative'}">${(s.to - s.from) >= 0 ? '+' : ''}${(s.to - s.from).toFixed(0)}</td>
        </tr>`).join('')}</tbody></table>` : '';

  const divs = plan.divs.length ? (() => {
    const shown = plan.divs.slice().sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from));
    const net = plan.divs.reduce((s, d) => s + (d.to - d.from), 0);
    return `<table style="width:100%;font-size:13px">
      <thead><tr><th class="left" style="position:static">Ticker</th>
        <th style="position:static">Stored</th><th style="position:static">Export</th>
        <th style="position:static">Change</th></tr></thead>
      <tbody>${shown.slice(0, 8).map(d => `<tr>
        <td class="left">${d.ticker}</td><td>${fmt$(d.from)}</td><td>${fmt$(d.to)}</td>
        <td class="${d.to >= d.from ? 'positive' : 'negative'}">${fmtGain$(d.to - d.from)}</td>
        </tr>`).join('')}
        ${shown.length > 8 ? `<tr><td class="left" colspan="3" style="color:var(--text-muted)">+ ${shown.length - 8} more</td><td></td></tr>` : ''}
        <tr><td class="left" style="font-weight:600">Net</td><td></td><td></td>
          <td class="${net >= 0 ? 'positive' : 'negative'}" style="font-weight:600">${fmtGain$(net)}</td></tr>
      </tbody></table>`;
  })() : '';

  document.getElementById('import-preview-content').innerHTML = `
    <div style="display:flex;gap:20px;padding:10px 12px;background:var(--surface2);border-radius:var(--radius-sm);font-size:13px">
      <div><div style="font-size:11px;color:var(--text-muted)">Trades</div><div>${plan.trades}</div></div>
      <div><div style="font-size:11px;color:var(--text-muted)">Distribution rows</div><div>${plan.distributions}</div></div>
      <div><div style="font-size:11px;color:var(--text-muted)">Tickers</div><div>${plan.tickers}</div></div>
      ${plan.merged_dates ? `<div title="Several payments on one date are summed into a single row — a regular dividend alongside a special or a year-end capital gain"><div style="font-size:11px;color:var(--text-muted)">Same-date merges</div><div>${plan.merged_dates}</div></div>` : ''}
    </div>
    ${plan.partial.length ? `<div style="margin-top:14px;padding:10px 12px;border-left:3px solid var(--yellow);
      background:rgba(240,192,64,0.08);border-radius:var(--radius-sm);font-size:12.5px;line-height:1.5">
      <strong>Partial export detected</strong> for ${plan.partial.join(', ')}. These were sold during the
      export window but bought before it starts, so share counts can't be rebuilt from this file.
      Distributions and trades will still import; share counts and acquired dates are left untouched.
      Export with the <strong>All</strong> date range to update those.
    </div>` : ''}
    ${section('Acquired dates', acquired)}
    ${section('Share counts', shares)}
    ${section('Distributions received', divs)}
    ${plan.new_tickers.length ? section('Not imported — untracked tickers',
      `<div style="font-size:13px;color:var(--text-2);line-height:1.5">
        ${plan.new_tickers.join(', ')}
        <div style="color:var(--text-muted);margin-top:6px">Everything traded in the account
        appears in the export, so these are left alone rather than filed as funds. Add any you
        want tracked via <strong>+ Add Fund</strong>, then re-import to pick up their history.</div>
      </div>`) : ''}`;
}

async function confirmImport() {
  if (!_importCsv) return;
  const btn = document.getElementById('import-confirm-btn');
  const resultEl = document.getElementById('import-result');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Importing…'; }
  try {
    const res = await POST('/api/imports/confirm', { csv: _importCsv });
    // renderApp() rebuilds this tab, so the outcome has to live in state
    // rather than in an element that is about to be replaced.
    _importResult = `${res.distributions} distribution rows written, ${res.trades} new trades, `
      + `${res.holdings} positions updated`
      + (res.skipped_tickers ? `, ${res.skipped_tickers} untracked tickers skipped.` : '.');
    _importCsv = null;
    _importPlan = null;
    await loadAll();
    renderApp();
    toast(`Import complete — ${res.holdings} positions updated`);
  } catch (e) {
    if (resultEl) resultEl.innerHTML = `<span style="color:var(--red)">Error: ${e.message}</span>`;
    if (btn) { btn.disabled = false; btn.textContent = 'Confirm Import'; }
  }
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
            <div title="Earned yield (total return on NAV) vs distributed yield, trailing 1 year"><div style="font-size:11px;color:var(--text-muted)">Earned/Dist 1Y</div><div class="${merged.earned_yield_1y != null && merged.dist_yield_1y != null ? (merged.earned_yield_1y >= merged.dist_yield_1y ? 'positive' : 'negative') : ''}">${merged.earned_yield_1y != null && merged.dist_yield_1y != null ? merged.earned_yield_1y.toFixed(1) + ' / ' + merged.dist_yield_1y.toFixed(1) : '—'}</div></div>
            <div title="Earned vs distributed yield, annualized over up to 5 years (or since inception)"><div style="font-size:11px;color:var(--text-muted)">Earned/Dist Life</div><div class="${merged.earned_yield_life != null && merged.dist_yield_life != null ? (merged.earned_yield_life >= merged.dist_yield_life ? 'positive' : 'negative') : ''}">${merged.earned_yield_life != null && merged.dist_yield_life != null ? merged.earned_yield_life.toFixed(1) + ' / ' + merged.dist_yield_life.toFixed(1) : '—'}</div></div>
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
          <div class="form-row">
            <div class="form-group">
              <label>Dividends Received ($)</label>
              <input type="number" id="h-divs" min="0" step="0.01" value="${merged.dividends_received || ''}">
            </div>
            <div class="form-group">
              <label>Acquired Date</label>
              <input type="date" id="h-acquired" value="${merged.acquired_date || ''}" title="When you bought this position — drives annualized return. If blank, the first recorded distribution is used as an estimate." style="width:160px">
            </div>
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
    // The header shows holdings.dividends_received and this tile sums the rows
    // below. They describe the same money, so a gap means the two are out of
    // sync — say which is which rather than printing two silent totals.
    const recorded = holding.dividends_received;
    const drift = recorded != null ? recorded - totalIncome : 0;
    const mismatch = Math.abs(drift) > 0.01;

    body.innerHTML = `
      <div style="display:flex;gap:16px;margin-bottom:12px;padding:8px;background:var(--surface2);border-radius:var(--radius-sm)">
        <div><div style="font-size:11px;color:var(--text-muted)">Latest</div><div>${fmt$(latest)}/sh</div></div>
        <div><div style="font-size:11px;color:var(--text-muted)">6-Period Avg</div><div>${prev6avg > 0 ? fmt$(prev6avg) + '/sh' : '—'}</div></div>
        <div><div style="font-size:11px;color:var(--text-muted)">Trend</div><div>${trendBadge || '—'}</div></div>
        <div><div style="font-size:11px;color:var(--text-muted)">${mismatch ? 'Sum of rows below' : 'Total Received'}</div><div class="positive">${fmt$(totalIncome)}</div></div>
      </div>
      ${mismatch ? `<div style="margin-bottom:12px;padding:9px 11px;border-left:3px solid var(--yellow);
        background:rgba(240,192,64,0.08);border-radius:var(--radius-sm);font-size:12px;line-height:1.5">
        The ${fmt$(recorded)} above is the recorded total for this position; the rows below
        sum to ${fmt$(totalIncome)}, a difference of ${fmtGain$(drift)}.
        ${drift > 0 ? 'Some payments are missing from the list — most often several landing on one date, since only one row per date can be stored.'
                    : 'The list holds more than the recorded total; re-run the transaction import to resync.'}
      </div>` : ''}
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
  const acquired_date = document.getElementById('h-acquired')?.value || null;
  const notes = document.getElementById('h-notes')?.value || '';
  try {
    await PUT(`/api/holdings/${ticker}`, { ticker, shares, cost_basis, dividends_received, manual_nav, manual_nav_date, acquired_date, notes });
    closeModal();
    await loadAll();
    renderApp();
    toast(`${ticker} updated`);
  } catch(e) {
    toast('Error: ' + e.message);
  }
}

// Earned (total return on NAV) vs distributed (distributions/NAV) yield — paired cell.
// Green when the distribution is being out-earned (NAV holding/growing), red when it erodes NAV.
function yieldPairCell(earned, distributed, period, years) {
  if (earned == null || distributed == null) {
    return `<td style="color:var(--text-muted)" title="No NAV history available (CEFs on CEFConnect only)">—</td>`;
  }
  const covered = earned >= distributed;
  const cls = covered ? 'positive' : 'negative';
  const span = years != null ? ` (${years}y)` : '';
  const tip = `${period}${span}: earned ${earned.toFixed(1)}% on NAV vs ${distributed.toFixed(1)}% distributed. `
    + (covered
        ? 'Distribution out-earned — NAV holding or growing.'
        : 'Distribution exceeds what the fund earned — NAV eroding (effectively return of capital).');
  return `<td class="${cls}" title="${tip}" style="white-space:nowrap">${earned.toFixed(1)} / ${distributed.toFixed(1)}</td>`;
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

  const filtered = applyScreenFilters(_screenData).map(f => ({
    ...f,
    coverage_1y: f.earned_yield_1y != null && f.dist_yield_1y != null ? f.earned_yield_1y - f.dist_yield_1y : null,
    coverage_life: f.earned_yield_life != null && f.dist_yield_life != null ? f.earned_yield_life - f.dist_yield_life : null,
  }));
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
              ${th('coverage_1y', '1Y E/D', false, false, 'Earned yield (total return on NAV) vs Distributed yield (distributions ÷ NAV), trailing 1 year. Green = distribution out-earned, NAV growing; red = NAV eroding. Sorted by the earned−distributed gap.')}
              ${th('coverage_life', 'Life E/D', false, false, 'Earned vs Distributed yield, annualized over up to 5 years (or since inception). Green = sustainable; red = NAV-eroding.')}
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
      ${yieldCell(f)}
      <td style="color:var(--text-2)">${f.dist_freq || '—'}</td>
      <td class="${discClass(f.premium_discount)}" title="${f.avg_discount_1y != null ? '1Y avg: ' + fmtDisc(f.avg_discount_1y) : ''}">${fmtDisc(f.premium_discount)}</td>
      ${yieldPairCell(f.earned_yield_1y, f.dist_yield_1y, '1-Year')}
      ${yieldPairCell(f.earned_yield_life, f.dist_yield_life, 'Lifetime', f.yield_life_years)}
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

// Yield cell — marks funds whose displayed yield excludes special distributions (regular-only)
function yieldCell(o) {
  if (o.yield_pct == null) return '<td title="Current market yield">—</td>';
  if (o.has_special_dist) {
    const last = o.last_special_date ? ` Last special ${o.last_special_date}: ${fmt$(o.last_special_amount)}.` : '';
    return `<td title="Regular-only yield — special distributions excluded so the figure isn't skewed by year-end/ROC payouts.${last}">${o.yield_pct.toFixed(2)}%<sup style="color:var(--accent,#5a7a52)">*</sup></td>`;
  }
  return `<td title="Current market yield">${o.yield_pct.toFixed(2)}%</td>`;
}

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
      acquired_date: holding.acquired_date || null,
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

// ════════════════════════════════════════════════════════════════
// POSITION AUDIT — grade badge, hover card, detail modal
// ════════════════════════════════════════════════════════════════

const GRADE_CLASS = { A: 'grade-a', B: 'grade-b', C: 'grade-c', D: 'grade-d', F: 'grade-f' };

function gradeClassFor(grade) {
  return grade ? (GRADE_CLASS[grade[0]] || 'grade-unknown') : 'grade-none';
}

/** The badge lives in the sticky ticker cell, so it stays visible while the
 *  table scrolls horizontally. One element carries every state: run button
 *  when unaudited, spinner while running, letter grade once complete. */
function gradeBadge(ticker) {
  if (_auditRunning[ticker]) {
    return `<span class="grade-badge running" title="Auditing ${ticker}…"><span class="grade-spin"></span></span>`;
  }
  const a = _audits[ticker];
  const attrs = `onmouseenter="showGradeTip(event,'${ticker}')" onmouseleave="hideGradeTip()"`
              + ` onclick="event.stopPropagation();onGradeClick(event,'${ticker}')"`;

  if (!a) {
    return `<span class="grade-badge grade-none" ${attrs} title="Run distribution audit">·</span>`;
  }
  const cls = [gradeClassFor(a.grade)];
  if (a.stale) cls.push('stale');
  if (a.confidence === 'low') cls.push('low-conf');
  return `<span class="grade-badge ${cls.join(' ')}" ${attrs}>${a.grade || '?'}</span>`;
}

function showGradeTip(ev, ticker) {
  hideGradeTip();
  const a = _audits[ticker];
  const tip = document.createElement('div');
  tip.className = 'grade-tip';
  tip.id = 'grade-tip';

  if (!a) {
    tip.innerHTML = `<div class="grade-tip-head">${ticker}</div>
      <div class="grade-tip-verdict">Not audited yet.</div>
      <div class="grade-tip-foot">Click to check whether the yield is paying for itself.</div>`;
  } else {
    const d = a.detail || {};
    const c = d.components || {};
    const ratio = d.headline_ratio;
    const rows = [];
    if (ratio != null) {
      rows.push(['Coverage', `${ratio.toFixed(2)}× ${ratio >= 1 ? 'earned' : 'of payout earned'}`]);
    }
    if (a.kind === 'bdc') {
      if (c.nav_trend?.cagr != null) rows.push(['NAV/share', fmtSigned(c.nav_trend.cagr) + '/yr']);
      if (c.dist_stability?.cuts != null) rows.push(['Dividend cuts', String(c.dist_stability.cuts)]);
    } else {
      if (c.nav_trend?.cagr != null) rows.push(['NAV trend', fmtSigned(c.nav_trend.cagr) + '/yr']);
      if (c.payout_power?.ratio_to_earning_power != null) {
        rows.push(['Payout vs earnings', fmtPayoutRatio(c.payout_power)]);
      }
    }
    const pos = c.your_return?.position;
    if (pos?.annualized != null) rows.push(['Your return', fmtSigned(pos.annualized) + '/yr']);

    const warns = (a.flags || []).filter(f => f.severity === 'warn' || f.severity === 'error');
    const foot = [];
    // Say so when the ownership component sat out, otherwise a watchlist grade
    // and a portfolio grade look like the same measurement when they aren't.
    if (!pos) foot.push('Fund quality only — not held');
    if (a.rubric_changed) foot.push('<span class="grade-tip-warn">Rubric changed since this ran</span>');
    else if (a.stale) foot.push(`<span class="grade-tip-warn">${a.age_days}d old — re-run</span>`);
    if (a.confidence === 'low') foot.push('<span class="grade-tip-warn">Low confidence</span>');
    if (warns.length) foot.push(`${warns.length} data flag${warns.length > 1 ? 's' : ''}`);
    foot.push('Click for full audit');

    tip.innerHTML = `
      <div class="grade-tip-head">
        <span class="grade-badge ${gradeClassFor(a.grade)}" style="cursor:default;margin:0">${a.grade || '?'}</span>
        <span>${ticker}</span>
        ${a.score != null ? `<span style="color:var(--text-muted);font-weight:400">${a.score.toFixed(0)}/100</span>` : ''}
      </div>
      <div class="grade-tip-verdict">${a.verdict || ''}</div>
      ${rows.map(([k, v]) => `<div class="grade-tip-row"><span>${k}</span><span>${v}</span></div>`).join('')}
      <div class="grade-tip-foot">${foot.join(' · ')}</div>`;
  }

  document.body.appendChild(tip);
  positionNear(tip, ev);
}

function hideGradeTip() {
  document.getElementById('grade-tip')?.remove();
}

/** Anchor a floating element near the click/hover point, clamped to viewport. */
function positionNear(el, ev) {
  const pad = 8;
  const r = el.getBoundingClientRect();
  let left = (ev?.clientX ?? window.innerWidth / 2) + 14;
  let top = (ev?.clientY ?? window.innerHeight / 2) + 14;
  if (left + r.width + pad > window.innerWidth) left = window.innerWidth - r.width - pad;
  if (top + r.height + pad > window.innerHeight) top = Math.max(pad, window.innerHeight - r.height - pad);
  el.style.left = Math.max(pad, left) + 'px';
  el.style.top = Math.max(pad, top) + 'px';
}

/** A fund earning ~nothing produces an arbitrarily large multiple; say what's
 *  actually happening instead of quoting a capped number as if it were precise. */
function fmtPayoutRatio(comp) {
  const r = comp.ratio_to_earning_power;
  const power = comp.earning_power;
  if (r == null) return '—';
  if (power != null && power <= 0.5) return 'pays out, earns ~nothing';
  return (r >= 10 ? '>10' : r.toFixed(1)) + '×';
}

/** "2021-06-01" -> "Jun 2021". Parsed as parts, not via Date(), so it can't
 *  shift a day backwards in a timezone west of UTC. */
function fmtMonthYear(iso) {
  if (!iso) return '';
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [y, m] = iso.split('-');
  return `${M[(+m || 1) - 1]} ${y}`;
}

function fmtSigned(v, digits = 1) {
  if (v == null) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(digits) + '%';
}

function onGradeClick(ev, ticker) {
  hideGradeTip();
  if (_auditRunning[ticker]) return;
  if (_audits[ticker]) openAuditModal(ticker, ev);
  else runAudit(ticker);
}

async function runAudit(ticker, reopen = false) {
  _auditRunning[ticker] = true;
  renderApp();
  try {
    const result = await POST('/api/audit/' + ticker, {});
    _audits = { ..._audits, [ticker]: { ...result, age_days: 0, stale: false, rubric_changed: false } };
    toast(`${ticker} audited — ${result.grade || 'not gradeable'}`);
  } catch (e) {
    toast('Audit failed: ' + e.message);
  } finally {
    delete _auditRunning[ticker];
    renderApp();
    if (reopen) openAuditModal(ticker);
  }
}

function auditAllHeld() {
  return auditSweep(_holdings.filter(h => h.shares > 0).map(h => h.ticker), 'positions');
}

/** Watchlist sweep covers whatever the current filter shows, so "Audit all"
 *  means what's on screen rather than a hidden superset. */
function auditAllWatchlist() {
  const held = new Set(_holdings.filter(h => h.shares > 0).map(h => h.ticker));
  const visible = (_hideHeld ? _prices.filter(p => !held.has(p.ticker)) : _prices)
    .map(p => p.ticker);
  return auditSweep(visible, 'watchlist funds');
}

async function auditSweep(tickers, label) {
  if (!tickers.length) return toast('Nothing to audit');
  toast(`Auditing ${tickers.length} ${label}…`);
  for (const t of tickers) {
    _auditRunning[t] = true;
    renderApp();
    try {
      const r = await POST('/api/audit/' + t, {});
      _audits = { ..._audits, [t]: { ...r, age_days: 0, stale: false, rubric_changed: false } };
    } catch (e) { /* keep going; one bad ticker shouldn't stop the sweep */ }
    delete _auditRunning[t];
    renderApp();
  }
  toast('Audit sweep complete');
}

// ── Full audit modal ──────────────────────────────────────────

function openAuditModal(ticker) {
  const a = _audits[ticker];
  if (!a) return runAudit(ticker, true);
  const d = a.detail || {};
  const c = d.components || {};
  const isBdc = a.kind === 'bdc';

  const confNote = { high: '', medium: 'Medium confidence', low: 'Low confidence' }[a.confidence] || '';
  const staleNote = a.rubric_changed
    ? '<span class="grade-tip-warn">Rubric changed since this ran — re-run for a current grade</span>'
    : a.stale ? `<span class="grade-tip-warn">${a.age_days} days old</span>` : '';

  document.getElementById('modal-root').innerHTML = `
    <div class="modal-backdrop" onclick="closeModal()">
      <div class="modal modal-wide" onclick="event.stopPropagation()">
        <div class="modal-header">
          <div style="display:flex;align-items:center;gap:10px">
            <span class="grade-badge ${gradeClassFor(a.grade)}" style="cursor:default;margin:0;min-width:30px;height:24px;font-size:13px">${a.grade || '?'}</span>
            <div>
              <h2 style="margin:0">${ticker} — Distribution Audit</h2>
              <div style="font-size:12px;color:var(--text-2);margin-top:2px">
                ${a.score != null ? `Score ${a.score.toFixed(1)}/100 · ` : ''}${isBdc ? 'BDC rubric' : 'CEF rubric'}
                · Run ${(a.run_at || '').replace('T', ' ').slice(0, 16)}
                ${confNote ? ' · ' + confNote : ''}${staleNote ? ' · ' + staleNote : ''}
              </div>
            </div>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body">
          <div style="padding:10px 12px;background:var(--surface2);border-radius:var(--radius);margin-bottom:14px;line-height:1.5">
            ${a.verdict || ''}
          </div>
          ${isBdc ? bdcAuditBody(d, c) : cefAuditBody(d, c)}
          ${auditComponentTable(c, d, isBdc)}
          ${!c.your_return?.position ? `<div class="settings-hint" style="margin-top:8px">
            Not held, so the realized-return component sits out and the remaining
            weights scale up to fill it. Across the current portfolio that shifts a
            grade by about 2 points either way — comparable to a held fund's grade,
            but not identical to one.</div>` : ''}
          ${auditFlags(a.flags)}
          ${auditRubricNote(a)}
        </div>
        <div class="settings-actions" style="padding:12px 16px">
          ${isBdc ? `<button class="btn btn-ghost btn-sm" onclick="openBdcEntry('${ticker}')">Enter quarter</button>` : ''}
          <button class="btn btn-ghost btn-sm" onclick="showAuditHistory('${ticker}')">History</button>
          <button class="btn btn-primary btn-sm" onclick="closeModal();runAudit('${ticker}', true)">Re-run audit</button>
        </div>
      </div>
    </div>`;
}

function cefAuditBody(d, c) {
  const w = d.windows || {};
  const order = [['6m', '6 months'], ['1y', '1 year'], ['2y', '2 years'], ['3y', '3 years'], ['life', 'Since inception']];
  const rows = order.filter(([k]) => w[k]).map(([k, label]) => {
    const x = w[k];
    const cls = x.ratio == null ? '' : x.ratio >= 1 ? 'positive' : x.ratio >= 0.7 ? '' : 'negative';
    return `<tr>
      <td class="left">${label}</td>
      <td style="color:var(--text-2)">${x.years}y</td>
      <td>${fmtSigned(x.earned)}</td>
      <td>${x.distributed.toFixed(1)}%</td>
      <td class="${cls}">${x.ratio != null ? x.ratio.toFixed(2) + '×' : '—'}</td>
      <td style="color:var(--text-2)">$${x.nav_start.toFixed(2)} → $${x.nav_end.toFixed(2)}</td>
    </tr>`;
  }).join('');

  const cov = c.coverage || {};
  return `
    <h4 style="font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">
      Earned vs distributed
    </h4>
    <div class="modal-scroll-x"><table style="width:100%">
      <thead><tr>
        <th class="left" style="position:static">Window</th>
        <th style="position:static">Span</th>
        <th style="position:static" title="Annualized NAV total return">Earned</th>
        <th style="position:static" title="Distributions ÷ starting NAV, annualized">Paid</th>
        <th style="position:static" title="Earned ÷ paid. Below 1.0 means part of the payout came from principal.">Cover</th>
        <th style="position:static">NAV</th>
      </tr></thead>
      <tbody>${rows || '<tr><td colspan="6" style="color:var(--text-muted)">No measurable windows.</td></tr>'}</tbody>
    </table></div>
    <div class="settings-hint">
      Grading uses the trailing 1Y and 3Y windows plus a long-run figure taken as the
      <strong>median of rolling 3-year windows</strong>${cov.rolling_3y_windows ? ` (${cov.rolling_3y_windows} of them)` : ''},
      not the single inception-to-today row above — one bad start date shouldn't decide the grade.
    </div>`;
}

function bdcAuditBody(d, c) {
  const qs = (d.quarters || []).slice().reverse();
  if (!qs.length) {
    return `<div class="settings-hint">No quarterly figures entered yet. Use “Enter quarter” below —
      the runbook in docs/ walks through where each number comes from.</div>`;
  }
  const rows = qs.map(q => {
    const cover = (q.nii_per_share != null && q.dividend_per_share)
      ? q.nii_per_share / q.dividend_per_share : null;
    const cls = cover == null ? '' : cover >= 1 ? 'positive' : cover >= 0.9 ? '' : 'negative';
    return `<tr>
      <td class="left">${q.quarter_end}</td>
      <td>${q.nii_per_share != null ? '$' + q.nii_per_share.toFixed(3) : '—'}</td>
      <td>${q.dividend_per_share != null ? '$' + q.dividend_per_share.toFixed(3) : '—'}${q.special_per_share ? `<span style="color:var(--text-muted)" title="Special dividend, on top of the regular"> +${q.special_per_share.toFixed(2)}</span>` : ''}</td>
      <td class="${cls}">${cover != null ? cover.toFixed(2) + '×' : '—'}</td>
      <td>${q.nav_per_share != null ? '$' + q.nav_per_share.toFixed(2) : '—'}</td>
      <td>${q.non_accrual_pct != null ? q.non_accrual_pct.toFixed(1) + '%' : '—'}</td>
    </tr>`;
  }).join('');
  return `
    <h4 style="font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">
      Filed quarterly figures
    </h4>
    <table style="width:100%;margin-bottom:6px">
      <thead><tr>
        <th class="left" style="position:static">Quarter</th>
        <th style="position:static">NII/sh</th>
        <th style="position:static">Div/sh</th>
        <th style="position:static">Cover</th>
        <th style="position:static">NAV/sh</th>
        <th style="position:static" title="Non-accruals at fair value">Non-acc</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function auditComponentTable(c, d, isBdc) {
  const weights = d.effective_weights || {};
  const labels = isBdc
    ? { nii_coverage: 'NII coverage', nav_trend: 'NAV/share trend', dist_stability: 'Dividend stability', your_return: 'Your return' }
    : { coverage: 'Distribution coverage', nav_trend: 'NAV trend', payout_power: 'Payout vs earning power', your_return: 'Your return' };

  const rows = Object.entries(labels).map(([key, label]) => {
    const comp = c[key] || {};
    const score = comp.score;
    const w = weights[key];
    let note = '';
    if (key === 'payout_power' && comp.payout_rate_on_nav != null) {
      note = `paying ${comp.payout_rate_on_nav.toFixed(1)}% of NAV against ${comp.earning_power != null ? fmtSigned(comp.earning_power) : '—'} earning power`;
    } else if (key === 'nav_trend' && comp.cagr != null) {
      note = `${fmtSigned(comp.cagr)}/yr${comp.consecutive_down_years > 1 ? ` · ${comp.consecutive_down_years} down years running` : ''}`;
    } else if (key === 'your_return') {
      const p = comp.position;
      note = p ? (p.annualized != null
          ? `${fmtSigned(p.annualized)}/yr over ${p.hold_years}y vs ${comp.cash_benchmark}% cash`
          : `${fmtSigned(p.total_return_pct)} total — too short to annualize`)
        : 'not held';
    } else if (key === 'coverage' && comp.ratios) {
      note = Object.entries(comp.ratios).filter(([, v]) => v != null)
        .map(([k, v]) => `${k}: ${v.toFixed(2)}×`).join(' · ');
    } else if (key === 'nii_coverage' && comp.ratio != null) {
      note = `${comp.ratio.toFixed(2)}× across ${comp.quarters_used} quarters`;
    } else if (key === 'dist_stability') {
      const bits = [`${comp.cuts || 0} regular cut(s)`];
      if (comp.specials_stopped) bits.push(`${comp.specials_stopped} quarter(s) where specials lapsed`);
      if (comp.raises_into_decline) bits.push(`${comp.raises_into_decline} raise(s) into a falling NAV`);
      note = bits.join(', ');
    }
    return `<tr>
      <td class="left">${label}</td>
      <td>${score != null ? score.toFixed(0) : '<span style="color:var(--text-muted)">n/a</span>'}</td>
      <td style="color:var(--text-2)">${w != null ? w.toFixed(0) + '%' : '—'}</td>
      <td class="left" style="color:var(--text-2);font-size:12px">${note}</td>
    </tr>`;
  }).join('');

  return `
    <h4 style="font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin:16px 0 8px">
      How the grade was built
    </h4>
    <div class="modal-scroll-x"><table style="width:100%">
      <thead><tr>
        <th class="left" style="position:static">Component</th>
        <th style="position:static">Score</th>
        <th style="position:static" title="Weight actually applied — components with no data reweight the rest">Weight</th>
        <th class="left" style="position:static">Detail</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

function auditFlags(flags) {
  if (!flags?.length) return '';
  const icon = { error: '✕', warn: '!', info: 'i' };
  const color = { error: 'var(--red)', warn: 'var(--yellow)', info: 'var(--text-muted)' };
  return `
    <h4 style="font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin:16px 0 8px">
      Data checks
    </h4>
    <div style="display:flex;flex-direction:column;gap:6px">
      ${flags.map(f => `
        <div style="display:flex;gap:8px;font-size:12px;line-height:1.45">
          <span style="color:${color[f.severity] || 'var(--text-muted)'};font-weight:700;flex-shrink:0">${icon[f.severity] || '·'}</span>
          <span style="color:var(--text-2)">${f.message}</span>
        </div>`).join('')}
    </div>
    <div class="settings-hint" style="margin-top:8px">
      Data discrepancies never change the grade — a stale or missing figure is a tooling
      problem, not a fund problem. They lower confidence instead.
    </div>`;
}

function auditRubricNote(a) {
  const s = a.settings || {};
  const w = s['audit.weights'] || {};
  const parts = Object.entries(w).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}%`).join(' · ');
  return `
    <details class="settings-advanced" style="margin-top:14px">
      <summary>Rubric this grade was computed under</summary>
      <div class="settings-hint" style="margin:0">
        ${parts}<br>
        Cash benchmark ${s['audit.cash_benchmark_pct']}% ·
        Bands A≥${s['audit.grade_bands']?.A} B≥${s['audit.grade_bands']?.B} C≥${s['audit.grade_bands']?.C} D≥${s['audit.grade_bands']?.D}
        ${a.rubric_changed ? '<br><span class="grade-tip-warn">Current settings differ from these — re-run to compare like with like.</span>' : ''}
      </div>
    </details>`;
}

async function showAuditHistory(ticker) {
  try {
    const rows = await GET(`/api/audit/${ticker}/history`);
    const body = rows.map(r => `
      <tr>
        <td class="left">${(r.run_at || '').replace('T', ' ').slice(0, 16)}</td>
        <td><span class="grade-badge ${gradeClassFor(r.grade)}" style="cursor:default;margin:0">${r.grade || '?'}</span></td>
        <td>${r.score != null ? r.score.toFixed(1) : '—'}</td>
        <td class="left" style="font-size:12px;color:var(--text-2)">${r.verdict || ''}</td>
      </tr>`).join('');
    document.getElementById('modal-root').innerHTML = `
      <div class="modal-backdrop" onclick="closeModal()">
        <div class="modal modal-wide" onclick="event.stopPropagation()">
          <div class="modal-header">
            <h2>${ticker} — Audit history</h2>
            <button class="btn btn-ghost btn-sm" onclick="closeModal()">✕</button>
          </div>
          <div class="modal-body">
            <table style="width:100%">
              <thead><tr>
                <th class="left" style="position:static">Run</th>
                <th style="position:static">Grade</th>
                <th style="position:static">Score</th>
                <th class="left" style="position:static">Verdict</th>
              </tr></thead>
              <tbody>${body || '<tr><td colspan="4">No history.</td></tr>'}</tbody>
            </table>
          </div>
          <div class="settings-actions" style="padding:12px 16px">
            <button class="btn btn-ghost btn-sm" onclick="openAuditModal('${ticker}')">← Back to audit</button>
          </div>
        </div>
      </div>`;
  } catch (e) { toast('Could not load history: ' + e.message); }
}

// ════════════════════════════════════════════════════════════════
// SETTINGS PANEL (behind the Sage logo)
// ════════════════════════════════════════════════════════════════

let _settingsDraft = null;

function openSettings(ev) {
  document.getElementById('settings-panel')?.remove();
  _settingsDraft = JSON.parse(JSON.stringify(_settings));

  const panel = document.createElement('div');
  panel.className = 'settings-panel';
  panel.id = 'settings-panel';
  panel.onclick = e => e.stopPropagation();
  panel.innerHTML = settingsPanelHtml();
  document.body.appendChild(panel);

  // Anchor under the logo rather than centring — the logo is the affordance.
  const logo = document.querySelector('.nav-logo');
  const r = logo ? logo.getBoundingClientRect() : null;
  if (r) {
    panel.style.left = Math.max(8, r.left) + 'px';
    panel.style.top = (r.bottom + 10) + 'px';
  } else {
    positionNear(panel, ev);
  }
  setTimeout(() => document.addEventListener('click', closeSettingsOnOutside), 0);
}

function closeSettingsOnOutside(e) {
  if (!document.getElementById('settings-panel')?.contains(e.target)) closeSettings();
}

function closeSettings() {
  document.getElementById('settings-panel')?.remove();
  document.removeEventListener('click', closeSettingsOnOutside);
  _settingsDraft = null;
}

function draft(key, fallback) {
  const v = _settingsDraft?.[key];
  return v === undefined || v === null ? fallback : v;
}

function settingsPanelHtml() {
  const w = draft('audit.weights', {});
  const cw = draft('audit.coverage_windows', {});
  const bands = draft('audit.grade_bands', {});
  const caps = draft('audit.hard_caps', {});
  const bw = draft('audit.bdc_weights', {});

  const numRow = (label, path, value, step = 1, hint = '') => `
    <div class="settings-row">
      <label title="${hint}">${label}</label>
      <input type="number" step="${step}" value="${value ?? ''}"
             oninput="setDraft('${path}', this.value)">
    </div>`;

  const wTotal = Object.values(w).reduce((s, v) => s + (+v || 0), 0);
  const cwTotal = Object.values(cw).reduce((s, v) => s + (+v || 0), 0);
  const bwTotal = Object.values(bw).reduce((s, v) => s + (+v || 0), 0);
  const totalNote = (t) => `<div class="settings-total ${Math.abs(t - 100) < 0.01 ? 'ok' : 'bad'}">Total ${t}%${Math.abs(t - 100) < 0.01 ? '' : ' — must be 100%'}</div>`;

  return `
    <div class="settings-section">
      <h4>Audit rubric — CEF</h4>
      <div class="settings-hint">How much each component moves the letter grade.</div>
      ${numRow('Distribution coverage', 'audit.weights.coverage', w.coverage, 1, 'Earned vs distributed — the core question')}
      ${numRow('NAV trend', 'audit.weights.nav_trend', w.nav_trend)}
      ${numRow('Payout vs earning power', 'audit.weights.payout_power', w.payout_power)}
      ${numRow('Your realized return', 'audit.weights.your_return', w.your_return)}
      ${totalNote(wTotal)}
    </div>

    <div class="settings-section">
      <h4>Coverage window blend</h4>
      <div class="settings-hint">
        Weighting inside the coverage component. Long-run is the median of rolling
        3-year windows, so no single start date can decide the grade.
      </div>
      ${numRow('Trailing 1 year', 'audit.coverage_windows.y1', cw.y1)}
      ${numRow('Trailing 3 years', 'audit.coverage_windows.y3', cw.y3)}
      ${numRow('Long-run (rolling)', 'audit.coverage_windows.longrun', cw.longrun)}
      ${totalNote(cwTotal)}
    </div>

    <div class="settings-section">
      <h4>Benchmarks</h4>
      ${numRow('Cash benchmark %', 'audit.cash_benchmark_pct', draft('audit.cash_benchmark_pct'), 0.25, 'Your realized return is scored against this')}
      ${numRow('Stale after (days)', 'audit.stale_days', draft('audit.stale_days'), 1)}
      ${numRow('Discount alert (pp)', 'display.disc_alert_threshold', draft('display.disc_alert_threshold'), 0.5, 'Flag when discount is this many points wider than its average')}
    </div>

    <div class="settings-section">
      <h4>Display</h4>
      <div class="settings-row">
        <label>Group tables by type</label>
        <input type="checkbox" ${draft('display.group_by_type', true) ? 'checked' : ''}
               oninput="setDraft('display.group_by_type', this.checked)">
      </div>
    </div>

    <details class="settings-advanced">
      <summary>Advanced — grade bands, hard caps, BDC rubric</summary>
      <div class="settings-section">
        <h4>Grade bands</h4>
        <div class="settings-hint">Minimum score for each letter.</div>
        ${numRow('A', 'audit.grade_bands.A', bands.A)}
        ${numRow('B', 'audit.grade_bands.B', bands.B)}
        ${numRow('C', 'audit.grade_bands.C', bands.C)}
        ${numRow('D', 'audit.grade_bands.D', bands.D)}
      </div>
      <div class="settings-section">
        <h4>Hard caps</h4>
        <div class="settings-hint">
          Ceilings that fire regardless of blended score, so a strong recent run
          can't mask chronic distribution destruction.
        </div>
        <div class="settings-row">
          <label>Caps enabled</label>
          <input type="checkbox" ${caps.enabled ? 'checked' : ''}
                 oninput="setDraft('audit.hard_caps.enabled', this.checked)">
        </div>
        ${numRow('Coverage floor (×)', 'audit.hard_caps.coverage_floor_ratio', caps.coverage_floor_ratio, 0.05, 'Cap if coverage is under this on both 1Y and 3Y')}
        ${numRow('NAV CAGR floor (%)', 'audit.hard_caps.nav_cagr_floor', caps.nav_cagr_floor, 0.5)}
        ${numRow('Payout ceiling (×)', 'audit.hard_caps.payout_power_ceiling', caps.payout_power_ceiling, 0.1)}
      </div>
      <div class="settings-section">
        <h4>Audit rubric — BDC</h4>
        <div class="settings-hint">Graded on filed NII coverage rather than inferred NAV total return.</div>
        ${numRow('NII coverage', 'audit.bdc_weights.nii_coverage', bw.nii_coverage)}
        ${numRow('NAV/share trend', 'audit.bdc_weights.nav_trend', bw.nav_trend)}
        ${numRow('Dividend stability', 'audit.bdc_weights.dist_stability', bw.dist_stability)}
        ${numRow('Your realized return', 'audit.bdc_weights.your_return', bw.your_return)}
        ${totalNote(bwTotal)}
      </div>
    </details>

    <div class="settings-hint">
      Retuning marks every stored audit stale — a grade computed under different
      rules isn't comparable to a current one. Each audit records the rubric it ran under.
    </div>
    <div class="settings-actions">
      <button class="btn btn-ghost btn-sm" onclick="resetSettings()">Reset defaults</button>
      <button class="btn btn-ghost btn-sm" onclick="closeSettings()">Cancel</button>
      <button class="btn btn-primary btn-sm" onclick="saveSettings()">Save</button>
    </div>`;
}

/** Nested paths ("audit.weights.coverage") write into the draft object. */
function setDraft(path, raw) {
  const parts = path.split('.');
  // Setting keys themselves contain a dot ("audit.weights"), so the key is the
  // first two segments and anything after that is a field inside its object.
  const key = parts.slice(0, 2).join('.');
  const field = parts.slice(2).join('.');
  const value = typeof raw === 'boolean' ? raw : (raw === '' ? null : +raw);
  if (!field) {
    _settingsDraft[key] = value;
  } else {
    _settingsDraft[key] = { ...(_settingsDraft[key] || {}), [field]: value };
  }
  // Re-render only the running totals so focus stays in the input being typed.
  const panel = document.getElementById('settings-panel');
  if (!panel) return;
  const totals = panel.querySelectorAll('.settings-total');
  const sums = [
    Object.values(_settingsDraft['audit.weights'] || {}).reduce((s, v) => s + (+v || 0), 0),
    Object.values(_settingsDraft['audit.coverage_windows'] || {}).reduce((s, v) => s + (+v || 0), 0),
    Object.values(_settingsDraft['audit.bdc_weights'] || {}).reduce((s, v) => s + (+v || 0), 0),
  ];
  totals.forEach((el, i) => {
    const ok = Math.abs(sums[i] - 100) < 0.01;
    el.className = 'settings-total ' + (ok ? 'ok' : 'bad');
    el.textContent = `Total ${sums[i]}%` + (ok ? '' : ' — must be 100%');
  });
}

async function saveSettings() {
  try {
    const resp = await PUT('/api/settings', { settings: _settingsDraft });
    _settings = resp.settings;
    closeSettings();
    if (resp.rubric_changed) {
      _audits = await GET('/api/audit').catch(() => _audits);
      toast('Settings saved — stored audits marked stale');
    } else {
      toast('Settings saved');
    }
    renderApp();
  } catch (e) {
    toast('Could not save: ' + e.message);
  }
}

async function resetSettings() {
  try {
    const resp = await POST('/api/settings/reset', {});
    _settings = resp.settings;
    _audits = await GET('/api/audit').catch(() => _audits);
    closeSettings();
    toast('Settings reset to defaults');
    renderApp();
  } catch (e) {
    toast('Could not reset: ' + e.message);
  }
}

// ════════════════════════════════════════════════════════════════
// BDC quarterly fundamentals entry
// ════════════════════════════════════════════════════════════════

async function openBdcEntry(ticker) {
  let rows = [];
  try { rows = await GET('/api/audit/bdc/' + ticker); } catch (e) {}
  const existing = rows.map(q => `
    <tr>
      <td class="left">${q.quarter_end}</td>
      <td>${q.nii_per_share ?? '—'}</td>
      <td>${q.dividend_per_share ?? '—'}</td>
      <td>${q.nav_per_share ?? '—'}</td>
      <td>${q.non_accrual_pct ?? '—'}</td>
      <td><button class="btn btn-ghost btn-sm" onclick="deleteBdcQuarter('${ticker}','${q.quarter_end}')">✕</button></td>
    </tr>`).join('');

  document.getElementById('modal-root').innerHTML = `
    <div class="modal-backdrop" onclick="closeModal()">
      <div class="modal modal-med" onclick="event.stopPropagation()">
        <div class="modal-header">
          <div>
            <h2>${ticker} — Quarterly figures</h2>
            <div style="font-size:12px;color:var(--text-2);margin-top:2px">
              From the latest 10-Q. See the BDC audit runbook for where each number lives.
            </div>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body">
          <div class="settings-row"><label>Quarter end (YYYY-MM-DD)</label>
            <input type="text" id="bdc-q" placeholder="2026-06-30" style="width:120px"></div>
          <div class="settings-row"><label>Net investment income / share</label>
            <input type="number" step="0.001" id="bdc-nii"></div>
          <div class="settings-row"><label>Dividend declared / share</label>
            <input type="number" step="0.001" id="bdc-div"></div>
          <div class="settings-row"><label>Special dividend / share <span style="color:var(--text-muted)">(if any)</span></label>
            <input type="number" step="0.001" id="bdc-special"></div>
          <div class="settings-row"><label>NAV / share</label>
            <input type="number" step="0.01" id="bdc-nav"></div>
          <div class="settings-row"><label>Non-accruals (% of fair value)</label>
            <input type="number" step="0.1" id="bdc-na"></div>
          <div class="settings-hint">
            NII covering the dividend at 1.0× or better means the payout is earned.
            Below that, the shortfall is coming from somewhere else.
          </div>
          ${rows.length ? `
            <h4 style="font-size:12px;color:var(--text-muted);text-transform:uppercase;margin:14px 0 8px">Entered</h4>
            <table style="width:100%">
              <thead><tr>
                <th class="left" style="position:static">Quarter</th>
                <th style="position:static">NII</th><th style="position:static">Div</th>
                <th style="position:static">NAV</th><th style="position:static">Non-acc</th>
                <th style="position:static"></th>
              </tr></thead>
              <tbody>${existing}</tbody>
            </table>` : ''}
        </div>
        <div class="settings-actions" style="padding:12px 16px">
          <button class="btn btn-primary btn-sm" onclick="saveBdcQuarter('${ticker}')">Save quarter</button>
        </div>
      </div>
    </div>`;
}

async function saveBdcQuarter(ticker) {
  const val = id => {
    const el = document.getElementById(id);
    return el && el.value !== '' ? (id === 'bdc-q' ? el.value.trim() : +el.value) : null;
  };
  const quarter_end = val('bdc-q');
  if (!quarter_end) return toast('Quarter end date is required');
  try {
    await PUT('/api/audit/bdc/' + ticker, {
      quarter_end,
      nii_per_share: val('bdc-nii'),
      dividend_per_share: val('bdc-div'),
      special_per_share: val('bdc-special'),
      nav_per_share: val('bdc-nav'),
      non_accrual_pct: val('bdc-na'),
    });
    toast('Quarter saved');
    openBdcEntry(ticker);
  } catch (e) { toast('Save failed: ' + e.message); }
}

async function deleteBdcQuarter(ticker, quarterEnd) {
  try {
    await DELETE(`/api/audit/bdc/${ticker}/${quarterEnd}`);
    openBdcEntry(ticker);
  } catch (e) { toast('Delete failed: ' + e.message); }
}
