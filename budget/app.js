// ============================================================
// Planner — app.js  (one plan per month, API-driven)
// ============================================================

// ── State ──────────────────────────────────────────────────
let currentPlanId = null;
let currentPlan   = null;   // {id, plan_date, label, starting_balance, kind, excl, items:[], prev_projected}
let allPlans      = [];
let allGroups     = {};     // {group: [{category, type}]}
let catTypes      = {};     // {category: 'income'|'expense'}
let cardOptions   = [];     // [{label, account}] — Quicken accounts for the Credit Cards add box
let settings      = {floor: 3000};

// Scheduled items active for the current plan that are neither accepted nor rejected
let suggestions = {income: [], expense: [], dismissed: {income: 0, expense: 0}};

// Expense groups, top to bottom. An optional group has a "Include in total" box;
// unticked, it is left out of the column totals but never out of the projection.
const EXPENSE_GROUPS = [
    {key: 'other',     title: 'Other'},
    {key: 'utilities', title: 'Utilities',    optional: true},
    {key: 'cards',     title: 'Credit Cards', optional: true},
];
const GROUP_TITLES = {income: 'Income lines', other: 'Other', utilities: 'Utilities', cards: 'Credit Cards'};
const TAG_TEXT     = {oneoff: 'one-off', auto: 'automatic'};
const MONTH_NAMES  = ['January','February','March','April','May','June',
                      'July','August','September','October','November','December'];

// ── Init ───────────────────────────────────────────────────

async function initApp() {
    const nav = document.querySelector('.tab-nav');
    if (nav) document.documentElement.style.setProperty('--nav-h', nav.offsetHeight + 'px');
    // The column totals stick just under the header, whose height changes
    // when the Adjustment box appears.
    const hero = document.querySelector('.pl-hero-wrap');
    if (hero) new ResizeObserver(() =>
        document.documentElement.style.setProperty('--hero-h', hero.offsetHeight + 'px')).observe(hero);

    await Promise.all([loadCategories(), loadCards(), loadSettings(), loadPlans()]);
    if (!allPlans.some(p => p.kind === 'month')) {
        // First run of the monthly Planner: this month starts from the newest dated plan.
        await apiPost('/api/months', {month: thisMonth(), copy_from: allPlans[0]?.id || null});
        await loadPlans();
    }
    const months = allPlans.filter(p => p.kind === 'month');
    const open   = months.find(p => p.plan_date.startsWith(thisMonth())) || months[0];
    renderPlanDropdown();
    await loadPlan(open.id);
}

function thisMonth() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function loadCategories() {
    const data = await apiFetch('/api/categories');
    catTypes  = data.category_types || {};
    allGroups = {};
    for (const [group, cats] of Object.entries(data.groups || {})) {
        allGroups[group] = cats.map(c => ({category: c, type: catTypes[c] || 'expense'}));
    }
}

async function loadCards()    { try { cardOptions = await apiFetch('/api/planner/cards'); } catch (e) { cardOptions = []; } }
async function loadSettings() { try { settings = await apiFetch('/api/planner/settings'); } catch (e) {} }
async function loadPlans()    { allPlans = await apiFetch('/api/plans'); }

// ── Plan CRUD ──────────────────────────────────────────────

async function loadPlan(id) {
    currentPlan   = await apiFetch(`/api/plans/${id}`);
    currentPlanId = id;
    await loadSuggestions();
    renderDropdownSelection();
    renderBudget();
}

async function deletePlan(id) {
    if (allPlans.length <= 1) { showToast('Cannot delete the only plan'); return; }
    await apiDelete(`/api/plans/${id}`);
    allPlans = allPlans.filter(p => p.id !== id);
    renderPlanDropdown();
    if (id === currentPlanId) await loadPlan(allPlans[0].id);
}

async function saveStartingBalance() {
    const input = document.getElementById('startingBalanceInput');
    const val   = parseFloat(input.value.replace(/[^0-9.\-]/g, '')) || 0;
    input.value = formatCurrencyWhole(val);
    currentPlan.starting_balance = val;
    await apiPut(`/api/plans/${currentPlanId}`, {starting_balance: val});
    calculateTotals();
}

// ── Items ──────────────────────────────────────────────────

