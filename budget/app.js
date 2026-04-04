// ============================================================
// Budget Planner — app.js  (API-driven, Quicken categories)
// ============================================================

// ── State ──────────────────────────────────────────────────
let currentPlanId  = null;
let currentPlan    = null;   // {id, plan_date, label, starting_balance, items:[]}
let allPlans       = [];
let allGroups      = {};     // {group: [{category, type}]}
let catTypes       = {};     // {category: 'income'|'expense'}
let currentActuals = {};     // {category: amount}
let panelsExpanded = false;
let showZeroIncome = false;
let showZeroExpense= false;

// ── Init ───────────────────────────────────────────────────

async function initApp() {
    await loadCategories();
    await loadPlans();
    if (allPlans.length === 0) {
        const today = new Date();
        const iso   = today.toISOString().split('T')[0];
        const label = formatPlanLabel(iso);
        const plan  = await apiPost('/api/plans', {plan_date: iso, label, starting_balance: 0});
        allPlans = [plan];
    }
    renderPlanDropdown();
    await loadPlan(allPlans[0].id);
}

async function loadCategories() {
    const data = await apiFetch('/api/categories');
    catTypes  = data.category_types || {};
    allGroups = {};
    for (const [group, cats] of Object.entries(data.groups || {})) {
        allGroups[group] = cats.map(c => ({category: c, type: catTypes[c] || 'expense'}));
    }
}

async function loadPlans() {
    allPlans = await apiFetch('/api/plans');
}

// ── Plan CRUD ──────────────────────────────────────────────

async function loadPlan(id) {
    currentPlan   = await apiFetch(`/api/plans/${id}`);
    currentPlanId = id;

    // Derive month/year from plan_date e.g. "2026-01-08"
    const [year, month] = currentPlan.plan_date.split('-').map(Number);
    currentActuals = await apiFetch(`/api/actuals?month=${month}&year=${year}`);

    renderDropdownSelection();
    renderBudget();
}

async function createNewPlan(isoDate) {
    const label = formatPlanLabel(isoDate);
    try {
        const plan = await apiPost('/api/plans', {plan_date: isoDate, label, starting_balance: 0});
        allPlans.unshift(plan);
        renderPlanDropdown();
        await loadPlan(plan.id);
    } catch(e) {
        showToast('A plan with that date already exists');
    }
}

async function deletePlan(id) {
    if (allPlans.length <= 1) { showToast('Cannot delete the only plan'); return; }
    await apiDelete(`/api/plans/${id}`);
    allPlans = allPlans.filter(p => p.id !== id);
    renderPlanDropdown();
    await loadPlan(allPlans[0].id);
}

async function saveStartingBalance() {
    const input = document.getElementById('startingBalanceInput');
    const val   = parseFloat(input.value.replace(/[^0-9.]/g, '')) || 0;
    input.value = formatCurrencyWhole(val);
    currentPlan.starting_balance = val;
    await apiPut(`/api/plans/${currentPlanId}`, {starting_balance: val});
    calculateTotals();
}

// ── Item CRUD ──────────────────────────────────────────────

async function addBudgetItem(category, budgetAmount) {
    const type = catTypes[category] || 'expense';
    const item = await apiPost(`/api/plans/${currentPlanId}/items`,
        {category, budget_amount: budgetAmount, item_type: type});
    currentPlan.items.push(item);
    renderBudget();
    showToast(`Added ${category}`);
}

async function addFreeformItem(label, budgetAmount) {
    const item = await apiPost(`/api/plans/${currentPlanId}/items`,
        {label, budget_amount: budgetAmount, item_type: 'expense'});
    currentPlan.items.push(item);
    renderBudget();
    showToast(`Added ${label}`);
}

async function removeItem(itemId) {
    await apiDelete(`/api/items/${itemId}`);
    currentPlan.items = currentPlan.items.filter(i => i.id !== itemId);
    renderBudget();
}

let _saveTimers = {};
function debounceSaveItem(itemId, amount) {
    clearTimeout(_saveTimers[itemId]);
    _saveTimers[itemId] = setTimeout(() => {
        apiPut(`/api/items/${itemId}`, {budget_amount: amount});
    }, 600);
}

// ── Rendering ──────────────────────────────────────────────

