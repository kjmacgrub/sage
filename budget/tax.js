// ============================================================
// Tax Estimator — tax.js
// ============================================================

const API = 'http://localhost:5050';

// ── 2025 State Tax Rates (flat / approximate for progressive states) ────────
// Progressive states use a mid-income approximation — label shown as "~"

const STATE_RATES = {
    'AL': { name: 'Alabama',        rate: 0.050, approx: true  },
    'AK': { name: 'Alaska',         rate: 0.000, approx: false },
    'AZ': { name: 'Arizona',        rate: 0.025, approx: false },
    'AR': { name: 'Arkansas',       rate: 0.047, approx: false },
    'CA': { name: 'California',     rate: 0.093, approx: true  },
    'CO': { name: 'Colorado',       rate: 0.044, approx: false },
    'CT': { name: 'Connecticut',    rate: 0.050, approx: true  },
    'DE': { name: 'Delaware',       rate: 0.055, approx: true  },
    'FL': { name: 'Florida',        rate: 0.000, approx: false },
    'GA': { name: 'Georgia',        rate: 0.0549,approx: false },
    'HI': { name: 'Hawaii',         rate: 0.082, approx: true  },
    'ID': { name: 'Idaho',          rate: 0.058, approx: false },
    'IL': { name: 'Illinois',       rate: 0.0495,approx: false },
    'IN': { name: 'Indiana',        rate: 0.0305,approx: false },
    'IA': { name: 'Iowa',           rate: 0.038, approx: false },
    'KS': { name: 'Kansas',         rate: 0.052, approx: true  },
    'KY': { name: 'Kentucky',       rate: 0.040, approx: false },
    'LA': { name: 'Louisiana',      rate: 0.030, approx: true  },
    'ME': { name: 'Maine',          rate: 0.071, approx: true  },
    'MD': { name: 'Maryland',       rate: 0.050, approx: true  },
    'MA': { name: 'Massachusetts',  rate: 0.050, approx: false },
    'MI': { name: 'Michigan',       rate: 0.0425,approx: false },
    'MN': { name: 'Minnesota',      rate: 0.078, approx: true  },
    'MS': { name: 'Mississippi',    rate: 0.047, approx: false },
    'MO': { name: 'Missouri',       rate: 0.048, approx: true  },
    'MT': { name: 'Montana',        rate: 0.059, approx: true  },
    'NE': { name: 'Nebraska',       rate: 0.058, approx: true  },
    'NV': { name: 'Nevada',         rate: 0.000, approx: false },
    'NH': { name: 'New Hampshire',  rate: 0.000, approx: false },
    'NJ': { name: 'New Jersey',     rate: 0.063, approx: true  },
    'NM': { name: 'New Mexico',     rate: 0.049, approx: true  },
    'NY': { name: 'New York',       rate: 0.068, approx: true  },
    'NC': { name: 'North Carolina', rate: 0.045, approx: false },
    'ND': { name: 'North Dakota',   rate: 0.025, approx: true  },
    'OH': { name: 'Ohio',           rate: 0.035, approx: true  },
    'OK': { name: 'Oklahoma',       rate: 0.047, approx: false },
    'OR': { name: 'Oregon',         rate: 0.087, approx: true  },
    'PA': { name: 'Pennsylvania',   rate: 0.0307,approx: false },
    'RI': { name: 'Rhode Island',   rate: 0.047, approx: true  },
    'SC': { name: 'South Carolina', rate: 0.064, approx: true  },
    'SD': { name: 'South Dakota',   rate: 0.000, approx: false },
    'TN': { name: 'Tennessee',      rate: 0.000, approx: false },
    'TX': { name: 'Texas',          rate: 0.000, approx: false },
    'UT': { name: 'Utah',           rate: 0.0455,approx: false },
    'VT': { name: 'Vermont',        rate: 0.066, approx: true  },
    'VA': { name: 'Virginia',       rate: 0.057, approx: true  },
    'WA': { name: 'Washington',     rate: 0.000, approx: false },
    'WV': { name: 'West Virginia',  rate: 0.051, approx: true  },
    'WI': { name: 'Wisconsin',      rate: 0.053, approx: true  },
    'WY': { name: 'Wyoming',        rate: 0.000, approx: false },
};

