// ============================================================
// Buckets — the two-bucket plan, checked once a month
// ============================================================
//
// Expenses: paid from the shared checking account; each of us deposits a share.
// Cash bucket: my money market, two years of my draw, where the big yearly
// bills wait. Growth bucket: everything of mine that is invested.
//
// Two bucket balances are typed in from statements. The page works out my
// draw (all-in monthly spending minus guaranteed income; `gap` in the code
// and in saved data), the Cash bucket's months of cover, the draw rate
// (yearly draw / Growth bucket) against its guardrail band, and reads the
// rule table to say exactly what to do. The distributions are the fixed
// monthly amount the Growth bucket pays into shared checking; the rule
// pauses and restarts them. Everything is saved as one JSON blob through
// /api/reserve (the route and table keep their original name).

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
const NAMES = { ken: 'Ken', hilary: 'Hilary' };

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

// ── The drawer with this month's numbers ────────────────────
// Hidden by default. Clicking the selected person's name opens and closes
// it; clicking the other name switches person with the drawer closed. A dot
// on the name shows the month still needs attention (a bucket balance
// missing, not yet saved, or changed since it was saved).

// The drawer and its backdrop start just below the header, so the names
// stay clickable while it is open.
function placeDrawer() {
    const top = Math.round(document.querySelector('.rv-head').getBoundingClientRect().bottom + 8) + 'px';
    $('drawer').style.top = top; $('drawerBackdrop').style.top = top;
}
window.addEventListener('resize', placeDrawer);
function openDrawer() { placeDrawer(); $('drawer').classList.add('open'); $('drawerBackdrop').classList.add('open'); syncPersonTiles(); }
function closeDrawer() { $('drawer').classList.remove('open'); $('drawerBackdrop').classList.remove('open'); syncPersonTiles(); }
function drawerOpen() { return $('drawer').classList.contains('open'); }
function personClick(who) {
    if (who === store.current) { if (drawerOpen()) closeDrawer(); else openDrawer(); }
    else switchPerson(who);
}
function savedRow() { return state.log.find(r => r.month === state.settings.month) || null; }
function monthSaved() { return !!savedRow(); }
// the saved row no longer matches what is on the page
function monthStale(c) {
    const r = savedRow(), s = state.settings;
    if (!r) return false;
    return num(r.mm) !== s.mm || num(r.managed) !== s.managed || num(r.dist) !== s.dist || (r.distOn !== false) !== !!s.distOn
        || Math.abs(num(r.expenses) - c.expenses) > 1 || Math.abs(num(r.income) - c.income) > 1;
}
function drawerNeeded(c) {
    const s = state.settings;
    return !s.mm || !s.managed || !monthSaved() || (c ? monthStale(c) : false);
}
function syncDrawerButton(c) {
    const needed = drawerNeeded(c);
    document.querySelectorAll('.rv-person-tile').forEach(b => b.classList.toggle('needed', needed && b.dataset.who === store.current));
    $('drawerWho').textContent = NAMES[store.current] || '';
}
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeDrawer(); });

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
            p.settings.baseline = null;
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
    normalizeIncome();
    syncPersonTiles();
    await loadPlanner();
    useplanner(false);
    fillInputs();
    renderIncome();
    renderItems();
    render();
}

function syncPersonTiles() {
    const open = $('drawer').classList.contains('open');
    document.querySelectorAll('.rv-person-tile').forEach(b => { const me = b.dataset.who === store.current; b.classList.toggle('active', me); b.classList.toggle('open', me && open); });
}

function switchPerson(who) {
    if (who === store.current) return;
    readInputs();
    closeDrawer();
    store.current = who;
    if (!store.people[who]) store.people[who] = freshPerson(who);
    state = store.people[who];
    state.settings = Object.assign({}, PERSON_DEFAULTS.settings, state.settings);
    if (!state.settings.month) state.settings.month = thisMonth();
    normalizeItems();
    normalizeIncome();
    useplanner(false);
    syncPersonTiles();
    fillInputs(); renderIncome(); renderItems(); render(); scheduleSave();
    closeDrawer();
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
// Its expense total times my share is my deposit toward expenses.

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
    const prevBaseline = s.baseline;
    s.baseline = b === '' ? null : num(b);
    // remember the draw the baseline was set against, so the card can say
    // when the draw has moved far enough that the baseline is stale
    const prevMonth = s.month;
    s.month = $('rvMonth').value || thisMonth();
    if (s.baseline !== prevBaseline) s.baselineGap = s.baseline == null ? null : compute().gap;
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
    if (!(c.rate > 0)) { showToast('Enter the Growth bucket balance and a draw first'); return; }
    state.settings.baseline = Math.round(c.rate * 100) / 100;
    state.settings.baselineGap = c.gap;
    fillInputs(); render(); scheduleSave();
    showToast('Baseline set to ' + pct(state.settings.baseline));
}