function renderBudget() {
    const incomeItems  = (currentPlan.items || []).filter(i => i.item_type === 'income');
    const expenseItems = (currentPlan.items || []).filter(i => i.item_type === 'expense');

    const content = `
        <div class="two-column-wrapper">
            <div class="budget-panel income-panel">
                <div class="budget-panel-header">
                    <span class="budget-panel-title income-title">Income</span>
                    <span class="budget-panel-total" id="totalIncome">$0</span>
                    <button class="add-category-plus" onclick="openAddItem('income')" title="Add income category">+</button>
                </div>
                ${renderTable(incomeItems, 'income')}
            </div>
            <div class="budget-panel expense-panel">
                <div class="budget-panel-header">
                    <span class="budget-panel-title expense-title">Expenses</span>
                    <span class="budget-panel-total" id="totalExpenses">$0</span>
                    <button class="add-category-plus" onclick="openAddItem('expense')" title="Add expense category">+</button>
                </div>
                ${renderTable(expenseItems, 'expense')}
            </div>
        </div>`;

    document.getElementById('budgetContent').innerHTML = content;

    const balInput = document.getElementById('startingBalanceInput');
    if (balInput) balInput.value = formatCurrencyWhole(currentPlan.starting_balance || 0);

    calculateTotals();
    renderScheduledSuggestions();
}

function renderTable(items, type) {
    if (!items.length) {
        return `<p class="empty-section">No ${type} items — click + to add.</p>`;
    }

    // Group by Quicken top-level category; freeform items go under '__freeform__'
    const grouped = {};
    items.forEach(item => {
        const group = !item.category ? '__freeform__'
            : item.category.includes(':') ? item.category.split(':')[0]
            : item.category;
        (grouped[group] = grouped[group] || []).push(item);
    });

    const rows = Object.entries(grouped).sort(([a],[b]) => {
        if (a === '__freeform__') return 1;
        if (b === '__freeform__') return -1;
        return a.localeCompare(b);
    }).map(([group, groupItems]) => {
        const groupLabel = group === '__freeform__' ? 'Custom' : group;
        const itemRows = groupItems
            .sort((a,b) => (a.label || a.category).localeCompare(b.label || b.category))
            .map(item => renderItem(item, type, group))
            .join('');
        return `
            <tr class="budget-group-row">
                <td class="group-name">${groupLabel}</td>
                <td></td><td></td><td></td>
                <td class="group-subtotal" id="stot_${CSS.escape(group)}_${type}"></td>
            </tr>
            ${itemRows}`;
    }).join('');

    return `
        <table class="budget-table">
            <thead>
                <tr class="budget-col-heads">
                    <th class="bh-cat">Category</th>
                    <th class="bh-num">Budget</th>
                    <th class="bh-num">Actual</th>
                    <th class="bh-num">Diff</th>
                    <th class="bh-del"></th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>`;
}

function renderItem(item, type, group) {
    const isFreeform  = !item.category;
    const displayName = isFreeform
        ? item.label
        : (item.category.includes(':') ? item.category.split(':').slice(1).join(':') : item.category);

    const actualRaw = isFreeform ? 0 : (currentActuals[item.category] || 0);
    const actualAbs = Math.abs(actualRaw);
    const actualStr = isFreeform ? '—' : (actualAbs > 0.01 ? formatCurrencyWhole(actualAbs) : '—');

    const budget = parseFloat(item.budget_amount) || 0;
    let diffStr = '', diffClass = '';
    if (!isFreeform && actualAbs > 0.01 && budget > 0) {
        const diff = type === 'income' ? (actualAbs - budget) : (budget - actualAbs);
        if (Math.abs(diff) < 1) {
            diffStr = '—'; diffClass = 'exact';
        } else {
            diffStr   = (diff > 0 ? '+' : '') + formatCurrencyWhole(diff);
            diffClass = diff > 0 ? 'under' : 'over';
        }
    }

    return `
    <tr class="budget-item-row" data-item-id="${item.id}">
        <td class="item-name${isFreeform ? ' freeform-item' : ''}" title="${isFreeform ? item.label : item.category}">${displayName}</td>
        <td class="item-budget">
            <input type="text" class="expense-input"
                   value="${formatNumberWithCommas(item.budget_amount)}"
                   data-item-id="${item.id}"
                   data-group-type="${type}"
                   data-group="${group}"
                   onfocus="removeCommasOnFocus(this)"
                   onblur="formatAndSaveAmount(this)"
                   oninput="onAmountInput(this)"
                   onkeypress="if(event.key==='Enter') this.blur()">
        </td>
        <td class="item-actual">${actualStr}</td>
        <td class="item-diff ${diffClass}">${diffStr}</td>
        <td class="item-del"><button class="delete-item-btn" onclick="removeItem(${item.id})">×</button></td>
    </tr>`;
}