// ── 2025 Federal Tax Parameters ─────────────────────────────

const BRACKETS = {
    mfj: [
        { limit: 23850,   rate: 0.10 },
        { limit: 96950,   rate: 0.12 },
        { limit: 206700,  rate: 0.22 },
        { limit: 394600,  rate: 0.24 },
        { limit: 501050,  rate: 0.32 },
        { limit: 751600,  rate: 0.35 },
        { limit: Infinity, rate: 0.37 },
    ],
    single: [
        { limit: 11925,   rate: 0.10 },
        { limit: 48475,   rate: 0.12 },
        { limit: 103350,  rate: 0.22 },
        { limit: 197300,  rate: 0.24 },
        { limit: 250525,  rate: 0.32 },
        { limit: 626350,  rate: 0.35 },
        { limit: Infinity, rate: 0.37 },
    ],
    hoh: [
        { limit: 17000,   rate: 0.10 },
        { limit: 64850,   rate: 0.12 },
        { limit: 103350,  rate: 0.22 },
        { limit: 197300,  rate: 0.24 },
        { limit: 250500,  rate: 0.32 },
        { limit: 626350,  rate: 0.35 },
        { limit: Infinity, rate: 0.37 },
    ],
};

const STANDARD_DEDUCTION = { mfj: 30000, single: 15000, hoh: 22500 };

// 2025 Long-Term Capital Gains / Qualified Dividend brackets
// Preferential income "stacks on top" of ordinary income to find the rate
const LTCG_BRACKETS = {
    mfj:    [{ limit: 96700,   rate: 0.00 }, { limit: 583750,  rate: 0.15 }, { limit: Infinity, rate: 0.20 }],
    single: [{ limit: 48350,   rate: 0.00 }, { limit: 517200,  rate: 0.15 }, { limit: Infinity, rate: 0.20 }],
    hoh:    [{ limit: 64750,   rate: 0.00 }, { limit: 551350,  rate: 0.15 }, { limit: Infinity, rate: 0.20 }],
};

// SS: 85% of benefits included in taxable income (simplified — applies at most
// retiree income levels above the combined-income threshold)
const SS_TAXABLE_PCT = 0.85;

// Tax characters
const CHAR_LABELS = {
    ordinary:    'Ordinary Income',
    ss:          'Social Security (85% taxable)',
    taxable_acct: 'Taxable Account Distribution (5% ord · 50% pref · 45% ROC)',
    net_withheld:'Net — Tax Already Withheld',
    nontaxable:  'Non-Taxable (Roth / ROC)',
    exclude:     'Exclude (transfer / non-income)',
};

// ── State ───────────────────────────────────────────────────

let _config    = {};   // from /api/tax/config
let _incomeRows = [];  // from /api/tax/income
let _year      = new Date().getFullYear();
let _ytdMonths = 0;

// ── Init ────────────────────────────────────────────────────

async function init() {
    try {
        // Build year selector — current year ± 3
        const yearSel = document.getElementById('taxYear');
        const cur = new Date().getFullYear();
        for (let y = cur + 1; y >= cur - 3; y--) {
            yearSel.innerHTML += `<option value="${y}" ${y === cur ? 'selected' : ''}>${y}</option>`;
        }

        // Populate state dropdown
        const stateSel = document.getElementById('stateSelect');
        Object.entries(STATE_RATES)
            .sort(([,a],[,b]) => a.name.localeCompare(b.name))
            .forEach(([code, s]) => {
                stateSel.innerHTML += `<option value="${code}">${s.name}${s.rate === 0 ? ' (no tax)' : ''}</option>`;
            });

        _config = await GET('/api/tax/config');
        applyConfig();
        await loadTaxData();
        hideError();
    } catch(e) {
        showError();
    }
}