// income lines
// Each line has a start and an end month like the annual items; blank means
// it has always run, or runs on. Only the lines running in the check-in
// month count.
function normalizeIncome() {
    state.income.forEach(r => { if (r.start == null) r.start = ''; if (r.end == null) r.end = ''; });
}
function activeIncome(ym) { return state.income.filter(r => itemStatus(r, ym) === 'on'); }
function incomeTotal(ym) { return activeIncome(ym).reduce((a, r) => a + num(r.amount), 0); }
function renderIncome() {
    const body = $('incomeBody');
    body.innerHTML = '';
    const ym = state.settings.month || thisMonth();
    state.income.forEach((row, i) => {
        const tr = document.createElement('tr');
        tr.dataset.i = i;
        tr.innerHTML =
            `<td><input type="text" value="${esc(row.name)}" placeholder="Source" oninput="incomeChange(${i},'name',this.value)"></td>` +
            `<td class="num"><input type="number" step="10" value="${row.amount || ''}" placeholder="0" oninput="incomeChange(${i},'amount',this.value)"></td>` +
            `<td><input type="month" value="${esc(row.start || '')}" onchange="incomeChange(${i},'start',this.value)"></td>` +
            `<td><input type="month" value="${esc(row.end || '')}" onchange="incomeChange(${i},'end',this.value)"></td>` +
            `<td class="c-note"></td>` +
            `<td><button class="rv-del" title="Remove" onclick="removeIncome(${i})">×</button></td>`;
        body.appendChild(tr);
        refreshIncomeRow(tr, row, ym);
    });
    $('incomeTotalNote').textContent = fmt(incomeTotal(ym)) + ' a month in ' + monthLabel(ym);
}
function refreshIncomeRow(tr, row, ym) {
    const on = itemStatus(row, ym) === 'on';
    tr.classList.toggle('rv-row-off', !on);
    tr.querySelector('.c-note').textContent = !row.start && !row.end ? 'always' : itemNote(row, ym);
}
function incomeChange(i, key, val) {
    const row = state.income[i];
    row[key] = key === 'amount' ? num(val) : val;
    const ym = state.settings.month || thisMonth();
    const tr = $('incomeBody').querySelector(`tr[data-i="${i}"]`);
    if (tr) refreshIncomeRow(tr, row, ym);
    $('incomeTotalNote').textContent = fmt(incomeTotal(ym)) + ' a month in ' + monthLabel(ym);
    render(); scheduleSave();
}
function addIncome() { state.income.push({ name: '', amount: 0, start: '', end: '' }); renderIncome(); scheduleSave(); }
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
// What the Cash bucket is holding for an item right now: the twelfths saved
// since the last payment, or the whole bill in the month it is due.
function earmark(it, ym) { return sinking(it, ym) + dueThisMonth(it, ym); }

// ── Calculation ─────────────────────────────────────────────