// ── Plan dropdown ──────────────────────────────────────────

function renderPlanDropdown() {
    const menu    = document.getElementById('monthDropdownMenu');
    const display = document.getElementById('selectedMonthDisplay');
    if (!menu || !display) return;

    menu.innerHTML = '';
    allPlans.forEach(plan => {
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
    });

    const newBtn = document.createElement('div');
    newBtn.className = 'month-option new-month-option';
    newBtn.textContent = '+ New Date';
    newBtn.onclick = () => { toggleMonthDropdown(); createNewMonth(); };
    menu.appendChild(newBtn);

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

// ── Add item modal ─────────────────────────────────────────

let _addItemType = 'expense';

function openAddItem(type) {
    _addItemType = type;
    const modal = document.getElementById('addItemModal');
    const sel   = document.getElementById('addItemSelect');
    if (!modal || !sel) return;

    // Get categories already in plan for this type (only category-based items)
    const used = new Set((currentPlan.items || []).filter(i => i.category).map(i => i.category));

    // Build options from allGroups
    sel.innerHTML = '<option value="">— select a category —</option>';
    if (type === 'expense') {
        sel.innerHTML += '<option value="__custom__">— Custom name… —</option>';
    }
    Object.entries(allGroups).sort(([a],[b]) => a.localeCompare(b)).forEach(([group, cats]) => {
        const matching = cats.filter(c => c.type === type && !used.has(c.category));
        if (!matching.length) return;
        const og = document.createElement('optgroup');
        og.label = group;
        matching.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.category;
            opt.textContent = c.category.includes(':') ? c.category.split(':').slice(1).join(':') : c.category;
            og.appendChild(opt);
        });
        sel.appendChild(og);
    });

    sel.onchange = () => {
        const customRow = document.getElementById('customNameRow');
        if (customRow) customRow.style.display = sel.value === '__custom__' ? 'block' : 'none';
    };

    document.getElementById('addItemAmount').value = '';
    const labelInput = document.getElementById('addItemLabel');
    if (labelInput) labelInput.value = '';
    const customRow = document.getElementById('customNameRow');
    if (customRow) customRow.style.display = 'none';

    modal.style.display = 'flex';
    sel.focus();
}

function hideAddItemModal() {
    document.getElementById('addItemModal').style.display = 'none';
}

async function confirmAddItem() {
    const cat    = document.getElementById('addItemSelect').value;
    const amount = parseFloat(document.getElementById('addItemAmount').value) || 0;
    if (cat === '__custom__') {
        const label = (document.getElementById('addItemLabel')?.value || '').trim();
        if (!label) { showToast('Please enter a name'); return; }
        hideAddItemModal();
        await addFreeformItem(label, amount);
    } else {
        if (!cat) { showToast('Please select a category'); return; }
        hideAddItemModal();
        await addBudgetItem(cat, amount);
    }
}

// ── Totals ─────────────────────────────────────────────────