function applyConfig() {
    const fs = document.getElementById('filingStatus');
    const ed = document.getElementById('extraDeductions');
    const rv = document.getElementById('reserveAmount');
    const st = document.getElementById('stateSelect');
    const tw = document.getElementById('taxWithheld');
    if (_config.filing_status    && fs) fs.value = _config.filing_status;
    if (_config.extra_deductions && ed) ed.value = _config.extra_deductions;
    if (_config.reserve_amount   && rv) rv.value = _config.reserve_amount;
    if (_config.state            && st) st.value = _config.state;
    if (_config.tax_withheld     && tw) tw.value = _config.tax_withheld;
}

async function loadTaxData() {
    _year = parseInt(document.getElementById('taxYear').value);
    try {
        const data = await GET(`/api/tax/income?year=${_year}`);
        _incomeRows = data.rows || [];
        computeYtdMonths();
        render();
        hideError();
    } catch(e) {
        showError();
    }
}

function computeYtdMonths() {
    const now = new Date();
    if (_year < now.getFullYear()) {
        _ytdMonths = 12;  // past year — full year
    } else if (_year > now.getFullYear()) {
        _ytdMonths = 0;   // future year — no data yet
    } else {
        _ytdMonths = now.getMonth() + 1;  // current year
    }
}

// ── Render ──────────────────────────────────────────────────

