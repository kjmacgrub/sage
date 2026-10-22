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

        cpInit();
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

// ============================================================
// Conversion Plan — two people, ten years, under the IRMAA line
// ============================================================
// Replaces the old fill-the-bracket Roth Planner (removed 2026-10-22).
// The plan is a steady ~$50K a year each, sized so household MAGI
// stays under the first IRMAA tier. Nominal dollars; federal
// parameters are 2026 (OBBBA) indexed by the inflation input.

// ── 2026 Federal parameters (MFJ) ───────────────────────────

const CP_FED_BRACKETS = [
    { limit: 24800,    rate: 0.10 },
    { limit: 100800,   rate: 0.12 },
    { limit: 211400,   rate: 0.22 },
    { limit: 403550,   rate: 0.24 },
    { limit: 512450,   rate: 0.32 },
    { limit: 768700,   rate: 0.35 },
    { limit: Infinity, rate: 0.37 },
];
const CP_LTCG_BRACKETS = [
    { limit: 98900,    rate: 0.00 },
    { limit: 613700,   rate: 0.15 },
    { limit: Infinity, rate: 0.20 },
];
const CP_STD_DED        = 32200;   // MFJ
const CP_AGE65_EXTRA    = 1650;    // per person, 65+
const CP_SENIOR_BONUS   = 6000;    // per person 65+, tax years 2025-2028, phased out 6% of MAGI over $150K MFJ
const CP_SENIOR_PHASE   = 150000;

// ── NY State brackets (MFJ) ─────────────────────────────────

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
const NYC_BRACKETS = [
    { limit: 12000,    rate: 0.03078 },
    { limit: 25000,    rate: 0.03762 },
    { limit: 50000,    rate: 0.03819 },
    { limit: Infinity, rate: 0.03876 },
];
const NY_STD_DEDUCTION = 16050;
const NY_PENSION_EXCL  = 20000; // per person 59½+, covers pension, annuity and IRA money incl. conversions

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

function inflateBrackets(brackets, inf) {
    return brackets.map(b => ({
        limit: b.limit === Infinity ? Infinity : Math.round(b.limit * inf),
        rate: b.rate,
    }));
}

function stackedLtcgTax(ordTaxable, pref, brackets) {
    let tax = 0, pos = ordTaxable, rem = pref;
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

function fmtK(n) {
    if (Math.abs(n) >= 1000000) return (n / 1000000).toFixed(2) + 'M';
    if (Math.abs(n) >= 1000) return Math.round(n / 1000) + 'K';
    return Math.round(n).toString();
}

// ── View toggle ─────────────────────────────────────────────

function setView(view) {
    document.querySelectorAll('.view-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.view === view));
    document.getElementById('trackerView').style.display = view === 'tracker' ? '' : 'none';
    document.getElementById('planView').style.display    = view === 'plan'    ? '' : 'none';
    if (view === 'plan') cpRender();
}

// ── Inputs / persistence ────────────────────────────────────

const CP_STORAGE = 'sage-conversion-plan';

const CP_DEFAULTS = {
    // The plan
    ken_amt: 50000, ken_start: 2027,
    hil_2026: 80000, hil_amt: 50000,
    plan_through: 2036,
    contrib_limit: 8600,
    // IRMAA line
    irmaa_limit: 218000, irmaa_margin: 8000, inflation: 2.5,
    // Income
    birth_year: 1962,
    wages_2026: 58500, wages_2027: 19500, pt_wages: 18000, pt_through: 2029,
    ken_pension: 0,
    ken_ss_monthly: 2160, ken_ss_start: 2027, ken_ss_months: 8,
    hil_annuity: 50649,
    hil_ss_monthly: 1210, hil_ss_start: 2029,
    inv_ord_2026: 8075, inv_pref_2026: 9781,
    inv_ord: 20000, inv_pref: 20000, tax_exempt: 0,
    cap_loss_co: 36355,
    // Balances
    ken_lump: 300000, ken_lump_year: 2027, ira_growth: 5,
    hil_ira: 785000,
    ken_roth: 80000, ken_roth_growth: 12,
    hil_roth: 0, hil_roth_growth: 7.4,
};
const CP_SELECTS = { hil_mode: 'fixed', state: 'nyc' };
const CP_CHECKS  = { contrib_on: true };

let _cpOverrides = { ken: {}, hil: {} };   // per-year hand edits to the conversion cells

function cpInit() {
    localStorage.removeItem('sage-roth-planner');   // old planner's key
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(CP_STORAGE) || '{}'); } catch (e) { saved = {}; }
    for (const [k, def] of Object.entries(CP_DEFAULTS)) {
        const el = document.getElementById('cp_' + k);
        if (el) el.value = (k in saved) ? saved[k] : def;
    }
    for (const [k, def] of Object.entries(CP_SELECTS)) {
        const el = document.getElementById('cp_' + k);
        if (el) el.value = saved[k] || def;
    }
    for (const [k, def] of Object.entries(CP_CHECKS)) {
        const el = document.getElementById('cp_' + k);
        if (el) el.checked = (k in saved) ? !!saved[k] : def;
    }
    _cpOverrides = saved.overrides || { ken: {}, hil: {} };
}

