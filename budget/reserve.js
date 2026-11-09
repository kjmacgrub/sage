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

const PERSON_DEFAULTS = {
    settings: {
        deposit: 0, own: 0, share: 50,
        mm: 0, managed: 0,
        dist: 0, distOn: true,
        full: 24, refill: 18, floor: 12,
        band: 20, baseline: null,
        month: '',
    },
    income: [],
    items: [],
    log: [],
};
const SEED = {
    ken:    { income: [{ name: 'Wages: Ken', amount: 2800 }], items: [{ name: 'Long-term care insurance', amount: 0, freq: 1, start: '2026-01', end: '2035-12' }] },
    hilary: { income: [{ name: 'NY Life annuity', amount: 3714.73 }], items: [{ name: 'Long-term care insurance', amount: 0, freq: 1, start: '2026-01', end: '2035-12' }] },
};

// everything saved: { people: { ken: {...}, hilary: {...} }, current: 'ken' }
let store = { people: {}, current: 'ken' };
let state = null;          // store.people[store.current]
let planner = null;
let _saveTimer = null;
let _toastTimer = null;

function freshPerson(who) {
    const seed = SEED[who] || { income: [], items: [] };
    return { settings: { ...PERSON_DEFAULTS.settings }, income: seed.income.map(r => ({ ...r })), items: seed.items.map(r => ({ ...r })), log: [] };
}

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
        if (data && data.people) {
            store = data;
        } else if (data && data.settings) {
            // first version held one household record: it becomes Ken's, minus the shared bits
            const old = data;
            const p = freshPerson('ken');
            p.settings = Object.assign({}, PERSON_DEFAULTS.settings, old.settings);
            delete p.settings.recurring; delete p.settings.checking;
            p.settings.deposit = 0; p.settings.dist = 0;
            p.settings.baseline = null;   // the denominator changed meaning: set it again
            p.income = (old.income || []).filter(r => /ken|wages/i.test(r.name || ''));
            if (!p.income.length) p.income = freshPerson('ken').income;
            p.items = Array.isArray(old.items) && old.items.length ? old.items : p.items;
            p.log = [];
            store = { people: { ken: p }, current: 'ken' };
            scheduleSave();
        }
    } catch (e) { showError(); }
    if (!store.people.ken) store.people.ken = freshPerson('ken');
    if (!store.people.hilary) store.people.hilary = freshPerson('hilary');
    if (!store.people[store.current]) store.current = 'ken';
    state = store.people[store.current];
    state.settings = Object.assign({}, PERSON_DEFAULTS.settings, state.settings);
    if (!state.settings.month) state.settings.month = thisMonth();
    normalizeItems();
    $('rvPerson').value = store.current;
    await loadPlanner();
    useplanner(false);
    fillInputs();
    renderIncome();
    renderItems();
    render();
}

function switchPerson(who) {
    readInputs();
    store.current = who;
    if (!store.people[who]) store.people[who] = freshPerson(who);
    state = store.people[who];
    state.settings = Object.assign({}, PERSON_DEFAULTS.settings, state.settings);
    if (!state.settings.month) state.settings.month = thisMonth();
    normalizeItems();
    useplanner(false);
    fillInputs(); renderIncome(); renderItems(); render(); scheduleSave();
}

function scheduleSave() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(async () => {
        try {
            await apiPut('/api/reserve', store);
            hideError();
            $('savedNote').textContent = 'saved';
            setTimeout(() => { $('savedNote').textContent = ''; }, 1500);
        } catch (e) { showError(); }
    }, 500);
}

// ── Planner ─────────────────────────────────────────────────
// The newest plan on the Planner tab is the household budget for the month.
// Its expense total times my share is my deposit to shared checking.

async function loadPlanner() {
    try {
        const plans = await apiGet('/api/plans');
        let plan = null;
        if (plans.length) {
            const newest = plans.slice().sort((a, b) => (a.plan_date < b.plan_date ? 1 : -1))[0];
            plan = await apiGet('/api/plans/' + newest.id);
        }
        const items = plan ? (plan.items || []) : [];
        planner = plan ? {
            date: plan.plan_date, label: plan.label,
            expenses: items.filter(i => i.item_type !== 'income').reduce((a, i) => a + num(i.budget_amount), 0),
        } : null;
    } catch (e) { planner = null; }
}