function render() {
    if (!_incomeRows.length && _ytdMonths === 0) return;

    document.getElementById('ytdMonths').textContent   = _ytdMonths;
    document.getElementById('taxYearLabel').textContent = _year;
    document.getElementById('calcYear').textContent     = _year;

    const status   = document.getElementById('filingStatus').value;
    const stateCode= document.getElementById('stateSelect')?.value || '';
    const extraDed = parseFloat(document.getElementById('extraDeductions').value) || 0;
    const stdDed   = STANDARD_DEDUCTION[status] || 30000;
    const reserve     = parseFloat(document.getElementById('reserveAmount')?.value) || 0;
    const withheld    = parseFloat(document.getElementById('taxWithheld')?.value) || 0;
    const stateInfo   = STATE_RATES[stateCode] || null;

    // Build income table with character classifications
    const chars = getCharMap();   // {category -> char}
    let totalYtd = 0, totalProj = 0;
    let taxableYtd = 0, taxableProj = 0;
    let ordTaxProj = 0, prefTaxProj = 0;
    let netWithheldProj = 0;

    const rowHtml = _incomeRows.map(r => {
        const char = chars[r.category] || 'ordinary';
        if (char === 'exclude') return '';

        const proj = _ytdMonths > 0 ? (r.total / _ytdMonths) * 12 : 0;
        const { ord: ordYtd,  pref: prefYtd  } = taxableAmounts(r.total, char);
        const { ord: ordProj, pref: prefProj } = taxableAmounts(proj,    char);
        const taxYtd  = ordYtd  + prefYtd;
        const taxProj = ordProj + prefProj;

        totalYtd  += r.total;
        totalProj += proj;
        taxableYtd  += taxYtd;
        taxableProj += taxProj;
        ordTaxProj  += ordProj;
        prefTaxProj += prefProj;
        if (char === 'net_withheld') netWithheldProj += proj;

        const exempt = char === 'nontaxable' || char === 'net_withheld';
        const charClass = char === 'net_withheld' ? 'char-exempt' : char === 'nontaxable' ? 'char-exempt' : char === 'ss' ? 'char-ss' : '';

        return `<tr>
            <td>${escH(r.category)}</td>
            <td style="text-align:right">${fmt(r.total)}</td>
            <td style="text-align:right;color:#6e6e73">${proj > 0 ? fmt(proj) : '—'}</td>
            <td><select class="char-select ${charClass}" onchange="setChar('${escA(r.category)}', this.value)">
                ${Object.entries(CHAR_LABELS).map(([v, l]) =>
                    `<option value="${v}" ${char === v ? 'selected' : ''}>${l}</option>`
                ).join('')}
            </select></td>
            <td style="text-align:right;${exempt ? 'color:#6e6e73' : ''}">${exempt ? '<em>—</em>' : fmt(taxProj)}</td>
        </tr>`;
    }).join('');

    const totalTaxYtd  = taxableYtd;
    const totalTaxProj = taxableProj;

    document.getElementById('incomeTableBody').innerHTML = rowHtml;
    document.getElementById('incomeTableFoot').innerHTML = `
        <tr class="total-row">
            <td>Total</td>
            <td style="text-align:right">${fmt(totalYtd)}</td>
            <td style="text-align:right;color:#6e6e73">${fmt(totalProj)}</td>
            <td></td>
            <td style="text-align:right;font-weight:700">${fmt(totalTaxProj)}</td>
        </tr>`;

    // Federal tax calculation (projected annual)
    // Deductions reduce ordinary income first; preferential income stacks on top
    const totalDed   = stdDed + extraDed;
    const ordAgi     = Math.max(0, ordTaxProj - totalDed);
    const prefAgi    = prefTaxProj;
    const agi        = ordAgi + prefAgi;
    const fedTaxOrd  = computeTax(ordAgi, status);
    const fedTaxPref = computeLtcgTax(ordAgi, prefAgi, status);
    const fedTax     = fedTaxOrd + fedTaxPref;
    const fedEffRate = totalProj > 0 ? (fedTax / totalProj * 100) : 0;

    // State tax — most states apply ordinary rates to all income including LTCG
    const stateTax   = stateInfo ? agi * stateInfo.rate : 0;
    const projTax    = fedTax + stateTax;
    const effRate    = totalProj > 0 ? (projTax / totalProj * 100) : 0;
    const margRate   = marginalRate(ordAgi, status);

    const stateRows = stateInfo
        ? `<tr><td>State Tax — ${stateInfo.name}${stateInfo.approx ? ' <span class="approx-note">(~approx)</span>' : ''} (${(stateInfo.rate * 100).toFixed(2)}%)</td><td class="calc-val warning-val">${stateInfo.rate === 0 ? '<em>none</em>' : fmt(stateTax)}</td></tr>`
        : '';

    // Net owed = total tax minus what was already withheld at source
    const withheldProj = _ytdMonths > 0 ? (withheld / _ytdMonths) * 12 : withheld;
    const netOwed      = projTax - withheldProj;

    document.getElementById('calcTableBody').innerHTML = `
        <tr><td>Ordinary Taxable Income (projected)</td><td class="calc-val">${fmt(ordTaxProj)}</td></tr>
        ${prefAgi > 0 ? `<tr><td style="color:#6e6e73">Preferential Income — Qual Div / LTCG</td><td class="calc-val" style="color:#6e6e73">${fmt(prefAgi)}</td></tr>` : ''}
        ${netWithheldProj > 0 ? `<tr><td style="color:#6e6e73">Net-after-tax income (excluded)</td><td class="calc-val" style="color:#6e6e73">${fmt(netWithheldProj)}</td></tr>` : ''}
        <tr><td>Standard Deduction (${status.toUpperCase()})</td><td class="calc-val negative-val">(${fmt(stdDed)})</td></tr>
        ${extraDed > 0 ? `<tr><td>Additional Deductions</td><td class="calc-val negative-val">(${fmt(extraDed)})</td></tr>` : ''}
        <tr class="calc-divider"><td>Adjusted Gross Income</td><td class="calc-val">${fmt(agi)}</td></tr>
        <tr><td>Federal Tax — ordinary brackets</td><td class="calc-val warning-val">${fmt(fedTaxOrd)}</td></tr>
        ${prefAgi > 0 ? `<tr><td>Federal Tax — preferential rate (LTCG/qual div)</td><td class="calc-val warning-val">${fmt(fedTaxPref)}</td></tr>` : ''}
        ${stateRows}
        <tr class="calc-divider"><td><strong>Total Estimated Tax</strong></td><td class="calc-val warning-val"><strong>${fmt(projTax)}</strong></td></tr>
        <tr><td>Effective Rate (on unwithheld income)</td><td class="calc-val">${effRate.toFixed(1)}%</td></tr>
        <tr><td>Marginal Rate (top ordinary bracket)</td><td class="calc-val">${(margRate * 100).toFixed(0)}%</td></tr>
        ${withheldProj > 0 ? `
        <tr style="border-top:1px solid var(--border);margin-top:4px"><td>Tax Already Withheld (projected annual)</td><td class="calc-val" style="color:var(--income-accent)">(${fmt(withheldProj)})</td></tr>
        <tr class="calc-divider"><td><strong>${netOwed >= 0 ? 'Additional Tax Owed' : 'Projected Refund'}</strong></td>
            <td class="calc-val"><strong style="color:${netOwed >= 0 ? 'var(--warning)' : 'var(--income-accent)'}">${netOwed >= 0 ? fmt(netOwed) : fmt(-netOwed) + ' refund'}</strong></td></tr>
        ` : `<tr><td>Suggested Reserve (+5% buffer)</td><td class="calc-val">${fmt(projTax * 1.05)}</td></tr>`}`;

    // Underpayment check — compare reserve against net owed (not total tax)
    const netTarget = Math.max(0, netOwed);
    const alertEl = document.getElementById('underpaymentAlert');
    if (reserve > 0 && netTarget > 0) {
        const shortfall = netTarget * 1.05 - reserve;
        if (shortfall > 500) {
            alertEl.style.display = 'block';
            alertEl.className     = 'underpayment-alert danger';
            alertEl.innerHTML     = `&#9888; Tax shortfall: ${fmt(shortfall)} more needed to cover estimated tax + 5% buffer.`;
        } else if (shortfall < -500) {
            alertEl.style.display = 'block';
            alertEl.className     = 'underpayment-alert success';
            alertEl.innerHTML     = `&#10003; On track — reserve exceeds estimate by ${fmt(-shortfall)}.`;
        } else {
            alertEl.style.display = 'none';
        }
    } else {
        alertEl.style.display = 'none';
    }

    // Summary cards
    document.getElementById('cardYtdTaxable').textContent  = fmt(totalTaxYtd);
    document.getElementById('cardProjTax').textContent     = withheldProj > 0
        ? (netOwed >= 0 ? fmt(netOwed) + ' owed' : fmt(-netOwed) + ' refund')
        : fmt(projTax);
    document.getElementById('cardProjTaxLabel').textContent = withheldProj > 0
        ? (netOwed >= 0 ? 'Projected Tax Owed' : 'Projected Refund')
        : 'Projected Annual Tax';
    document.getElementById('cardEffRate').textContent      = effRate.toFixed(1) + '%';
    document.getElementById('cardMarginalRate').textContent = (margRate * 100).toFixed(0) + '%';
    document.getElementById('cardReserve').textContent     = fmt(reserve);

    // Reserve bar
    const suggested = projTax * 1.05;
    const pct       = suggested > 0 ? Math.min(100, reserve / suggested * 100) : 0;
    document.getElementById('reserveBarFill').style.width = pct + '%';
    document.getElementById('reserveBarFill').className   = 'reserve-bar-fill ' + (pct >= 100 ? 'full' : pct >= 75 ? 'good' : 'low');
    document.getElementById('reserveBarLeft').textContent  = fmt(reserve) + ' set aside';
    document.getElementById('reserveBarRight').textContent = 'Target: ' + fmt(suggested);
    document.getElementById('reserveStatus').textContent   = `${pct.toFixed(0)}% of suggested reserve`;

    // Category classify section
    renderClassifyList(chars);

    // Show all cards
    ['summaryRow','incomeCard','calcCard','reserveCard','classifyCard'].forEach(id => {
        document.getElementById(id).style.display = id === 'summaryRow' ? 'grid' : 'block';
    });
}