function cpSave() {
    const data = {};
    for (const k of Object.keys(CP_DEFAULTS)) {
        const el = document.getElementById('cp_' + k);
        if (el) data[k] = parseFloat(el.value) || 0;
    }
    for (const k of Object.keys(CP_SELECTS)) {
        const el = document.getElementById('cp_' + k);
        if (el) data[k] = el.value;
    }
    for (const k of Object.keys(CP_CHECKS)) {
        const el = document.getElementById('cp_' + k);
        if (el) data[k] = el.checked;
    }
    data.overrides = _cpOverrides;
    localStorage.setItem(CP_STORAGE, JSON.stringify(data));
}

function cpVal(key) {
    const el = document.getElementById('cp_' + key);
    const v  = parseFloat(el?.value);
    return Number.isFinite(v) ? v : (CP_DEFAULTS[key] || 0);
}

function cpOnInput() { cpSave(); cpRender(); }

function cpSetOverride(person, year, raw) {
    const v = parseFloat(raw);
    if (raw === '' || !Number.isFinite(v)) delete _cpOverrides[person][year];
    else _cpOverrides[person][year] = Math.max(0, v);
    cpOnInput();
}

function cpResetOverrides() {
    _cpOverrides = { ken: {}, hil: {} };
    cpOnInput();
}

// ── Income by year ──────────────────────────────────────────

function cpYearIncome(yr) {
    const k   = yr - 2026;
    const inf = Math.pow(1 + cpVal('inflation') / 100, k);

    let wages = 0;
    if (yr === 2026)      wages = cpVal('wages_2026');
    else if (yr === 2027) wages = cpVal('wages_2027');
    else if (yr <= cpVal('pt_through')) wages = cpVal('pt_wages');

    const kenPension = yr >= 2027 ? cpVal('ken_pension') : 0;

    let ssKen = 0;
    const ksStart = cpVal('ken_ss_start');
    if (yr >= ksStart) {
        const months = yr === ksStart ? Math.min(12, Math.max(0, cpVal('ken_ss_months'))) : 12;
        ssKen = cpVal('ken_ss_monthly') * months * inf;
    }
    let ssHil = 0;
    if (yr >= cpVal('hil_ss_start')) ssHil = cpVal('hil_ss_monthly') * 12 * inf;

    const annuity = cpVal('hil_annuity');   // NY Life, fixed payment

    let invOrd, invPref, taxExempt = 0;
    if (yr === 2026) {
        invOrd  = cpVal('inv_ord_2026');
        invPref = cpVal('inv_pref_2026');
    } else {
        const g = Math.pow(1 + cpVal('inflation') / 100, yr - 2027);
        invOrd    = cpVal('inv_ord')    * g;
        invPref   = cpVal('inv_pref')   * g;
        taxExempt = cpVal('tax_exempt') * g;
    }

    const capLossDed = Math.min(3000, Math.max(0, cpVal('cap_loss_co') - k * 3000));

    const age = yr - cpVal('birth_year');

    return { yr, k, inf, age, wages, kenPension, ssKen, ssHil, annuity, invOrd, invPref, taxExempt, capLossDed };
}