function calculateTotals() {
    const bal = parseFloat(
        (document.getElementById('startingBalanceInput')?.value || '0').replace(/[^0-9.]/g, '')
    ) || 0;

    let totalIncome   = 0;
    let totalExpenses = 0;
    const groupTotals = {};

    document.querySelectorAll('.expense-input').forEach(inp => {
        const val   = parseFloat(inp.value.replace(/,/g, '')) || 0;
        const type  = inp.getAttribute('data-group-type');
        const group = inp.getAttribute('data-group');
        const key   = `${group}_${type}`;
        groupTotals[key] = (groupTotals[key] || 0) + val;
        if (type === 'income') totalIncome   += val;
        else                   totalExpenses += val;
    });

    // Update group subtotals
    for (const [key, total] of Object.entries(groupTotals)) {
        const el = document.getElementById(`stot_${CSS.escape(key.replace('_income','').replace('_expense',''))}_${key.endsWith('income')?'income':'expense'}`);
        if (el) el.innerHTML = formatCurrencyWithSuperscriptCents(total);
    }

    const ending = bal + totalIncome - totalExpenses;
    const inc = document.getElementById('totalIncome');
    const exp = document.getElementById('totalExpenses');
    const end = document.getElementById('endingBalanceDisplay');
    if (inc) inc.innerHTML = formatCurrencyWithSuperscriptCents(totalIncome);
    if (exp) exp.innerHTML = formatCurrencyWithSuperscriptCents(totalExpenses);
    if (end) {
        end.innerHTML = formatCurrencyWithSuperscriptCents(ending);
        end.classList.toggle('negative', ending < 0);
    }

    const wcEl = document.getElementById('worstCaseLow');
    if (wcEl) {
        const worstCase = bal - totalExpenses;
        if (worstCase < 0) {
            wcEl.innerHTML = `Worst-case low: <span class="negative">${formatCurrencyWithSuperscriptCents(worstCase)}</span>`;
            wcEl.style.display = '';
        } else {
            wcEl.innerHTML = `Worst-case low: ${formatCurrencyWithSuperscriptCents(worstCase)}`;
            wcEl.style.display = '';
        }
    }
}

function onAmountInput(input) {
    const val    = parseFloat(input.value.replace(/,/g, '')) || 0;
    const itemId = parseInt(input.getAttribute('data-item-id'));
    debounceSaveItem(itemId, val);
    calculateTotals();
}

// ── New plan date modal ────────────────────────────────────

function createNewMonth() {
    const modal  = document.getElementById('newDateModal');
    const dp     = document.getElementById('newDatePicker');
    const copyEl = document.getElementById('copyFromSelect');
    dp.value = new Date().toISOString().split('T')[0];

    // Populate copy-from dropdown (B3)
    if (copyEl) {
        copyEl.innerHTML = '<option value="">— start fresh —</option>';
        allPlans.forEach(p => {
            const opt = document.createElement('option');
            opt.value       = p.id;
            opt.textContent = p.label || formatPlanLabel(p.plan_date);
            // Pre-select the current plan as the default copy source
            if (p.id === currentPlanId) opt.selected = true;
            copyEl.appendChild(opt);
        });
    }

    modal.style.display = 'flex';
}

function hideNewDateModal() {
    document.getElementById('newDateModal').style.display = 'none';
}

async function createNewMonthFromPicker() {
    const isoDate   = document.getElementById('newDatePicker').value;
    const copyFromId = parseInt(document.getElementById('copyFromSelect')?.value || '0') || null;
    if (!isoDate) { showToast('Please select a date'); return; }
    hideNewDateModal();

    if (copyFromId) {
        // B3: copy items from source plan
        try {
            const plan = await apiPost(`/api/plans/${copyFromId}/copy`, {plan_date: isoDate});
            allPlans.unshift(plan);
            renderPlanDropdown();
            await loadPlan(plan.id);
        } catch(e) {
            showToast('A plan with that date already exists');
        }
    } else {
        await createNewPlan(isoDate);
    }
}

// ── Section / panel toggles ────────────────────────────────

function toggleMonthDropdown() {
    document.getElementById('monthDropdownMenu')?.classList.toggle('active');
}

function toggleBudgetPanels() {}   // kept for HTML onclick compatibility
function showIncomeOnly()    {}
function showExpensesOnly()  {}

// ── Starting balance ───────────────────────────────────────