function compute() {
    const s = state.settings;

    const ym = s.month || thisMonth();
    const active = activeItems(ym);
    const annual = active.reduce((a, it) => a + num(it.amount), 0);
    const annualPm = annual / 12;
    const expenses = s.deposit + s.own + annualPm;
    const income = incomeTotal(ym);
    // my draw: what my buckets have to supply each month
    const gap = Math.max(0, expenses - income);
    // the part of the draw that goes to shared checking every month; the
    // twelfths of the annual items stay in the Cash bucket until each bill is due
    const regularGap = Math.max(0, s.deposit + s.own - income);

    // what the Cash bucket is holding for the annual items, and what falls due now
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
    // once paused, the distributions wait for the rate to come all the way
    // back to the baseline, not just under the pause line, so a choppy market
    // cannot flip them on and off month after month
    const backAtBaseline = s.baseline == null || rate <= s.baseline;
    const stillDown = above || (!s.distOn && !backAtBaseline);
    const wellBelow = lower != null && rate > 0 && rate < lower;

    // what the Cash bucket sends to shared checking this month: the regular
    // part of the draw (less the distribution while it runs) plus any bill due
    const monthly = s.distOn ? Math.max(0, regularGap - s.dist) : regularGap;
    const transfer = monthly + dueTotal;

    // ── the rule ──
    let row = -1, cls = 'setup', state_ = 'Set-up', title = '', body = '', steps = [], sell = 0;
    const missing = [];
    if (!s.mm) missing.push('the Cash bucket balance');
    if (!s.managed) missing.push('the Growth bucket balance');
    if (!(gap > 0)) missing.push('what I pay each month, above my guaranteed income');

    if (missing.length) {
        title = 'Fill in ' + missing.join(', ').replace(/, ([^,]*)$/, ' and $1') + '.';
        body = 'The card needs those before it can read the rule. Open "Enter this month\'s numbers" at the top right; each step says where the number comes from. The Growth bucket is everything of mine that is invested, so the draw rate reads like the familiar 4% rule.';
    } else if (!stillDown) {
        if (!s.distOn) {
            row = 2; cls = 'restart'; state_ = 'Recovered';
            sell = Math.max(0, target - free);
            title = 'Restart the distributions' + (sell > 0 ? ` and sell ${fmt(sell)} to refill the Cash bucket.` : '.');
            body = (upper != null ? `The draw rate is ${pct(rate)}, back at the baseline (${pct(s.baseline)}). ` : '') + `The Growth bucket can carry the monthly amount again, and the Cash bucket${sell > 0 ? ` is at ${fmt1(cover)} months and should go back to ${s.full}` : ' is full'}.`;
            steps = [`Call Fidelity or Schwab: restart the monthly distribution of ${fmt(s.dist)} to checking.`];
            if (sell > 0) steps.push(`Same call: sell ${fmt(sell)} from the Growth bucket and move it to the Cash bucket.`);
            steps.push('Flip the distributions switch on the card to on, then save the month.');
        } else if (cover < s.floor) {
            row = 6; cls = 'forced'; state_ = 'Cash bucket low';
            sell = Math.max(0, gap * s.refill - free);
            title = `Sell ${fmt(sell)} to bring the Cash bucket to ${s.refill} months.`;
            body = `The Cash bucket is down to ${fmt1(cover)} months, under the ${s.floor}-month floor, while the distributions are running. Something other than the market is draining it, so it gets refilled now whatever the market is doing.`;
            steps = [`Call Fidelity or Schwab: sell ${fmt(sell)} from the Growth bucket and move it to the Cash bucket.`,
                     'Look at why the Cash bucket fell: are the distributions set too low for the draw? Note it for the annual review.',
                     'Save the month.'];
        } else if (cover < s.full) {
            row = 1; cls = 'topup'; state_ = 'Normal, top up';
            sell = Math.max(0, target - free);
            title = `Sell ${fmt(sell)} to top the Cash bucket back up to ${s.full} months.`;
            body = (upper != null ? `The draw rate is ${pct(rate)}, inside the band. ` : '') + `The Cash bucket holds ${fmt1(cover)} months against a target of ${s.full} (${fmt(target)}). It is refilled now.`;
            steps = [`Call Fidelity or Schwab, or place it online: sell ${fmt(sell)} from the Growth bucket and move it to the Cash bucket.`,
                     'Save the month.'];
        } else {
            row = 0; cls = 'ok'; state_ = 'Normal';
            title = 'Nothing to do this month.';
            body = upper != null
                ? `The draw rate is ${pct(rate)}, inside the band (under ${pct(upper)}). The Cash bucket holds ${fmt1(cover)} months, at or above the ${s.full}-month target. Continue distributions.`
                : `The Cash bucket holds ${fmt1(cover)} months, at or above the ${s.full}-month target. Continue distributions.`;
            steps = ['Save the month.'];
            if (wellBelow) steps.unshift(`The rate is well under the ${pct(s.baseline)} baseline. Note for the annual review: the distributions could rise.`);
        }
    } else {
        if (s.distOn) {
            if (cover >= s.floor) {
                row = 3; cls = 'pause'; state_ = 'Market down';
                title = 'Pause the distributions.';
                body = `The draw rate is ${pct(rate)}, above the band (${pct(upper)}). The Growth bucket has fallen enough that each monthly distribution is selling too cheaply. The Cash bucket holds ${fmt1(cover)} months and pays everything from here until the rate is back down to the baseline (${pct(s.baseline)}).`;
                steps = [`Call Fidelity or Schwab: pause the monthly distribution of ${fmt(s.dist)} until further notice.`,
                         `Move ${fmt(monthly)} a month from the Cash bucket from now on; this page shows the figure each month.`,
                         'Flip the distributions switch on the card to paused, then save the month.'];
            } else {
                row = 6; cls = 'forced'; state_ = 'Cash bucket low';
                sell = Math.max(0, gap * s.refill - free);
                title = `Sell ${fmt(sell)} to bring the Cash bucket to ${s.refill} months.`;
                body = `The Cash bucket is under the ${s.floor}-month floor at ${fmt1(cover)} months. Even in a down market it has to be refilled; a thin Cash bucket is the bigger risk.`;
                steps = [`Call Fidelity or Schwab: sell ${fmt(sell)} from the Growth bucket and move it to the Cash bucket.`, 'Save the month.'];
            }
        } else {
            if (cover >= s.floor) {
                row = 4; cls = 'hold'; state_ = 'Market down, holding';
                title = 'Hold. Keep paying from the Cash bucket.';
                body = `The draw rate is ${pct(rate)}, ${above ? `still above the band (${pct(upper)})` : `inside the band but not yet back to the baseline (${pct(s.baseline)})`}. The distributions stay paused and the Cash bucket carries the month. It holds ${fmt1(cover)} months, about ${fmt1(Math.max(0, cover - s.floor))} above the floor. Nothing is sold.`;
                steps = [`Move ${fmt(monthly)} from the Cash bucket to cover the month.`, 'Trim discretionary spending where it is easy.', 'Save the month.'];
            } else {
                row = 5; cls = 'forced'; state_ = 'Cash bucket low';
                title = 'Restart the distributions anyway.';
                body = `The Cash bucket is down to ${fmt1(cover)} months, under the ${s.floor}-month floor, and the market has not recovered. The distributions come back on so the Cash bucket stops draining. No top-up until the rate is back at the baseline.`;
                steps = [`Call Fidelity or Schwab: restart the monthly distribution of ${fmt(s.dist)} to checking.`,
                         'Flip the distributions switch on the card to on, then save the month.'];
            }
        }
    }

    const saved = !!state.log.find(r => r.month === ym);
    // notes that go in front of the save step
    const notes = [];
    if (sell > 0) notes.push(`The ${fmt(sell)} is a pre-tax figure. Sold from an IRA it is taxable income this year; check the Tax tab.`);
    if (!missing.length && s.baseline != null && s.baselineGap > 0 && Math.abs(gap - s.baselineGap) / s.baselineGap > 0.1) {
        notes.push(`The draw is ${fmt(gap)} a month against ${fmt(s.baselineGap)} when the baseline was set, so the band is reading a spending change as well as the market. Re-set the baseline in settings at the review.`);
    }
    if (notes.length) {
        const at = steps.indexOf('Save the month.');
        steps.splice(at < 0 ? steps.length : at, 0, ...notes);
    }
    if (saved) steps = steps.filter(t => t !== 'Save the month.');
    if (!missing.length && dueTotal > 0) {
        steps.unshift(`Move ${fmt(dueTotal)} from the Cash bucket to checking for the ${due.map(d => d.name).join(' and ')} due this month. The Cash bucket has been holding it.`);
    }
    if (!missing.length && s.baseline == null) {
        steps.push('No baseline yet, so only the Cash bucket rows of the rule apply. Set it in settings around mid-2027, once the lump sum and condo proceeds are invested.');
    }

    return { annual, annualPm, expenses, income, gap, regularGap, earmarked, due, dueTotal, free, target, cover, hwm, dd, rate, upper, lower, above, wellBelow,
             monthly, transfer, row, cls, state: state_, title, body, steps, sell };
}

