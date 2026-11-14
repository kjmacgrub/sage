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
// monthly amount the Growth bucket pays into the Cash bucket; the rule
// pauses and restarts them. The Cash bucket sends one transfer to shared
// checking each month, larger in a month when an annual bill is due. Everything is saved as one JSON blob through
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
            date: plan.plan_date, label: plan.label, checking: num(plan.starting_balance),
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
    tr.querySelector('.c-saved').innerHTML = `<span class="rv-row-note">${esc(due > 0 ? fmt(due) + ' due this month' : itemNote(it, ym))}</span>`;
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

// The payment that falls in the check-in month, if any.
function dueThisMonth(it, ym) {
    const freq = [1, 2, 4].includes(Number(it.freq)) ? Number(it.freq) : 1;
    const period = 12 / freq;
    const first = Number((it.start || '').split('-')[1]) || 1;
    const cur = Number(ym.split('-')[1]) || 1;
    return ((cur - first) % period + period) % period === 0 ? num(it.amount) / freq : 0;
}

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
    // the part of the draw that goes to shared checking every month; an
    // annual bill goes over only in the month it is due
    const regularGap = Math.max(0, s.deposit + s.own - income);

    // annual bills that fall due now. Nothing is set aside for them: the draw
    // carries a twelfth of each, so the target and the floor already hold them
    const due = active.map(it => ({ name: it.name || 'annual item', amount: dueThisMonth(it, ym) })).filter(d => d.amount > 0);
    const dueTotal = due.reduce((a, d) => a + d.amount, 0);
    const free = Math.max(0, s.mm);

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

    // what the Cash bucket sends to shared checking this month, in one
    // transfer: the regular part of the draw plus any bill due. The
    // distributions land in the Cash bucket, so pausing them does not change it
    const monthly = regularGap;
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
            steps = [`Call Fidelity or Schwab: restart the monthly distribution of ${fmt(s.dist)} into the Cash bucket.`];
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
                         `Leave the monthly transfer of ${fmt(monthly)} from the Cash bucket to checking as it is; the Cash bucket now carries it alone.`,
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
                steps = [`The transfer of ${fmt(monthly)} from the Cash bucket to checking carries on.`, 'Trim discretionary spending where it is easy.', 'Save the month.'];
            } else {
                row = 5; cls = 'forced'; state_ = 'Cash bucket low';
                title = 'Restart the distributions anyway.';
                body = `The Cash bucket is down to ${fmt1(cover)} months, under the ${s.floor}-month floor, and the market has not recovered. The distributions come back on so the Cash bucket stops draining. No top-up until the rate is back at the baseline.`;
                steps = [`Call Fidelity or Schwab: restart the monthly distribution of ${fmt(s.dist)} into the Cash bucket.`,
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
        steps.unshift(`Move ${fmt(dueTotal)} more from the Cash bucket to checking for the ${due.map(d => d.name).join(' and ')} due this month. That makes this month's transfer ${fmt(transfer)}.`);
    }
    if (!missing.length && s.baseline == null) {
        steps.push('No baseline yet, so only the Cash bucket rows of the rule apply. Set it in settings around mid-2027, once the lump sum and condo proceeds are invested.');
    }

    return { annual, annualPm, expenses, income, gap, regularGap, due, dueTotal, free, target, cover, hwm, dd, rate, upper, lower, above, wellBelow,
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
    $('incomeAllTotal').textContent = '(' + fmt(c.income) + ')';
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
// Everything shown is this month. On the left the Growth bucket sits above
// the Cash bucket: the distributions and any top-up run down into Cash. One
// transfer leaves the Cash bucket for shared checking on the right, a column
// with the balance at the top and this month's arrivals stacked under it in
// proportion: the Cash transfer on top of guaranteed income, which arrives
// straight from outside and is the floor of the column.
function renderFlow(c) {
    const s = state.settings;
    const svg = $('flowSvg');
    const W = 1100, H = 460;
    const G = { x: 20, y: 14, w: 300, h: 130 };      // Growth bucket
    const C = { x: 20, y: 250, w: 300, h: 150 };     // Cash bucket
    const K = { x: 800, y: 14, w: 280, h: 432 };     // checking column
    const ready = s.mm > 0 && s.managed > 0;
    const income = c.income, transfer = c.transfer;
    const checking = planner ? planner.checking : 0;

    const widthOf = amt => Math.max(4, Math.min(22, amt / 150));
    // an arrowhead pointing right or down, sized to its line
    const headR = (x, y, w, cls) => `<path class="rv-flow-head ${cls}" d="M ${x - 18} ${y - w / 2 - 7} L ${x} ${y} L ${x - 18} ${y + w / 2 + 7} z"/>`;
    const headD = (x, y, w, cls) => `<path class="rv-flow-head ${cls}" d="M ${x - w / 2 - 6} ${y - 15} L ${x} ${y} L ${x + w / 2 + 6} ${y - 15} z"/>`;
    const tile = (b, cls, label, value, sub) =>
        `<g class="rv-flow-box ${cls}"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="12"/></g>` +
        `<text class="rv-flow-label ${cls.split(' ')[0]}" x="${b.x + 16}" y="${b.y + 24}">${esc(label)}</text>` +
        `<text class="rv-flow-value big" x="${b.x + 16}" y="${b.y + 53}">${esc(value)}</text>` +
        (sub ? `<text class="rv-flow-sub" x="${b.x + 16}" y="${b.y + 73}">${esc(sub)}</text>` : '');

    let out = '<defs><clipPath id="flowClipK"><rect x="' + K.x + '" y="' + K.y + '" width="' + K.w + '" height="' + K.h + '" rx="12"/></clipPath></defs>';

    // ── Growth bucket: balance, draw rate, and the rate against its band
    out += tile(G, 'managed' + (c.above ? ' bad' : ''), 'Growth bucket', s.managed > 0 ? fmt(s.managed) : 'enter the balance',
                c.rate > 0 ? `draw rate ${pct(c.rate)} a year` : 'everything of mine that is invested');
    {
        const tx = G.x + 16, tw = G.w - 32, ty = G.y + 86, th = 8;
        const scale = Math.max(c.upper != null ? c.upper * 1.3 : 0, c.rate * 1.5, 0.1);
        const xAt = v => tx + Math.max(0, Math.min(1, v / scale)) * tw;
        out += `<rect class="rv-flow-track" x="${tx}" y="${ty}" width="${tw}" height="${th}" rx="4"/>`;
        if (c.upper != null) {
            const lx = xAt(c.lower), ux = xAt(c.upper), bx = xAt(s.baseline);
            out += `<rect class="rv-flow-band" x="${lx}" y="${ty}" width="${ux - lx}" height="${th}"/>`;
            if (s.distOn) {
                out += `<line class="rv-flow-tick limit" x1="${ux}" y1="${ty - 5}" x2="${ux}" y2="${ty + th + 5}"/>` +
                       `<text class="rv-flow-tick-label limit" x="${Math.min(ux, G.x + G.w - 60)}" y="${ty + 30}" text-anchor="middle">pause above ${pct(c.upper)}</text>`;
            } else {
                out += `<line class="rv-flow-tick" x1="${bx}" y1="${ty - 5}" x2="${bx}" y2="${ty + th + 5}"/>` +
                       `<text class="rv-flow-tick-label" x="${Math.min(bx, G.x + G.w - 60)}" y="${ty + 30}" text-anchor="middle">restart at ${pct(s.baseline)}</text>`;
            }
        } else if (c.rate > 0) {
            out += `<text class="rv-flow-tick-label" x="${tx}" y="${ty + 30}">no baseline yet, so no pause line</text>`;
        }
        if (c.rate > 0) out += `<circle class="rv-flow-mark${c.above ? ' bad' : ''}" cx="${xAt(c.rate)}" cy="${ty + th / 2}" r="7"/>`;
    }

    // ── Growth → Cash: the distributions, and the top-up when one is due
    {
        const y0 = G.y + G.h, y1 = C.y, x = G.x + 60;
        const on = s.distOn && s.dist > 0;
        const w = on ? widthOf(s.dist) : 3;
        out += `<path class="rv-flow-arrow ${on ? 'managed' : 'off'}" style="stroke-width:${w}" d="M ${x} ${y0} V ${y1 - 14}"/>` + headD(x, y1 - 1, w, on ? 'managed' : 'off');
        out += on
            ? `<text class="rv-flow-arrow-label" x="${x + 22}" y="${y0 + 48}">${esc(fmt(s.dist))} this month</text><text class="rv-flow-sub" x="${x + 22}" y="${y0 + 66}">distributions</text>`
            : `<text class="rv-flow-arrow-label off" x="${x + 22}" y="${y0 + 48}">distributions</text><text class="rv-flow-sub" x="${x + 22}" y="${y0 + 66}">${s.distOn ? 'none set' : 'paused'}</text>`;
        const tx = G.x + 230, top = c.sell > 0;
        out += `<path class="rv-flow-arrow refill ${top ? 'managed' : 'off'}" style="stroke-width:3" d="M ${tx} ${y0} V ${y1 - 12}"/>` + headD(tx, y1 - 1, 3, top ? 'managed' : 'off');
        out += top
            ? `<text class="rv-flow-arrow-label" x="${tx + 14}" y="${y0 + 48}">top-up due</text><text class="rv-flow-sub" x="${tx + 14}" y="${y0 + 66}">sell ${esc(fmt(c.sell))}</text>`
            : `<text class="rv-flow-arrow-label off" x="${tx + 14}" y="${y0 + 48}">top-up</text><text class="rv-flow-sub" x="${tx + 14}" y="${y0 + 66}">none this month</text>`;
    }

    // ── Cash bucket: balance and months of cover against the floor and target
    const hasCover = s.mm > 0 && c.gap > 0 && isFinite(c.cover);
    out += tile(C, 'reserve', 'Cash bucket', s.mm > 0 ? fmt(s.mm) : 'enter the balance',
                hasCover ? `${fmt1(c.cover)} months of cover` : 'two years of what I draw');
    {
        const tx = C.x + 16, tw = C.w - 32, ty = C.y + 86, th = 14;
        const scale = s.full * 1.5;
        const xAt = v => tx + Math.max(0, Math.min(1, v / scale)) * tw;
        out += `<rect class="rv-flow-track" x="${tx}" y="${ty}" width="${tw}" height="${th}" rx="4"/>`;
        if (hasCover) {
            const fcls = c.cover < s.floor ? ' bad' : c.cover < s.full ? ' warn' : '';
            out += `<rect class="rv-flow-fill${fcls}" x="${tx}" y="${ty}" width="${xAt(c.cover) - tx}" height="${th}" rx="4"/>`;
        }
        const fx = xAt(s.floor), gx = xAt(s.full);
        out += `<line class="rv-flow-tick limit" x1="${fx}" y1="${ty - 4}" x2="${fx}" y2="${ty + th + 4}"/>` +
               `<line class="rv-flow-tick" x1="${gx}" y1="${ty - 4}" x2="${gx}" y2="${ty + th + 4}"/>` +
               `<text class="rv-flow-tick-label limit" x="${fx}" y="${ty + 32}" text-anchor="middle">floor ${s.floor} mo</text>` +
               `<text class="rv-flow-tick-label" x="${gx}" y="${ty + 32}" text-anchor="middle">target ${s.full} mo</text>`;
        if (c.gap > 0) {
            out += `<text class="rv-flow-tick-label limit" x="${fx}" y="${ty + 46}" text-anchor="middle">${esc(fmt(c.gap * s.floor))}</text>` +
                   `<text class="rv-flow-tick-label" x="${gx}" y="${ty + 46}" text-anchor="middle">${esc(fmt(c.target))}</text>`;
        }
    }

    // ── Checking: balance at the top, this month's arrivals stacked under it
    const bottom = K.y + K.h;
    const total = checking + income + transfer;
    let hI = 0, hC = 0;
    if (total > 0) {
        const px = K.h / total;
        hI = income > 0 ? Math.max(24, income * px) : 0;
        hC = transfer > 0 ? Math.max(24, transfer * px) : 0;
        const room = K.h - 96;                       // the balance keeps room for its text
        if (hI + hC > room) { const k = room / (hI + hC); hI *= k; hC *= k; }
    }
    const yI = bottom - hI, yC = yI - hC;
    out += `<g clip-path="url(#flowClipK)">` +
           `<rect class="rv-flow-seg checking" x="${K.x}" y="${K.y}" width="${K.w}" height="${K.h}"/>` +
           (hC > 0 ? `<rect class="rv-flow-seg reserve" x="${K.x}" y="${yC}" width="${K.w}" height="${hC}"/>` : '') +
           (hI > 0 ? `<rect class="rv-flow-seg income" x="${K.x}" y="${yI}" width="${K.w}" height="${hI}"/>` : '') +
           `</g><rect class="rv-flow-col-edge" x="${K.x}" y="${K.y}" width="${K.w}" height="${K.h}" rx="12"/>`;
    const kx = K.x + K.w / 2;
    out += `<text class="rv-flow-label checking" x="${kx}" y="${K.y + 36}" text-anchor="middle">Checking · shared</text>` +
           `<text class="rv-flow-value big" x="${kx}" y="${K.y + 68}" text-anchor="middle">${esc(planner ? fmt(checking) : '—')}</text>` +
           `<text class="rv-flow-sub" x="${kx}" y="${K.y + 90}" text-anchor="middle">${esc(planner ? 'balance now, from the Planner' : 'balance is on the Planner')}</text>`;
    if (hC > 0) out += `<text class="rv-flow-on" x="${kx}" y="${yC + hC / 2 + 5}" text-anchor="middle">${esc(fmt(transfer))} · from Cash</text>`;
    if (hI > 0) out += `<text class="rv-flow-on" x="${kx}" y="${yI + hI / 2 + 5}" text-anchor="middle">${esc(fmt(income))} · guaranteed income</text>`;

    // ── Cash → checking: one transfer, landing on its block
    let cashY0 = C.y + C.h - 40;
    {
        const x0 = C.x + C.w, x1 = K.x - 4;
        const yEnd = hC > 0 ? yC + hC / 2 : yI - 12;
        const y0 = Math.max(C.y + 24, Math.min(C.y + C.h - 40, yEnd));
        cashY0 = y0;
        const on = transfer > 0;
        const w = on ? widthOf(transfer) : 3;
        const mid = (x0 + x1 - 16) / 2;
        const d = Math.abs(y0 - yEnd) < 1
            ? `M ${x0} ${y0} H ${x1 - 16}`
            : `M ${x0} ${y0} C ${mid} ${y0}, ${mid} ${yEnd}, ${x1 - 16} ${yEnd}`;
        out += `<path class="rv-flow-arrow ${on ? 'reserve' : 'off'}" style="stroke-width:${w}" d="${d}"/>` + headR(x1, yEnd, w, on ? 'reserve' : 'off');
        const label = !ready ? '' : !on ? 'nothing needed this month'
            : `${fmt(transfer)} this month · ${c.dueTotal > 0 ? 'covers bills due' : 'one transfer'}`;
        if (label) out += `<text class="rv-flow-arrow-label${on ? '' : ' off'}" x="${x0 + 16}" y="${y0 - w / 2 - 10}">${esc(label)}</text>`;
    }

    // ── Guaranteed income: a flow from outside, with no balance of its own
    {
        const names = activeIncome(s.month || thisMonth()).filter(r => num(r.amount) > 0).map(r => r.name).filter(Boolean);
        // level with its block where there is room under the Cash transfer
        const tx = 400, ty = Math.max(cashY0 + 46, Math.min(H - 52, yI + hI / 2 - 18));
        out += `<text class="rv-flow-label income" x="${tx}" y="${ty}">Guaranteed income</text>` +
               `<text class="rv-flow-value" x="${tx}" y="${ty + 24}">${esc(income > 0 ? fmt(income) + ' this month' : 'none yet')}</text>` +
               `<text class="rv-flow-sub" x="${tx}" y="${ty + 43}">${esc(names.length ? names.slice(0, 3).join(', ') : 'pension, wages, Social Security')}</text>`;
        if (income > 0 && hI > 0) {
            const w = widthOf(income), x0 = 610, x1 = K.x - 4, y0 = ty + 18, yEnd = yI + hI / 2;
            const mid = (x0 + x1 - 16) / 2;
            const d = Math.abs(y0 - yEnd) < 1
                ? `M ${x0} ${y0} H ${x1 - 16}`
                : `M ${x0} ${y0} C ${mid} ${y0}, ${mid} ${yEnd}, ${x1 - 16} ${yEnd}`;
            out += `<path class="rv-flow-arrow income" style="stroke-width:${w}" d="${d}"/>` + headR(x1, yEnd, w, 'income');
        }
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