function plannerDeposit() {
    return planner ? Math.round(planner.expenses * (state.settings.share || 0) / 100) : 0;
}

// force=false fills only what is blank; force=true overwrites the deposit.
function useplanner(force) {
    if (!planner) return;
    const s = state.settings;
    if (force || !s.deposit) s.deposit = plannerDeposit();
    if (force) {
        fillInputs(); render(); scheduleSave();
        showToast('Deposit set from the Planner, ' + (planner.label || planner.date));
    }
}

// ── Inputs ──────────────────────────────────────────────────

function fillInputs() {
    const s = state.settings;
    $('rv_deposit').value = s.deposit || '';
    $('rv_own').value = s.own || '';
    $('rv_mm').value = s.mm || '';
    $('rv_managed').value = s.managed || '';
    $('rv_dist').value = s.dist || '';
    $('rv_distOn').checked = !!s.distOn;
    $('rv_share').value = s.share;
    $('rv_full').value = s.full;
    $('rv_refill').value = s.refill;
    $('rv_floor').value = s.floor;
    $('rv_band').value = s.band;
    $('rv_baseline').value = s.baseline == null ? '' : s.baseline;
    $('rvMonth').value = s.month;
}

function readInputs() {
    const s = state.settings;
    s.deposit = num($('rv_deposit').value);
    s.own = num($('rv_own').value);
    s.mm = num($('rv_mm').value);
    s.managed = num($('rv_managed').value);
    s.dist = num($('rv_dist').value);
    s.distOn = $('rv_distOn').checked;
    s.share = Math.max(0, Math.min(100, num($('rv_share').value)));
    s.full = Math.max(1, num($('rv_full').value) || 24);
    s.refill = Math.max(1, num($('rv_refill').value) || 18);
    s.floor = Math.max(0, num($('rv_floor').value) || 0);
    s.band = Math.max(0, num($('rv_band').value) || 0);
    const b = $('rv_baseline').value;
    s.baseline = b === '' ? null : num(b);
    const prevMonth = s.month;
    s.month = $('rvMonth').value || thisMonth();
    if (s.month !== prevMonth) renderItems();
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
// Each item: amount per year, paid `freq` times a year, from `start` (the
// month of the first or next payment, YYYY-MM) until `end` (the last payment,
// blank for no end). An item counts only in the months it is running.
const FREQS = [[1, 'year'], [2, 'half year'], [4, 'quarter']];

function normalizeItems() {
    const ym = state.settings.month || thisMonth();
    const y = Number(ym.split('-')[0]), cm = Number(ym.split('-')[1]);
    state.items.forEach(it => {
        if (!it.start && it.month) {
            const m = Number(it.month) || 1;
            it.start = (m <= cm ? y : y - 1) + '-' + String(m).padStart(2, '0');
        }
        if (!it.start) it.start = ym;
        if (it.end == null) it.end = '';
        delete it.month;
    });
}
function itemStatus(it, ym) {
    if (it.start && it.start > ym) return 'later';
    if (it.end && it.end < ym) return 'ended';
    return 'on';
}
function activeItems(ym) { return state.items.filter(it => itemStatus(it, ym) === 'on'); }
function itemNote(it, ym) {
    const st = itemStatus(it, ym);
    if (st === 'later') return 'starts ' + monthLabel(it.start);
    if (st === 'ended') return 'ended ' + monthLabel(it.end);
    return it.end ? 'until ' + monthLabel(it.end) : 'ongoing';
}

function renderItems() {
    const body = $('itemsBody');
    body.innerHTML = '';
    const ym = state.settings.month || thisMonth();
    state.items.forEach((it, i) => {
        const tr = document.createElement('tr');
        tr.dataset.i = i;
        const freq = Number(it.freq) || 1;
        const fopts = FREQS.map(([v, l]) => `<option value="${v}" ${freq === v ? 'selected' : ''}>${l}</option>`).join('');
        tr.innerHTML =
            `<td><input type="text" value="${esc(it.name)}" placeholder="Item" oninput="itemChange(${i},'name',this.value)"></td>` +
            `<td class="num"><input type="number" step="100" value="${it.amount || ''}" placeholder="0" oninput="itemChange(${i},'amount',this.value)"></td>` +
            `<td><select onchange="itemChange(${i},'freq',this.value)">${fopts}</select></td>` +
            `<td><input type="month" value="${esc(it.start || '')}" onchange="itemChange(${i},'start',this.value)"></td>` +
            `<td><input type="month" value="${esc(it.end || '')}" placeholder="no end" onchange="itemChange(${i},'end',this.value)"></td>` +
            `<td class="num c-pm"></td>` +
            `<td class="num c-saved"></td>` +
            `<td><button class="rv-del" title="Remove" onclick="removeItem(${i})">×</button></td>`;
        body.appendChild(tr);
        refreshItemRow(tr, it, ym);
    });
}
// Update only the computed cells, so a field being typed in keeps its focus.
function refreshItemRow(tr, it, ym) {
    const on = itemStatus(it, ym) === 'on';
    tr.classList.toggle('rv-row-off', !on);
    tr.querySelector('.c-pm').textContent = on ? fmt(num(it.amount) / 12) : '—';
    const due = on ? dueThisMonth(it, ym) : 0;
    tr.querySelector('.c-saved').innerHTML = (on ? fmt(earmark(it, ym)) : '—') + `<span class="rv-row-note">${esc(due > 0 ? fmt(due) + ' due this month' : itemNote(it, ym))}</span>`;
}
function itemChange(i, key, val) {
    const it = state.items[i];
    it[key] = (key === 'name' || key === 'start' || key === 'end') ? val : num(val);
    if (key === 'start' && !val) it.start = state.settings.month || thisMonth();
    const tr = $('itemsBody').querySelector(`tr[data-i="${i}"]`);
    if (tr) refreshItemRow(tr, it, state.settings.month || thisMonth());
    render(); scheduleSave();
}
function addItem() { state.items.push({ name: '', amount: 0, freq: 1, start: state.settings.month || thisMonth(), end: '' }); renderItems(); scheduleSave(); }
function removeItem(i) { state.items.splice(i, 1); renderItems(); render(); scheduleSave(); }

// How much should have been saved toward an item by the check-in month. The
// amount is per year, paid `freq` times a year, with the payment months set
// by `start`. Twelfths accumulate from the month after each payment; in a
// payment month the float has just been spent.
function sinking(it, ym) {
    const freq = [1, 2, 4].includes(Number(it.freq)) ? Number(it.freq) : 1;
    const period = 12 / freq;
    const first = Number((it.start || '').split('-')[1]) || 1;
    const cur = Number(ym.split('-')[1]) || 1;
    const elapsed = ((cur - first) % period + period) % period;
    return num(it.amount) * elapsed / 12;
}
// The payment that falls in the check-in month, if any.
function dueThisMonth(it, ym) {
    const freq = [1, 2, 4].includes(Number(it.freq)) ? Number(it.freq) : 1;
    const period = 12 / freq;
    const first = Number((it.start || '').split('-')[1]) || 1;
    const cur = Number(ym.split('-')[1]) || 1;
    return ((cur - first) % period + period) % period === 0 ? num(it.amount) / freq : 0;
}
// What the money market is holding for an item right now: the twelfths
// saved since the last payment, or the whole bill in the month it is due.
function earmark(it, ym) { return sinking(it, ym) + dueThisMonth(it, ym); }

// ── Calculation ─────────────────────────────────────────────

function compute() {
    const s = state.settings;

    const ym = s.month || thisMonth();
    const active = activeItems(ym);
    const annual = active.reduce((a, it) => a + num(it.amount), 0);
    const annualPm = annual / 12;
    const expenses = s.deposit + s.own + annualPm;
    const income = state.income.reduce((a, r) => a + num(r.amount), 0);
    const gap = Math.max(0, expenses - income);
    // the part of the gap that goes to checking every month; the twelfths
    // of the annual items stay in the money market until each bill is due
    const regularGap = Math.max(0, s.deposit + s.own - income);

    // what the money market is holding for the annual items, and what falls due now
    const earmarked = active.reduce((a, it) => a + earmark(it, ym), 0);
    const due = active.map(it => ({ name: it.name || 'annual item', amount: dueThisMonth(it, ym) })).filter(d => d.amount > 0);
    const dueTotal = due.reduce((a, d) => a + d.amount, 0);
    const free = Math.max(0, s.mm - earmarked);

    const target = gap * s.full;
    const cover = gap > 0 ? free / gap : Infinity;

    const hwm = Math.max(s.managed, ...state.log.map(r => num(r.managed)));
    const dd = hwm > 0 ? (1 - s.managed / hwm) * 100 : 0;

    const rate = s.managed > 0 ? gap * 12 / s.managed * 100 : 0;
    const upper = s.baseline != null ? s.baseline * (1 + s.band / 100) : null;
    const lower = s.baseline != null ? s.baseline * (1 - s.band / 100) : null;
    const above = upper != null && rate > upper;
    const wellBelow = lower != null && rate > 0 && rate < lower;

    // what the reserve sends to checking this month: the regular part of the
    // gap (less the distribution while it runs) plus any annual bill due now
    const monthly = s.distOn ? Math.max(0, regularGap - s.dist) : regularGap;
    const transfer = monthly + dueTotal;

    // ── the rule ──
    let row = -1, cls = 'setup', state_ = 'Set-up', title = '', body = '', steps = [], sell = 0;
    const missing = [];
    if (!s.mm) missing.push('the money market balance');
    if (!s.managed) missing.push('the managed accounts balance');
    if (!(gap > 0)) missing.push('what I pay each month, above my guaranteed income');

    if (missing.length) {
        title = 'Fill in ' + missing.join(', ').replace(/, ([^,]*)$/, ' and $1') + '.';
        body = 'The card needs those before it can read the rule. Follow the steps on the left; each one says where the number comes from. The managed accounts figure is everything of mine that is invested, so the draw rate reads like the familiar 4% rule.';
    } else if (!above) {
        if (!s.distOn) {
            row = 2; cls = 'restart'; state_ = 'Recovered';
            sell = Math.max(0, target - free);
            title = 'Restart the distributions' + (sell > 0 ? ` and sell ${fmt(sell)} to refill the reserve.` : '.');
            body = (upper != null ? `The draw rate is ${pct(rate)}, back inside the band (under ${pct(upper)}). ` : '') + `The managed accounts can carry the monthly amount again, and the reserve${sell > 0 ? ` is at ${fmt1(cover)} months and should go back to ${s.full}` : ' is full'}.`;
            steps = [`Call Fidelity or Schwab: restart the monthly distribution of ${fmt(s.dist)} to checking.`];
            if (sell > 0) steps.push(`Same call: sell ${fmt(sell)} from the managed accounts and move it to the money market.`);
            steps.push('Flip the "Distributions are" switch on the left to on, then save the month.');
        } else if (cover < s.floor) {
            row = 6; cls = 'forced'; state_ = 'Reserve low';
            sell = Math.max(0, gap * s.refill - free);
            title = `Sell ${fmt(sell)} to bring the reserve to ${s.refill} months.`;
            body = `The reserve is down to ${fmt1(cover)} months, under the ${s.floor}-month floor, while the distributions are running. Something other than the market is draining it, so it gets refilled now whatever the market is doing.`;
            steps = [`Call Fidelity or Schwab: sell ${fmt(sell)} from the managed accounts and move it to the money market.`,
                     'Look at why the reserve fell: are the distributions set too low for the gap? Note it for the annual review.',
                     'Save the month.'];
        } else if (cover < s.full) {
            row = 1; cls = 'topup'; state_ = 'Normal, top up';
            sell = Math.max(0, target - free);
            title = `Sell ${fmt(sell)} to top the reserve back up to ${s.full} months.`;
            body = (upper != null ? `The draw rate is ${pct(rate)}, inside the band. ` : '') + `The reserve holds ${fmt1(cover)} months against a target of ${s.full} (${fmt(target)}). It is refilled now.`;
            steps = [`Call Fidelity or Schwab, or place it online: sell ${fmt(sell)} from the managed accounts and move it to the money market.`,
                     'Save the month.'];
        } else {
            row = 0; cls = 'ok'; state_ = 'Normal';
            title = 'Nothing to do this month.';
            body = upper != null
                ? `The draw rate is ${pct(rate)}, inside the band (under ${pct(upper)}). The reserve holds ${fmt1(cover)} months, at or above the ${s.full}-month target. The distributions keep running.`
                : `The reserve holds ${fmt1(cover)} months, at or above the ${s.full}-month target. The distributions keep running.`;
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
                         `Move ${fmt(monthly)} a month from my money market from now on; this page shows the figure each month.`,
                         'Flip the "Distributions are" switch on the left to paused, then save the month.'];
            } else {
                row = 6; cls = 'forced'; state_ = 'Reserve low';
                sell = Math.max(0, gap * s.refill - free);
                title = `Sell ${fmt(sell)} to bring the reserve to ${s.refill} months.`;
                body = `The reserve is under the ${s.floor}-month floor at ${fmt1(cover)} months. Even in a down market it has to be refilled; a thin reserve is the bigger risk.`;
                steps = [`Call Fidelity or Schwab: sell ${fmt(sell)} from the managed accounts and move it to the money market.`, 'Save the month.'];
            }
        } else {
            if (cover >= s.floor) {
                row = 4; cls = 'hold'; state_ = 'Market down, holding';
                title = 'Hold. Keep paying from the reserve.';
                body = `The draw rate is ${pct(rate)}, still above the band (${pct(upper)}). The distributions stay paused and the reserve carries the month. It holds ${fmt1(cover)} months, about ${fmt1(Math.max(0, cover - s.floor))} above the floor. Nothing is sold.`;
                steps = [`Move ${fmt(monthly)} from my money market to cover the month.`, 'Trim discretionary spending where it is easy.', 'Save the month.'];
            } else {
                row = 5; cls = 'forced'; state_ = 'Reserve low';
                title = 'Restart the distributions anyway.';
                body = `The reserve is down to ${fmt1(cover)} months, under the ${s.floor}-month floor, and the market has not recovered. The distributions come back on so the reserve stops draining. No top-up until the rate is back in the band.`;
                steps = [`Call Fidelity or Schwab: restart the monthly distribution of ${fmt(s.dist)} to checking.`,
                         'Flip the "Distributions are" switch on the left to on, then save the month.'];
            }
        }
    }

    if (!missing.length && dueTotal > 0) {
        steps.unshift(`Move ${fmt(dueTotal)} from my money market to checking for the ${due.map(d => d.name).join(' and ')} due this month. The reserve has been holding it.`);
    }
    if (!missing.length && s.baseline == null) {
        steps.push('No baseline yet, so only the reserve rows of the rule apply. Set it in settings around mid-2027, once the lump sum and condo proceeds are invested.');
    }

    return { annual, annualPm, expenses, income, gap, regularGap, earmarked, due, dueTotal, free, target, cover, hwm, dd, rate, upper, lower, above, wellBelow,
             monthly, transfer, row, cls, state: state_, title, body, steps, sell };
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

    renderGauges(c);
    renderDistBox(c);
    renderFlow(c);

    // left column computed bits
    $('rv_annual_pm').textContent = fmt(c.annualPm);
    $('rv_income').textContent = fmt(c.income);
    $('spendAllTotal').textContent = '(' + fmt(c.expenses) + ')';
    $('whereDeposit').textContent = planner ? `The one number we agree on. Planner ${fmt(planner.expenses)} × ${s.share}% = ${fmt(plannerDeposit())}` : 'The one number we agree on: my share of the household budget.';
    $('incomeAllTotal').textContent = '(' + fmt(c.income + (s.distOn ? s.dist : 0)) + (s.distOn ? '' : ', distributions paused') + ')';
    $('annualTotal').textContent = c.annual > 0 ? fmt(c.annual) + ' a year' : '';

    // footer: planner and the share
    const parts = [];
    if (planner) {
        const pd = plannerDeposit();
        parts.push(`Planner ${esc(planner.label || planner.date)}: household expenses ${fmt(planner.expenses)} × ${s.share}% share = ${fmt(pd)}` +
                   (Math.abs(pd - s.deposit) > 1 ? `, deposit entered as ${fmt(s.deposit)}` : ''));
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

// ── Gauges and the distributions box on the card ───────────

function renderGauges(c) {
    const s = state.settings;
    const px = v => Math.max(0, Math.min(100, v)) + '%';

    // draw rate: scale runs to a little past the pause line (or past today's rate)
    const hasRate = c.rate > 0;
    const scale = c.upper != null ? Math.max(c.upper, c.rate) * 1.3 : Math.max(c.rate, 1) * 1.6;
    $('gRateVal').textContent = hasRate ? pct(c.rate) : '—';
    const band = $('gRateBand');
    if (c.upper != null) {
        band.style.display = '';
        band.style.left = px(Math.max(0, c.lower) / scale * 100);
        band.style.width = px((c.upper - Math.max(0, c.lower)) / scale * 100);
        $('gRateBase').style.display = ''; $('gRateBase').style.left = px(s.baseline / scale * 100);
        $('gRateUpper').style.display = ''; $('gRateUpper').style.left = px(c.upper / scale * 100);
    } else {
        band.style.display = 'none'; $('gRateBase').style.display = 'none'; $('gRateUpper').style.display = 'none';
    }
    const ptr = $('gRatePtr');
    ptr.style.display = hasRate ? '' : 'none';
    ptr.style.left = px(c.rate / scale * 100);
    ptr.className = 'rv-gauge-pointer' + (c.above ? ' bad' : '');
    $('gRateFoot').innerHTML = c.upper != null
        ? `<span>0%</span><span>band ${pct(Math.max(0, c.lower))} to ${pct(c.upper)} · a year's gap ${fmt(c.gap * 12)} on ${fmt(s.managed)}</span>`
        : `<span>0%</span><span>${hasRate ? 'set a baseline in settings to draw the band' : 'needs the managed balance and a gap'}</span>`;

    // reserve: scale runs to a little past the target
    const hasCover = c.gap > 0 && s.mm > 0 && isFinite(c.cover);
    const cscale = s.full * 1.3;
    $('gCoverVal').textContent = hasCover ? fmt1(c.cover) + ' months' : '—';
    const fill = $('gCoverFill');
    fill.style.width = hasCover ? px(c.cover / cscale * 100) : '0%';
    fill.className = 'rv-gauge-fill' + (hasCover ? (c.cover < s.floor ? ' bad' : c.cover < s.full ? ' warn' : '') : '');
    $('gCoverFloor').style.left = px(s.floor / cscale * 100);
    $('gCoverFull').style.left = px(s.full / cscale * 100);
    $('gCoverFoot').innerHTML = c.gap > 0
        ? `<span>${c.earmarked > 0 ? `${fmt(c.free)} free in the money market, ${fmt(c.earmarked)} held for annual items` : `${fmt(s.mm)} in the money market`}</span><span>floor ${s.floor} mo ${fmt(c.gap * s.floor)} · target ${s.full} mo ${fmt(c.target)}</span>`
        : `<span>—</span><span>needs a gap</span>`;
}

// ── The flow picture ────────────────────────────────────────
// Three pots on the left feed one column on the right: what I pay each
// month, stacked from what covers it. Guaranteed income first, then the
// fixed distribution, then the reserve. The top two of those are the gap.
function renderFlow(c) {
    const s = state.settings;
    const svg = $('flowSvg');
    const W = 1100, H = 200;
    const expenses = c.expenses;
    const guar = Math.min(c.income, expenses);
    const distUse = s.distOn ? Math.min(s.dist, Math.max(0, expenses - guar)) : 0;
    const resUse = Math.max(0, expenses - guar - distUse);
    const ok = expenses > 0;

    // boxes
    const A = { x: 14, y: 10, w: 240, h: 56 };     // guaranteed income
    const B = { x: 14, y: 136, w: 240, h: 56 };    // managed accounts
    const C = { x: 440, y: 136, w: 260, h: 56 };   // money market
    // column
    const col = { x: 880, w: 46, y: 56, h: 124 };
    const seg = (amt) => ok ? col.h * amt / expenses : 0;
    const hG = seg(guar), hD = seg(distUse), hR = seg(resUse);
    const yG = col.y, yD = yG + hG, yR = yD + hD;
    const midG = yG + hG / 2, midD = yD + hD / 2, midR = yR + hR / 2;
    const endX = col.x - 6;

    const box = (b, cls, label, value, sub) =>
        `<g class="rv-flow-box ${cls}"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="8"/>` +
        `<text class="rv-flow-label" x="${b.x + 12}" y="${b.y + 17}">${esc(label)}</text>` +
        `<text class="rv-flow-value" x="${b.x + 12}" y="${b.y + 36}">${esc(value)}</text>` +
        `<text class="rv-flow-sub" x="${b.x + 12}" y="${b.y + 50}">${esc(sub)}</text></g>`;
    const curve = (x0, y0, x1, y1, cls, label, bend, shift) => {
        const c1x = x0 + (x1 - x0) * (bend || 0.45), c2x = x1 - (x1 - x0) * (bend || 0.45);
        const mx = (x0 + 3 * c1x + 3 * c2x + x1) / 8, my = (y0 + 3 * y0 + 3 * y1 + y1) / 8;
        return `<path class="rv-flow-arrow ${cls}" marker-end="url(#flowHead-${/off/.test(cls) ? 'off' : cls.split(' ')[0]})" d="M ${x0} ${y0} C ${c1x} ${y0}, ${c2x} ${y1}, ${x1} ${y1}"/>` +
               (label ? `<text class="rv-flow-arrow-label ${cls}" x="${mx + (shift || 0)}" y="${my - 9}" text-anchor="middle">${esc(label)}</text>` : '');
    };

    let out = '';
    // defs: arrow head
    out += '<defs>' + ['income', 'managed', 'reserve', 'off'].map(k =>
        `<marker id="flowHead-${k}" class="${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"/></marker>`).join('') + '</defs>';

    // guaranteed income box
    const incomeNames = state.income.filter(r => num(r.amount) > 0).map(r => r.name).filter(Boolean);
    out += box(A, 'income', 'Guaranteed income', c.income > 0 ? fmt(c.income) + ' a month' : 'none yet',
               incomeNames.length ? incomeNames.slice(0, 3).join(', ') : 'pension, wages, Social Security');
    // managed accounts box
    out += box(B, 'managed', 'Managed accounts', s.managed > 0 ? fmt(s.managed) : 'enter the balance',
               c.rate > 0 ? `draw rate ${pct(c.rate)}` + (c.upper != null ? ` · pause above ${pct(c.upper)}` : '') : 'everything of mine that is invested');
    // money market box
    out += box(C, 'reserve', 'Money market, my reserve', s.mm > 0 ? fmt(s.mm) + (ok && isFinite(c.cover) ? ` · ${fmt1(c.cover)} months` : '') : 'enter the balance',
               c.earmarked > 0 ? `${fmt(c.free)} free · ${fmt(c.earmarked)} held for bills` : (ok ? `target ${fmt(c.target)}, ${s.full} months` : 'two years of the gap'));

    // arrows
    if (ok && guar > 0) out += curve(A.x + A.w, A.y + A.h / 2, endX, midG, 'income', `${fmt(guar)} a month`);
    // managed → column: the distribution
    if (ok) {
        const over = (y1, cls, label) => {
            // up from the top of the managed box, flat above the money market, down into the column
            const x0 = B.x + B.w - 50, y0 = B.y, cy = 72, c2x = C.x + C.w + 60;
            const mx = (x0 + 3 * x0 + 3 * c2x + endX) / 8, my = (y0 + 3 * cy + 3 * cy + y1) / 8;
            return `<path class="rv-flow-arrow ${cls}" marker-end="url(#flowHead-${/off/.test(cls) ? 'off' : 'managed'})" d="M ${x0} ${y0} C ${x0} ${cy}, ${c2x} ${cy}, ${endX} ${y1}"/>` +
                   `<text class="rv-flow-arrow-label ${cls}" x="${mx}" y="${my - 9}" text-anchor="middle">${esc(label)}</text>`;
        };
        if (s.distOn && s.dist > 0 && distUse > 0) out += over(midD, 'managed', `distribution ${fmt(s.dist)} a month`);
        else if (!s.distOn) out += over(Math.max(col.y + 8, yD), 'managed off', 'distributions paused');
    }
    // managed → money market: refills
    out += `<path class="rv-flow-arrow managed ${c.sell > 0 ? '' : 'off'}" marker-end="url(#flowHead-${c.sell > 0 ? 'managed' : 'off'})" d="M ${B.x + B.w} ${B.y + 34} L ${C.x - 6} ${C.y + 34}"/>` +
           `<text class="rv-flow-arrow-label managed ${c.sell > 0 ? '' : 'off'}" x="${(B.x + B.w + C.x) / 2}" y="${B.y + 25}" text-anchor="middle">${esc(c.sell > 0 ? `sell ${fmt(c.sell)} now` : 'sell to refill')}</text>`;
    // money market → column
    if (ok) {
        if (resUse > 0 || c.dueTotal > 0) {
            const label = c.dueTotal > 0 ? (resUse > 0 ? `${fmt(c.monthly)} + ${fmt(c.dueTotal)} bills due` : `${fmt(c.dueTotal)} for bills due`) : `${fmt(c.monthly)} a month`;
            out += curve(C.x + C.w, C.y + C.h / 2, endX, resUse > 0 ? midR : col.y + col.h - 8, 'reserve', label, 0.5, -14);
        } else {
            out += curve(C.x + C.w, C.y + C.h / 2, endX, col.y + col.h - 8, 'reserve off', 'nothing needed this month', 0.5, -14);
        }
    }

    // the column
    out += `<text class="rv-flow-label" x="${col.x}" y="22">What I pay each month</text>`;
    out += `<text class="rv-flow-value big" x="${col.x}" y="44">${esc(ok ? fmt(expenses) : '—')}</text>`;
    out += `<rect class="rv-flow-col-bg" x="${col.x}" y="${col.y}" width="${col.w}" height="${col.h}" rx="6"/>`;
    if (ok) {
        if (hG > 0) out += `<rect class="rv-flow-seg income" x="${col.x}" y="${yG}" width="${col.w}" height="${hG}"/>`;
        if (hD > 0) out += `<rect class="rv-flow-seg managed" x="${col.x}" y="${yD}" width="${col.w}" height="${hD}"/>`;
        if (hR > 0) out += `<rect class="rv-flow-seg reserve" x="${col.x}" y="${yR}" width="${col.w}" height="${hR}"/>`;
        // labels beside the segments, pushed apart so they never overlap
        const labels = [];
        if (guar > 0) labels.push({ y: midG, cls: 'income', text: `guaranteed ${fmt(guar)}` });
        if (distUse > 0) labels.push({ y: midD, cls: 'managed', text: `distribution ${fmt(distUse)}` });
        if (resUse > 0) labels.push({ y: midR, cls: 'reserve', text: `from the reserve ${fmt(resUse)}` });
        for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 18);
        for (let i = labels.length - 1; i >= 0; i--) {
            const maxY = col.y + col.h - (labels.length - 1 - i) * 18;
            if (labels[i].y > maxY) labels[i].y = maxY;
            if (i < labels.length - 1 && labels[i].y > labels[i + 1].y - 18) labels[i].y = labels[i + 1].y - 18;
        }
        labels.forEach(l => { out += `<text class="rv-flow-seg-label ${l.cls}" x="${col.x + col.w + 18}" y="${l.y + 4}">${esc(l.text)}</text>`; });
        // the gap bracket
        if (c.gap > 0 && yD < col.y + col.h) {
            const bx = col.x + col.w + 8, y0 = yD, y1 = col.y + col.h;
            out += `<path class="rv-flow-bracket" d="M ${bx - 3} ${y0} L ${bx} ${y0} L ${bx} ${y1} L ${bx - 3} ${y1}"/>`;
        }
        out += `<text class="rv-flow-sub" x="${col.x}" y="${col.y + col.h + 17}">${esc(c.gap > 0 ? `the gap: ${fmt(c.gap)} a month` : 'no gap: income covers it')}</text>`;
    } else {
        out += `<text class="rv-flow-sub" x="${col.x}" y="${col.y + col.h + 17}">fill in the steps on the left</text>`;
    }
    svg.innerHTML = out;
}

function renderDistBox(c) {
    const s = state.settings;
    $('distState').textContent = s.distOn ? 'on' : 'paused';
    const words = {
        0: 'Continue distributions', 1: 'Continue distributions', 2: 'Restart distributions',
        3: 'Pause distributions', 4: 'Stay paused', 5: 'Restart distributions', 6: 'Continue distributions',
    };
    $('distAction').textContent = c.row in words ? words[c.row] : (s.distOn ? 'Running' : 'Paused');
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
        transfer: c.transfer, due: c.dueTotal, sell: c.sell, action: c.title,
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