// ── Render ──────────────────────────────────────────────────

function render() {
    const s = state.settings;
    const c = compute();

    // the card
    const card = $('actionCard');
    card.className = 'rv-action ' + c.cls;
    $('actionState').textContent = c.state;
    $('actionTitle').textContent = c.title;
    $('actionBody').textContent = c.body;
    $('actionSteps').innerHTML = c.steps.map(t => `<li>${esc(t)}</li>`).join('');

    renderDistBox(c);
    renderFlow(c);
    syncDrawerButton(c);
    renderSaveBox(c);

    // drawer computed bits
    $('rv_annual_pm').textContent = fmt(c.annualPm);
    $('rv_income').textContent = fmt(c.income);
    $('spendAllTotal').textContent = '(' + fmt(c.expenses) + ')';
    $('whereDeposit').textContent = planner ? `Shared checking: Planner ${fmt(planner.expenses)} × ${s.share}% = ${fmt(plannerDeposit())}` : 'Shared checking: my share of the household budget.';
    $('incomeAllTotal').textContent = '(' + fmt(c.income + (s.distOn ? s.dist : 0)) + (s.distOn ? '' : ', distributions paused') + ')';
    $('annualTotal').textContent = c.annual > 0 ? fmt(c.annual) + ' a year' : '';

    // footer: planner and the share
    const parts = [];
    if (planner) {
        const pd = plannerDeposit();
        parts.push(`Planner ${esc(planner.label || planner.date)}: household expenses ${fmt(planner.expenses)} × ${s.share}% share = ${fmt(pd)}` +
                   (Math.abs(pd - s.deposit) > 1 ? `, deposit entered as ${fmt(s.deposit)}` : ''));
    }
    if (c.hwm > 0 && c.dd > 0.5) parts.push(`Growth bucket ${pct(c.dd)} below its high of ${fmt(c.hwm)}`);
    $('plannerText').innerHTML = parts.join('<br>');

    // rule table labels + highlight
    document.querySelectorAll('.r-full').forEach(el => el.textContent = s.full);
    document.querySelectorAll('.r-floor').forEach(el => el.textContent = s.floor);
    document.querySelectorAll('.r-refill').forEach(el => el.textContent = s.refill);
    document.querySelectorAll('.r-band').forEach(el => el.textContent = s.band);
    document.querySelectorAll('#ruleTable tbody tr').forEach(tr => tr.classList.toggle('active', Number(tr.dataset.row) === c.row));

    renderLog();
}