// ── Tax character helpers ────────────────────────────────────

function getCharMap() {
    const prefix = 'char_';
    const map = {};
    for (const [k, v] of Object.entries(_config)) {
        if (k.startsWith(prefix)) map[k.slice(prefix.length)] = v;
    }
    return map;
}

// Returns { ord, pref } — ordinary income and preferential-rate income (qual divs / LTCG)
function taxableAmounts(amount, char) {
    switch (char) {
        case 'ordinary':     return { ord: amount,                           pref: 0 };
        case 'ss':           return { ord: amount * SS_TAXABLE_PCT,          pref: 0 };
        // 15% divs: 1/3 non-qual (ordinary) + 2/3 qualified (pref); 40% LTCG (pref); 45% ROC (non-taxable)
        case 'taxable_acct': return { ord: amount * (0.15 * 1/3),            pref: amount * (0.15 * 2/3 + 0.40) };
        case 'net_withheld': return { ord: 0,                                pref: 0 };
        case 'nontaxable':   return { ord: 0,                                pref: 0 };
        case 'exclude':      return { ord: 0,                                pref: 0 };
        default:             return { ord: amount,                           pref: 0 };
    }
}

function computeTax(taxableIncome, status) {
    const brackets = BRACKETS[status] || BRACKETS.mfj;
    let tax  = 0;
    let prev = 0;
    for (const b of brackets) {
        if (taxableIncome <= prev) break;
        const slice = Math.min(taxableIncome, b.limit) - prev;
        tax  += slice * b.rate;
        prev  = b.limit;
    }
    return tax;
}