const groupOf  = i => i.item_type === 'income' ? 'income' : (i.grp || 'other');
const shortCat = c => c.includes(':') ? c.split(':').slice(1).join(':') : c;
const nameOf   = i => i.label || shortCat(i.category || '');
const amountOf = i => parseFloat(i.budget_amount) || 0;
const exclSet  = () => new Set((currentPlan.excl || '').split(',').filter(Boolean));
const esc      = s => escHtmlBP(s).replace(/"/g, '&quot;');

async function removeItem(itemId) {
    await apiDelete(`/api/items/${itemId}`);
    currentPlan.items = currentPlan.items.filter(i => i.id !== itemId);
    renderBudget();
}

// Keep the in-memory plan in sync with edited inputs so a re-render repaints
// the real value instead of the stale pre-edit one.
function updateLocalItemAmount(itemId, amount) {
    const item = (currentPlan.items || []).find(i => i.id === itemId);
    if (item) item.budget_amount = amount;
}

let _saveTimers = {};
function debounceSaveItem(itemId, amount) {
    clearTimeout(_saveTimers[itemId]);
    _saveTimers[itemId] = setTimeout(() => {
        apiPut(`/api/items/${itemId}`, {budget_amount: amount})
            .catch(() => showToast('Could not save — check connection'));
    }, 600);
}

// Click a line's name to change how often it applies. A one-off stays in this
// month only; everything else is carried into the next month's plan.
async function cycleTag(itemId) {
    const item = currentPlan.items.find(i => i.id === itemId);
    if (!item) return;
    const order = item.item_type === 'income' ? ['', 'oneoff', 'auto'] : ['', 'oneoff'];
    item.tag = order[(order.indexOf(item.tag || '') + 1) % order.length];
    renderBudget();
    showToast(`${nameOf(item)}: ${{'': 'every month', oneoff: 'just this month', auto: 'automatic transfer'}[item.tag]}`);
    await apiPut(`/api/items/${itemId}`, {tag: item.tag}).catch(() => showToast('Could not save — check connection'));
}

async function toggleGroup(grp, counted) {
    const excl = exclSet();
    counted ? excl.delete(grp) : excl.add(grp);
    currentPlan.excl = [...excl].join(',');
    document.querySelector(`.pl-card[data-grp="${grp}"]`)?.classList.toggle('pl-off', !counted);
    calculateTotals();
    await apiPut(`/api/plans/${currentPlanId}`, {excl: currentPlan.excl})
        .catch(() => showToast('Could not save — check connection'));
}

// ── Rendering ──────────────────────────────────────────────

function renderBudget() {
    const items = currentPlan.items || [];
    const by    = g => items.filter(i => groupOf(i) === g);
    const excl  = exclSet();
    const el    = document.getElementById('budgetContent');
    el.className = '';
    el.innerHTML = `
        <div class="pl-cols">
            <div class="pl-col">
                <div class="pl-colhead"><span>Income</span><b id="totalIncome"></b></div>
                ${renderCard('income', by('income'))}
            </div>
            <div class="pl-col">
                <div class="pl-colhead"><span>Expenses</span><b id="totalExpenses"></b></div>
                ${EXPENSE_GROUPS.map(g => renderCard(g.key, by(g.key), g.optional, excl.has(g.key))).join('')}
                <div class="pl-card pl-grand">
                    <div><span>Total expenses</span><small id="grandNote"></small></div>
                    <b id="grandExpenses"></b>
                </div>
            </div>
        </div>`;
    enableDragReorder();
    renderHeader();
    calculateTotals();
}

function renderHeader() {
    const balInput = document.getElementById('startingBalanceInput');
    if (balInput) balInput.value = formatCurrencyWhole(currentPlan.starting_balance || 0);

    const prev = currentPlan.prev_projected;
    document.getElementById('prevProjected').textContent =
        prev ? `${prev.month} projected ${money(prev.amount)}` : '';

    let label = 'Projected balance';
    if (currentPlan.kind === 'month') {
        const [y, m] = currentPlan.plan_date.split('-').map(Number);
        label = `Projected ${MONTH_NAMES[m - 1].slice(0, 3)} ${new Date(y, m, 0).getDate()}`;
    }
    document.getElementById('projectedLabel').textContent = label;
}

function renderCard(grp, items, optional, off) {
    const sugg  = grp === 'income' ? renderSuggestionRows('income')
                : grp === 'other'  ? renderSuggestionRows('expense') : '';
    const check = optional ? `
        <label class="pl-count" title="Unticked, this group is left out of the Expenses total. The projected balance always counts it.">
            <input type="checkbox" ${off ? '' : 'checked'} onchange="toggleGroup('${grp}', this.checked)"> Include in total
        </label>` : '';
    return `
        <div class="pl-card${off ? ' pl-off' : ''}" data-grp="${grp}">
            <div class="pl-card-head">
                <span class="pl-card-title">${GROUP_TITLES[grp]}</span>
                ${check}
                <button class="pl-add" onclick="openAdd('${grp}')">+ add</button>
            </div>
            <div class="pl-addrow" id="add_${grp}" hidden>${addRowHtml(grp)}</div>
            <div class="pl-rows" data-grp="${grp}">${items.map(renderRow).join('') || '<p class="pl-empty">No lines yet.</p>'}</div>
            ${sugg}
            <div class="pl-row pl-total"><span>${grp === 'income' ? 'Total' : 'Subtotal'}</span><b id="sub_${grp}"></b></div>
        </div>`;
}

function renderRow(item) {
    const tag  = item.tag ? `<span class="pl-tag pl-tag-${item.tag}">${TAG_TEXT[item.tag]}</span>` : '';
    const full = item.account || item.category || item.label || '';
    return `
        <div class="pl-row${item.tag === 'oneoff' ? ' pl-oneoff' : ''}" data-item-id="${item.id}">
            <span class="pl-grip" draggable="true" title="Drag to reorder">⋮⋮</span>
            <span class="pl-name" title="${esc(full)}. Click to change between every month and just this month."
                  onclick="cycleTag(${item.id})">${esc(nameOf(item))}${tag}</span>
            <input type="text" class="expense-input"
                   value="${formatNumberWithCommas(item.budget_amount)}"
                   data-item-id="${item.id}"
                   onfocus="removeCommasOnFocus(this)"
                   onblur="formatAndSaveAmount(this)"
                   oninput="onAmountInput(this)"
                   onkeypress="if(event.key==='Enter') this.blur()">
            <button class="delete-item-btn" onclick="removeItem(${item.id})" title="Remove">×</button>
        </div>`;
}

// ── Drag to reorder ────────────────────────────────────────
// Drag a row by its grip, within its own card. The order is saved with the
// plan and carried into each new month.

function enableDragReorder() {
    let dragRow = null;
    document.querySelectorAll('.pl-rows').forEach(box => {
        box.querySelectorAll('.pl-grip').forEach(grip => {
            const row = grip.closest('.pl-row');
            grip.addEventListener('dragstart', e => {
                dragRow = row;
                row.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', row.dataset.itemId);
                e.dataTransfer.setDragImage(row, 12, row.offsetHeight / 2);
            });
            grip.addEventListener('dragend', () => {
                row.classList.remove('dragging');
                dragRow = null;
                saveOrder();
            });
        });
        box.addEventListener('dragover', e => {
            if (!dragRow || dragRow.parentElement !== box) return;   // same card only
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const target = e.target.closest('.pl-row');
            if (!target || target === dragRow || target.parentElement !== box) return;
            const rect = target.getBoundingClientRect();
            box.insertBefore(dragRow, e.clientY > rect.top + rect.height / 2 ? target.nextSibling : target);
        });
        box.addEventListener('drop', e => e.preventDefault());
    });
}

function saveOrder() {
    const ids = [...document.querySelectorAll('.pl-rows .pl-row')].map(r => parseInt(r.dataset.itemId));
    const pos = new Map(ids.map((id, n) => [id, n]));
    currentPlan.items.sort((a, b) => pos.get(a.id) - pos.get(b.id));
    apiPut(`/api/plans/${currentPlanId}/order`, {ids})
        .catch(() => showToast('Could not save the order — check connection'));
}

// ── Plan dropdown ──────────────────────────────────────────

function renderPlanDropdown() {
    const menu = document.getElementById('monthDropdownMenu');
    if (!menu) return;
    menu.innerHTML = '';

    const addOption = plan => {
        const opt = document.createElement('div');
        opt.className = `month-option ${plan.id === currentPlanId ? 'selected' : ''}`;

        const span = document.createElement('span');
        span.textContent = plan.label || formatPlanLabel(plan.plan_date);
        span.style.flex = '1';
        span.style.cursor = 'pointer';

        const del = document.createElement('button');
        del.className = 'month-delete-x';
        del.innerHTML = '&times;';
        del.onclick = e => { e.stopPropagation(); deletePlan(plan.id); };

        opt.appendChild(span);
        opt.appendChild(del);
        opt.onclick = e => { if (e.target !== del) selectPlan(plan.id); };
        menu.appendChild(opt);
    };

    allPlans.filter(p => p.kind === 'month').forEach(addOption);

    const newBtn = document.createElement('div');
    newBtn.className = 'month-option new-month-option';
    newBtn.textContent = '+ New month';
    newBtn.onclick = () => { toggleMonthDropdown(); createNewMonth(); };
    menu.appendChild(newBtn);

    const dated = allPlans.filter(p => p.kind !== 'month');
    if (dated.length) {
        const head = document.createElement('div');
        head.className = 'pl-menu-head';
        head.textContent = 'Earlier dated plans';
        menu.appendChild(head);
        dated.forEach(addOption);
    }
    renderDropdownSelection();
}

function renderDropdownSelection() {
    const display = document.getElementById('selectedMonthDisplay');
    if (display && currentPlan) {
        display.textContent = currentPlan.label || formatPlanLabel(currentPlan.plan_date);
    }
}

async function selectPlan(id) {
    toggleMonthDropdown();
    await loadPlan(id);
    renderPlanDropdown();
}

async function selectPlanById(id) {
    await loadPlan(id);
    renderPlanDropdown();
}

function toggleMonthDropdown() {
    document.getElementById('monthDropdownMenu')?.classList.toggle('active');
}

// ── Add a line ─────────────────────────────────────────────
// One name box per card. Pick a Quicken category (or, for Credit Cards, a
// Quicken account) from the suggestions and the line is linked to it; type
// anything else and it is a plain line with that name.

function addRowHtml(grp) {
    const oneoffFirst = grp === 'income' || grp === 'other';   // surprises land here
    const opts = [
        ['', 'Every month'],
        ['oneoff', 'Just this month'],
        ...(grp === 'income' ? [['auto', 'Automatic transfer']] : []),
    ];
    if (oneoffFirst) opts.unshift(opts.splice(1, 1)[0]);
    return `
        <input class="pl-add-name" list="dl_${grp}" placeholder="${grp === 'cards' ? 'Card' : 'Name or Quicken category'}"
               onkeydown="addKey(event, '${grp}')">
        <datalist id="dl_${grp}"></datalist>
        <input class="pl-add-amt" type="number" step="0.01" min="0" placeholder="0" onkeydown="addKey(event, '${grp}')">
        <select class="pl-add-tag">${opts.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>
        <button class="pl-add-ok" onclick="confirmAdd('${grp}')">Add</button>`;
}

function candidates(grp) {
    if (grp === 'cards') return cardOptions.map(c => c.label);
    const type = grp === 'income' ? 'income' : 'expense';
    const used = new Set((currentPlan.items || []).filter(i => i.category).map(i => i.category));
    const out  = [];
    for (const [group, cats] of Object.entries(allGroups)) {
        const isUtil = group.toLowerCase() === 'utilities';
        if (grp === 'utilities' && !isUtil) continue;
        if (grp === 'other' && isUtil) continue;
        cats.forEach(c => { if (c.type === type && !used.has(c.category)) out.push(c.category); });
    }
    return out.sort((a, b) => a.localeCompare(b));
}

function resolveName(grp, text) {
    const name = text.trim(), t = name.toLowerCase();
    if (grp === 'cards') {
        const card = cardOptions.find(c => c.label.toLowerCase() === t);
        return card ? {label: card.label, account: card.account} : {label: name};
    }
    const list = candidates(grp);
    const full = list.find(c => c.toLowerCase() === t);
    if (full) return {category: full};
    const short = list.filter(c => shortCat(c).toLowerCase() === t);
    return short.length === 1 ? {category: short[0]} : {label: name};
}

function openAdd(grp) {
    const row = document.getElementById(`add_${grp}`);
    if (!row) return;
    row.hidden = !row.hidden;
    if (row.hidden) return;
    document.getElementById(`dl_${grp}`).innerHTML =
        candidates(grp).map(c => `<option value="${esc(c)}">`).join('');
    row.querySelector('.pl-add-name').focus();
}

function addKey(e, grp) {
    if (e.key === 'Enter')  confirmAdd(grp);
    if (e.key === 'Escape') document.getElementById(`add_${grp}`).hidden = true;
}

async function confirmAdd(grp) {
    const row  = document.getElementById(`add_${grp}`);
    const name = row.querySelector('.pl-add-name').value;
    if (!name.trim()) { showToast('Please enter a name'); return; }
    const body = {
        ...resolveName(grp, name),
        budget_amount: parseFloat(row.querySelector('.pl-add-amt').value) || 0,
        item_type:     grp === 'income' ? 'income' : 'expense',
        grp:           grp === 'income' ? null : grp,
        tag:           row.querySelector('.pl-add-tag').value,
    };
    try {
        const item = await apiPost(`/api/plans/${currentPlanId}/items`, body);
        currentPlan.items.push(item);
        renderBudget();
        showToast(`Added ${nameOf(item)}`);
    } catch (e) {
        showToast('Could not add — check connection');
    }
}

// ── Totals ─────────────────────────────────────────────────

function money(v) {
    return new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD',
        minimumFractionDigits: 0, maximumFractionDigits: 0}).format(Math.round(v));
}

