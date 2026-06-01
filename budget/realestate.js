// ── Sage · Real Estate Scenario ─────────────────────────────────────────────
// All-cash condo purchase modeler: units + add-ons funded by a home sale and a
// taxable-account top-up. Pure client-side, persisted to localStorage.

const VERSION_HISTORY = [
    { version: 'v1.0', description: 'Initial release — multi-unit all-cash scenario, sources & uses, liquidation tax, rental P&L, saved scenarios.' },
];
const COMMIT = '064d1f6';

const STATE_KEY  = 'sage-realestate-state';
const SCENES_KEY = 'sage-realestate-scenarios';

let _uid = 0;
function u() { return 'u' + (++_uid); }

// ── Defaults: The Windsor, from the realtor data sheets ─────────────────────
function defaultState() {
    return {
        units: [
            { id: u(), label: '7K', type: 'Studio',        price: 575000, sqft: 414, cc: 384, tax: 472, rent: 2700, role: 'rental'    },
            { id: u(), label: '3Q', type: '1 Bed',         price: 815000, sqft: 0,   cc: 570, tax: 700, rent: 0,    role: 'skip'      },
            { id: u(), label: '3R', type: '1 Bed + office',price: 865000, sqft: 653, cc: 607, tax: 744, rent: 0,    role: 'skip'      },
            { id: u(), label: '4R', type: '1 Bed + office',price: 880000, sqft: 653, cc: 607, tax: 744, rent: 0,    role: 'skip'      },
            { id: u(), label: '5R', type: '1 Bed + office',price: 905000, sqft: 653, cc: 607, tax: 744, rent: 0,    role: 'residence' },
            { id: u(), label: '5A', type: '1 Bed + office',price: 940000, sqft: 653, cc: 621, tax: 763, rent: 0,    role: 'skip'      },
        ],
        parkingOn: true,  parkingPrice: 150000, parkingMonthly: 153,
        storageOn: false, storagePrice: 10000,  storageMonthly: 16,
        sponsorTransfer: true, sponsorMansion: true,
        buyerTransferPct: 1.825, titlePct: 0.45, sponsorAtty: 2900, yourAtty: 3000,
        acris: 250, fundsMonths: 3, licenseFee: 1000,
        homeGross: 1400000, homeBasis: 1200000, homeImprovements: 0,
        homeCommissionPct: 4.5, homeTransferPct: 1.825, homeAttorney: 3000,
        homeMortgage: 0, homeExclusion: 500000, homeLtcgPct: 23.8,
        liqGainPct: 55, liqLtcgPct: 23.8, liqLossOffset: 0,
        rentBuildingPct: 80, rentInsurance: 600, rentOther: 0, rentPassiveSuspend: true,
    };
}

let state = load();

// ── Persistence ─────────────────────────────────────────────────────────────
function load() {
    try {
        const s = JSON.parse(localStorage.getItem(STATE_KEY));
        if (s && Array.isArray(s.units)) return s;
    } catch (e) {}
    return defaultState();
}
function save() { localStorage.setItem(STATE_KEY, JSON.stringify(state)); }
function loadScenes() { try { return JSON.parse(localStorage.getItem(SCENES_KEY)) || {}; } catch (e) { return {}; } }
function saveScenes(s) { localStorage.setItem(SCENES_KEY, JSON.stringify(s)); }