// ── The picture ─────────────────────────────────────────────
// The two buckets of mine and my guaranteed income on the left feed the
// Expenses on the right: a column whose height is what I pay each
// month, stacked from what covers it. Guaranteed income is the foundation
// at the bottom, the fixed distribution sits on it, and the Cash bucket
// fills whatever is left at the top. Everything above guaranteed income is
// my draw. The Cash bucket tile carries its months-of-cover gauge.
function renderFlow(c) {
    const s = state.settings;
    const svg = $('flowSvg');
    const expenses = c.expenses;
    const guar = Math.min(c.income, expenses);
    const distUse = s.distOn ? Math.min(s.dist, Math.max(0, expenses - guar)) : 0;
    const resUse = Math.max(0, expenses - guar - distUse);
    const ok = expenses > 0;

    // tiles, top to bottom in the order their flows arrive at the column
    const C = { x: 20, y: 8, w: 340, h: 106 };      // Cash bucket, with its gauge
    const B = { x: 20, y: 134, w: 340, h: 106 };    // Growth bucket, with its gauge
    const A = { x: 20, y: 262, w: 340, h: 70 };     // guaranteed income
    // the expenses column: income at the bottom, cash at the top
    const col = { x: 1000, w: 64, y: 86, h: 226 };
    // the draw collector: the Cash bucket and the distribution land here,
    // and together they are the draw, which then goes into the column
    const D = { x: 800, w: col.x - 26 - 800 };
    const seg = (amt) => ok ? col.h * amt / expenses : 0;
    const hG = seg(guar), hD = seg(distUse), hR = seg(resUse);
    const yG = col.y + col.h - hG, yD = yG - hD, yR = yD - hR;
    const midG = yG + hG / 2, midD = yD + hD / 2, midR = yR + hR / 2;
    const endX = col.x - 7;          // where the income arrow lands
    const drawX = D.x - 7;           // where the draw arrows land

    const tile = (b, cls, label, value, sub) =>
        `<g class="rv-flow-box ${cls}"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="10"/>` +
        `<text class="rv-flow-label ${cls.split(' ')[0]}" x="${b.x + 16}" y="${b.y + 22}">${esc(label)}</text>` +
        `<text class="rv-flow-value" x="${b.x + 16}" y="${b.y + 47}">${esc(value)}</text>` +
        (sub ? `<text class="rv-flow-sub" x="${b.x + 16}" y="${b.y + 65}">${esc(sub)}</text>` : '') + `</g>`;
    const head = cls => `url(#flowHead-${/off/.test(cls) ? 'off' : cls.split(' ')[0]})`;
    const curve = (x0, y0, x1, y1, cls, label, bend, shift) => {
        const c1x = x0 + (x1 - x0) * (bend || 0.45), c2x = x1 - (x1 - x0) * (bend || 0.45);
        const mx = (x0 + 3 * c1x + 3 * c2x + x1) / 8, my = (y0 + y1) / 2;
        return `<path class="rv-flow-arrow ${cls}" marker-end="${head(cls)}" d="M ${x0} ${y0} C ${c1x} ${y0}, ${c2x} ${y1}, ${x1} ${y1}"/>` +
               (label ? `<text class="rv-flow-arrow-label ${cls}" x="${mx + (shift || 0)}" y="${my - 10}" text-anchor="middle">${esc(label)}</text>` : '');
    };

    let out = '';
    out += '<defs>' + ['income', 'managed', 'reserve', 'draw', 'off'].map(k =>
        `<marker id="flowHead-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"/></marker>`).join('') + '</defs>';

    // Cash bucket, with the months-of-cover gauge inside
    const hasCover = ok && s.mm > 0 && isFinite(c.cover);
    out += tile(C, 'reserve', 'Cash bucket', s.mm > 0 ? fmt(s.mm) + (hasCover ? ` · ${fmt1(c.cover)} months` : '') : 'enter the balance',
                c.earmarked > 0 ? `${fmt(c.free)} free · ${fmt(c.earmarked)} held for bills` : (ok ? `${s.full} months of my draw is ${fmt(c.target)}` : 'two years of my draw'));
    {
        // a vertical gauge at the right of the tile: months of cover filling
        // from the bottom, the floor mark below the target mark
        const bw = 16, bx = C.x + C.w - 90, by = C.y + 10, bh = C.h - 20;
        const cscale = s.full * 1.3;
        const yAt = v => by + bh - Math.max(0, Math.min(1, v / cscale)) * bh;
        out += `<rect class="rv-flow-track" x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="5"/>`;
        if (hasCover) {
            const top = yAt(c.cover);
            const fcls = c.cover < s.floor ? ' bad' : c.cover < s.full ? ' warn' : '';
            out += `<rect class="rv-flow-fill${fcls}" x="${bx}" y="${top}" width="${bw}" height="${by + bh - top}" rx="5"/>`;
        }
        const fy = yAt(s.floor), ty = yAt(s.full);
        out += `<line class="rv-flow-tick" x1="${bx - 4}" y1="${ty}" x2="${bx + bw + 4}" y2="${ty}"/>` +
               `<text class="rv-flow-tick-label" x="${bx + bw + 8}" y="${ty + 4}">target ${s.full}</text>` +
               `<line class="rv-flow-tick limit" x1="${bx - 4}" y1="${fy}" x2="${bx + bw + 4}" y2="${fy}"/>` +
               `<text class="rv-flow-tick-label limit" x="${bx + bw + 8}" y="${fy + 4}">floor ${s.floor}</text>`;
    }
    // Growth bucket, with the draw-rate gauge inside
    out += tile(B, 'managed' + (c.above ? ' bad' : ''), 'Growth bucket', s.managed > 0 ? fmt(s.managed) : 'enter the balance',
                c.rate > 0 ? `draw rate ${pct(c.rate)}` + (c.upper != null ? ` · baseline ${pct(s.baseline)}` : ' · no baseline yet') : 'everything of mine that is invested');
    if (c.rate > 0) out += `<text class="rv-flow-sub" x="${B.x + 16}" y="${B.y + 78}">${esc(c.hwm > 0 && c.dd > 0.5 ? `${pct(c.dd)} below its high of ${fmt(c.hwm)}` : 'my yearly draw ÷ this balance')}</text>`;
    {
        // a vertical gauge at the right of the tile: the draw rate filling from
        // the bottom, the guardrail band shaded over it. The top edge is the
        // pause line and acts; the bottom edge only flags the annual review.
        const bw = 16, bx = B.x + B.w - 90, by = B.y + 10, bh = B.h - 20;
        const rscale = Math.max(c.upper != null ? c.upper * 1.35 : 0, c.rate * 1.15, 0.1);
        const yAt = v => by + bh - Math.max(0, Math.min(1, v / rscale)) * bh;
        out += `<rect class="rv-flow-track" x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="5"/>`;
        if (c.upper != null) {
            const uy = yAt(c.upper), ly = yAt(c.lower), my = yAt(s.baseline);
            out += `<rect class="rv-flow-band" x="${bx}" y="${uy}" width="${bw}" height="${ly - uy}"/>` +
                   `<line class="rv-flow-tick faint" x1="${bx}" y1="${my}" x2="${bx + bw}" y2="${my}"/>` +
                   `<line class="rv-flow-tick limit" x1="${bx - 4}" y1="${uy}" x2="${bx + bw + 4}" y2="${uy}"/>` +
                   (s.distOn ? `<text class="rv-flow-tick-label limit" x="${bx + bw + 8}" y="${uy + 4}">pause ${pct(c.upper)}</text>` : '') +
                   (s.distOn
                       ? `<line class="rv-flow-tick soft" x1="${bx - 4}" y1="${ly}" x2="${bx + bw + 4}" y2="${ly}"/>` +
                         `<text class="rv-flow-tick-label" x="${bx + bw + 8}" y="${ly + 4}">review ${pct(c.lower)}</text>`
                       : `<line class="rv-flow-tick" x1="${bx - 4}" y1="${my}" x2="${bx + bw + 4}" y2="${my}"/>` +
                         `<text class="rv-flow-tick-label" x="${bx + bw + 8}" y="${my + 4}">restart ${pct(s.baseline)}</text>`);
        }
        if (c.rate > 0) {
            // this month's rate is a marker across the track, not a fill: a rate
            // is a reading, and the question is where it sits against the band
            const ry = yAt(c.rate);
            out += `<rect class="rv-flow-mark${c.above ? ' bad' : ''}" x="${bx - 6}" y="${ry - 3.5}" width="${bw + 12}" height="7" rx="3.5"/>`;
            if (c.upper == null) out += `<text class="rv-flow-tick-label" x="${bx + bw + 8}" y="${ry + 4}">${pct(c.rate)}</text>`;
        }
    }
    // guaranteed income
    const incomeNames = activeIncome(state.settings.month || thisMonth()).filter(r => num(r.amount) > 0).map(r => r.name).filter(Boolean);
    out += tile(A, 'income', 'Guaranteed income', c.income > 0 ? fmt(c.income) + ' a month' : 'none yet',
                incomeNames.length ? incomeNames.slice(0, 3).join(', ') : 'pension, wages, Social Security');

    // arrows
    // Growth → Cash: refills, an arc out of the Growth bucket's right side
    // and back into the Cash bucket's right side
    {
        const x0 = B.x + B.w, y0 = B.y + 16, x1 = C.x + C.w + 7, y1 = C.y + C.h - 16, bulge = x0 + 70;
        const on = c.sell > 0;
        out += `<path class="rv-flow-arrow managed refill ${on ? '' : 'off'}" marker-end="url(#flowHead-${on ? 'managed' : 'off'})" d="M ${x0} ${y0} C ${bulge} ${y0}, ${bulge} ${y1}, ${x1} ${y1}"/>` +
               `<text class="rv-flow-arrow-label managed ${on ? '' : 'off'}" x="${bulge + 4}" y="${y1 + 10}" text-anchor="start">${esc(on ? `sell ${fmt(c.sell)} now` : 'sell to refill')}</text>`;
    }
    if (ok) {
        // Cash → Spending: the top of the column
        if (resUse > 0 || c.dueTotal > 0) {
            const label = c.dueTotal > 0 ? `${fmt(c.transfer)} with bills due` : `${fmt(c.monthly)} a month`;
            out += curve(C.x + C.w, C.y + 58, c.gap > 0 ? drawX : endX, resUse > 0 ? midR : col.y + 8, 'reserve', label, 0.5);
        } else {
            out += curve(C.x + C.w, C.y + 58, c.gap > 0 ? drawX : endX, col.y + 8, 'reserve off', 'nothing needed', 0.5);
        }
        // Growth → Spending: the distribution, into the middle
        if (s.distOn && s.dist > 0 && distUse > 0) out += curve(B.x + B.w, B.y + B.h / 2, drawX, midD, 'managed', `distribution ${fmt(s.dist)} a month`, 0.4);
        else if (!s.distOn) out += curve(B.x + B.w, B.y + B.h / 2, c.gap > 0 ? drawX : endX, Math.min(col.y + col.h - 8, yD), 'managed off', 'distributions paused', 0.4);
        // income → Spending: the foundation
        if (guar > 0) out += curve(A.x + A.w, A.y + A.h / 2, endX, midG, 'income', `${fmt(guar)} a month`, 0.4);
    }

    // the expenses column
    out += `<text class="rv-flow-label" x="${col.x}" y="30">Expenses</text>`;
    out += `<text class="rv-flow-sub" x="${col.x}" y="46">shared checking · my deposit</text>`;
    out += `<text class="rv-flow-value big" x="${col.x}" y="72">${esc(ok ? fmt(expenses) + ' a month' : '—')}</text>`;
    out += `<rect class="rv-flow-col-bg" x="${col.x}" y="${col.y}" width="${col.w}" height="${col.h}" rx="8"/>`;
    if (ok) {
        if (hG > 0) out += `<rect class="rv-flow-seg income" x="${col.x}" y="${yG}" width="${col.w}" height="${hG}"/>`;
        if (hD > 0) out += `<rect class="rv-flow-seg managed" x="${col.x}" y="${yD}" width="${col.w}" height="${hD}"/>`;
        if (hR > 0) out += `<rect class="rv-flow-seg reserve" x="${col.x}" y="${yR}" width="${col.w}" height="${hR}"/>`;
        // labels beside the segments, top to bottom, pushed apart so they never overlap
        const labels = [];
        if (resUse > 0) labels.push({ y: midR, cls: 'reserve', text: `Cash bucket ${fmt(resUse)}` });
        if (distUse > 0) labels.push({ y: midD, cls: 'managed', text: `distribution ${fmt(distUse)}` });
        if (guar > 0) labels.push({ y: midG, cls: 'income', text: `guaranteed ${fmt(guar)}` });
        for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 18);
        for (let i = labels.length - 1; i >= 0; i--) {
            const maxY = col.y + col.h - (labels.length - 1 - i) * 18;
            if (labels[i].y > maxY) labels[i].y = maxY;
            if (i < labels.length - 1 && labels[i].y > labels[i + 1].y - 18) labels[i].y = labels[i + 1].y - 18;
        }
        labels.forEach(l => { out += `<text class="rv-flow-seg-label ${l.cls}" x="${col.x + col.w + 20}" y="${l.y + 4}">${esc(l.text)}</text>`; });
        // the draw collector: spans the top two layers, left of the column
        if (c.gap > 0 && yG > col.y) {
            const y0 = col.y, y1 = yG, hh = y1 - y0, cy = (y0 + y1) / 2;
            out += `<rect class="rv-flow-draw" x="${D.x}" y="${y0}" width="${D.w}" height="${hh}" rx="8"/>`;
            // a bracket between the draw total and the two layers it is made of
            const bx = col.x - 11;
            out += `<path class="rv-flow-bracket" d="M ${bx + 5} ${y0} L ${bx} ${y0} L ${bx} ${y1} L ${bx + 5} ${y1}"/>`;
            const cx = D.x + D.w / 2;
            if (hh >= 44) {
                out += `<text class="rv-flow-label draw" x="${cx}" y="${cy - 4}" text-anchor="middle">My draw</text>` +
                       `<text class="rv-flow-value" x="${cx}" y="${cy + 16}" text-anchor="middle">${esc(fmt(c.gap) + ' a month')}</text>`;
            } else if (hh >= 20) {
                out += `<text class="rv-flow-seg-label" x="${cx}" y="${cy + 5}" text-anchor="middle">${esc('my draw ' + fmt(c.gap))}</text>`;
            } else {
                out += `<text class="rv-flow-seg-label" x="${cx}" y="${y0 - 6}" text-anchor="middle">${esc('my draw ' + fmt(c.gap))}</text>`;
            }
        } else {
            out += `<text class="rv-flow-sub" x="${col.x}" y="${col.y + col.h + 20}">no draw: income covers it</text>`;
        }
    } else {
        out += `<text class="rv-flow-sub" x="${col.x}" y="${col.y + col.h + 20}">enter this month's numbers</text>`;
    }
    svg.innerHTML = out;
}

function renderSaveBox(c) {
    const s = state.settings;
    const r = savedRow();
    const stale = monthStale(c);
    const btn = $('saveBtn'), note = $('saveNote');
    btn.textContent = r ? 'Save again' : 'Save this month';
    btn.classList.toggle('quiet', !!r && !stale);
    note.className = 'rv-save-note' + (stale ? ' stale' : '');
    note.textContent = !r ? `${monthLabel(s.month)} not saved yet`
        : stale ? 'numbers changed since it was saved'
        : `${monthLabel(s.month)} saved`;
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
    showToast((existing >= 0 ? 'Updated ' : 'Saved ') + monthLabel(s.month) + '. Now read the card.');
    closeDrawer();
}

function removeLog(i) {
    state.log.splice(i, 1);
    render();
    scheduleSave();
}

load();
