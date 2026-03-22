// ============================================================
// Budget Dashboard — dashboard.js
// ============================================================

const API = 'http://localhost:5050';
let groups     = {};
let catTypes   = {};
let chart      = null;
let viewMode   = 'year';
let _dateFrom  = '';   // ISO date, set by shortcuts; empty = use year selectors
let _dateTo    = '';
const _txCache = {};   // "cat|yearFrom|yearTo" -> rows
let _lastSummary = null;
let _lastMonthly = null;
let _chartYears  = [];  // year labels for year-chart click handler
let _chartMonths = [];  // "YYYY-MM" labels for monthly-chart click handler

// ── Init ─────────────────────────────────────────────────────

async function init() {
    try {
        const res = await fetch(`${API}/api/categories`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        groups   = data.groups;
        catTypes = data.category_types || {};

        buildCategoryTree();

        // Populate year dropdowns
        const yearFrom = document.getElementById('yearFrom');
        const yearTo   = document.getElementById('yearTo');
        data.years.forEach(y => {
            yearFrom.innerHTML += `<option value="${y}">${y}</option>`;
            yearTo.innerHTML   += `<option value="${y}">${y}</option>`;
        });
        yearFrom.value = Math.min(...data.years);
        yearTo.value   = Math.max(...data.years);

        // Load accounts
        const acctRes = await fetch(`${API}/api/accounts`);
        const accts   = await acctRes.json();
        buildAccountList(accts);

        // Close panels on outside click
        document.addEventListener('click', e => {
            if (!document.getElementById('categoryMultiSelect').contains(e.target)) {
                closeCategoryPanel();
            }
            if (!document.getElementById('accountMultiSelect').contains(e.target)) {
                closeAccountPanel();
            }
        });

        hideError();
        analyze();
    } catch (e) {
        console.error('init() error:', e);
        showError();
    }
}

// ── Category tree ─────────────────────────────────────────────

function buildCategoryTree() {
    const container = document.getElementById('categoryTree');
    container.innerHTML = '';

    // Separate income vs expense groups using catTypes
    const incomeGroups  = [];
    const expenseGroups = [];
    Object.keys(groups).sort().forEach(group => {
        const cats = groups[group];
        // A group is "income" if the majority of its cats are income type
        const incCount = cats.filter(c => (catTypes[c] || 'expense') === 'income').length;
        if (incCount > cats.length / 2) incomeGroups.push(group);
        else expenseGroups.push(group);
    });

    function renderSection(label, groupList) {
        if (!groupList.length) return;
        const sec = document.createElement('div');
        sec.className = 'ms-type-header';
        sec.textContent = label;
        container.appendChild(sec);

        groupList.forEach(group => {
            const cats = groups[group];
            const header = document.createElement('label');
            header.className = 'ms-group-header';
            header.innerHTML = `<input type="checkbox" id="grp_${group}" checked onchange="onGroupToggle('${group}')"> ${group}`;
            container.appendChild(header);

            cats.forEach(cat => {
                const displayName = cat.includes(':') ? cat.split(':').slice(1).join(':') : cat;
                const row = document.createElement('label');
                row.className = 'ms-cat-item';
                row.innerHTML = `<input type="checkbox" class="cat-cb" data-group="${group}" value="${cat}" checked onchange="onCatToggle('${group}')"> ${displayName}`;
                container.appendChild(row);
            });
        });
    }

    renderSection('— Income —', incomeGroups);
    renderSection('— Expenses —', expenseGroups);

    updateCategoryDisplay();
}

function onGroupToggle(group) {
    const checked = document.getElementById(`grp_${group}`).checked;
    document.querySelectorAll(`.cat-cb[data-group="${group}"]`)
        .forEach(cb => cb.checked = checked);
    updateCategoryDisplay();
}

function onCatToggle(group) {
    const all     = document.querySelectorAll(`.cat-cb[data-group="${group}"]`);
    const checked = document.querySelectorAll(`.cat-cb[data-group="${group}"]:checked`);
    const grpCb   = document.getElementById(`grp_${group}`);
    grpCb.checked       = checked.length > 0;
    grpCb.indeterminate = checked.length > 0 && checked.length < all.length;
    updateCategoryDisplay();
}

function selectAllCategories() {
    document.querySelectorAll('.cat-cb').forEach(cb => cb.checked = true);
    document.querySelectorAll('[id^="grp_"]').forEach(cb => {
        cb.checked = true;
        cb.indeterminate = false;
    });
    updateCategoryDisplay();
}

function clearCategories() {
    document.querySelectorAll('.cat-cb').forEach(cb => cb.checked = false);
    document.querySelectorAll('[id^="grp_"]').forEach(cb => {
        cb.checked = false;
        cb.indeterminate = false;
    });
    updateCategoryDisplay();
}

function getSelectedCategories() {
    return Array.from(document.querySelectorAll('.cat-cb:checked')).map(cb => cb.value);
}

function updateCategoryDisplay() {
    const all     = document.querySelectorAll('.cat-cb');
    const checked = document.querySelectorAll('.cat-cb:checked');
    const display = document.getElementById('categoryDisplay');

    if (checked.length === 0) {
        display.textContent = 'None selected';
    } else if (checked.length === all.length) {
        display.textContent = 'All Categories';
    } else {
        // Summarize by group
        const groupSummary = [];
        Object.keys(groups).sort().forEach(group => {
            const groupAll     = document.querySelectorAll(`.cat-cb[data-group="${group}"]`);
            const groupChecked = document.querySelectorAll(`.cat-cb[data-group="${group}"]:checked`);
            if (groupChecked.length === 0) return;
            if (groupChecked.length === groupAll.length) {
                groupSummary.push(group);
            } else {
                groupSummary.push(`${group} (${groupChecked.length})`);
            }
        });
        display.innerHTML = groupSummary.join(', ');
    }
}

// ── Category panel toggle ─────────────────────────────────────

function toggleCategoryPanel() {
    const panel = document.getElementById('categoryPanel');
    panel.classList.contains('open') ? closeCategoryPanel() : openCategoryPanel();
}

function openCategoryPanel() {
    document.getElementById('categoryPanel').classList.add('open');
    document.getElementById('categoryTrigger').classList.add('open');
}

function closeCategoryPanel() {
    document.getElementById('categoryPanel').classList.remove('open');
    document.getElementById('categoryTrigger').classList.remove('open');
}

// ── Account selector ──────────────────────────────────────────

function buildAccountList(accts) {
    const container = document.getElementById('accountList');
    container.innerHTML = '';
    accts.forEach(acct => {
        const label = document.createElement('label');
        label.className = 'ms-cat-item';
        label.innerHTML = `<input type="checkbox" class="acct-cb" value="${escAttr(acct)}" checked> ${escHtml(acct)}`;
        container.appendChild(label);
    });
    updateAccountDisplay();
}

function getSelectedAccounts() {
    return Array.from(document.querySelectorAll('.acct-cb:checked')).map(cb => cb.value);
}

function selectAllAccounts() {
    document.querySelectorAll('.acct-cb').forEach(cb => cb.checked = true);
    updateAccountDisplay();
}

function clearAccounts() {
    document.querySelectorAll('.acct-cb').forEach(cb => cb.checked = false);
    updateAccountDisplay();
}

function updateAccountDisplay() {
    const all     = document.querySelectorAll('.acct-cb');
    const checked = document.querySelectorAll('.acct-cb:checked');
    const display = document.getElementById('accountDisplay');
    if (checked.length === 0)         display.textContent = 'None selected';
    else if (checked.length === all.length) display.textContent = 'All Accounts';
    else display.textContent = Array.from(checked).map(cb => cb.value).join(', ');
}

function toggleAccountPanel() {
    const panel = document.getElementById('accountPanel');
    panel.classList.contains('open') ? closeAccountPanel() : openAccountPanel();
}

function openAccountPanel() {
    document.getElementById('accountPanel').classList.add('open');
    document.getElementById('accountTrigger').classList.add('open');
}

function closeAccountPanel() {
    document.getElementById('accountPanel').classList.remove('open');
    document.getElementById('accountTrigger').classList.remove('open');
}

// ── Date shortcuts ────────────────────────────────────────────

function setShortcut(name) {
    const now   = new Date();
    const today = now.toISOString().split('T')[0];
    const y     = now.getFullYear();
    const m     = now.getMonth();   // 0-based

    document.querySelectorAll('.shortcut-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`sc_${name}`)?.classList.add('active');
    document.getElementById('sc_clear').style.display = '';

    switch (name) {
        case 'week': {
            const day  = now.getDay() || 7;              // Mon=1…Sun=7
            const mon  = new Date(now); mon.setDate(now.getDate() - day + 1);
            const sun  = new Date(mon); sun.setDate(mon.getDate() + 6);
            _dateFrom  = mon.toISOString().split('T')[0];
            _dateTo    = sun.toISOString().split('T')[0];
            viewMode   = 'month';
            break;
        }
        case 'lastweek': {
            const day   = now.getDay() || 7;             // Mon=1…Sun=7
            const lmon  = new Date(now); lmon.setDate(now.getDate() - day - 6);
            const lsun  = new Date(lmon); lsun.setDate(lmon.getDate() + 6);
            _dateFrom   = lmon.toISOString().split('T')[0];
            _dateTo     = lsun.toISOString().split('T')[0];
            viewMode    = 'month';
            break;
        }
        case 'month': {
            const first = new Date(y, m, 1);
            const last  = new Date(y, m + 1, 0);
            _dateFrom   = first.toISOString().split('T')[0];
            _dateTo     = last.toISOString().split('T')[0];
            viewMode    = 'month';
            break;
        }
        case 'year':
            _dateFrom = `${y}-01-01`;
            _dateTo   = `${y}-12-31`;
            viewMode  = 'year';
            break;
        case 'lastmonth': {
            const lm    = new Date(y, m, 0);   // last day of previous month
            const lmY   = lm.getFullYear();
            const lmM   = lm.getMonth();        // 0-based
            const first = new Date(lmY, lmM, 1);
            _dateFrom   = first.toISOString().split('T')[0];
            _dateTo     = lm.toISOString().split('T')[0];
            viewMode    = 'month';
            break;
        }
        case 'lastyear':
            _dateFrom = `${y - 1}-01-01`;
            _dateTo   = `${y - 1}-12-31`;
            viewMode  = 'year';
            break;
    }

    // Sync year dropdowns to match the shortcut range
    const fy = parseInt(_dateFrom.split('-')[0]);
    const ty = parseInt(_dateTo.split('-')[0]);
    if (document.getElementById('yearFrom').querySelector(`option[value="${fy}"]`))
        document.getElementById('yearFrom').value = fy;
    if (document.getElementById('yearTo').querySelector(`option[value="${ty}"]`))
        document.getElementById('yearTo').value = ty;

    document.getElementById('btnYear').classList.toggle('active',  viewMode === 'year');
    document.getElementById('btnMonth').classList.toggle('active', viewMode === 'month');

    analyze();
}

function clearShortcut() {
    _dateFrom = '';
    _dateTo   = '';
    document.querySelectorAll('.shortcut-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('sc_clear').style.display = 'none';
    // Reset year dropdowns to full range
    const yearFrom = document.getElementById('yearFrom');
    const yearTo   = document.getElementById('yearTo');
    if (yearFrom.options.length) yearFrom.value = yearFrom.options[0].value;
    if (yearTo.options.length)   yearTo.value   = yearTo.options[yearTo.options.length - 1].value;
    analyze();
}

// ── View toggle (C1) ─────────────────────────────────────────

function setView(mode) {
    viewMode = mode;
    document.getElementById('btnYear').classList.toggle('active',  mode === 'year');
    document.getElementById('btnMonth').classList.toggle('active', mode === 'month');
    analyze();
}

// ── CSV Upload (C5) ──────────────────────────────────────────

async function uploadCSV(event) {
    const file = event.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
        const res = await fetch(`${API}/api/csv/upload`, { method: 'POST', body: fd });
        if (!res.ok) throw new Error();
        const data = await res.json();
        showToast(`Imported ${data.count.toLocaleString()} transactions`);
        event.target.value = '';
        analyze();
    } catch (e) {
        event.target.value = '';
        showToast('Upload failed', true);
    }
}

// ── Analyze ───────────────────────────────────────────────────

async function analyze() {
    closeCategoryPanel();
    closeAccountPanel();
    Object.keys(_txCache).forEach(k => delete _txCache[k]);

    const yearFrom = parseInt(document.getElementById('yearFrom').value) || 2000;
    const yearTo   = parseInt(document.getElementById('yearTo').value)   || 2100;
    const cats     = getSelectedCategories().join(',');
    const accts    = getSelectedAccounts().join(',');

    // Build date params — shortcut overrides year selectors
    const dateParams = _dateFrom && _dateTo
        ? `&date_from=${_dateFrom}&date_to=${_dateTo}`
        : `&year_from=${yearFrom}&year_to=${yearTo}`;
    const baseParams = `cats=${encodeURIComponent(cats)}&accts=${encodeURIComponent(accts)}${dateParams}`;

    try {
        if (viewMode === 'month') {
            const months = (yearTo - yearFrom + 1) * 12;
            const [sumRes, monRes] = await Promise.all([
                fetch(`${API}/api/summary?${baseParams}`),
                fetch(`${API}/api/monthly?${baseParams}&months=${months}`)
            ]);
            if (!sumRes.ok || !monRes.ok) throw new Error();
            const data    = await sumRes.json();
            const monthly = await monRes.json();
            hideError();
            _lastSummary = data;
            _lastMonthly = monthly;
            renderStats(data);
            renderTable(data);
            renderPayees(data);
            renderExpenseBreakdown(data);
            renderIncomeBreakdown(data);
        } else {
            const res = await fetch(`${API}/api/summary?${baseParams}`);
            if (!res.ok) throw new Error();
            const data = await res.json();
            hideError();
            _lastSummary = data;
            _lastMonthly = null;
            renderStats(data);
            renderTable(data);
            renderPayees(data);
            renderExpenseBreakdown(data);
            renderIncomeBreakdown(data);
        }

        // Show containers BEFORE rendering chart so it can measure full width
        const statsRow  = document.getElementById('statsRow');
        const chartCard = document.getElementById('chartCard');
        const tileRow1  = document.getElementById('tileRow1');
        const tileRow2  = document.getElementById('tileRow2');
        if (statsRow)  statsRow.style.display  = 'grid';
        if (chartCard) chartCard.style.display = 'block';
        if (tileRow1)  tileRow1.style.display  = 'grid';
        if (tileRow2)  tileRow2.style.display  = 'grid';

        // Defer chart render one frame so the browser can finish laying out the container
        requestAnimationFrame(() => {
            if (viewMode === 'month' && _lastMonthly) {
                renderMonthlyChart(_lastMonthly);
            } else if (_lastSummary) {
                renderChart(_lastSummary);
            }
        });
    } catch (e) {
        console.error('analyze() error:', e);
        showError();
    }
}

// ── Render: Stats ─────────────────────────────────────────────

function renderStats(data) {
    const yearFrom = parseInt(document.getElementById('yearFrom').value);
    const yearTo   = parseInt(document.getElementById('yearTo').value);
    const nMonths  = (yearTo - yearFrom + 1) * 12;

    document.getElementById('statTotal').textContent   = fmt(data.expenses);
    document.getElementById('statMonthly').textContent = fmt(data.monthly_avg) + '/mo';
    document.getElementById('statCount').textContent   = data.count.toLocaleString();

    const monthlyIncomeCard = document.getElementById('statMonthlyIncomeCard');
    if (data.income > 1) {
        document.getElementById('statMonthlyIncome').textContent = '+' + fmt(data.income / nMonths) + '/mo';
        monthlyIncomeCard.style.display = 'block';
    } else {
        monthlyIncomeCard.style.display = 'none';
    }

    const incomeCard = document.getElementById('statIncomeCard');
    if (data.income > 1) {
        document.getElementById('statIncome').textContent = '+' + fmt(data.income);
        incomeCard.style.display = 'block';
    } else {
        incomeCard.style.display = 'none';
    }
}

// ── Render: Chart ─────────────────────────────────────────────

function renderChart(data) {
    if (chart) chart.destroy();
    const canvas = document.getElementById('yearChart');
    canvas.removeAttribute('width');
    canvas.removeAttribute('height');

    const years     = data.by_year.map(r => r.year);
    _chartYears     = years;
    const expenses  = data.by_year.map(r => Math.abs(r.expenses));
    const income    = data.by_year.map(r => r.income);
    const hasIncome = income.some(v => v > 1);

    const datasets = [{
        label: 'Expenses',
        data: expenses,
        backgroundColor: 'rgba(200, 75, 0, 0.72)',
        borderRadius: 5,
        borderSkipped: false,
    }];

    if (hasIncome) {
        datasets.push({
            label: 'Income / Reimb.',
            data: income,
            backgroundColor: 'rgba(36, 138, 61, 0.72)',
            borderRadius: 5,
            borderSkipped: false,
        });
    }

    const ctx = document.getElementById('yearChart').getContext('2d');
    chart = new Chart(ctx, {
        type: 'bar',
        data: { labels: years, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            onClick(evt, elements) {
                if (!elements.length) return;
                const i    = elements[0].index;
                const ds   = elements[0].datasetIndex;
                const yr   = _chartYears[i];
                const type = ds === 0 ? 'expense' : 'income';
                const label = `${yr} ${type === 'income' ? 'Income' : 'Expenses'}`;
                showBarTransactions(label, `${yr}-01-01`, `${yr}-12-31`, type);
            },
            plugins: {
                legend: {
                    display: hasIncome,
                    labels: { font: { family: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif' }, boxWidth: 12, padding: 8 }
                },
                tooltip: {
                    callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.raw)}` }
                }
            },
            scales: {
                y: {
                    ticks: {
                        callback: v => '$' + (v / 1000).toFixed(0) + 'k',
                        font: { family: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif', size: 11 }
                    },
                    grid: { color: 'rgba(0,0,0,0.04)' }
                },
                x: {
                    grid: { display: false },
                    ticks: { font: { family: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif', size: 11 } }
                }
            }
        }
    });
    chart.resize();
}

// ── Render: Monthly Chart (C1) ────────────────────────────────

function renderMonthlyChart(monthly) {
    if (chart) chart.destroy();
    const canvas = document.getElementById('yearChart');
    canvas.removeAttribute('width');
    canvas.removeAttribute('height');

    _chartMonths   = monthly.map(m => m.label);  // "YYYY-MM"
    const labels   = monthly.map(m => {
        const [y, mo] = m.label.split('-');
        return new Date(+y, +mo - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    });
    const expenses = monthly.map(m => Math.abs(m.expenses));
    const income   = monthly.map(m => m.income);
    const hasIncome = income.some(v => v > 1);

    const datasets = [{
        label: 'Expenses',
        data: expenses,
        backgroundColor: 'rgba(200, 75, 0, 0.72)',
        borderRadius: 3,
        borderSkipped: false,
    }];
    if (hasIncome) {
        datasets.push({
            label: 'Income / Reimb.',
            data: income,
            backgroundColor: 'rgba(36, 138, 61, 0.72)',
            borderRadius: 3,
            borderSkipped: false,
        });
    }

    const ctx = document.getElementById('yearChart').getContext('2d');
    chart = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            onClick(evt, elements) {
                if (!elements.length) return;
                const i      = elements[0].index;
                const ds     = elements[0].datasetIndex;
                const lbl    = _chartMonths[i];       // "YYYY-MM"
                const [y, m] = lbl.split('-');
                const lastDay = new Date(+y, +m, 0).getDate();
                const dateTo  = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;
                const type    = ds === 0 ? 'expense' : 'income';
                const moLabel = new Date(+y, +m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                showBarTransactions(`${moLabel} ${type === 'income' ? 'Income' : 'Expenses'}`,
                    `${lbl}-01`, dateTo, type);
            },
            plugins: {
                legend: {
                    display: hasIncome,
                    labels: { font: { family: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif' } }
                },
                tooltip: {
                    callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.raw)}` }
                }
            },
            scales: {
                y: {
                    ticks: {
                        callback: v => '$' + (v / 1000).toFixed(0) + 'k',
                        font: { family: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif' }
                    },
                    grid: { color: 'rgba(0,0,0,0.04)' }
                },
                x: {
                    grid: { display: false },
                    ticks: {
                        font: { family: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif' },
                        maxRotation: 45,
                        autoSkip: true,
                        maxTicksLimit: 24
                    }
                }
            }
        }
    });
    chart.resize();
}

// ── Render: Category Breakdowns ──────────────────────────────

function catRowHtml(r, total, type) {
    const pct     = total ? (Math.abs(r.amount) / Math.abs(total) * 100).toFixed(1) : '—';
    const display = r.category.includes(':') ? r.category.split(':').slice(1).join(':') : r.category;
    const group   = r.category.includes(':') ? r.category.split(':')[0] : '';
    const cls     = type === 'income' ? 'td-income' : 'td-expense';
    const prefix  = type === 'income' ? '+' : '';
    return `
        <tr class="cat-row" data-cat="${escHtml(r.category)}" data-type="${type}" onclick="toggleCatDrill(this)">
            <td>
                <span class="cat-expand-icon">&#9654;</span>
                ${escHtml(display)}
                ${group ? `<span class="cat-group-tag">${escHtml(group)}</span>` : ''}
            </td>
            <td class="${cls} td-right">${prefix}${fmt(r.amount)}</td>
            <td class="td-right" style="color:#666">${pct}%</td>
        </tr>`;
}

function renderIncomeBreakdown(data) {
    document.getElementById('incomeTableBody').innerHTML =
        (!data.income_by_cat || !data.income_by_cat.length || data.income < 1)
        ? '<tr><td colspan="3" style="color:#999;font-size:0.8rem;padding:0.5rem 0.6rem">No income data</td></tr>'
        : data.income_by_cat.map(r => catRowHtml(r, data.income, 'income')).join('');
}

function renderExpenseBreakdown(data) {
    document.getElementById('expenseCatBody').innerHTML =
        (!data.expense_by_cat || !data.expense_by_cat.length)
        ? '<tr><td colspan="3" style="color:#999;font-size:0.8rem;padding:0.5rem 0.6rem">No expense data</td></tr>'
        : data.expense_by_cat.map(r => catRowHtml(r, data.expenses, 'expense')).join('');
}

async function toggleCatDrill(row) {
    const cat      = row.dataset.cat;
    const yearFrom = parseInt(document.getElementById('yearFrom').value);
    const yearTo   = parseInt(document.getElementById('yearTo').value);
    const cacheKey = `${cat}|${yearFrom}|${yearTo}`;

    // If already expanded, collapse
    const existing = row.nextElementSibling;
    if (existing && existing.classList.contains('cat-drill-row')) {
        existing.remove();
        row.querySelector('.cat-expand-icon').innerHTML = '&#9654;';
        return;
    }

    row.querySelector('.cat-expand-icon').innerHTML = '&#9660;';

    // Insert loading placeholder
    const drillRow = document.createElement('tr');
    drillRow.className = 'cat-drill-row';
    drillRow.innerHTML = `<td colspan="3"><div class="cat-drill-inner"><em style="color:#999;font-size:12px">Loading…</em></div></td>`;
    row.after(drillRow);

    // Fetch if not cached
    if (!_txCache[cacheKey]) {
        try {
            _txCache[cacheKey] = await fetch(
                `${API}/api/transactions?cat=${encodeURIComponent(cat)}&year_from=${yearFrom}&year_to=${yearTo}`
            ).then(r => r.json());
        } catch(e) {
            drillRow.querySelector('.cat-drill-inner').innerHTML = '<em style="color:red;font-size:12px">Failed to load</em>';
            return;
        }
    }

    const txns = _txCache[cacheKey];
    if (!txns.length) {
        drillRow.querySelector('.cat-drill-inner').innerHTML = '<em style="color:#999;font-size:12px">No transactions</em>';
        return;
    }

    const type = row.dataset.type;
    drillRow.querySelector('.cat-drill-inner').outerHTML = `
        <div class="cat-drill-inner">
            <table class="cat-drill-table">
                <thead><tr><th>Date</th><th>Payee</th><th class="td-right">Amount</th></tr></thead>
                <tbody>${txns.map(t => `
                    <tr>
                        <td class="drill-date">${t.date}</td>
                        <td class="drill-payee">${escHtml(t.payee)}</td>
                        <td class="td-right drill-amount ${type === 'income' ? 'td-income' : 'td-expense'}">${fmt(t.amount)}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>`;
}

// ── Render: Table ─────────────────────────────────────────────

function renderTable(data) {
    const tbody = document.getElementById('yearTableBody');
    tbody.innerHTML = '';
    let totExp = 0, totInc = 0, totCount = 0;

    data.by_year.forEach(r => {
        const net = r.expenses + r.income;
        totExp   += r.expenses;
        totInc   += r.income;
        totCount += r.count;
        tbody.innerHTML += `
            <tr>
                <td>${r.year}</td>
                <td class="td-expense">${fmt(r.expenses)}</td>
                <td class="${r.income > 1 ? 'td-income' : 'td-muted'}">${r.income > 1 ? '+' + fmt(r.income) : '—'}</td>
                <td class="${net < 0 ? 'td-net-neg' : 'td-net-pos'}">${net < 0 ? '-' : '+'}${fmt(net)}</td>
                <td>${r.count.toLocaleString()}</td>
            </tr>`;
    });

    const netTotal = totExp + totInc;
    tbody.innerHTML += `
        <tr class="total-row">
            <td>Total</td>
            <td class="td-expense">${fmt(totExp)}</td>
            <td class="${totInc > 1 ? 'td-income' : 'td-muted'}">${totInc > 1 ? '+' + fmt(totInc) : '—'}</td>
            <td class="${netTotal < 0 ? 'td-net-neg' : 'td-net-pos'}">${netTotal < 0 ? '-' : '+'}${fmt(netTotal)}</td>
            <td>${totCount.toLocaleString()}</td>
        </tr>`;
}

// ── Render: Payees ────────────────────────────────────────────

function renderPayees(data) {
    const tbody = document.getElementById('payeeTableBody');
    tbody.innerHTML = '';
    if (!data.top_payees.length) {
        tbody.innerHTML = '<tr><td colspan="2" style="color:#999;font-size:0.8rem;padding:0.5rem 0.6rem">No data</td></tr>';
        return;
    }
    data.top_payees.forEach(r => {
        tbody.innerHTML += `
            <tr class="cat-row" data-payee="${escHtml(r.payee)}" onclick="togglePayeeDrill(this)" style="cursor:pointer">
                <td><span class="cat-expand-icon">&#9654;</span> ${escHtml(r.payee)}</td>
                <td class="td-expense">${fmt(r.amount)}</td>
            </tr>`;
    });
}

async function togglePayeeDrill(row) {
    const payee    = row.dataset.payee;
    const yearFrom = parseInt(document.getElementById('yearFrom').value) || 2000;
    const yearTo   = parseInt(document.getElementById('yearTo').value)   || 2100;
    const cacheKey = `payee|${payee}|${yearFrom}|${yearTo}`;

    const existing = row.nextElementSibling;
    if (existing && existing.classList.contains('cat-drill-row')) {
        existing.remove();
        row.querySelector('.cat-expand-icon').innerHTML = '&#9654;';
        return;
    }
    row.querySelector('.cat-expand-icon').innerHTML = '&#9660;';

    const drillRow = document.createElement('tr');
    drillRow.className = 'cat-drill-row';
    drillRow.innerHTML = `<td colspan="2"><div class="cat-drill-inner"><em style="color:#999;font-size:12px">Loading…</em></div></td>`;
    row.after(drillRow);

    if (!_txCache[cacheKey]) {
        try {
            const dateParams = _dateFrom && _dateTo
                ? `&date_from=${_dateFrom}&date_to=${_dateTo}`
                : `&year_from=${yearFrom}&year_to=${yearTo}`;
            _txCache[cacheKey] = await fetch(
                `${API}/api/transactions?payee=${encodeURIComponent(payee)}${dateParams}`
            ).then(r => r.json());
        } catch(e) {
            drillRow.querySelector('.cat-drill-inner').innerHTML = '<em style="color:red;font-size:12px">Failed to load</em>';
            return;
        }
    }

    const txns = _txCache[cacheKey];
    if (!txns.length) {
        drillRow.querySelector('.cat-drill-inner').innerHTML = '<em style="color:#999;font-size:12px">No transactions</em>';
        return;
    }

    drillRow.querySelector('.cat-drill-inner').outerHTML = `
        <div class="cat-drill-inner">
            <table class="cat-drill-table">
                <thead><tr><th>Date</th><th>Category</th><th class="td-right">Amount</th></tr></thead>
                <tbody>${txns.map(t => {
                    const cls = (t.amount || 0) < 0 ? 'td-expense' : 'td-income';
                    const cat = t.category ? t.category.split(':').pop() : '';
                    return `<tr>
                        <td class="drill-date">${t.date}</td>
                        <td class="drill-payee">${escHtml(cat)}</td>
                        <td class="td-right drill-amount ${cls}">${fmt(t.amount)}</td>
                    </tr>`;
                }).join('')}
                </tbody>
            </table>
        </div>`;
}


// ── Helpers ───────────────────────────────────────────────────

function fmt(n) {
    return '$' + Math.abs(n).toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    });
}

function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(s) {
    return String(s).replace(/'/g,"\\'");
}

let _toastTimer = null;
function showToast(msg, isError = false) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className   = 'toast visible' + (isError ? ' toast-error' : '');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.remove('visible'), 3000);
}

function showError() { document.getElementById('errorBanner').classList.add('visible'); }
function hideError() { document.getElementById('errorBanner').classList.remove('visible'); }

// ── All Transactions Modal ────────────────────────────────────

async function showAllTransactions() {
    const yearFrom = parseInt(document.getElementById('yearFrom').value) || 2000;
    const yearTo   = parseInt(document.getElementById('yearTo').value)   || 2100;
    const cats     = getSelectedCategories().join(',');
    const accts    = getSelectedAccounts().join(',');
    const dateParams = _dateFrom && _dateTo
        ? `&date_from=${_dateFrom}&date_to=${_dateTo}`
        : `&year_from=${yearFrom}&year_to=${yearTo}`;

    const modal = document.getElementById('txnModal');
    const tbody = document.getElementById('txnModalBody');
    const title = document.getElementById('txnModalTitle');
    tbody.innerHTML = '<tr><td colspan="4" style="padding:1rem;color:#999">Loading…</td></tr>';
    title.textContent = 'Transactions';
    modal.style.display = 'flex';

    try {
        const res  = await fetch(`${API}/api/all-transactions?cats=${encodeURIComponent(cats)}&accts=${encodeURIComponent(accts)}${dateParams}`);
        const data = await res.json();
        title.textContent = `Transactions (${data.length.toLocaleString()})`;
        if (!data.length) {
            tbody.innerHTML = '<tr><td colspan="4" style="padding:1rem;color:#999">No transactions</td></tr>';
            return;
        }
        tbody.innerHTML = data.map(t => {
            const cls = (t.amount || 0) < 0 ? 'td-expense' : 'td-income';
            const cat = t.category ? t.category.split(':').pop() : '';
            return `<tr>
                <td>${t.date}</td>
                <td style="color:#888">${escHtml(cat)}</td>
                <td>${escHtml(t.payee)}</td>
                <td class="td-right ${cls}">${(t.amount||0) >= 0 ? '+' : ''}${fmt(t.amount)}</td>
            </tr>`;
        }).join('');
    } catch(e) {
        tbody.innerHTML = '<tr><td colspan="4" style="padding:1rem;color:red">Failed to load</td></tr>';
    }
}

function closeTxnModal(event) {
    if (!event || event.target === document.getElementById('txnModal') || event.currentTarget === document.querySelector('.modal-close')) {
        document.getElementById('txnModal').style.display = 'none';
    }
}

// ── Bar Chart Drill-down ──────────────────────────────────────

async function showBarTransactions(title, dateFrom, dateTo, type) {
    const cats  = getSelectedCategories().join(',');
    const accts = getSelectedAccounts().join(',');
    const modal  = document.getElementById('txnModal');
    const tbody  = document.getElementById('txnModalBody');
    const titleEl = document.getElementById('txnModalTitle');
    tbody.innerHTML = '<tr><td colspan="4" style="padding:1rem;color:#999">Loading…</td></tr>';
    titleEl.textContent = title;
    modal.style.display = 'flex';

    try {
        const res  = await fetch(`${API}/api/all-transactions?cats=${encodeURIComponent(cats)}&accts=${encodeURIComponent(accts)}&date_from=${dateFrom}&date_to=${dateTo}`);
        const all  = await res.json();
        const data = type === 'expense'
            ? all.filter(t => (t.amount || 0) < 0)
            : all.filter(t => (t.amount || 0) > 0);
        titleEl.textContent = `${title} (${data.length.toLocaleString()})`;
        if (!data.length) {
            tbody.innerHTML = '<tr><td colspan="4" style="padding:1rem;color:#999">No transactions</td></tr>';
            return;
        }
        tbody.innerHTML = data.map(t => {
            const cls = (t.amount || 0) < 0 ? 'td-expense' : 'td-income';
            const cat = t.category ? t.category.split(':').pop() : '';
            return `<tr>
                <td>${t.date}</td>
                <td style="color:#888">${escHtml(cat)}</td>
                <td>${escHtml(t.payee)}</td>
                <td class="td-right ${cls}">${(t.amount||0) >= 0 ? '+' : ''}${fmt(t.amount)}</td>
            </tr>`;
        }).join('');
    } catch(e) {
        tbody.innerHTML = '<tr><td colspan="4" style="padding:1rem;color:red">Failed to load</td></tr>';
    }
}

// ── Boot ──────────────────────────────────────────────────────

init().catch(() => showError());