function calculateTotals() {
    const items = currentPlan.items || [];
    const sum   = g => items.filter(i => groupOf(i) === g).reduce((s, i) => s + amountOf(i), 0);
    const set   = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    const excl  = exclSet();

    const income = sum('income');
    set('sub_income', money(income));
    set('totalIncome', money(income));

    // "all" drives the projection; "counted" is what the column totals show.
    let all = 0, counted = 0;
    const leftOut = [];
    EXPENSE_GROUPS.forEach(g => {
        const t = sum(g.key);
        all += t;
        if (excl.has(g.key)) { if (t) leftOut.push(g.title); }
        else counted += t;
        set(`sub_${g.key}`, money(t));
    });
    set('totalExpenses', money(counted));
    set('grandExpenses', money(counted));
    set('grandNote', leftOut.length ? `${leftOut.join(' and ')} not counted here.` : '');

    const projected = (currentPlan.starting_balance || 0) + income - all;
    const end = document.getElementById('endingBalanceDisplay');
    if (end) {
        end.textContent = money(projected);
        end.classList.toggle('negative', projected < 0);
    }

    // Adjustment: the one extra transfer that brings the projection back up to
    // the floor. Dips that stay above the floor ask for nothing.
    const need = (settings.floor || 0) - projected;
    const box  = document.getElementById('adjustBox');
    if (box) {
        box.classList.toggle('pl-need', need > 0.5);
        box.title = `Shows only when the projection falls below ${money(settings.floor || 0)}. Click to change that amount.`;
        set('adjustValue', need > 0.5 ? money(need) : 'None');
        set('adjustNote',  need > 0.5 ? 'from the Cash bucket' : '');
    }
    queueProjection(projected);
}