function marginalRate(taxableIncome, status) {
    const brackets = BRACKETS[status] || BRACKETS.mfj;
    let prev = 0;
    for (const b of brackets) {
        if (taxableIncome <= prev) return brackets[0].rate;
        if (taxableIncome <= b.limit) return b.rate;
        prev = b.limit;
    }
    return brackets[brackets.length - 1].rate;
}

// Preferential rates (LTCG / qualified divs) stack on top of ordinary income
function computeLtcgTax(ordAgi, prefIncome, status) {
    const brackets = LTCG_BRACKETS[status] || LTCG_BRACKETS.mfj;
    let tax = 0, pos = ordAgi, remaining = prefIncome;
    for (const b of brackets) {
        if (remaining <= 0) break;
        if (pos >= b.limit) continue;
        const slice = Math.min(remaining, b.limit - pos);
        tax += slice * b.rate;
        remaining -= slice;
        pos += slice;
    }
    return tax;
}

// ── Character select ─────────────────────────────────────────

async function setChar(category, char) {
    const key = 'char_' + category;
    _config[key] = char;
    await POST('/api/tax/config', { [key]: char });
    render();
}

function renderClassifyList(chars) {
    const el = document.getElementById('classifyList');
    if (!_incomeRows.length) { el.innerHTML = ''; return; }

    el.innerHTML = _incomeRows.map(r => {
        const char = chars[r.category] || 'ordinary';
        return `<div class="classify-row">
            <span class="classify-cat">${escH(r.category)}</span>
            <select class="char-select" onchange="setChar('${escA(r.category)}', this.value)">
                ${Object.entries(CHAR_LABELS).map(([v, l]) =>
                    `<option value="${v}" ${char === v ? 'selected' : ''}>${l}</option>`
                ).join('')}
            </select>
        </div>`;
    }).join('');
}

// ── Config save ──────────────────────────────────────────────

async function saveConfig() {
    const updates = {
        filing_status:    document.getElementById('filingStatus').value,
        state:            document.getElementById('stateSelect')?.value || '',
        extra_deductions: document.getElementById('extraDeductions').value,
        tax_withheld:     document.getElementById('taxWithheld')?.value || '0',
    };
    Object.assign(_config, updates);
    await POST('/api/tax/config', updates);
    render();
}

async function saveReserve() {
    const val = parseFloat(document.getElementById('reserveAmount').value) || 0;
    _config.reserve_amount = val;
    await POST('/api/tax/config', { reserve_amount: val });
    showToast('Reserve saved');
    render();
}

// ── Helpers ──────────────────────────────────────────────────

function fmt(n) {
    return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function escH(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escA(s) { return String(s).replace(/'/g,"\\'"); }

async function GET(url) {
    const r = await fetch(API + url);
    if (!r.ok) throw new Error(r.status);
    return r.json();
}
async function POST(url, body) {
    const r = await fetch(API + url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error(r.status);
    return r.json();
}

let _toastTimer;
function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast show';
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

function showError() { document.getElementById('errorBanner').classList.add('visible'); }
function hideError() { document.getElementById('errorBanner').classList.remove('visible'); }

// ── Boot ─────────────────────────────────────────────────────

init().catch(() => showError());