// ── Tax engine for one year ─────────────────────────────────
// Returns federal + NY (+ NYC) tax for the income in `inc` plus the
// two conversions. MAGI here is AGI + tax-exempt interest, which is
// what Medicare looks at for IRMAA.

function cpTax(inc, convKen, convHil, stateMode) {
    const ssTaxable = (inc.ssKen + inc.ssHil) * SS_TAXABLE_PCT;
    const ordinary  = inc.wages + inc.annuity + inc.kenPension + inc.invOrd + ssTaxable
                    + convKen + convHil - inc.capLossDed;
    const pref      = inc.invPref;
    const agi       = ordinary + pref;
    const magi      = agi + inc.taxExempt;

    // Deductions
    let ded = Math.round(CP_STD_DED * inc.inf);
    if (inc.age >= 65) {
        ded += 2 * Math.round(CP_AGE65_EXTRA * inc.inf);
        if (inc.yr <= 2028) {
            const bonus = Math.max(0, CP_SENIOR_BONUS - 0.06 * Math.max(0, magi - CP_SENIOR_PHASE));
            ded += 2 * bonus;
        }
    }
    const fedTaxOrd = Math.max(0, ordinary - ded);
    const fedTax    = calcBracketTax(fedTaxOrd, inflateBrackets(CP_FED_BRACKETS, inc.inf))
                    + stackedLtcgTax(fedTaxOrd, pref, inflateBrackets(CP_LTCG_BRACKETS, inc.inf));

    let nyTax = 0, nycTax = 0;
    if (stateMode === 'nyc' || stateMode === 'ny') {
        const exclHil  = Math.min(NY_PENSION_EXCL, inc.annuity + convHil);
        const exclKen  = Math.min(NY_PENSION_EXCL, inc.kenPension + convKen);
        const nyTaxable = Math.max(0, agi - exclHil - exclKen - Math.round(NY_STD_DEDUCTION * inc.inf));
        nyTax = calcBracketTax(nyTaxable, inflateBrackets(NY_BRACKETS, inc.inf));
        if (stateMode === 'nyc') nycTax = calcBracketTax(nyTaxable, NYC_BRACKETS);
    }
    return { agi, magi, fedTax, nyTax, nycTax, total: fedTax + nyTax + nycTax };
}

// ── The plan, year by year ──────────────────────────────────