// The projection is recorded once a day (last value wins) so next month can
// show what this month was expected to end at.
let _projTimer = null;
function queueProjection(projected) {
    clearTimeout(_projTimer);
    if (currentPlan.kind !== 'month') return;
    const id = currentPlanId;
    _projTimer = setTimeout(() => {
        apiPut(`/api/plans/${id}/projection`, {projected}).catch(() => {});
    }, 1200);
}

function onAmountInput(input) {
    const val    = parseFloat(input.value.replace(/,/g, '')) || 0;
    const itemId = parseInt(input.getAttribute('data-item-id'));
    updateLocalItemAmount(itemId, val);
    debounceSaveItem(itemId, val);
    calculateTotals();
}

// ── The floor (Adjustment popup) ───────────────────────────

function positionNear(el, event) {
    el.style.left = el.style.top = '0px';
    const w = el.offsetWidth, h = el.offsetHeight, pad = 12;
    el.style.left = Math.max(pad, Math.min(event.clientX - w / 2, window.innerWidth  - w - pad)) + 'px';
    el.style.top  = Math.max(pad, Math.min(event.clientY + 14,    window.innerHeight - h - pad)) + 'px';
}

function openFloor(event) {
    const pop = document.getElementById('floorPop');
    document.getElementById('floorInput').value = settings.floor || 0;
    pop.hidden = false;
    positionNear(pop, event);
    document.getElementById('floorInput').select();
    event.stopPropagation();
}

