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

const STANDARD_DEDUCTION = { mfj: 31500, single: 15000, hoh: 22500 };

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
        rpInit();
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

// ============================================================
// Roth Conversion Planner
// ============================================================

// ── NY State brackets (2025 MFJ) ────────────────────────────

const NY_BRACKETS = [
    { limit: 17150,    rate: 0.04   },
    { limit: 23600,    rate: 0.045  },
    { limit: 27900,    rate: 0.0525 },
    { limit: 161550,   rate: 0.055  },
    { limit: 323200,   rate: 0.06   },
    { limit: 2155350,  rate: 0.0685 },
    { limit: 5000000,  rate: 0.0965 },
    { limit: Infinity, rate: 0.109  },
];

// NYC resident tax brackets (2025)
const NYC_BRACKETS = [
    { limit: 12000,    rate: 0.03078 },
    { limit: 25000,    rate: 0.03762 },
    { limit: 50000,    rate: 0.03819 },
    { limit: Infinity, rate: 0.03876 },
];

const NY_STD_DEDUCTION = 16050;
const NY_PENSION_EXCL  = 20000; // per person, for pension/IRA/annuity income

// ── Generic bracket helpers ─────────────────────────────────

function calcBracketTax(income, brackets) {
    let tax = 0, prev = 0;
    for (const b of brackets) {
        if (income <= prev) break;
        tax += (Math.min(income, b.limit) - prev) * b.rate;
        prev = b.limit;
    }
    return tax;
}

function findMarginalRate(income, brackets) {
    for (const b of brackets) {
        if (income <= b.limit) return b.rate;
    }
    return brackets[brackets.length - 1].rate;
}

function fmtK(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return Math.round(n / 1000) + 'K';
    return n.toString();
}

// ── View toggle ─────────────────────────────────────────────