function cpCompute() {
    const stateMode  = document.getElementById('cp_state')?.value || 'nyc';
    const hilMode    = document.getElementById('cp_hil_mode')?.value || 'fixed';
    const contribOn  = document.getElementById('cp_contrib_on')?.checked ?? true;
    const iraG       = cpVal('ira_growth') / 100;
    const kenRothG   = cpVal('ken_roth_growth') / 100;
    const hilRothG   = cpVal('hil_roth_growth') / 100;
    const through    = Math.max(2026, Math.min(2060, Math.round(cpVal('plan_through'))));

    let kenIra  = 0;
    let hilIra  = cpVal('hil_ira');
    let kenRoth = cpVal('ken_roth');
    let hilRoth = cpVal('hil_roth');

    const rows = [];
    const tot  = { convKen: 0, convHil: 0, convTax: 0, contrib: 0, tax: 0, over: 0 };

    for (let yr = 2026; yr <= through; yr++) {
        const inc = cpYearIncome(yr);
        if (yr === cpVal('ken_lump_year')) kenIra += cpVal('ken_lump');

        const line = Math.round(cpVal('irmaa_limit') * inc.inf) - cpVal('irmaa_margin');
        const base = cpTax(inc, 0, 0, stateMode);

        // Ken: fixed amount from his start year, never more than the IRA holds
        let convKen = 0;
        if (yr >= cpVal('ken_start')) convKen = cpVal('ken_amt');
        if (yr in _cpOverrides.ken) convKen = _cpOverrides.ken[yr];
        convKen = Math.round(Math.min(convKen, Math.max(0, kenIra)));

        // Hilary: 2026 is its own number; afterwards fixed or fill-to-line
        let convHil, hilAuto = false;
        if (yr === 2026) convHil = cpVal('hil_2026');
        else if (hilMode === 'fill') {
            convHil = Math.floor(Math.max(0, line - base.magi - convKen) / 1000) * 1000;
            hilAuto = true;
        } else convHil = cpVal('hil_amt');
        if (!hilAuto && yr in _cpOverrides.hil) convHil = _cpOverrides.hil[yr];
        convHil = Math.round(Math.min(convHil, Math.max(0, hilIra)));

        const withC = cpTax(inc, convKen, convHil, stateMode);
        const convTax = withC.total - base.total;
        const room    = line - withC.magi;

        // Roth contributions from Ken's earned income (his own, then a spousal one)
        let contribKen = 0, contribHil = 0;
        if (contribOn && inc.wages > 0) {
            const limit = Math.round(cpVal('contrib_limit') * inc.inf / 100) * 100;
            contribKen = Math.min(limit, inc.wages);
            contribHil = Math.min(limit, inc.wages - contribKen);
        }

        // Balances at year end
        const kenIraStart = kenIra, hilIraStart = hilIra;
        kenIra  = (kenIra - convKen) * (1 + iraG);
        hilIra  = (hilIra - convHil) * (1 + iraG);
        kenRoth = (kenRoth + convKen + contribKen) * (1 + kenRothG);
        hilRoth = (hilRoth + convHil + contribHil) * (1 + hilRothG);

        tot.convKen += convKen; tot.convHil += convHil; tot.convTax += convTax;
        tot.contrib += contribKen + contribHil; tot.tax += withC.total;
        if (room < 0) tot.over++;

        rows.push({
            yr, age: inc.age, inc, line,
            baseMagi: base.magi, magi: withC.magi, room,
            convKen, convHil, hilAuto, kenOverride: yr in _cpOverrides.ken, hilOverride: !hilAuto && yr in _cpOverrides.hil,
            contribKen, contribHil,
            totalTax: withC.total, fedTax: withC.fedTax, stateTax: withC.nyTax + withC.nycTax,
            convTax, effRate: (convKen + convHil) > 0 ? convTax / (convKen + convHil) : 0,
            kenIraStart, hilIraStart, kenIra, hilIra, kenRoth, hilRoth,
        });
    }
    return { rows, tot, kenIra, hilIra, kenRoth, hilRoth, hilMode };
}

// ── Render ──────────────────────────────────────────────────

function cpRender() {
    const d = cpCompute();
    const conv = d.tot.convKen + d.tot.convHil;

    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('cpCardConv',       fmt(conv));
    set('cpCardConvDetail', `Ken ${fmtK(d.tot.convKen)} · Hilary ${fmtK(d.tot.convHil)}`);
    set('cpCardTax',        fmt(d.tot.convTax));
    set('cpCardRate',       conv > 0 ? (d.tot.convTax / conv * 100).toFixed(1) + '%' : '—');
    set('cpCardRateDetail', 'tax cost ÷ dollars converted');
    set('cpCardRoth',       fmt(d.kenRoth + d.hilRoth));
    set('cpCardRothDetail', `IRAs left: Ken ${fmtK(d.kenIra)} · Hilary ${fmtK(d.hilIra)}`);
    const overEl = document.getElementById('cpCardOver');
    if (overEl) {
        overEl.textContent = d.tot.over;
        overEl.classList.toggle('warning', d.tot.over > 0);
        overEl.classList.toggle('success', d.tot.over === 0);
    }
    set('cpCardOverDetail', d.tot.over ? 'each costs a year of Part B surcharge' : 'every year under the line');

    const resetBtn = document.getElementById('cpResetBtn');
    const nOver = Object.keys(_cpOverrides.ken).length + Object.keys(_cpOverrides.hil).length;
    if (resetBtn) resetBtn.style.display = nOver ? '' : 'none';

    cpRenderTable(d);
}