async function saveFloor() {
    const val = parseFloat(document.getElementById('floorInput').value) || 0;
    if (val === settings.floor) return;
    settings.floor = val;
    calculateTotals();
    await apiPut('/api/planner/settings', {floor: val}).catch(() => showToast('Could not save — check connection'));
}

function closeFloor() {
    const pop = document.getElementById('floorPop');
    if (pop && !pop.hidden) { saveFloor(); pop.hidden = true; }
}

// ── New month ──────────────────────────────────────────────

function createNewMonth() {
    const newest = allPlans.find(p => p.kind === 'month');
    let month = thisMonth();
    if (newest) {
        const [y, m] = newest.plan_date.split('-').map(Number);
        month = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    }
    document.getElementById('newMonthPicker').value = month;

    const copyEl = document.getElementById('copyFromSelect');
    copyEl.innerHTML = '<option value="">— start empty —</option>';
    allPlans.forEach(p => {
        const opt = document.createElement('option');
        opt.value       = p.id;
        opt.textContent = p.label || formatPlanLabel(p.plan_date);
        if (newest ? p.id === newest.id : p.id === currentPlanId) opt.selected = true;
        copyEl.appendChild(opt);
    });
    document.getElementById('newDateModal').style.display = 'flex';
}

function hideNewDateModal() {
    document.getElementById('newDateModal').style.display = 'none';
}

async function createNewMonthFromPicker() {
    const month    = document.getElementById('newMonthPicker').value;
    const copyFrom = parseInt(document.getElementById('copyFromSelect').value || '0') || null;
    if (!month) { showToast('Please choose a month'); return; }
    hideNewDateModal();
    try {
        const plan = await apiPost('/api/months', {month, copy_from: copyFrom});
        await loadPlans();
        await loadPlan(plan.id);
        renderPlanDropdown();
    } catch (e) {
        showToast('That month already has a plan');
    }
}

// ── Starting balance ───────────────────────────────────────

function selectStartingBalance() {
    const input = document.getElementById('startingBalanceInput');
    if (input) { input.value = input.value.replace(/[^0-9.\-]/g, ''); input.select(); }
}

function formatAndSaveStartingBalance() { saveStartingBalance(); }

// ── Amount formatting ──────────────────────────────────────

function formatCurrency(v) {
    return new Intl.NumberFormat('en-US', {style:'currency', currency:'USD'}).format(v);
}

function formatCurrencyWithSuperscriptCents(v) {
    const f = new Intl.NumberFormat('en-US', {style:'currency', currency:'USD',
        minimumFractionDigits:2, maximumFractionDigits:2}).format(v);
    const parts = f.split('.');
    return parts.length === 2 ? `${parts[0]}<sup class="cents">.${parts[1]}</sup>` : f;
}

