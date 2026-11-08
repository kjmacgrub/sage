// ============================================================
// Reserve — the two-year cash bucket, checked once a month
// ============================================================
//
// Three balances are typed in from statements. The page works out the gap
// (all-in expenses minus guaranteed income), the reserve's months of cover,
// the draw rate (yearly gap / managed accounts) against its guardrail band,
// and reads the rule table to say exactly what to do. The distributions are
// the fixed monthly amount the managed accounts send to checking; the rule
// pauses and restarts them. Everything is saved as one JSON blob through
// /api/reserve.

const API = 'http://localhost:5050';
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const DEFAULTS = {
    settings: {
        recurring: 0, mm: 0, checking: 0, managed: 0,
        dist: 0, distOn: true,
        full: 24, refill: 18, floor: 12,
        band: 20, baseline: null,
        month: '',
    },
    income: [],
    items: [{ name: 'Long-term care insurance', amount: 0, month: 1, freq: 1 }],
    log: [],
};

let state = JSON.parse(JSON.stringify(DEFAULTS));
let planner = null;
let _saveTimer = null;
let _toastTimer = null;

// ── Helpers ─────────────────────────────────────────────────

const $ = id => document.getElementById(id);
const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const fmt = v => (v < 0 ? '−' : '') + '$' + Math.round(Math.abs(v)).toLocaleString();
const fmt1 = v => (Math.round(v * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct = v => (Math.round(v * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 }) + '%';
const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function thisMonth() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function monthLabel(ym) {
    if (!ym) return '';
    const [y, m] = ym.split('-').map(Number);
    return MONTHS[m - 1] + ' ' + y;
}
function currentMonthNumber() {
    const ym = state.settings.month || thisMonth();
    return Number(ym.split('-')[1]) || (new Date().getMonth() + 1);
}

async function apiGet(url) {
    const r = await fetch(API + url);
    if (!r.ok) throw new Error(r.status);
    return r.json();
}
async function apiPut(url, data) {
    const r = await fetch(API + url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
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

// ── Popups ──────────────────────────────────────────────────

function openDialog(id, ev) {
    const d = $(id);
    if (d.open) return;
    d.showModal();
    positionModalNear(d, ev);
}
function closeDialog(id) { $(id).close(); }

// Anchor near the click, clamped to the viewport.
function positionModalNear(d, ev) {
    const pad = 12;
    const w = d.offsetWidth, h = d.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = ev ? ev.clientX - w / 2 : (vw - w) / 2;
    let top = ev ? ev.clientY + 16 : (vh - h) / 2;
    left = Math.max(pad, Math.min(left, vw - w - pad));
    top = Math.max(pad, Math.min(top, vh - h - pad));
    d.style.position = 'fixed';
    d.style.left = left + 'px';
    d.style.top = top + 'px';
}
document.addEventListener('click', ev => {
    // click on the backdrop closes
    const d = ev.target;
    if (d instanceof HTMLDialogElement && d.open) {
        const r = d.getBoundingClientRect();
        if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) d.close();
    }
});

// ── Load / save ─────────────────────────────────────────────

async function load() {
    try {
        const data = await apiGet('/api/reserve');
        hideError();
        if (data && data.settings) {
            state.settings = Object.assign({}, DEFAULTS.settings, data.settings);
            state.income = Array.isArray(data.income) ? data.income : [];
            state.items = Array.isArray(data.items) ? data.items : state.items;
            state.log = Array.isArray(data.log) ? data.log : [];
        }
    } catch (e) { showError(); }
    if (!state.settings.month) state.settings.month = thisMonth();
    await loadPlanner();
    useplanner(false);
    fillInputs();
    renderIncome();
    renderItems();
    render();
}

function scheduleSave() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(async () => {
        try {
            await apiPut('/api/reserve', state);
            hideError();
            $('savedNote').textContent = 'saved';
            setTimeout(() => { $('savedNote').textContent = ''; }, 1500);
        } catch (e) { showError(); }
    }, 500);
}

// ── Planner ─────────────────────────────────────────────────
// The newest plan on the Planner tab is the current month: its expense total
// and starting balance (checking) are suggestions here. The scheduled income
// items are the timing-free list of what recurs monthly: draws from managed
// accounts become the distributions figure, the rest seed guaranteed income.

const MANAGED_RE = /managed|brokerage|ira|roth|schwab|fidelity:\d|money market|reserve/i;

async function loadPlanner() {
    try {
        const [plans, sched] = await Promise.all([
            apiGet('/api/plans'),
            apiGet('/api/scheduled-items').catch(() => []),
        ]);
        let plan = null;
        if (plans.length) {
            const newest = plans.slice().sort((a, b) => (a.plan_date < b.plan_date ? 1 : -1))[0];
            plan = await apiGet('/api/plans/' + newest.id);
        }
        const items = plan ? (plan.items || []) : [];
        const monthly = sched.filter(i => i.item_type === 'income' && (i.frequency || 'monthly') === 'monthly' && num(i.amount) > 0);
        const income = monthly.filter(i => !MANAGED_RE.test(i.source || '')).map(i => ({ name: i.source || 'Income', amount: num(i.amount) }));
        const draws = monthly.filter(i => MANAGED_RE.test(i.source || '')).map(i => ({ name: i.source || 'Draw', amount: num(i.amount) }));
        planner = {
            date: plan ? plan.plan_date : null, label: plan ? plan.label : null,
            expenses: items.filter(i => i.item_type !== 'income').reduce((a, i) => a + num(i.budget_amount), 0),
            checking: plan ? num(plan.starting_balance) : 0,
            income, draws, drawTotal: draws.reduce((a, i) => a + i.amount, 0),
        };
    } catch (e) { planner = null; }
}

// force=false fills only what is blank; force=true overwrites expenses and checking.
function useplanner(force) {
    if (!planner) return;
    const s = state.settings;
    if (planner.date) {
        if (force || !s.recurring) s.recurring = planner.expenses;
        if (force || !s.checking) s.checking = planner.checking;
    }
    if (!s.dist && planner.drawTotal) s.dist = planner.drawTotal;
    const incomeBlank = !state.income.some(r => num(r.amount) > 0);
    if (incomeBlank && planner.income.length) state.income = planner.income.map(r => ({ ...r }));
    if (force) {
        fillInputs(); render(); scheduleSave();
        showToast('Pulled from the Planner, ' + (planner.label || planner.date));
    }
}

// ── Inputs ──────────────────────────────────────────────────

function fillInputs() {
    const s = state.settings;
    $('rv_recurring').value = s.recurring || '';
    $('rv_mm').value = s.mm || '';
    $('rv_checking').value = s.checking || '';
    $('rv_managed').value = s.managed || '';
    $('rv_dist').value = s.dist || '';
    $('rv_distOn').checked = !!s.distOn;
    $('rv_full').value = s.full;
    $('rv_refill').value = s.refill;
    $('rv_floor').value = s.floor;
    $('rv_band').value = s.band;
    $('rv_baseline').value = s.baseline == null ? '' : s.baseline;
    $('rvMonth').value = s.month;
}

function readInputs() {
    const s = state.settings;
    s.recurring = num($('rv_recurring').value);
    s.mm = num($('rv_mm').value);
    s.checking = num($('rv_checking').value);
    s.managed = num($('rv_managed').value);
    s.dist = num($('rv_dist').value);
    s.distOn = $('rv_distOn').checked;
    s.full = Math.max(1, num($('rv_full').value) || 24);
    s.refill = Math.max(1, num($('rv_refill').value) || 18);
    s.floor = Math.max(0, num($('rv_floor').value) || 0);
    s.band = Math.max(0, num($('rv_band').value) || 0);
    const b = $('rv_baseline').value;
    s.baseline = b === '' ? null : num(b);
    s.month = $('rvMonth').value || thisMonth();
}

function onInput() {
    readInputs();
    renderItems();
    render();
    scheduleSave();
}

function setBaseline() {
    readInputs();
    const c = compute();
    if (!(c.rate > 0)) { showToast('Enter the managed balance and a gap first'); return; }
    state.settings.baseline = Math.round(c.rate * 100) / 100;
    fillInputs(); render(); scheduleSave();
    showToast('Baseline set to ' + pct(state.settings.baseline));
}

// income lines
function renderIncome() {
    const box = $('incomeList');
    box.innerHTML = '';
    state.income.forEach((row, i) => {
        const div = document.createElement('div');
        div.className = 'rv-income-row';
        div.innerHTML =
            `<input type="text" value="${esc(row.name)}" placeholder="Income line" oninput="incomeChange(${i},'name',this.value)">` +
            `<input type="number" step="10" value="${row.amount || ''}" placeholder="0" oninput="incomeChange(${i},'amount',this.value)">` +
            `<button class="rv-del" title="Remove" onclick="removeIncome(${i})">×</button>`;
        box.appendChild(div);
    });
    const total = state.income.reduce((a, r) => a + num(r.amount), 0);
    $('incomeTotalNote').textContent = fmt(total) + ' a month';
}
function incomeChange(i, key, val) {
    state.income[i][key] = key === 'amount' ? num(val) : val;
    const total = state.income.reduce((a, r) => a + num(r.amount), 0);
    $('incomeTotalNote').textContent = fmt(total) + ' a month';
    render(); scheduleSave();
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
    if (key !== 'name') renderItems();
    render(); scheduleSave();
}
function addItem() { state.items.push({ name: '', amount: 0, month: currentMonthNumber(), freq: 1 }); renderItems(); scheduleSave(); }
function removeItem(i) { state.items.splice(i, 1); renderItems(); render(); scheduleSave(); }

// How much should have been saved toward an item by the check-in month. The
// amount is per year, paid `freq` times a year starting in `month`. Twelfths
// accumulate from the month after each payment; in a payment month the float
// has just been spent.
function sinking(it, cur) {
    const freq = [1, 2, 4].includes(Number(it.freq)) ? Number(it.freq) : 1;
    const period = 12 / freq;
    const first = Number(it.month) || 1;
    const elapsed = ((cur - first) % period + period) % period;
    return num(it.amount) * elapsed / 12;
}

// ── Calculation ─────────────────────────────────────────────

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

    const rate = s.managed > 0 ? gap * 12 / s.managed * 100 : 0;
    const upper = s.baseline != null ? s.baseline * (1 + s.band / 100) : null;
    const lower = s.baseline != null ? s.baseline * (1 - s.band / 100) : null;
    const above = upper != null && rate > upper;
    const wellBelow = lower != null && rate > 0 && rate < lower;

    // what the reserve sends to checking this month
    const transfer = gap <= 0 ? 0 : (s.distOn ? Math.max(0, gap - s.dist) : gap);

    // checking's float: one month of expenses plus what has built up toward the annual items
    const sink = state.items.reduce((a, it) => a + sinking(it, cur), 0);
    const chkTarget = expenses + sink;
    const chkVar = s.checking - chkTarget;

    // ── the rule ──
    let row = -1, cls = 'setup', state_ = 'Set-up', title = '', body = '', steps = [], sell = 0;
    const missing = [];
    if (!s.mm) missing.push('the money market balance');
    if (!s.managed) missing.push('the managed accounts balance');
    if (!(gap > 0)) missing.push('a month\'s expenses above the guaranteed income');

    if (missing.length) {
        title = 'Fill in ' + missing.join(', ').replace(/, ([^,]*)$/, ' and $1') + '.';
        body = 'The card needs those before it can read the rule. Follow the steps on the left; each one says where the number comes from.';
    } else if (s.baseline == null) {
        title = 'Set the baseline draw rate.';
        body = `Today's draw rate is ${pct(rate)}: the yearly gap of ${fmt(gap * 12)} divided by ${fmt(s.managed)} in the managed accounts. The rule compares every month against the rate on the day the plan started, so it needs that number once.`;
        steps = ['Open settings (bottom right) and press "set to today\'s rate", or type the rate you want as the baseline.',
                 'Reset it at an annual review whenever the distributions change.'];
    } else if (!above) {
        if (!s.distOn) {
            row = 2; cls = 'restart'; state_ = 'Recovered';
            sell = Math.max(0, target - s.mm);
            title = 'Restart the distributions' + (sell > 0 ? ` and sell ${fmt(sell)} to refill the reserve.` : '.');
            body = `The draw rate is ${pct(rate)}, back inside the band (under ${pct(upper)}). The managed accounts can carry the monthly amount again, and the reserve${sell > 0 ? ` is at ${fmt1(cover)} months and should go back to ${s.full}` : ' is full'}.`;
            steps = [`Call Fidelity or Schwab: restart the monthly distribution of ${fmt(s.dist)} to checking.`];
            if (sell > 0) steps.push(`Same call: sell ${fmt(sell)} from the managed accounts and move it to the money market.`);
            steps.push('Flip the "Distributions are" switch on the left to on, then save the month.');
        } else if (cover < s.floor) {
            row = 6; cls = 'forced'; state_ = 'Reserve low';
            sell = Math.max(0, gap * s.refill - s.mm);
            title = `Sell ${fmt(sell)} to bring the reserve to ${s.refill} months.`;
            body = `The reserve is down to ${fmt1(cover)} months, under the ${s.floor}-month floor, while the distributions are running. Something other than the market is draining it, so it gets refilled now whatever the market is doing.`;
            steps = [`Call Fidelity or Schwab: sell ${fmt(sell)} from the managed accounts and move it to the money market.`,
                     'Look at why the reserve fell: are the distributions set too low for the gap? Note it for the annual review.',
                     'Save the month.'];
        } else if (cover < s.full) {
            row = 1; cls = 'topup'; state_ = 'Normal, top up';
            sell = Math.max(0, target - s.mm);
            title = `Sell ${fmt(sell)} to top the reserve back up to ${s.full} months.`;
            body = `The draw rate is ${pct(rate)}, inside the band. The reserve holds ${fmt1(cover)} months against a target of ${s.full} (${fmt(target)}). Markets are fine, so it is refilled now.`;
            steps = [`Call Fidelity or Schwab, or place it online: sell ${fmt(sell)} from the managed accounts and move it to the money market.`,
                     'Save the month.'];
        } else {
            row = 0; cls = 'ok'; state_ = 'Normal';
            title = 'Nothing to do this month.';
            body = `The draw rate is ${pct(rate)}, inside the band (under ${pct(upper)}). The reserve holds ${fmt1(cover)} months, at or above the ${s.full}-month target. The distributions keep running.`;
            steps = ['Save the month.'];
            if (wellBelow) steps.unshift(`The rate is well under the ${pct(s.baseline)} baseline. Note for the annual review: the distributions could rise.`);
        }
    } else {
        if (s.distOn) {
            if (cover >= s.floor) {
                row = 3; cls = 'pause'; state_ = 'Market down';
                title = 'Pause the distributions.';
                body = `The draw rate is ${pct(rate)}, above the band (${pct(upper)}). The managed accounts have fallen enough that each monthly distribution is selling too cheaply. The reserve holds ${fmt1(cover)} months and pays everything from here until the rate is back in the band.`;
                steps = [`Call Fidelity or Schwab: pause the monthly distribution of ${fmt(s.dist)} until further notice.`,
                         `Move ${fmt(gap)} a month from the money market to checking from now on; this page shows the figure each month.`,
                         'Flip the "Distributions are" switch on the left to paused, then save the month.'];
            } else {
                row = 6; cls = 'forced'; state_ = 'Reserve low';
                sell = Math.max(0, gap * s.refill - s.mm);
                title = `Sell ${fmt(sell)} to bring the reserve to ${s.refill} months.`;
                body = `The reserve is under the ${s.floor}-month floor at ${fmt1(cover)} months. Even in a down market it has to be refilled; a thin reserve is the bigger risk.`;
                steps = [`Call Fidelity or Schwab: sell ${fmt(sell)} from the managed accounts and move it to the money market.`, 'Save the month.'];
            }
        } else {
            if (cover >= s.floor) {
                row = 4; cls = 'hold'; state_ = 'Market down, holding';
                title = 'Hold. Keep paying from the reserve.';
                body = `The draw rate is ${pct(rate)}, still above the band (${pct(upper)}). The distributions stay paused and the reserve carries the month. It holds ${fmt1(cover)} months, about ${fmt1(Math.max(0, cover - s.floor))} above the floor. Nothing is sold.`;
                steps = [`Move ${fmt(gap)} from the money market to checking.`, 'Trim discretionary spending where it is easy.', 'Save the month.'];
            } else {
                row = 5; cls = 'forced'; state_ = 'Reserve low';
                title = 'Restart the distributions anyway.';
                body = `The reserve is down to ${fmt1(cover)} months, under the ${s.floor}-month floor, and the market has not recovered. The distributions come back on so the reserve stops draining. No top-up until the rate is back in the band.`;
                steps = [`Call Fidelity or Schwab: restart the monthly distribution of ${fmt(s.dist)} to checking.`,
                         'Flip the "Distributions are" switch on the left to on, then save the month.'];
            }
        }
    }

    return { annual, annualPm, expenses, income, gap, target, cover, hwm, dd, rate, upper, lower, above, wellBelow,
             transfer, sink, chkTarget, chkVar, row, cls, state: state_, title, body, steps, sell };
}

// ── Render ──────────────────────────────────────────────────

function render() {
    const s = state.settings;
    const c = compute();

    // action card
    const card = $('actionCard');
    card.className = 'rv-action ' + c.cls;
    $('actionState').textContent = c.state;
    $('actionTitle').textContent = c.title;
    $('actionBody').textContent = c.body;
    $('actionSteps').innerHTML = c.steps.map(t => `<li>${esc(t)}</li>`).join('');

    // numbers
    $('nGap').textContent = fmt(c.gap);
    $('nGapDetail').textContent = `${fmt(c.expenses)} a month out, ${fmt(c.income)} guaranteed in`;

    const coverEl = $('nCover');
    coverEl.textContent = c.gap > 0 && s.mm ? fmt1(c.cover) + ' months' : '—';
    coverEl.className = 'rv-num-value ' + (c.gap > 0 && s.mm ? (c.cover < s.floor ? 'bad' : c.cover < s.full ? 'warn' : 'good') : '');
    $('nCoverDetail').textContent = c.gap > 0 ? `${fmt(s.mm)} in the money market; target ${fmt(c.target)}` : '—';
    const coverPct = c.gap > 0 && isFinite(c.cover) ? Math.min(100, c.cover / s.full * 100) : 0;
    $('coverBar').style.width = coverPct + '%';
    $('coverBar').className = 'rv-bar-fill ' + (c.cover < s.floor ? 'bad' : c.cover < s.full ? 'warn' : '');
    $('floorMark').style.left = Math.min(100, s.floor / s.full * 100) + '%';

    const rateEl = $('nRate');
    rateEl.textContent = c.rate > 0 ? pct(c.rate) : '—';
    rateEl.className = 'rv-num-value ' + (c.rate > 0 && c.upper != null ? (c.above ? 'bad' : 'good') : '');
    $('nRateDetail').textContent = c.upper != null
        ? `baseline ${pct(s.baseline)}, pause above ${pct(c.upper)}`
        : (c.rate > 0 ? 'no baseline set yet' : 'yearly gap ÷ managed accounts');
    const rateScale = c.upper != null ? c.upper * 1.25 : (c.rate || 1) * 1.5;
    $('rateBar').style.width = Math.min(100, c.rate / rateScale * 100) + '%';
    $('rateBar').className = 'rv-bar-fill ' + (c.above ? 'bad' : '');
    $('rateMark').style.left = (c.upper != null ? Math.min(100, c.upper / rateScale * 100) : 100) + '%';
    $('rateMark').style.display = c.upper != null ? '' : 'none';

    $('nTransfer').textContent = fmt(c.transfer);
    $('nTransferDetail').textContent = c.gap <= 0 ? 'nothing needed'
        : s.distOn ? (s.dist >= c.gap ? `the ${fmt(s.dist)} distribution covers the gap` : `the gap less the ${fmt(s.dist)} distribution`)
        : 'the whole gap, distributions paused';

    // left column computed bits
    $('rv_annual_pm').textContent = fmt(c.annualPm);
    $('rv_income').textContent = fmt(c.income);
    $('distState').textContent = s.distOn ? 'on' : 'paused';
    $('annualTotal').textContent = c.annual > 0 ? fmt(c.annual) + ' a year' : '';

    // footer: planner + checking float
    const parts = [];
    if (planner && planner.date) parts.push(`Planner ${esc(planner.label || planner.date)}: expenses ${fmt(planner.expenses)}, checking ${fmt(planner.checking)} as of that date`);
    if (c.expenses > 0) {
        const v = Math.abs(c.chkVar) < 1 ? 'on target' : c.chkVar > 0 ? fmt(c.chkVar) + ' over' : fmt(-c.chkVar) + ' short';
        parts.push(`Checking should hold about ${fmt(c.chkTarget)} (a month of expenses plus ${fmt(c.sink)} saved toward annual items); it is ${v}`);
    }
    if (c.hwm > 0 && c.dd > 0.5) parts.push(`Managed accounts ${pct(c.dd)} below their high of ${fmt(c.hwm)}`);
    $('plannerText').innerHTML = parts.join('<br>');

    // rule table labels + highlight
    document.querySelectorAll('.r-full').forEach(el => el.textContent = s.full);
    document.querySelectorAll('.r-floor').forEach(el => el.textContent = s.floor);
    document.querySelectorAll('.r-refill').forEach(el => el.textContent = s.refill);
    document.querySelectorAll('.r-band').forEach(el => el.textContent = s.band);
    document.querySelectorAll('#ruleTable tbody tr').forEach(tr => tr.classList.toggle('active', Number(tr.dataset.row) === c.row));

    renderLog();
}

function renderLog() {
    const body = $('logBody');
    body.innerHTML = '';
    const rows = state.log.slice().sort((a, b) => (a.month < b.month ? 1 : -1));
    if (!rows.length) {
        body.innerHTML = '<tr><td colspan="10" style="color:var(--text-secondary);text-align:center;padding:1rem">No check-ins saved yet.</td></tr>';
        return;
    }
    rows.forEach(r => {
        const i = state.log.indexOf(r);
        const tr = document.createElement('tr');
        tr.innerHTML =
            `<td>${monthLabel(r.month)}</td>` +
            `<td class="num">${fmt(r.gap)}</td>` +
            `<td class="num">${fmt(r.mm)}</td>` +
            `<td class="num">${r.cover != null && isFinite(r.cover) ? fmt1(r.cover) : '—'}</td>` +
            `<td class="num">${fmt(r.managed)}</td>` +
            `<td class="num">${r.rate ? pct(r.rate) : '—'}</td>` +
            `<td>${r.distOn === false ? 'paused' : 'on'}${r.dist ? ' ' + fmt(r.dist) : ''}</td>` +
            `<td class="num">${fmt(r.transfer)}</td>` +
            `<td class="action">${esc(r.action)}</td>` +
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
        rate: c.rate, dist: s.dist, distOn: s.distOn,
        transfer: c.transfer, sell: c.sell, action: c.title, checking: s.checking,
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