function setView(view) {
    document.querySelectorAll('.view-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.view === view));
    document.getElementById('trackerView').style.display = view === 'tracker' ? '' : 'none';
    document.getElementById('plannerView').style.display = view === 'planner' ? '' : 'none';
    if (view === 'planner') rpRender();
}

// ── Planner init / save ─────────────────────────────────────

const RP_KEYS = [
    'wages','annuity','pension','interest','div_nonqual','div_qual','cg_dist',
    'ss_self','ss_spouse','cap_loss_co','extra_ded','conversion',
    'fed_withheld','state_withheld',
    'ira_balance','growth_rate','inflation',
];

const RP_DEFAULTS = {
    wages: 58500, annuity: 50649, pension: 30305, interest: 600,
    div_nonqual: 7475, div_qual: 5353, cg_dist: 4428,
    ss_self: 0, ss_spouse: 0, cap_loss_co: 36355, extra_ded: 0,
    conversion: 0, fed_withheld: 15000, state_withheld: 7000,
    ira_balance: 742000, growth_rate: 5, inflation: 2.5,
};

function rpInit() {
    const saved = JSON.parse(localStorage.getItem('sage-roth-planner') || '{}');
    const vals = { ...RP_DEFAULTS, ...saved };
    for (const [key, val] of Object.entries(vals)) {
        const el = document.getElementById('rp_' + key);
        if (el) el.value = val;
    }
    const slider = document.getElementById('rp_slider');
    if (slider) slider.value = Math.min(300000, vals.conversion || 0);
    // Restore target bracket select
    const tbSel = document.getElementById('rp_target_bracket');
    if (tbSel && saved.target_bracket) tbSel.value = saved.target_bracket;
}

function rpSave() {
    const data = {};
    for (const k of RP_KEYS) {
        const el = document.getElementById('rp_' + k);
        if (el) data[k] = parseFloat(el.value) || 0;
    }
    const tbSel = document.getElementById('rp_target_bracket');
    if (tbSel) data.target_bracket = tbSel.value;
    localStorage.setItem('sage-roth-planner', JSON.stringify(data));
}

function rpVal(id) {
    return parseFloat(document.getElementById(id)?.value) || 0;
}

function rpOnInput() { rpSave(); rpRender(); }

function rpSyncSlider(fromSlider) {
    const slider = document.getElementById('rp_slider');
    const input  = document.getElementById('rp_conversion');
    if (fromSlider) input.value = slider.value;
    else slider.value = Math.min(300000, parseInt(input.value) || 0);
    rpOnInput();
}

function rpFillBracket(targetRate) {
    const status   = 'mfj';
    const brackets = BRACKETS[status];
    const stdDed   = STANDARD_DEDUCTION[status];

    // Base ordinary income (no conversion)
    const ssTaxable  = (rpVal('rp_ss_self') + rpVal('rp_ss_spouse')) * SS_TAXABLE_PCT;
    const capLossDed = Math.min(3000, rpVal('rp_cap_loss_co'));
    const baseOrd    = rpVal('rp_wages') + rpVal('rp_annuity') + rpVal('rp_pension')
                     + rpVal('rp_interest') + rpVal('rp_div_nonqual') + ssTaxable - capLossDed;
    const baseTaxOrd = Math.max(0, baseOrd - stdDed - rpVal('rp_extra_ded'));

    let targetTop = 0;
    for (const b of brackets) {
        if (b.rate === targetRate) { targetTop = b.limit; break; }
        if (b.rate > targetRate) break;
    }
    if (!targetTop || targetTop === Infinity) return;

    const fillAmt = Math.max(0, targetTop - baseTaxOrd);
    document.getElementById('rp_conversion').value = Math.round(fillAmt);
    document.getElementById('rp_slider').value = Math.min(300000, Math.round(fillAmt));
    rpOnInput();
}

// ── Planner compute ─────────────────────────────────────────

function rpCompute() {
    const status = 'mfj';
    const wages      = rpVal('rp_wages');
    const annuity    = rpVal('rp_annuity');
    const pension    = rpVal('rp_pension');
    const interest   = rpVal('rp_interest');
    const divNq      = rpVal('rp_div_nonqual');
    const divQ       = rpVal('rp_div_qual');
    const cgDist     = rpVal('rp_cg_dist');
    const ssSelf     = rpVal('rp_ss_self');
    const ssSpouse   = rpVal('rp_ss_spouse');
    const capLossCo  = rpVal('rp_cap_loss_co');
    const extraDed   = rpVal('rp_extra_ded');
    const conversion = rpVal('rp_conversion');
    const fedWH      = rpVal('rp_fed_withheld');
    const stateWH    = rpVal('rp_state_withheld');

    const ssTotal    = ssSelf + ssSpouse;
    const ssTaxable  = ssTotal * SS_TAXABLE_PCT;
    const capLossDed = Math.min(3000, capLossCo);

    const ordinary     = wages + annuity + pension + interest + divNq + ssTaxable + conversion - capLossDed;
    const preferential = divQ + cgDist;
    const agi          = ordinary + preferential;

    const stdDed       = STANDARD_DEDUCTION[status];
    const fedTaxOrd_i  = Math.max(0, ordinary - stdDed - extraDed);
    const fedTaxOrd    = computeTax(fedTaxOrd_i, status);
    const fedTaxPref   = computeLtcgTax(fedTaxOrd_i, preferential, status);
    const fedTax       = fedTaxOrd + fedTaxPref;

    // Base (without conversion)
    const baseOrd       = ordinary - conversion;
    const baseTaxOrd_i  = Math.max(0, baseOrd - stdDed - extraDed);
    const baseFedTaxOrd = computeTax(baseTaxOrd_i, status);
    const baseFedPref   = computeLtcgTax(baseTaxOrd_i, preferential, status);
    const baseFedTax    = baseFedTaxOrd + baseFedPref;

    // NY — pension/annuity exclusion: $20K per person
    const hilaryExcl   = Math.min(NY_PENSION_EXCL, annuity);
    const kenExcl      = Math.min(NY_PENSION_EXCL, pension);
    const nyPensionExcl = hilaryExcl + kenExcl;

    const nyTaxable    = Math.max(0, agi - nyPensionExcl - NY_STD_DEDUCTION);
    const nyTax        = calcBracketTax(nyTaxable, NY_BRACKETS);
    const nycTax       = calcBracketTax(nyTaxable, NYC_BRACKETS);

    const baseNyTaxable = Math.max(0, (agi - conversion) - nyPensionExcl - NY_STD_DEDUCTION);
    const baseNyTax     = calcBracketTax(baseNyTaxable, NY_BRACKETS);
    const baseNycTax    = calcBracketTax(baseNyTaxable, NYC_BRACKETS);

    const totalTax      = fedTax + nyTax + nycTax;
    const baseTotalTax  = baseFedTax + baseNyTax + baseNycTax;
    const convCost      = totalTax - baseTotalTax;

    const margFed   = marginalRate(fedTaxOrd_i, status);
    const margNy    = findMarginalRate(nyTaxable, NY_BRACKETS);
    const margNyc   = findMarginalRate(nyTaxable, NYC_BRACKETS);
    const margAll   = margFed + margNy + margNyc;

    const effConvRate = conversion > 0 ? convCost / conversion : 0;
    const effRate     = agi > 0 ? totalTax / agi : 0;

    const bracket22top = (BRACKETS[status].find(b => b.rate === 0.22) || {}).limit || 206700;
    const roomIn22     = Math.max(0, bracket22top - baseTaxOrd_i);

    return {
        status, wages, annuity, pension, interest, divNq, divQ, cgDist,
        ssSelf, ssSpouse, ssTotal, ssTaxable, capLossCo, capLossDed,
        extraDed, conversion, ordinary, preferential, agi,
        stdDed, fedTaxOrd_i, fedTaxOrd, fedTaxPref, fedTax,
        baseTaxOrd_i, baseFedTax,
        nyPensionExcl, nyTaxable, nyTax, nycTax,
        baseNyTaxable, baseNyTax, baseNycTax,
        totalTax, baseTotalTax, convCost,
        margFed, margNy, margNyc, margAll, effRate, effConvRate,
        roomIn22, fedWH, stateWH,
    };
}

// ── Planner render ──────────────────────────────────────────

function rpRender() {
    const r = rpCompute();

    // Summary cards
    document.getElementById('rpCardBase').textContent    = fmt(r.baseTotalTax);
    document.getElementById('rpCardCost').textContent    = r.conversion > 0 ? fmt(r.convCost) : '—';
    document.getElementById('rpCardEffective').textContent = (r.effRate * 100).toFixed(1) + '%';
    document.getElementById('rpCardEffDetail').textContent =
        `${fmt(r.totalTax)} on ${fmt(r.agi)} AGI`;
    document.getElementById('rpCardMarginal').textContent = (r.margAll * 100).toFixed(1) + '%';
    document.getElementById('rpCardMargDetail').textContent =
        `Fed ${(r.margFed*100).toFixed(0)}% \u00b7 NY ${(r.margNy*100).toFixed(1)}% \u00b7 NYC ${(r.margNyc*100).toFixed(1)}%`;
    document.getElementById('rpCardRoom').textContent    = fmt(r.roomIn22);

    // Bracket visualization
    rpRenderBrackets(r);

    // Detail table
    rpRenderDetail(r);

    // Multi-year projection
    rpRenderMultiYear();
}

// ── Bracket visualization ───────────────────────────────────

function rpRenderBrackets(r) {
    const el       = document.getElementById('rpBracketViz');
    const brackets = BRACKETS[r.status];
    const maxDisp  = 320000; // show up to ~$320K

    const colors = {
        0.10: '#4a9eff', 0.12: '#34c759', 0.22: '#ff9f0a',
        0.24: '#ff6b6b', 0.32: '#af52de', 0.35: '#ff2d55', 0.37: '#8b0000',
    };

    let barHtml    = '<div class="rp-bar">';
    let labelsHtml = '<div class="rp-bar-labels">';
    let prev = 0;

    for (const b of brackets) {
        if (prev >= maxDisp) break;
        const bEnd  = Math.min(b.limit, maxDisp);
        const range = bEnd - prev;
        const w     = (range / maxDisp * 100).toFixed(2);
        const color = colors[b.rate] || '#999';

        const baseFill = Math.max(0, Math.min(r.baseTaxOrd_i - prev, range));
        const basePct  = range > 0 ? (baseFill / range * 100) : 0;

        const cStart   = Math.max(prev, r.baseTaxOrd_i);
        const cEnd     = Math.min(bEnd, r.fedTaxOrd_i);
        const cFill    = Math.max(0, cEnd - cStart);
        const cLeft    = range > 0 ? ((cStart - prev) / range * 100) : 0;
        const cPct     = range > 0 ? (cFill / range * 100) : 0;

        barHtml += `<div class="rp-seg" style="width:${w}%;--seg-color:${color}">
            <div class="rp-seg-bg"></div>
            <div class="rp-seg-base" style="width:${basePct.toFixed(1)}%"></div>
            ${cPct > 0 ? `<div class="rp-seg-conv" style="left:${cLeft.toFixed(1)}%;width:${cPct.toFixed(1)}%"></div>` : ''}
            <span class="rp-seg-rate">${(b.rate*100).toFixed(0)}%</span>
        </div>`;

        labelsHtml += `<span style="width:${w}%">$${fmtK(prev)}</span>`;
        prev = bEnd;
    }

    barHtml    += '</div>';
    labelsHtml += '</div>';

    const infoHtml = `<div class="rp-bar-info">
        <span>Base: ${fmt(r.baseTaxOrd_i)}</span>
        ${r.conversion > 0
            ? `<span class="rp-bar-conv">+ ${fmt(r.conversion)} conversion = ${fmt(r.fedTaxOrd_i)}</span>`
            : ''}
        <span>Room in 22%: ${fmt(r.roomIn22)}</span>
    </div>`;

    el.innerHTML = barHtml + labelsHtml + infoHtml;
}

// ── Detail table ────────────────────────────────────────────

function rpRenderDetail(r) {
    const el = document.getElementById('rpCalcBody');

    const hdr  = (t)        => `<tr class="rp-section-head"><td colspan="2">${t}</td></tr>`;
    const row  = (l, v, c)  => `<tr class="${c||''}"><td>${l}</td><td class="calc-val">${v}</td></tr>`;
    const drow = (l, v, c)  => `<tr class="calc-divider ${c||''}"><td>${l}</td><td class="calc-val">${v}</td></tr>`;

    let h = '';

    // ── Income
    h += hdr('Income');
    h += row('Wages (W-2)', fmt(r.wages));
    h += row('Annuity — NY Life (gross)', fmt(r.annuity));
    h += row('Pension — ADP', fmt(r.pension));
    h += row('Taxable Interest', fmt(r.interest));
    h += row('Non-Qualified Dividends', fmt(r.divNq));
    if (r.ssTaxable > 0) h += row(`Social Security (${(SS_TAXABLE_PCT*100).toFixed(0)}% of ${fmt(r.ssTotal)})`, fmt(r.ssTaxable));
    if (r.conversion > 0) h += row('\u25b6 Roth Conversion', fmt(r.conversion), 'rp-conv-row');
    if (r.capLossDed > 0) h += row('Capital Loss Deduction', '(' + fmt(r.capLossDed) + ')', 'negative-val');
    h += drow('Ordinary Income', fmt(r.ordinary));
    if (r.preferential > 0)
        h += row('Qualified Dividends + CG Distributions', fmt(r.preferential), 'rp-pref-row');
    h += drow('Adjusted Gross Income', '<strong>' + fmt(r.agi) + '</strong>');

    // ── Federal
    h += hdr('Federal Tax');
    h += row('Standard Deduction (MFJ)', '(' + fmt(r.stdDed) + ')', 'negative-val');
    if (r.extraDed > 0) h += row('Additional Deductions', '(' + fmt(r.extraDed) + ')', 'negative-val');
    h += drow('Ordinary Taxable Income', fmt(r.fedTaxOrd_i));

    // Per-bracket detail
    const brackets = BRACKETS[r.status];
    let prev = 0;
    for (const b of brackets) {
        const filled = Math.max(0, Math.min(r.fedTaxOrd_i, b.limit) - prev);
        if (filled <= 0) { prev = b.limit; continue; }
        const tax = filled * b.rate;
        const inConv = r.conversion > 0 && r.baseTaxOrd_i < b.limit && r.fedTaxOrd_i > prev;
        h += row(
            `<span style="color:var(--text-secondary)">${(b.rate*100).toFixed(0)}% on ${fmt(filled)}</span>`,
            fmt(tax), inConv ? 'rp-conv-row' : ''
        );
        prev = b.limit;
    }

    h += drow('Federal Tax — Ordinary', fmt(r.fedTaxOrd));
    if (r.preferential > 0)
        h += row('Federal Tax — Preferential (qual div / LTCG)', fmt(r.fedTaxPref));
    h += drow('<strong>Total Federal Tax</strong>', '<strong>' + fmt(r.fedTax) + '</strong>');

    // ── NY State + NYC
    h += hdr('NY State + NYC');
    h += row('NY Pension/Annuity Exclusion (2 \u00d7 $20K)', '(' + fmt(r.nyPensionExcl) + ')', 'negative-val');
    h += row('NY Standard Deduction', '(' + fmt(NY_STD_DEDUCTION) + ')', 'negative-val');
    h += row('NY Taxable Income', fmt(r.nyTaxable));
    h += row('NYS Tax', fmt(r.nyTax));
    h += row('NYC Tax', fmt(r.nycTax));
    h += drow('<strong>Total State + City</strong>', '<strong>' + fmt(r.nyTax + r.nycTax) + '</strong>');

    // ── Summary
    h += hdr('Summary');
    h += drow('<strong>Total Estimated Tax</strong>', '<strong class="warning-val">' + fmt(r.totalTax) + '</strong>');
    if (r.conversion > 0) {
        h += row('Base Tax (without conversion)', fmt(r.baseTotalTax));
        h += row('Tax Cost of ' + fmt(r.conversion) + ' Conversion', fmt(r.convCost), 'rp-conv-row');
        h += row('Effective Rate on Conversion', (r.effConvRate * 100).toFixed(1) + '%');
    }
    h += row('Federal Withheld', '(' + fmt(r.fedWH) + ')', 'negative-val');
    h += row('State/Local Withheld', '(' + fmt(r.stateWH) + ')', 'negative-val');

    const net = r.totalTax - r.fedWH - r.stateWH;
    h += drow(
        '<strong>' + (net >= 0 ? 'Net Amount Owed' : 'Projected Refund') + '</strong>',
        '<strong style="color:' + (net >= 0 ? 'var(--warning)' : 'var(--income-accent)') + '">'
            + (net >= 0 ? fmt(net) : fmt(-net)) + '</strong>'
    );

    el.innerHTML = h;
}

// ── Multi-year projection ────────────────────────────────────

function rpYearIncome(yr) {
    const y        = yr - 2026;
    const inflRate = (rpVal('rp_inflation') || 2.5) / 100;
    const inf      = Math.pow(1 + inflRate, y);

    // Wages: Ken works through 2026, partial 2027, done after
    let wages = 0;
    if (yr === 2026) wages = rpVal('rp_wages');
    else if (yr === 2027) wages = 20000;

    // Annuity: fixed payment (not inflation-adjusted)
    const annuity = rpVal('rp_annuity');

    // Pension: 2026 uses profile input; Park Slope $24K starts 2027
    let pension = 0;
    if (yr === 2026) pension = rpVal('rp_pension');
    else if (yr >= 2027) pension = 24000 * Math.pow(1 + inflRate, yr - 2027);

    // Social Security starts 2029 at FRA, COLA-adjusted
    let ssSelf = 0, ssSpouse = 0;
    if (yr >= 2029) {
        const ssInf = Math.pow(1 + inflRate, yr - 2029);
        ssSelf   = 22800 * ssInf;
        ssSpouse = 10500 * ssInf;
    }

    // Investment income grows with inflation
    const interest = rpVal('rp_interest') * inf;
    const divNq    = rpVal('rp_div_nonqual') * inf;
    const divQ     = rpVal('rp_div_qual') * inf;
    const cgDist   = rpVal('rp_cg_dist') * inf;

    // Capital loss carryover depletes by $3K/year
    const capLossCo = Math.max(0, rpVal('rp_cap_loss_co') - y * 3000);

    return { wages, annuity, pension, interest, divNq, divQ, cgDist, ssSelf, ssSpouse, capLossCo };
}

function rpCalcLtcgInflated(ordTaxable, prefIncome, inf) {
    const brackets = LTCG_BRACKETS.mfj.map(b => ({
        limit: b.limit === Infinity ? Infinity : Math.round(b.limit * inf),
        rate: b.rate,
    }));
    let tax = 0, pos = ordTaxable, rem = prefIncome;
    for (const b of brackets) {
        if (rem <= 0) break;
        if (pos >= b.limit) continue;
        const slice = Math.min(rem, b.limit - pos);
        tax += slice * b.rate;
        rem -= slice;
        pos += slice;
    }
    return tax;
}

function rpComputeMultiYear() {
    const targetRate = parseFloat(document.getElementById('rp_target_bracket')?.value || '0.22');
    const growth     = (rpVal('rp_growth_rate') || 5) / 100;
    const inflRate   = (rpVal('rp_inflation') || 2.5) / 100;
    const stateMode  = document.getElementById('rp_state')?.value || 'nyc';

    let iraBalance   = rpVal('rp_ira_balance');
    let rothBalance  = 0;
    const rows       = [];
    let totalConv = 0, totalConvCost = 0;

    for (let yr = 2026; yr <= 2035; yr++) {
        const y   = yr - 2026;
        const inf = Math.pow(1 + inflRate, y);
        const inc = rpYearIncome(yr);

        // Inflate brackets for this year
        const brackets = BRACKETS.mfj.map(b => ({
            limit: b.limit === Infinity ? Infinity : Math.round(b.limit * inf),
            rate: b.rate,
        }));
        const stdDed = Math.round(STANDARD_DEDUCTION.mfj * inf);

        // Base ordinary income (no conversion)
        const ssTaxable  = (inc.ssSelf + inc.ssSpouse) * SS_TAXABLE_PCT;
        const capLossDed = Math.min(3000, inc.capLossCo);
        const baseOrd    = inc.wages + inc.annuity + inc.pension
                         + inc.interest + inc.divNq + ssTaxable - capLossDed;
        const pref       = inc.divQ + inc.cgDist;
        const baseTaxOrd = Math.max(0, baseOrd - stdDed);

        // Find target bracket top
        let targetTop = 0;
        for (const b of brackets) {
            if (b.rate === targetRate) { targetTop = b.limit; break; }
            if (b.rate > targetRate) break;
        }

        // Conversion = room to fill bracket, limited by IRA
        const room       = Math.max(0, targetTop - baseTaxOrd);
        const conversion = Math.min(room, Math.max(0, iraBalance));

        // Tax WITH conversion
        const fedTaxOrd_i = baseTaxOrd + conversion;
        const totalAgi    = baseOrd + conversion + pref;
        const fedTax      = calcBracketTax(fedTaxOrd_i, brackets)
                          + rpCalcLtcgInflated(fedTaxOrd_i, pref, inf);

        // State + city tax based on selected mode
        let nyTax = 0, nycTax = 0, baseNyTax = 0, baseNycTax = 0;
        let nyTaxable = 0, margNy = 0, margNyc = 0;
        const baseAgi = baseOrd + pref;

        if (stateMode === 'nyc' || stateMode === 'ny') {
            const nyExcl   = Math.min(NY_PENSION_EXCL, inc.annuity)
                           + Math.min(NY_PENSION_EXCL, inc.pension);
            const nyStdDed = Math.round(NY_STD_DEDUCTION * inf);
            nyTaxable      = Math.max(0, totalAgi - nyExcl - nyStdDed);
            const nyBr     = NY_BRACKETS.map(b => ({
                limit: b.limit === Infinity ? Infinity : Math.round(b.limit * inf),
                rate: b.rate,
            }));
            nyTax          = calcBracketTax(nyTaxable, nyBr);
            margNy         = findMarginalRate(nyTaxable, nyBr);
            const baseNyTaxable = Math.max(0, baseAgi - nyExcl - nyStdDed);
            baseNyTax      = calcBracketTax(baseNyTaxable, nyBr);

            if (stateMode === 'nyc') {
                nycTax     = calcBracketTax(nyTaxable, NYC_BRACKETS);
                margNyc    = findMarginalRate(nyTaxable, NYC_BRACKETS);
                baseNycTax = calcBracketTax(baseNyTaxable, NYC_BRACKETS);
            }
        } else if (stateMode === 'flat_3' || stateMode === 'flat_5') {
            const flatRate = stateMode === 'flat_3' ? 0.03 : 0.05;
            // Simple flat tax on AGI minus standard deduction
            const stStdDed = Math.round(STANDARD_DEDUCTION.mfj * inf);
            nyTaxable      = Math.max(0, totalAgi - stStdDed);
            nyTax          = nyTaxable * flatRate;
            margNy         = flatRate;
            const baseTaxable = Math.max(0, baseAgi - stStdDed);
            baseNyTax      = baseTaxable * flatRate;
        }
        // stateMode === 'none': all stay 0

        const totalTax     = fedTax + nyTax + nycTax;

        // Tax WITHOUT conversion (base)
        const baseFedTax    = calcBracketTax(baseTaxOrd, brackets)
                            + rpCalcLtcgInflated(baseTaxOrd, pref, inf);
        const baseTotalTax  = baseFedTax + baseNyTax + baseNycTax;

        const convCost = totalTax - baseTotalTax;

        // Marginal rates at conversion level
        const margFed = findMarginalRate(fedTaxOrd_i, brackets);

        const iraStart  = iraBalance;
        const rothStart = rothBalance;
        iraBalance      = Math.max(0, iraBalance - conversion);
        rothBalance    += conversion;

        totalConv     += conversion;
        totalConvCost += convCost;

        const effRate = totalAgi > 0 ? totalTax / totalAgi : 0;

        rows.push({
            year: yr, ageH: 64 + y, ageK: 64 + y,
            baseTaxOrd, conversion, iraStart, rothEnd: rothBalance, agi: totalAgi,
            totalTax, baseTotalTax, convCost,
            margAll: margFed + margNy + margNyc, effRate,
        });

        // Grow balances
        iraBalance  *= (1 + growth);
        rothBalance *= (1 + growth);
    }

    return { rows, totalConv, totalConvCost, finalIRA: iraBalance, finalRoth: rothBalance };
}

function rpRenderMultiYear() {
    const data = rpComputeMultiYear();
    const body = document.getElementById('rpProjBody');
    const foot = document.getElementById('rpProjFoot');
    if (!body) return;

    body.innerHTML = data.rows.map(r => {
        const has = r.conversion > 0;
        return `<tr${has ? '' : ' style="color:var(--text-secondary)"'}>
            <td>${r.year}</td>
            <td>${r.ageH} / ${r.ageK}</td>
            <td style="text-align:right">${fmt(r.baseTaxOrd)}</td>
            <td style="text-align:right;${has ? 'color:var(--warning);font-weight:600' : ''}">${has ? fmt(r.conversion) : '\u2014'}</td>
            <td style="text-align:right">${fmt(Math.round(r.iraStart))}</td>
            <td style="text-align:right;color:var(--income-accent)">${fmt(Math.round(r.rothEnd))}</td>
            <td style="text-align:right">${fmt(r.totalTax)}</td>
            <td style="text-align:right;${has ? 'font-weight:600' : ''}">${has ? fmt(r.convCost) : '\u2014'}</td>
            <td>${(r.effRate * 100).toFixed(1)}%</td>
            <td>${has ? (r.margAll * 100).toFixed(1) + '%' : '\u2014'}</td>
        </tr>`;
    }).join('');

    foot.innerHTML = `<tr class="total-row">
        <td colspan="3"><strong>Totals</strong></td>
        <td style="text-align:right;font-weight:700">${fmt(data.totalConv)}</td>
        <td style="text-align:right;font-size:0.8rem;color:var(--text-secondary)">final: ${fmt(Math.round(data.finalIRA))}</td>
        <td style="text-align:right;font-weight:700;color:var(--income-accent)">${fmt(Math.round(data.finalRoth))}</td>
        <td></td>
        <td style="text-align:right;font-weight:700">${fmt(data.totalConvCost)}</td>
        <td></td>
        <td></td>
    </tr>`;
}

// ── Boot ─────────────────────────────────────────────────────

init().catch(() => showError());