function formatCurrencyWhole(v) {
    return new Intl.NumberFormat('en-US', {style:'currency', currency:'USD',
        minimumFractionDigits:0, maximumFractionDigits:0}).format(Math.trunc(v));
}

function formatNumberWithCommas(v) {
    return (parseFloat(v) || 0).toLocaleString('en-US',
        {minimumFractionDigits:2, maximumFractionDigits:2});
}

function removeCommasOnFocus(input) {
    input.value = input.value.replace(/,/g, '');
    input.select();
}

function formatAndSaveAmount(input) {
    const val    = parseFloat(input.value.replace(/,/g, '')) || 0;
    const itemId = parseInt(input.getAttribute('data-item-id'));
    input.value  = formatNumberWithCommas(val);
    updateLocalItemAmount(itemId, val);
    clearTimeout(_saveTimers[itemId]);   // supersede any pending debounce
    apiPut(`/api/items/${itemId}`, {budget_amount: val})
        .catch(() => showToast('Could not save — check connection'));
    calculateTotals();
}

// ── Date formatting ────────────────────────────────────────

function formatPlanLabel(isoDate) {
    const [y, m, d] = isoDate.split('-').map(Number);
    const months = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];
    return `${months[m-1]} ${d}, ${y}`;
}

// ── Annual Summary (B4) ─────────────────────────────────────

async function showAnnualSummary() {
    // Derive year from current plan
    const year = currentPlan ? parseInt(currentPlan.plan_date.split('-')[0]) : new Date().getFullYear();
    document.getElementById('annualModalTitle').textContent = `Annual Summary — ${year}`;
    document.getElementById('annualModalBody').innerHTML = '<p style="padding:1rem;color:#999">Loading…</p>';
    document.getElementById('annualModal').style.display = 'flex';

    try {
        const data = await apiFetch(`/api/annual-summary?year=${year}`);
        renderAnnualTable(data);
    } catch(e) {
        document.getElementById('annualModalBody').innerHTML = '<p style="color:red;padding:1rem">Failed to load.</p>';
    }
}

function renderAnnualTable(data) {
    const months = data.months;
    if (!months.length) {
        document.getElementById('annualModalBody').innerHTML =
            '<p style="padding:1rem;color:#999">No budget plans for this year.</p>';
        return;
    }

    let totIncome = 0, totExpenses = 0, totActInc = 0, totActExp = 0;
    const rows = months.map(m => {
        totIncome   += m.income;
        totExpenses += m.expenses;
        totActInc   += m.actual_income;
        totActExp   += m.actual_expenses;
        const net     = m.income - m.expenses;
        const actNet  = m.actual_income - m.actual_expenses;
        const hasAct  = m.actual_income + m.actual_expenses > 0;
        return `<tr onclick="selectPlanFromSummary(${m.plan_id})" style="cursor:pointer">
            <td style="white-space:nowrap">${m.label || formatPlanLabel(m.plan_date)}</td>
            <td style="color:#34c759;text-align:right">${fmtS(m.income)}</td>
            <td style="color:#ff9500;text-align:right">${fmtS(m.expenses)}</td>
            <td style="text-align:right;font-weight:600;color:${net >= 0 ? '#34c759' : '#ff3b30'}">${net >= 0 ? '+' : ''}${fmtS(net)}</td>
            <td style="text-align:right;color:#6e6e73;font-size:0.85rem">${hasAct ? fmtS(m.actual_income) : '—'}</td>
            <td style="text-align:right;color:#6e6e73;font-size:0.85rem">${hasAct ? fmtS(m.actual_expenses) : '—'}</td>
            <td style="text-align:right;font-size:0.85rem;color:${actNet >= 0 ? '#34c759' : '#ff3b30'}">${hasAct ? (actNet >= 0 ? '+' : '') + fmtS(actNet) : '—'}</td>
        </tr>`;
    }).join('');

    const totNet    = totIncome - totExpenses;
    const totActNet = totActInc - totActExp;

    document.getElementById('annualModalBody').innerHTML = `
        <table style="width:100%;border-collapse:collapse;font-size:0.88rem">
            <thead>
                <tr style="border-bottom:2px solid #e5e5e7;color:#6e6e73;font-size:0.78rem;text-transform:uppercase;letter-spacing:.04em">
                    <th style="text-align:left;padding:6px 10px">Month</th>
                    <th style="text-align:right;padding:6px 10px">Budget Income</th>
                    <th style="text-align:right;padding:6px 10px">Budget Exp.</th>
                    <th style="text-align:right;padding:6px 10px">Budget Net</th>
                    <th style="text-align:right;padding:6px 10px">Actual Inc.</th>
                    <th style="text-align:right;padding:6px 10px">Actual Exp.</th>
                    <th style="text-align:right;padding:6px 10px">Actual Net</th>
                </tr>
            </thead>
            <tbody style="border-bottom:1px solid #e5e5e7">${rows}</tbody>
            <tfoot>
                <tr style="font-weight:700;border-top:2px solid #e5e5e7;background:#f5f5f7">
                    <td style="padding:8px 10px">Total</td>
                    <td style="text-align:right;padding:8px 10px;color:#34c759">${fmtS(totIncome)}</td>
                    <td style="text-align:right;padding:8px 10px;color:#ff9500">${fmtS(totExpenses)}</td>
                    <td style="text-align:right;padding:8px 10px;color:${totNet>=0?'#34c759':'#ff3b30'}">${totNet>=0?'+':''}${fmtS(totNet)}</td>
                    <td style="text-align:right;padding:8px 10px;color:#6e6e73">${fmtS(totActInc)}</td>
                    <td style="text-align:right;padding:8px 10px;color:#6e6e73">${fmtS(totActExp)}</td>
                    <td style="text-align:right;padding:8px 10px;color:${totActNet>=0?'#34c759':'#ff3b30'}">${totActNet>=0?'+':''}${fmtS(totActNet)}</td>
                </tr>
            </tfoot>
        </table>`;
}