function selectStartingBalance() {
    const input = document.getElementById('startingBalanceInput');
    if (input) { input.value = input.value.replace(/[^0-9.]/g, ''); input.select(); }
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
    apiPut(`/api/items/${itemId}`, {budget_amount: val});
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
    _scheduledIncome = await apiFetch('/api/scheduled-income');
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
        el.innerHTML = '<p style="color:#999;font-size:0.85rem">No scheduled income yet.</p>';
        return;
    }
    el.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:0.875rem">
        <thead><tr style="border-bottom:1px solid #e5e5e7;color:#6e6e73;font-size:0.78rem">
            <th style="text-align:left;padding:5px 8px">Source</th>
            <th style="text-align:right;padding:5px 8px">Amount/mo</th>
            <th style="text-align:left;padding:5px 8px">Starts</th>
            <th style="text-align:left;padding:5px 8px">Ends</th>
            <th></th>
        </tr></thead>
        <tbody>${_scheduledIncome.map(s => `
            <tr style="border-bottom:1px solid #f0f0f0">
                <td style="padding:6px 8px">${escHtmlBP(s.source)}</td>
                <td style="text-align:right;padding:6px 8px;color:#34c759;font-weight:600">${fmtS(s.amount)}</td>
                <td style="padding:6px 8px;color:#6e6e73">${s.start_date}</td>
                <td style="padding:6px 8px;color:#6e6e73">${s.end_date || '—'}</td>
                <td style="padding:6px 8px"><button class="delete-item-btn" onclick="deleteScheduledIncome(${s.id})">×</button></td>
            </tr>`).join('')}
        </tbody>
    </table>`;
}

async function addScheduledIncome() {
    const source    = document.getElementById('schedSource').value.trim();
    const amount    = parseFloat(document.getElementById('schedAmount').value) || 0;
    const startDate = document.getElementById('schedStartDate').value;
    const endDate   = document.getElementById('schedEndDate').value || null;
    if (!source || !amount || !startDate) { showToast('Source, amount, and start date required'); return; }
    await apiPost('/api/scheduled-income', {source, amount, start_date: startDate, end_date: endDate});
    document.getElementById('schedSource').value    = '';
    document.getElementById('schedAmount').value    = '';
    document.getElementById('schedStartDate').value = '';
    document.getElementById('schedEndDate').value   = '';
    await loadScheduledIncome();
    renderScheduledList();
}

async function deleteScheduledIncome(id) {
    await apiDelete(`/api/scheduled-income/${id}`);
    await loadScheduledIncome();
    renderScheduledList();
}

// Load scheduled income for current plan month and show as suggestions
async function renderScheduledSuggestions() {
    if (!currentPlan) return;
    const [year, month] = currentPlan.plan_date.split('-').map(Number);
    let active = [];
    try {
        active = await apiFetch(`/api/scheduled-income/for-month?year=${year}&month=${month}`);
    } catch(e) { return; }
    if (!active.length) return;

    // Only show items that aren't already in the plan
    const usedCats = new Set((currentPlan.items || []).map(i => i.category));
    const total    = active.reduce((s, a) => s + a.amount, 0);

    const existing = document.getElementById('schedSuggestions');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id        = 'schedSuggestions';
    panel.className = 'sched-suggestions';
    panel.innerHTML = `
        <div class="sched-sugg-label">&#9654; Scheduled income this month: <strong>${fmtS(total)}/mo</strong></div>
        <div class="sched-sugg-items">${active.map(a =>
            `<span class="sched-sugg-tag">${escHtmlBP(a.source)}: ${fmtS(a.amount)}</span>`
        ).join('')}</div>`;

    const content = document.getElementById('budgetContent');
    if (content) content.prepend(panel);
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
                        {plan_date: p.plan_date, label: p.label, starting_balance: p.starting_balance});
                    for (const item of (p.items || [])) {
                        await apiPost(`/api/plans/${created.id}/items`,
                            {category: item.category, label: item.label, budget_amount: item.budget_amount, item_type: item.item_type});
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

// ── Modal helpers ──────────────────────────────────────────

function hideInfoModal() {
    document.getElementById('infoModal')?.classList.remove('active');
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

// ── Click-outside dropdown close ───────────────────────────

document.addEventListener('click', e => {
    const menu    = document.getElementById('monthDropdownMenu');
    const trigger = document.querySelector('.month-display-dropdown');
    if (menu?.classList.contains('active') && !menu.contains(e.target) && !trigger?.contains(e.target)) {
        menu.classList.remove('active');
    }
    const newModal  = document.getElementById('newDateModal');
    if (newModal && e.target === newModal) hideNewDateModal();
    const addModal  = document.getElementById('addItemModal');
    if (addModal && e.target === addModal) hideAddItemModal();
    const annModal  = document.getElementById('annualModal');
    if (annModal && e.target === annModal) hideAnnualModal();
    const schedModal = document.getElementById('scheduledModal');
    if (schedModal && e.target === schedModal) hideScheduledModal();
});

// ── Start ──────────────────────────────────────────────────

initApp();
