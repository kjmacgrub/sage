// ============================================================
// Reserve — the two-year cash bucket, checked once a month
// ============================================================
//
// Inputs are typed in from statements. The page works out the monthly gap
// (all-in expenses minus guaranteed income), the reserve target, months of
// cover, the drawdown of the managed accounts from their high-water mark,
// and reads the rule table to say what to do. Everything is saved to one
// JSON blob through /api/reserve.

const API = 'http://localhost:5050';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const DEFAULTS = {
    settings: {
        recurring: 0, mm: 0, checking: 0, managed: 0,
        full: 24, refill: 18, floor: 12, dd: 10,
        month: '',
    },
    income: [
        { name: 'Ken Social Security', amount: 0 },
        { name: 'NY Life annuity', amount: 0 },
        { name: 'Hilary spousal Social Security', amount: 0 },
    ],
    items: [
        { name: 'Long-term care insurance', amount: 0, month: 1, freq: 1 },
    ],
    log: [],
};

let state = JSON.parse(JSON.stringify(DEFAULTS));
let _saveTimer = null;
let _toastTimer = null;

// ── Helpers ─────────────────────────────────────────────────

const $ = id => document.getElementById(id);
const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const fmt = v => (v < 0 ? '−' : '') + '$' + Math.round(Math.abs(v)).toLocaleString();
const fmt1 = v => (Math.round(v * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct = v => (Math.round(v * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 }) + '%';

function thisMonth() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function monthLabel(ym) {
    if (!ym) return '';
    const [y, m] = ym.split('-').map(Number);
    return MONTHS[m - 1] + ' ' + y;
}

async function apiGet() {
    const r = await fetch(API + '/api/reserve');
    if (!r.ok) throw new Error(r.status);
    return r.json();
}
async function apiPut(data) {
    const r = await fetch(API + '/api/reserve', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    if (!r.ok) throw new Error(r.status);
}

function showToast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.className = 'toast show';
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}
function showError() { $('errorBanner').classList.add('visible'); }
function hideError() { $('errorBanner').classList.remove('visible'); }

// ── Load / save ─────────────────────────────────────────────

async function load() {
    try {
        const data = await apiGet();
        hideError();
        if (data && data.settings) {
            state.settings = Object.assign({}, DEFAULTS.settings, data.settings);
            state.income = Array.isArray(data.income) ? data.income : state.income;
            state.items = Array.isArray(data.items) ? data.items : state.items;
            state.log = Array.isArray(data.log) ? data.log : [];
        }
    } catch (e) {
        showError();
    }
    if (!state.settings.month) state.settings.month = thisMonth();
    await loadPlanner();
    useplanner(false);
    fillInputs();
    renderIncome();
    renderItems();
    render();
}

// ── Planner ─────────────────────────────────────────────────
// The newest plan on the Planner tab is the current month: its expense total
// is the recurring monthly figure, its income lines are the guaranteed income,
// and its starting balance is checking.

let planner = null;

async function loadPlanner() {
    try {
        const r = await fetch(API + '/api/plans');
        if (!r.ok) return;
        const plans = await r.json();
        if (!plans.length) return;
        const newest = plans.slice().sort((a, b) => (a.plan_date < b.plan_date ? 1 : -1))[0];
        const r2 = await fetch(API + '/api/plans/' + newest.id);
        if (!r2.ok) return;
        const plan = await r2.json();
        const items = plan.items || [];
        const income = items.filter(i => i.item_type === 'income' && num(i.budget_amount) > 0)
            .map(i => ({ name: i.label || i.category || 'Income', amount: num(i.budget_amount) }));
        planner = {
            date: plan.plan_date, label: plan.label,
            expenses: items.filter(i => i.item_type !== 'income').reduce((a, i) => a + num(i.budget_amount), 0),
            incomeTotal: income.reduce((a, i) => a + i.amount, 0),
            income, checking: num(plan.starting_balance),
        };
    } catch (e) { planner = null; }
    const strip = $('plannerStrip');
    if (!planner) { strip.style.display = 'none'; return; }
    strip.style.display = '';
    $('plannerText').innerHTML = `<strong>Planner, ${esc(planner.label || planner.date)}:</strong> expenses ${fmt(planner.expenses)} · income ${fmt(planner.incomeTotal)} (${planner.income.map(i => esc(i.name)).join(', ') || 'none'}) · checking ${fmt(planner.checking)}`;
}

// force=false fills only what is blank; force=true overwrites with the plan.
function useplanner(force) {
    if (!planner) return;
    const s = state.settings;
    if (force || !s.recurring) s.recurring = planner.expenses;
    if (force || !s.checking) s.checking = planner.checking;
    const incomeBlank = !state.income.some(r => num(r.amount) > 0);
    if ((force || incomeBlank) && planner.income.length) state.income = planner.income.map(r => ({ ...r }));
    if (force) {
        fillInputs(); renderIncome(); render(); scheduleSave();
        showToast('Filled from the Planner, ' + (planner.label || planner.date));
    }
}

function scheduleSave() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(async () => {
        try {
            await apiPut(state);
            hideError();
            $('savedNote').textContent = 'saved';
            setTimeout(() => { $('savedNote').textContent = ''; }, 1500);
        } catch (e) { showError(); }
    }, 500);
}

// ── Inputs ──────────────────────────────────────────────────

function fillInputs() {
    const s = state.settings;
    $('rv_recurring').value = s.recurring || '';
    $('rv_mm').value = s.mm || '';
    $('rv_checking').value = s.checking || '';
    $('rv_managed').value = s.managed || '';
    $('rv_full').value = s.full;
    $('rv_refill').value = s.refill;
    $('rv_floor').value = s.floor;
    $('rv_dd').value = s.dd;
    $('rvMonth').value = s.month;
}

function readInputs() {
    const s = state.settings;
    s.recurring = num($('rv_recurring').value);
    s.mm = num($('rv_mm').value);
    s.checking = num($('rv_checking').value);
    s.managed = num($('rv_managed').value);
    s.full = Math.max(1, num($('rv_full').value) || 24);
    s.refill = Math.max(1, num($('rv_refill').value) || 18);
    s.floor = Math.max(0, num($('rv_floor').value) || 0);
    s.dd = Math.max(0, num($('rv_dd').value) || 0);
    s.month = $('rvMonth').value || thisMonth();
}

function onInput() {
    readInputs();
    renderItems();
    render();
    scheduleSave();
}

// income lines
function renderIncome() {
    const box = $('incomeList');
    box.innerHTML = '';
    state.income.forEach((row, i) => {
        const div = document.createElement('div');
        div.className = 'cp-field rv-income-row';
        div.innerHTML =
            `<input type="text" value="${esc(row.name)}" placeholder="Income line" oninput="incomeChange(${i},'name',this.value)">` +
            `<input type="number" step="10" value="${row.amount || ''}" placeholder="0" oninput="incomeChange(${i},'amount',this.value)">` +
            `<button class="rv-del" title="Remove" onclick="removeIncome(${i})">×</button>`;
        box.appendChild(div);
    });
}
function incomeChange(i, key, val) {
    state.income[i][key] = key === 'amount' ? num(val) : val;
    render();
    scheduleSave();
}
function addIncome() { state.income.push({ name: '', amount: 0 }); renderIncome(); scheduleSave(); }
function removeIncome(i) { state.income.splice(i, 1); renderIncome(); render(); scheduleSave(); }

// annual items
function renderItems() {
    const body = $('itemsBody');
    body.innerHTML = '';
    const cur = currentMonthNumber();
    state.items.forEach((it, i) => {
        const tr = document.createElement('tr');
        const opts = MONTHS.map((m, k) => `<option value="${k + 1}" ${Number(it.month) === k + 1 ? 'selected' : ''}>${m}</option>`).join('');
        const freq = Number(it.freq) || 1;
        const fopts = [[1, 'year'], [2, 'half year'], [4, 'quarter']].map(([v, l]) => `<option value="${v}" ${freq === v ? 'selected' : ''}>${l}</option>`).join('');
        tr.innerHTML =
            `<td><input type="text" value="${esc(it.name)}" placeholder="Item" oninput="itemChange(${i},'name',this.value)"></td>` +
            `<td class="num"><input type="number" step="100" value="${it.amount || ''}" placeholder="0" oninput="itemChange(${i},'amount',this.value)"></td>` +
            `<td><select onchange="itemChange(${i},'freq',this.value)">${fopts}</select></td>` +
            `<td><select onchange="itemChange(${i},'month',this.value)">${opts}</select></td>` +
            `<td class="num">${fmt(num(it.amount) / 12)}</td>` +
            `<td class="num">${fmt(sinking(it, cur))}</td>` +
            `<td><button class="rv-del" title="Remove" onclick="removeItem(${i})">×</button></td>`;
        body.appendChild(tr);
    });
}
function itemChange(i, key, val) {
    state.items[i][key] = key === 'name' ? val : num(val);
    if (key !== 'name') renderItems();   // refresh the computed cells
    render();
    scheduleSave();
}
function addItem() { state.items.push({ name: '', amount: 0, month: currentMonthNumber(), freq: 1 }); renderItems(); scheduleSave(); }
function removeItem(i) { state.items.splice(i, 1); renderItems(); render(); scheduleSave(); }

function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

// ── Calculation ─────────────────────────────────────────────

function currentMonthNumber() {
    const ym = state.settings.month || thisMonth();
    return Number(ym.split('-')[1]) || (new Date().getMonth() + 1);
}

// How much should have been saved toward an item by the current check-in
// month. The amount is per year; it is paid `freq` times a year (1, 2 or 4),
// starting in `month`. Twelfths of the yearly amount accumulate from the month
// after each payment; in a payment month the float is spent and starts again.
function sinking(it, cur) {
    const freq = [1, 2, 4].includes(Number(it.freq)) ? Number(it.freq) : 1;
    const period = 12 / freq;
    const first = Number(it.month) || 1;
    const elapsed = ((cur - first) % period + period) % period;
    return num(it.amount) * elapsed / 12;
}

function compute() {
    const s = state.settings;
    const cur = currentMonthNumber();

    const annual = state.items.reduce((a, it) => a + num(it.amount), 0);
    const annualPm = annual / 12;
    const expenses = s.recurring + annualPm;
    const income = state.income.reduce((a, r) => a + num(r.amount), 0);
    const gap = Math.max(0, expenses - income);

    const target = gap * s.full;
    const cover = gap > 0 ? s.mm / gap : Infinity;

    const hwm = Math.max(s.managed, ...state.log.map(r => num(r.managed)));
    const dd = hwm > 0 ? (1 - s.managed / hwm) * 100 : 0;

    // the rule
    let action, sell = 0, cls = 'ok', ruleRow = 0;
    if (gap <= 0) {
        action = 'Nothing to do. Guaranteed income covers the expenses, so there is no gap for the reserve to fill.';
        cls = 'ok';
    } else if (s.mm <= 0) {
        action = 'Enter the money market balance to read the rule.'; ruleRow = -1; cls = 'hold';
    } else if (cover >= s.full) {
        action = 'Do nothing.'; ruleRow = 0; cls = 'ok';
    } else if (cover >= s.floor) {
        if (dd <= s.dd) { sell = target - s.mm; action = 'Sell to refill.'; ruleRow = 1; cls = 'sell'; }
        else { action = 'Hold. Keep drawing on the reserve.'; ruleRow = 2; cls = 'hold'; }
    } else {
        sell = gap * s.refill - s.mm; action = 'Sell, whatever the market is doing.'; ruleRow = 3; cls = 'forced';
    }

    // checking: one month of all-in expenses plus what has built up toward the annual items
    const sink = state.items.reduce((a, it) => a + sinking(it, cur), 0);
    const chkTarget = expenses + sink;
    const chkVar = s.checking - chkTarget;
    // smooth transfer: the gap, the same every month; checking's float is reported, not corrected
    const transfer = gap;

    return { annual, annualPm, expenses, income, gap, target, cover, hwm, dd, action, sell, cls, ruleRow, sink, chkTarget, chkVar, transfer };
}

// ── Render ──────────────────────────────────────────────────

function render() {
    const s = state.settings;
    const c = compute();

    $('cardGap').textContent = fmt(c.gap);
    $('cardGapDetail').textContent = fmt(c.expenses) + ' expenses − ' + fmt(c.income) + ' income';
    $('cardTarget').textContent = fmt(c.target);
    $('cardTargetDetail').textContent = s.full + ' months of the gap';
    $('cardCover').textContent = isFinite(c.cover) ? fmt1(c.cover) + ' mo' : '—';
    $('cardCoverDetail').textContent = fmt(s.mm) + ' in the money market';
    $('cardDD').textContent = pct(Math.max(0, c.dd));
    $('cardDDDetail').textContent = c.hwm > 0 ? 'high ' + fmt(c.hwm) : 'no high-water mark yet';
    $('cardTransfer').textContent = fmt(c.transfer);
    $('cardTransferDetail').textContent = c.chkVar > c.gap
        ? 'same every month; checking is ' + fmt(c.chkVar) + ' over its float, so this one could be skipped'
        : c.chkVar < -c.gap
        ? 'same every month; checking is ' + fmt(-c.chkVar) + ' short of its float'
        : 'the smoothed gap, same every month';

    // action card
    const card = $('actionCard');
    card.className = 'section-card rv-action ' + c.cls;
    $('actionTitle').textContent = c.sell > 0 ? fmt(c.sell) + ' — ' + c.action : c.action;
    let body = '';
    if (c.gap <= 0 || c.ruleRow === -1) {
        body = '';
    } else if (c.ruleRow === 0) {
        body = `The reserve holds ${fmt1(c.cover)} months of the gap, at or above the ${s.full}-month target. Dividends and interest keep landing in it.`;
    } else if (c.ruleRow === 1) {
        body = `The reserve is at ${fmt1(c.cover)} months and the managed accounts are ${pct(c.dd)} below their high, inside the ${s.dd}% band. Selling ${fmt(c.sell)} brings the reserve back to ${s.full} months (${fmt(c.target)}). Take it from the taxable account first.`;
    } else if (c.ruleRow === 2) {
        body = `The reserve is at ${fmt1(c.cover)} months, above the ${s.floor}-month floor, and the managed accounts are ${pct(c.dd)} below their high. That is a down market, so nothing is sold. The reserve has about ${fmt1(c.cover - s.floor)} months of room before a forced sale.`;
    } else {
        body = `The reserve is down to ${fmt1(c.cover)} months, under the ${s.floor}-month floor. Sell ${fmt(c.sell)} to bring it back to ${s.refill} months regardless of where the market is, and trim discretionary spending until it recovers.`;
    }
    $('actionBody').textContent = body;

    // computed cells
    $('rv_annual_pm').textContent = fmt(c.annualPm);
    $('rv_expenses').textContent = fmt(c.expenses);
    $('rv_income').textContent = fmt(c.income);
    $('rv_hwm').textContent = c.hwm > 0 ? fmt(c.hwm) : '—';
    $('rv_chk_base').textContent = fmt(c.expenses);
    $('rv_chk_sink').textContent = fmt(c.sink);
    $('rv_chk_target').textContent = fmt(c.chkTarget);
    const v = $('rv_chk_var');
    v.textContent = Math.abs(c.chkVar) < 1 ? 'on target' : (c.chkVar > 0 ? fmt(c.chkVar) + ' over' : fmt(-c.chkVar) + ' short');
    v.className = 'rv-computed ' + (c.chkVar < -1 ? 'neg' : c.chkVar > 1 ? 'pos' : '');

    $('annualTotal').textContent = c.annual > 0 ? fmt(c.annual) + ' a year · ' + fmt(c.annualPm) + ' a month' : '';

    // rule table labels + highlight
    ['ruleFull1','ruleFull2','ruleFull3','ruleFull4'].forEach(id => $(id).textContent = s.full);
    ['ruleFloor1','ruleFloor2','ruleFloor3'].forEach(id => $(id).textContent = s.floor);
    ['ruleDD1','ruleDD2'].forEach(id => $(id).textContent = s.dd + '%');
    $('ruleRefill1').textContent = s.refill;
    document.querySelectorAll('.rv-rules tbody tr').forEach((tr, i) => tr.classList.toggle('active', c.gap > 0 && i === c.ruleRow));

    renderLog();
}

function renderLog() {
    const body = $('logBody');
    body.innerHTML = '';
    const rows = state.log.slice().sort((a, b) => (a.month < b.month ? 1 : -1));
    if (!rows.length) {
        body.innerHTML = '<tr><td colspan="11" style="color:var(--text-secondary);text-align:center;padding:1rem">No check-ins saved yet.</td></tr>';
        return;
    }
    rows.forEach(r => {
        const i = state.log.indexOf(r);
        const tr = document.createElement('tr');
        tr.innerHTML =
            `<td>${monthLabel(r.month)}</td>` +
            `<td class="num">${fmt(r.expenses)}</td>` +
            `<td class="num">${fmt(r.income)}</td>` +
            `<td class="num">${fmt(r.gap)}</td>` +
            `<td class="num">${fmt(r.mm)}</td>` +
            `<td class="num">${isFinite(r.cover) && r.cover !== null ? fmt1(r.cover) : '—'}</td>` +
            `<td class="num">${fmt(r.managed)}</td>` +
            `<td class="num">${pct(Math.max(0, num(r.dd)))}</td>` +
            `<td class="num">${fmt(r.transfer)}</td>` +
            `<td class="action">${esc(r.action)}${r.sell > 0 ? ' ' + fmt(r.sell) : ''}</td>` +
            `<td><button class="rv-del" title="Delete this row" onclick="removeLog(${i})">×</button></td>`;
        body.appendChild(tr);
    });
}

function saveToLog() {
    readInputs();
    const s = state.settings;
    const c = compute();
    const row = {
        month: s.month, expenses: c.expenses, income: c.income, gap: c.gap,
        mm: s.mm, cover: isFinite(c.cover) ? c.cover : null, managed: s.managed, dd: c.dd,
        transfer: c.transfer, sell: c.sell, action: c.action, checking: s.checking,
    };
    const existing = state.log.findIndex(r => r.month === s.month);
    if (existing >= 0) state.log[existing] = row; else state.log.push(row);
    render();
    scheduleSave();
    showToast((existing >= 0 ? 'Updated ' : 'Saved ') + monthLabel(s.month));
}

function removeLog(i) {
    state.log.splice(i, 1);
    render();
    scheduleSave();
}

load();