async function selectPlanFromSummary(planId) {
    hideAnnualModal();
    await selectPlanById(planId);
}

function hideAnnualModal() {
    document.getElementById('annualModal').style.display = 'none';
}

function fmtS(v) {
    return '$' + Math.abs(v).toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:0});
}

// ── Scheduled Income (B2) ───────────────────────────────────

let _scheduledIncome = [];

async function loadScheduledIncome() {
    _scheduledIncome = await apiFetch('/api/scheduled-items');
}

async function showScheduledIncomeModal() {
    document.getElementById('scheduledModal').style.display = 'flex';
    await loadScheduledIncome();
    renderScheduledList();
}

function hideScheduledModal() {
    document.getElementById('scheduledModal').style.display = 'none';
}

function renderScheduledList() {
    const el = document.getElementById('scheduledList');
    if (!_scheduledIncome.length) {
        el.innerHTML = '<p style="color:#999;font-size:0.85rem">Nothing scheduled yet.</p>';
        return;
    }
    el.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:0.875rem">
        <thead><tr style="border-bottom:1px solid #e5e5e7;color:#6e6e73;font-size:0.78rem">
            <th style="text-align:left;padding:5px 8px">Source</th>
            <th style="text-align:left;padding:5px 8px">Type</th>
            <th style="text-align:right;padding:5px 8px">Amount/mo</th>
            <th style="text-align:left;padding:5px 8px">Starts</th>
            <th style="text-align:left;padding:5px 8px">Ends</th>
            <th></th>
        </tr></thead>
        <tbody>${_scheduledIncome.map(s => {
            const isExpense = s.item_type === 'expense';
            return `
            <tr style="border-bottom:1px solid #f0f0f0">
                <td style="padding:6px 8px">${escHtmlBP(s.source)}</td>
                <td style="padding:6px 8px"><span class="sched-type-pill ${isExpense ? 'is-expense' : 'is-income'}">${isExpense ? 'Expense' : 'Income'}</span></td>
                <td style="text-align:right;padding:6px 8px;color:${isExpense ? '#e65100' : '#34c759'};font-weight:600">${fmtS(s.amount)}</td>
                <td style="padding:6px 8px;color:#6e6e73">${s.start_date}</td>
                <td style="padding:6px 8px;color:#6e6e73">${s.end_date || '—'}</td>
                <td style="padding:6px 8px"><button class="delete-item-btn" onclick="deleteScheduledIncome(${s.id})">×</button></td>
            </tr>`;
        }).join('')}
        </tbody>
    </table>`;
}

async function addScheduledIncome() {
    const source    = document.getElementById('schedSource').value.trim();
    const amount    = parseFloat(document.getElementById('schedAmount').value) || 0;
    const startDate = document.getElementById('schedStartDate').value;
    const endDate   = document.getElementById('schedEndDate').value || null;
    const itemType  = document.getElementById('schedType').value;
    if (!source || !amount || !startDate) { showToast('Source, amount, and start date required'); return; }
    await apiPost('/api/scheduled-items',
        {source, amount, start_date: startDate, end_date: endDate, item_type: itemType});
    document.getElementById('schedSource').value    = '';
    document.getElementById('schedAmount').value    = '';
    document.getElementById('schedStartDate').value = '';
    document.getElementById('schedEndDate').value   = '';
    await loadScheduledIncome();
    renderScheduledList();
    if (currentPlanId) { await loadSuggestions(); renderBudget(); }
}

async function deleteScheduledIncome(id) {
    await apiDelete(`/api/scheduled-items/${id}`);
    await loadScheduledIncome();
    renderScheduledList();
    if (currentPlanId) { await loadSuggestions(); renderBudget(); }
}

// ── Suggestions: accept / reject scheduled items per period ─────────────

async function loadSuggestions() {
    try {
        suggestions = await apiFetch(`/api/plans/${currentPlanId}/suggestions`);
    } catch(e) {
        suggestions = {income: [], expense: [], dismissed: {income: 0, expense: 0}};
    }
}

// Rows shown under the real lines, styled as not-yet-committed.
function renderSuggestionRows(type) {
    const list      = suggestions[type] || [];
    const dismissed = (suggestions.dismissed || {})[type] || 0;
    if (!list.length && !dismissed) return '';

    const rows = list.map(s => `
        <div class="pl-row pl-sugg" title="Scheduled ${type}, starts ${s.start_date}${s.end_date ? ', ends ' + s.end_date : ''}">
            <span class="pl-name">${escHtmlBP(s.source)}</span>
            <span class="pl-sugg-amt">${formatNumberWithCommas(s.amount)}</span>
            <button class="sched-btn sched-accept" title="Add to this month" onclick="acceptSuggestion(${s.id})">&#10003;</button>
            <button class="sched-btn sched-reject" title="Skip for this month only" onclick="rejectSuggestion(${s.id})">&#10005;</button>
        </div>`).join('');

    const restore = dismissed ? `
        <button class="sched-restore" onclick="restoreSuggestions('${type}')">${dismissed} skipped this month — restore</button>` : '';

    return `<div class="pl-suggs">${list.length ? '<div class="pl-sugg-head">Scheduled, not added</div>' : ''}${rows}${restore}</div>`;
}

async function acceptSuggestion(schedId) {
    const item = await apiPost(`/api/plans/${currentPlanId}/suggestions/${schedId}/accept`, {});
    currentPlan.items.push(item);
    await loadSuggestions();
    renderBudget();
    showToast(`Added ${item.label}`);
}

async function rejectSuggestion(schedId) {
    await apiPost(`/api/plans/${currentPlanId}/suggestions/${schedId}/dismiss`, {});
    await loadSuggestions();
    renderBudget();
    showToast('Skipped for this month');
}

async function restoreSuggestions(type) {
    await apiPost(`/api/plans/${currentPlanId}/suggestions/restore`, {item_type: type});
    await loadSuggestions();
    renderBudget();
}

function escHtmlBP(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Export / Import ────────────────────────────────────────

async function exportData() {
    const plans = await apiFetch('/api/plans');
    const full  = await Promise.all(plans.map(p => apiFetch(`/api/plans/${p.id}`)));
    const blob  = new Blob([JSON.stringify(full, null, 2)], {type:'application/json'});
    const a     = document.createElement('a');
    a.href      = URL.createObjectURL(blob);
    a.download  = `budget-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    showToast('Exported');
}

function importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async e => {
        try {
            const plans = JSON.parse(e.target.result);
            for (const p of plans) {
                try {
                    const created = await apiPost('/api/plans',
                        {plan_date: p.plan_date, label: p.label, starting_balance: p.starting_balance,
                         kind: p.kind, excl: p.excl});
                    for (const item of (p.items || [])) {
                        await apiPost(`/api/plans/${created.id}/items`,
                            {category: item.category, label: item.label, budget_amount: item.budget_amount,
                             item_type: item.item_type, grp: item.grp, tag: item.tag, account: item.account});
                    }
                } catch(e) { /* skip duplicate plan dates */ }
            }
            await loadPlans();
            renderPlanDropdown();
            showToast('Import complete');
        } catch(e) {
            showToast('Import failed — invalid file');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

// ── Toast ──────────────────────────────────────────────────

function showToast(msg) {
    let t = document.getElementById('toast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'toast';
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
}

// ── API helpers ────────────────────────────────────────────

async function apiFetch(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r.json();
}

async function apiPost(url, body) {
    const r = await fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r.json();
}

async function apiPut(url, body) {
    const r = await fetch(url, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r.json();
}

async function apiDelete(url) {
    const r = await fetch(url, {method:'DELETE'});
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r.json();
}

// ── Click-outside and Escape ───────────────────────────────

document.addEventListener('click', e => {
    const menu    = document.getElementById('monthDropdownMenu');
    const trigger = document.querySelector('.month-display-dropdown');
    if (menu?.classList.contains('active') && !menu.contains(e.target) && !trigger?.contains(e.target)) {
        menu.classList.remove('active');
    }
    const pop = document.getElementById('floorPop');
    if (pop && !pop.hidden && !pop.contains(e.target)) closeFloor();

    const newModal  = document.getElementById('newDateModal');
    if (newModal && e.target === newModal) hideNewDateModal();
    const annModal  = document.getElementById('annualModal');
    if (annModal && e.target === annModal) hideAnnualModal();
    const schedModal = document.getElementById('scheduledModal');
    if (schedModal && e.target === schedModal) hideScheduledModal();
});

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeFloor(); });

// ── Start ──────────────────────────────────────────────────

initApp();