// ── Helpers ─────────────────────────────────────────────────────────────────
function fmt(n) {
    const v = Math.round(n || 0);
    return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US');
}
function fmtSigned(n) { return (n >= 0 ? '+' : '−') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US'); }
function num(v) { const n = parseFloat(v); return isFinite(n) ? n : 0; }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// NY State mansion tax tiers (residential, 2026)
function mansionRate(price) {
    if (price >= 25000000) return 0.039;
    if (price >= 20000000) return 0.0375;
    if (price >= 15000000) return 0.035;
    if (price >= 10000000) return 0.0325;
    if (price >= 5000000)  return 0.0225;
    if (price >= 3000000)  return 0.015;
    if (price >= 2000000)  return 0.0125;
    if (price >= 1000000)  return 0.01;
    return 0;
}

// ── Core computation ────────────────────────────────────────────────────────
function compute() {
    const s = state;
    const buying = s.units.filter(x => x.role !== 'skip');
    const residences = s.units.filter(x => x.role === 'residence');
    const rentals = s.units.filter(x => x.role === 'rental');

    // Per-unit closing costs
    let unitPriceTotal = 0, closingTotal = 0, sponsorCovered = 0;
    const unitDetail = buying.map(unit => {
        const transfer = s.sponsorTransfer ? 0 : unit.price * s.buyerTransferPct / 100;
        const mansion  = s.sponsorMansion  ? 0 : unit.price * mansionRate(unit.price);
        if (s.sponsorTransfer) sponsorCovered += unit.price * s.buyerTransferPct / 100;
        if (s.sponsorMansion)  sponsorCovered += unit.price * mansionRate(unit.price);
        const title = unit.price * s.titlePct / 100;
        const funds = s.fundsMonths * unit.cc;
        const closing = transfer + mansion + title + s.sponsorAtty + s.acris + funds;
        unitPriceTotal += unit.price;
        closingTotal += closing;
        return { unit, closing };
    });

    // Add-ons
    let addonPrice = 0, licenses = 0;
    if (s.parkingOn) { addonPrice += s.parkingPrice; licenses++; }
    if (s.storageOn) { addonPrice += s.storagePrice; licenses++; }
    const licenseFees = licenses * s.licenseFee;

    // Your attorney is a single (per-transaction) cost
    closingTotal += (buying.length ? s.yourAtty : 0) + licenseFees;

    const uses = unitPriceTotal + addonPrice + closingTotal;

    // Home sale (sources)
    const sellingCosts = s.homeGross * s.homeCommissionPct / 100
                       + s.homeGross * s.homeTransferPct / 100
                       + s.homeAttorney;
    const amountRealized = s.homeGross - sellingCosts;
    const netProceeds = amountRealized - s.homeMortgage;
    const homeGain = Math.max(0, amountRealized - s.homeBasis - s.homeImprovements);
    const homeTaxableGain = Math.max(0, homeGain - s.homeExclusion);
    const homeTax = homeTaxableGain * s.homeLtcgPct / 100;

    // Taxable-account top-up
    const shortfall = Math.max(0, uses - netProceeds);
    const surplus = Math.max(0, netProceeds - uses);
    const liqGain = shortfall * s.liqGainPct / 100;
    const liqTaxableGain = Math.max(0, liqGain - s.liqLossOffset);
    const liqTax = liqTaxableGain * s.liqLtcgPct / 100;

    // Steady-state monthly
    const resCarry = residences.reduce((a, x) => a + x.cc + x.tax, 0);
    const addonMonthly = (s.parkingOn ? s.parkingMonthly : 0) + (s.storageOn ? s.storageMonthly : 0);
    const yourMonthly = resCarry + addonMonthly;

    const rentalRows = rentals.map(unit => {
        const income = unit.rent * 12;
        const opex = (unit.cc + unit.tax) * 12 + s.rentInsurance + s.rentOther;
        const cashFlow = income - opex;                              // pre-tax, no debt
        const depreciation = unit.price * s.rentBuildingPct / 100 / 27.5;
        const taxable = income - opex - depreciation;
        return { unit, income, opex, cashFlow, depreciation, taxable };
    });
    const rentalCashMonthly = rentalRows.reduce((a, r) => a + r.cashFlow, 0) / 12;
    const netMonthly = rentalCashMonthly - yourMonthly;

    return {
        buying, residences, rentals, unitDetail,
        unitPriceTotal, addonPrice, closingTotal, licenseFees, uses, sponsorCovered,
        sellingCosts, netProceeds, homeGain, homeTaxableGain, homeTax,
        shortfall, surplus, liqGain, liqTaxableGain, liqTax,
        resCarry, addonMonthly, yourMonthly, rentalRows, rentalCashMonthly, netMonthly,
    };
}

// ── Rendering ───────────────────────────────────────────────────────────────
function renderUnits() {
    const tb = document.getElementById('unitsBody');
    tb.innerHTML = state.units.map(unit => {
        const ppsf = unit.sqft > 0 ? '$' + Math.round(unit.price / unit.sqft).toLocaleString('en-US') : '—';
        const carry = fmt(unit.cc + unit.tax);
        const rentDisabled = unit.role !== 'rental' ? 'disabled' : '';
        return `<tr class="re-row-${unit.role}" data-id="${unit.id}">
            <td><input class="re-cell-in" data-f="label" value="${esc(unit.label)}" style="min-width:54px"></td>
            <td><input class="re-cell-in" data-f="type" value="${esc(unit.type)}" style="min-width:120px"></td>
            <td class="re-num"><input class="re-cell-in" data-f="price" type="number" step="5000" value="${unit.price}"></td>
            <td class="re-num"><input class="re-cell-in" data-f="sqft" type="number" step="1" value="${unit.sqft}"></td>
            <td class="re-num"><input class="re-cell-in" data-f="cc" type="number" step="1" value="${unit.cc}"></td>
            <td class="re-num"><input class="re-cell-in" data-f="tax" type="number" step="1" value="${unit.tax}"></td>
            <td class="re-num"><input class="re-cell-in" data-f="rent" type="number" step="50" value="${unit.rent}" ${rentDisabled}></td>
            <td><select class="re-role-select" data-f="role">
                <option value="residence" ${unit.role==='residence'?'selected':''}>Residence</option>
                <option value="rental" ${unit.role==='rental'?'selected':''}>Rental</option>
                <option value="skip" ${unit.role==='skip'?'selected':''}>Skip</option>
            </select></td>
            <td class="re-num re-computed">${ppsf}</td>
            <td class="re-num re-computed">${carry}</td>
            <td><button class="re-del" data-del="${unit.id}" title="Remove">×</button></td>
        </tr>`;
    }).join('');
}

function row(label, val, cls) {
    return `<tr class="${cls || ''}"><td>${label}</td><td>${val}</td></tr>`;
}

function renderResults() {
    const r = compute();

    // Uses
    let usesHtml = '';
    r.unitDetail.forEach(d => usesHtml += row(`${esc(d.unit.label)} — ${esc(d.unit.type)}`, fmt(d.unit.price)));
    if (state.parkingOn) usesHtml += row('Parking space', fmt(state.parkingPrice));
    if (state.storageOn) usesHtml += row('Storage unit', fmt(state.storagePrice));
    usesHtml += row('Closing costs (all units)', fmt(r.closingTotal), 're-sub');
    usesHtml += row('<b>Total cash to close</b>', '<b>' + fmt(r.uses) + '</b>', 're-total');
    document.getElementById('usesBody').innerHTML = usesHtml;

    // Sources
    let srcHtml = '';
    srcHtml += row('Home sale — gross', fmt(state.homeGross));
    srcHtml += row('Less selling costs', '−' + fmt(r.sellingCosts).replace('$', '$'), 're-sub');
    if (state.homeMortgage) srcHtml += row('Less mortgage payoff', '−' + fmt(state.homeMortgage), 're-sub');
    srcHtml += row('Net home proceeds', fmt(r.netProceeds));
    if (r.shortfall > 0) srcHtml += row('Top-up from taxable accounts', fmt(r.shortfall));
    if (r.surplus > 0)   srcHtml += row('Left over (to savings)', fmt(r.surplus), 're-sub');
    srcHtml += row('<b>Total sources</b>', '<b>' + fmt(r.netProceeds + r.shortfall) + '</b>', 're-total');
    document.getElementById('sourcesBody').innerHTML = srcHtml;

    // Balance line
    const bl = document.getElementById('balanceLine');
    if (r.shortfall > 0) {
        bl.className = 're-balance gap';
        bl.innerHTML = `Funding gap: you'd draw <b>${fmt(r.shortfall)}</b> from taxable accounts to complete the purchase all-cash.`;
    } else {
        bl.className = 're-balance ok';
        bl.innerHTML = `Fully covered by the home sale — <b>${fmt(r.surplus)}</b> left over. No taxable-account draw needed.`;
    }

    // Taxes triggered
    let taxHtml = '';
    taxHtml += row('Home-sale capital gain', fmt(r.homeGain));
    taxHtml += row(`Less §121 exclusion`, '−' + fmt(state.homeExclusion), 're-sub');
    taxHtml += row('Taxable home gain', fmt(r.homeTaxableGain), 're-sub');
    taxHtml += row('Home-sale tax', fmt(r.homeTax));
    if (r.shortfall > 0) {
        taxHtml += row('Gain realized on top-up', fmt(r.liqGain));
        if (state.liqLossOffset) taxHtml += row('Less capital-loss offset', '−' + fmt(state.liqLossOffset), 're-sub');
        taxHtml += row('Top-up capital-gains tax', fmt(r.liqTax));
    }
    taxHtml += row('<b>Total tax triggered</b>', '<b>' + fmt(r.homeTax + r.liqTax) + '</b>', 're-total');
    document.getElementById('taxBody').innerHTML = taxHtml;

    // Steady-state monthly
    let monHtml = '';
    r.residences.forEach(x => monHtml += row(`${esc(x.label)} carry (CC + tax)`, fmt(x.cc + x.tax)));
    if (state.parkingOn) monHtml += row('Parking license', fmt(state.parkingMonthly));
    if (state.storageOn) monHtml += row('Storage license', fmt(state.storageMonthly));
    monHtml += row('<b>Your housing cost</b>', '<b>' + fmt(r.yourMonthly) + '</b>', 're-total');
    if (r.rentals.length) {
        monHtml += row('Rental net cash flow', `<span class="${r.rentalCashMonthly>=0?'re-pos':'re-neg'}">${fmtSigned(r.rentalCashMonthly)}</span>`);
        monHtml += row('<b>Net monthly (after rent)</b>',
            `<b class="${r.netMonthly>=0?'re-pos':'re-neg'}">${fmtSigned(-r.yourMonthly + r.rentalCashMonthly)}</b>`, 're-total');
    }
    document.getElementById('monthlyBody').innerHTML = monHtml;

    // Rental P&L
    const rentalCard = document.getElementById('rentalCard');
    if (r.rentals.length) {
        rentalCard.style.display = '';
        document.getElementById('rentalBody').innerHTML = r.rentalRows.map(x =>
            `<tr><td>${esc(x.unit.label)}</td>
             <td class="re-num">${fmt(x.income)}</td>
             <td class="re-num">${fmt(x.opex)}</td>
             <td class="re-num ${x.cashFlow>=0?'re-pos':'re-neg'}">${fmtSigned(x.cashFlow)}</td>
             <td class="re-num">${fmt(x.depreciation)}</td>
             <td class="re-num ${x.taxable>=0?'':'re-neg'}">${fmtSigned(x.taxable)}</td></tr>`
        ).join('');
    } else {
        rentalCard.style.display = 'none';
    }

    renderBottomBar(r);
    renderNotes(r);
}

function renderBottomBar(r) {
    const bbItem = (label, val, cls) =>
        `<div class="re-bb-item ${cls || ''}"><span class="re-bb-label">${label}</span><span class="re-bb-val">${val}</span></div>`;
    const sep = '<span class="re-bb-sep"></span>';
    const gapItem = r.shortfall > 0
        ? bbItem('Funding gap', `<span class="re-neg">${fmt(r.shortfall)}</span>`, 'emph')
        : bbItem('Left over', `<span class="re-pos">${fmt(r.surplus)}</span>`, 'emph');
    const netLabel = r.rentals.length ? 'Net monthly' : 'Your monthly';
    const netVal = r.rentals.length
        ? `<span class="${(r.rentalCashMonthly - r.yourMonthly) >= 0 ? 're-pos' : 're-neg'}">${fmtSigned(r.rentalCashMonthly - r.yourMonthly)}</span>`
        : fmt(r.yourMonthly);
    document.getElementById('bottomBar').innerHTML =
        bbItem('Cash to close', fmt(r.uses)) + sep +
        bbItem('Net home proceeds', fmt(r.netProceeds)) + sep +
        gapItem + sep +
        bbItem('Tax triggered', fmt(r.homeTax + r.liqTax)) + sep +
        bbItem(netLabel, netVal);
}

function renderNotes(r) {
    const notes = [];
    if (r.rentals.length) {
        notes.push(['warn', `<b>Family rental:</b> to keep a rental fully deductible (depreciation + expenses), the tenant must pay <b>fair-market rent</b> and use it as their principal residence. A below-market rent to a relative reclassifies it as personal-use — deductions get capped at rent collected. Gift money separately to make market rent affordable; keep the gift and rent as distinct, documented transactions (couple's 2026 gift exclusion ≈ $38K).`]);
        const anyLoss = r.rentalRows.some(x => x.taxable < 0);
        if (anyLoss && state.rentPassiveSuspend) {
            notes.push(['', `Depreciation drives a paper loss, but with income over ~$150K the passive loss is <b>suspended and carried forward</b> (released when you sell) — it isn't lost. The rental's cash income is still largely sheltered by depreciation in the meantime.`]);
        }
    }
    // Mansion-tax cliff if sponsor not covering and aggregation pushes a unit + parking over $1M
    if (!state.sponsorMansion && state.parkingOn) {
        r.unitDetail.forEach(d => {
            if (d.unit.price < 1000000 && d.unit.price + state.parkingPrice >= 1000000) {
                notes.push(['warn', `<b>${esc(d.unit.label)} + parking</b> aggregates to ${fmt(d.unit.price + state.parkingPrice)} — crossing the $1M mansion-tax threshold (1% ≈ ${fmt((d.unit.price+state.parkingPrice)*0.01)}). Since the sponsor isn't covering mansion tax in this scenario, consider buying the license separately.`]);
            }
        });
    }
    if (state.sponsorTransfer || state.sponsorMansion) {
        notes.push(['', `Sponsor concession in this scenario ≈ <b>${fmt(r.sponsorCovered)}</b> in transfer/mansion taxes you don't pay. Get it in writing in the purchase agreement.`]);
    }
    if (r.shortfall > 0) {
        notes.push(['', `The Fidelity tax-loss cards show <b>cumulative savings since 2020</b>, not a current balance. The real offset against the ${fmt(r.liqGain)} top-up gain is your 2025 Schedule&nbsp;D carryforward plus 2026 harvested losses — enter it in "Capital-loss offset." Selling highest-basis lots first minimizes the gain realized.`]);
        notes.push(['', `Taxes triggered (${fmt(r.homeTax + r.liqTax)}) are due with next year's return, not at closing — but budget for them. To actually <i>net</i> ${fmt(r.shortfall)} after the top-up tax, you'd sell slightly more than ${fmt(r.shortfall)}.`]);
    }
    document.getElementById('notesList').innerHTML = notes.map(([c, t]) => `<li class="${c}">${t}</li>`).join('');
}

// ── Inputs ⇄ state ──────────────────────────────────────────────────────────
const NUM_FIELDS = ['parkingPrice','parkingMonthly','storagePrice','storageMonthly','buyerTransferPct','titlePct',
    'sponsorAtty','yourAtty','acris','fundsMonths','licenseFee','homeGross','homeBasis','homeImprovements',
    'homeCommissionPct','homeTransferPct','homeAttorney','homeMortgage','homeExclusion','homeLtcgPct',
    'liqGainPct','liqLtcgPct','liqLossOffset','rentBuildingPct','rentInsurance','rentOther'];
const BOOL_FIELDS = ['parkingOn','storageOn','sponsorTransfer','sponsorMansion','rentPassiveSuspend'];

function syncInputsFromState() {
    NUM_FIELDS.forEach(f => { const el = document.getElementById(f); if (el) el.value = state[f]; });
    BOOL_FIELDS.forEach(f => { const el = document.getElementById(f); if (el) el.checked = !!state[f]; });
}

function wireGlobalInputs() {
    NUM_FIELDS.forEach(f => {
        const el = document.getElementById(f);
        if (el) el.addEventListener('input', () => { state[f] = num(el.value); save(); renderResults(); });
    });
    BOOL_FIELDS.forEach(f => {
        const el = document.getElementById(f);
        if (el) el.addEventListener('change', () => { state[f] = el.checked; save(); renderResults(); });
    });
}

// Units table: event delegation
function wireUnitsTable() {
    const body = document.getElementById('unitsBody');
    body.addEventListener('input', e => {
        const inp = e.target.closest('[data-f]'); if (!inp) return;
        const tr = e.target.closest('tr'); const unit = state.units.find(x => x.id === tr.dataset.id); if (!unit) return;
        const f = inp.dataset.f;
        unit[f] = (f === 'label' || f === 'type') ? inp.value : num(inp.value);
        save();
        // Recompute the computed cells in-place to avoid losing focus
        const ppsf = unit.sqft > 0 ? '$' + Math.round(unit.price / unit.sqft).toLocaleString('en-US') : '—';
        const cells = tr.querySelectorAll('.re-computed');
        if (cells[0]) cells[0].textContent = ppsf;
        if (cells[1]) cells[1].textContent = fmt(unit.cc + unit.tax);
        renderResults();
    });
    body.addEventListener('change', e => {
        const sel = e.target.closest('[data-f="role"]'); if (!sel) return;
        const tr = e.target.closest('tr'); const unit = state.units.find(x => x.id === tr.dataset.id); if (!unit) return;
        unit.role = sel.value; save(); renderUnits(); renderResults();
    });
    body.addEventListener('click', e => {
        const del = e.target.closest('[data-del]'); if (!del) return;
        state.units = state.units.filter(x => x.id !== del.dataset.del);
        save(); renderUnits(); renderResults();
    });
}

// ── Scenarios ───────────────────────────────────────────────────────────────
function refreshScenarioSelect() {
    const scenes = loadScenes();
    const sel = document.getElementById('scenarioSelect');
    const names = Object.keys(scenes).sort();
    sel.innerHTML = '<option value="">— current (unsaved) —</option>' +
        names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
}
function wireScenarios() {
    document.getElementById('saveScenarioBtn').addEventListener('click', () => {
        const name = document.getElementById('scenarioName').value.trim();
        if (!name) { document.getElementById('scenarioName').focus(); return; }
        const scenes = loadScenes();
        scenes[name] = JSON.parse(JSON.stringify(state));
        saveScenes(scenes);
        refreshScenarioSelect();
        document.getElementById('scenarioSelect').value = name;
    });
    document.getElementById('scenarioSelect').addEventListener('change', e => {
        const name = e.target.value; if (!name) return;
        const scenes = loadScenes();
        if (scenes[name]) {
            state = JSON.parse(JSON.stringify(scenes[name]));
            save();
            document.getElementById('scenarioName').value = name;
            syncInputsFromState(); renderUnits(); renderResults();
        }
    });
    document.getElementById('deleteScenarioBtn').addEventListener('click', () => {
        const name = document.getElementById('scenarioSelect').value; if (!name) return;
        const scenes = loadScenes(); delete scenes[name]; saveScenes(scenes);
        refreshScenarioSelect();
    });
    document.getElementById('resetBtn').addEventListener('click', () => {
        state = defaultState(); save();
        syncInputsFromState(); renderUnits(); renderResults();
    });
    document.getElementById('addUnitBtn').addEventListener('click', () => {
        state.units.push({ id: u(), label: 'New', type: '', price: 0, sqft: 0, cc: 0, tax: 0, rent: 0, role: 'skip' });
        save(); renderUnits(); renderResults();
    });
}

// ── Init ────────────────────────────────────────────────────────────────────
function init() {
    const vl = document.getElementById('versionLabel');
    vl.textContent = VERSION_HISTORY[0].version;
    vl.title = `${COMMIT} · ${VERSION_HISTORY[0].description}`;
    document.body.classList.add('has-sticky-footer');
    syncInputsFromState();
    wireGlobalInputs();
    wireUnitsTable();
    wireScenarios();
    refreshScenarioSelect();
    renderUnits();
    renderResults();
}
init();