function cpRenderTable(d) {
    const body = document.getElementById('cpBody');
    if (!body) return;
    const r = v => `<td class="num">${v}</td>`;
    const cell = (person, row, val, auto, isOver) => auto
        ? `<td class="num cp-auto" title="sized to the IRMAA line">${fmt(val)}</td>`
        : `<td class="num"><input type="number" class="cp-cell${isOver ? ' cp-edited' : ''}" step="1000" min="0" value="${Math.round(val)}"
              title="${isOver ? 'hand-entered — clear to return to the plan' : 'plan amount — edit to override this year'}"
              onchange="cpSetOverride('${person}', ${row.yr}, this.value)"></td>`;

    body.innerHTML = d.rows.map(row => {
        const roomCls = row.room < 0 ? 'cp-over' : (row.room < 10000 ? 'cp-tight' : 'cp-ok');
        const contrib = row.contribKen + row.contribHil;
        return `<tr>
            <td>${row.yr}</td>
            <td class="num">${row.age}</td>
            ${r(fmt(row.baseMagi))}
            ${cell('ken', row, row.convKen, false, row.kenOverride)}
            ${cell('hil', row, row.convHil, row.hilAuto, row.hilOverride)}
            ${r(fmt(row.magi))}
            <td class="num ${roomCls}" title="IRMAA line this year: ${fmt(row.line)}">${row.room < 0 ? '−' : ''}${fmt(Math.abs(row.room))}</td>
            ${r(fmt(row.totalTax))}
            ${r(row.convTax > 0 ? fmt(row.convTax) : '—')}
            ${r(row.effRate > 0 ? (row.effRate * 100).toFixed(1) + '%' : '—')}
            ${r(contrib > 0 ? fmt(contrib) : '—')}
            ${r(fmtK(row.kenIra))}
            ${r(fmtK(row.hilIra))}
            ${r(fmtK(row.kenRoth + row.hilRoth))}
        </tr>`;
    }).join('');

    const foot = document.getElementById('cpFoot');
    if (foot) {
        const conv = d.tot.convKen + d.tot.convHil;
        foot.innerHTML = `<tr class="cp-total">
            <td colspan="3">Total</td>
            <td class="num">${fmt(d.tot.convKen)}</td>
            <td class="num">${fmt(d.tot.convHil)}</td>
            <td></td>
            <td class="num ${d.tot.over ? 'cp-over' : 'cp-ok'}">${d.tot.over ? d.tot.over + ' over' : 'all under'}</td>
            <td class="num">${fmt(d.tot.tax)}</td>
            <td class="num">${fmt(d.tot.convTax)}</td>
            <td class="num">${conv > 0 ? (d.tot.convTax / conv * 100).toFixed(1) + '%' : '—'}</td>
            <td class="num">${d.tot.contrib > 0 ? fmt(d.tot.contrib) : '—'}</td>
            <td class="num">${fmtK(d.kenIra)}</td>
            <td class="num">${fmtK(d.hilIra)}</td>
            <td class="num">${fmtK(d.kenRoth + d.hilRoth)}</td>
        </tr>`;
    }
}

// ── Boot ─────────────────────────────────────────────────────

init().catch(() => showError());
