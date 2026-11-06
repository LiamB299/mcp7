// Independent ground truth for evaluation Q12 (reorder suggestions). Deliberately NOT importing anything from src/.
// Read-only: GET requests only. About 170 paced calls (about 3.5 minutes): saleList pages, one sale detail per
// invoiced non-voided sale, ref/productavailability pages and product pages.
// Writes eval/out/truth-reorder.json as its own file (it does not merge into other truth files). Output stays local (gitignored).
// Console output carries counts, totals and top-3 numbers only: no customer names, no order numbers. SKUs are printed.
import { loadEnvFile } from 'node:process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
const base = `${process.env.CIN7_BASE_URL.replace(/\/+$/, '')}/v2/`;
const headers = {
  'api-auth-accountid': process.env.CIN7_ACCOUNT_ID,
  'api-auth-applicationkey': process.env.CIN7_APPLICATION_KEY,
};
const ASOF = JSON.parse(readFileSync(fileURLToPath(new URL('./questions.json', import.meta.url)), 'utf8')).asOf;
const L = 14; // lead time days
const C = 30; // target cover days after delivery
const WINDOWS = [90, 365];
const PRIMARY_W = 90;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let calls = 0;
async function get(path) {
  const label = path.split('?')[0];
  for (let a = 0; a < 4; a++) {
    await sleep(1150);
    calls++;
    const res = await fetch(base + path, { headers });
    if (res.status === 429 || res.status === 503) {
      await sleep(5000 * 2 ** a);
      continue;
    }
    if (!res.ok) throw new Error(`${label} ${res.status}`);
    return res.json();
  }
  throw new Error(`gave up ${label}`);
}

// Every page until the body's Total is reached or a page comes back empty.
async function listAll(path, key) {
  const rows = [];
  let total = Infinity;
  for (let page = 1; rows.length < total && page <= 50; page++) {
    const j = await get(`${path}?Page=${page}&Limit=1000`);
    if (typeof j.Total === 'number') total = j.Total;
    const batch = j[key] ?? [];
    if (!batch.length) break;
    rows.push(...batch);
  }
  return rows;
}

const r2 = (n) => Math.round(n * 100) / 100;
const up = (v) => String(v ?? '').toUpperCase();
const num = (v) => Number(v ?? 0) || 0;
const day = (v) => (typeof v === 'string' && v.length >= 10 ? v.slice(0, 10) : null);
const shiftDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
// Window [asOf - W + 1, asOf], inclusive, yyyy-MM-dd string compare.
const windowFrom = (w) => shiftDays(ASOF, -(w - 1));
const inWindow = (d, w) => d !== null && d >= windowFrom(w) && d <= ASOF;

// 1. Sale list (non-voided), deduplicated by SaleID.
const saleRows = [...new Map((await listAll('saleList', 'SaleList')).map((s) => [s.SaleID, s])).values()];
const sales = saleRows.filter((s) => s.Status !== 'VOIDED');
const combinedInvoiceStatus = {};
for (const s of sales) {
  const k = s.CombinedInvoiceStatus ?? '(none)';
  combinedInvoiceStatus[k] = (combinedInvoiceStatus[k] ?? 0) + 1;
}
const invoiced = sales.filter((s) => up(s.CombinedInvoiceStatus).startsWith('INVOICED'));

// 2. Document lines from the detail of each invoiced sale. Only the fields needed for velocity are kept.
const docLines = [];
for (const s of invoiced) {
  const d = await get(`sale?ID=${s.SaleID}&HideInventoryMovements=true`);
  for (const i of d.Invoices ?? []) {
    for (const l of i.Lines ?? []) {
      docLines.push({
        kind: 'INV',
        status: up(i.Status),
        date: day(i.InvoiceDate),
        productId: l.ProductID ?? null,
        sku: l.SKU ?? null,
        qty: num(l.Quantity),
      });
    }
  }
  for (const c of d.CreditNotes ?? []) {
    for (const l of c.Lines ?? []) {
      docLines.push({
        kind: 'CN',
        status: up(c.Status),
        date: day(c.CreditNoteDate),
        productId: l.ProductID ?? null,
        sku: l.SKU ?? null,
        qty: num(l.Quantity),
      });
    }
  }
}

// 3. Stock rows (every page) and the product list (every page).
const availRows = await listAll('ref/productavailability', 'ProductAvailabilityList');
const productRows = await listAll('product', 'Products');

// Keyed by product ID (primary) or by SKU (bySku alternative).
const KEYS = {
  id: { line: (l) => l.productId ?? '(none)', avail: (r) => r.ID ?? '(none)', product: (p) => p.ID ?? '(none)' },
  sku: { line: (l) => l.sku ?? '(no sku)', avail: (r) => r.SKU ?? '(no sku)', product: (p) => p.SKU ?? '(no sku)' },
};

// Net units per key: AUTHORISED or PAID invoice lines minus AUTHORISED credit-note lines, each by its own document date.
function velocityMap(w, mode, useCreditNotes) {
  const m = new Map();
  for (const l of docLines) {
    if (!inWindow(l.date, w)) continue;
    let signed;
    if (l.kind === 'INV' && ['AUTHORISED', 'PAID'].includes(l.status)) signed = l.qty;
    else if (l.kind === 'CN' && l.status === 'AUTHORISED' && useCreditNotes) signed = -l.qty;
    else continue;
    const k = KEYS[mode].line(l);
    m.set(k, (m.get(k) ?? 0) + signed);
  }
  return m;
}

// Stock per key: sums of Available, OnHand and OnOrder over availability rows.
function stockMap(mode) {
  const m = new Map();
  for (const r of availRows) {
    const k = KEYS[mode].avail(r);
    const cur = m.get(k) ?? { available: 0, onHand: 0, onOrder: 0 };
    cur.available += num(r.Available);
    cur.onHand += num(r.OnHand);
    cur.onOrder += num(r.OnOrder);
    m.set(k, cur);
  }
  return m;
}

// Universe: products whose Type is not Service and whose Status is not Deprecated (first row wins on duplicate keys).
const universeOf = (mode) => {
  const seen = new Map();
  for (const p of productRows) {
    if (p.Type === 'Service' || p.Status === 'Deprecated') continue;
    const k = KEYS[mode].product(p);
    if (!seen.has(k)) seen.set(k, p);
  }
  return seen;
};

const cmpDays = (a, b) => {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
};
const cmpSku = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Evaluate one reading: returns counts, the ranked candidate list and the top-3 summary.
function evaluate(w, mode, useCreditNotes) {
  const vel = velocityMap(w, mode, useCreditNotes);
  const stock = stockMap(mode);
  const rows = [];
  for (const [k, p] of universeOf(mode)) {
    const net = vel.get(k) ?? 0;
    const v = Math.max(0, net) / w;
    const st = stock.get(k) ?? { available: 0, onHand: 0, onOrder: 0 };
    const minimum = num(p.MinimumBeforeReorder);
    const suggested = Math.max(0, Math.ceil(Math.max(0, v * (L + C) - st.available - st.onOrder) - 1e-9));
    const daysOfCover = v === 0 ? null : st.available <= 0 ? 0 : st.available / v;
    const reasons = [];
    if (minimum > 0 && st.available <= minimum) reasons.push('below_threshold');
    if (v > 0 && daysOfCover < L) reasons.push('stockout_before_delivery');
    if (suggested > 0) reasons.push('needs_cover');
    rows.push({
      sku: p.SKU ?? '(no sku)',
      available: st.available,
      onHand: st.onHand,
      onOrder: st.onOrder,
      minimum,
      velocity: v,
      suggested,
      daysOfCover,
      reasons,
    });
  }
  const byRank = (a, b) =>
    cmpDays(a.daysOfCover, b.daysOfCover) ||
    a.available - a.minimum - (b.available - b.minimum) ||
    cmpSku(a.sku, b.sku);
  const candidates = rows.filter((r) => r.reasons.length > 0).sort(byRank);
  const counts = {
    universe: rows.length,
    withVelocity: rows.filter((r) => r.velocity > 0).length,
    belowThreshold: rows.filter((r) => r.reasons.includes('below_threshold')).length,
    stockoutBeforeDelivery: rows.filter((r) => r.reasons.includes('stockout_before_delivery')).length,
    needsCover: rows.filter((r) => r.reasons.includes('needs_cover')).length,
    candidates: candidates.length,
  };
  const top = (list) =>
    list.slice(0, 3).map((r) => ({
      sku: r.sku,
      suggested: r.suggested,
      daysOfCover: r.daysOfCover === null ? null : r2(r.daysOfCover),
    }));
  return { counts, top3: top(candidates), rows, candidates };
}

const primary = evaluate(PRIMARY_W, 'id', true);
const window365 = evaluate(365, 'id', true);
const bySku = evaluate(PRIMARY_W, 'sku', true);
const ignoreCreditNotes = evaluate(PRIMARY_W, 'id', false);
const thresholdCandidates = primary.candidates
  .filter((r) => r.reasons.includes('below_threshold'))
  .sort((a, b) => a.available - a.minimum - (b.available - b.minimum) || cmpSku(a.sku, b.sku));
const thresholdOnly = {
  counts: { candidates: thresholdCandidates.length },
  top3: thresholdCandidates.slice(0, 3).map((r) => ({
    sku: r.sku,
    suggested: r.suggested,
    daysOfCover: r.daysOfCover === null ? null : r2(r.daysOfCover),
  })),
};

// Join diagnostic: product IDs that appear on window lines (primary reading) vs the product list.
const productIds = new Set(productRows.map((p) => p.ID ?? '(none)'));
const lineIds = new Set([...velocityMap(PRIMARY_W, 'id', true).keys()]);
const velocityJoin = {
  matched: [...lineIds].filter((k) => productIds.has(k)).length,
  unmatched: [...lineIds].filter((k) => !productIds.has(k)).length,
};

const totals = {
  available: r2(primary.rows.reduce((a, r) => a + r.available, 0)),
  onHand: r2(primary.rows.reduce((a, r) => a + r.onHand, 0)),
  onOrder: r2(primary.rows.reduce((a, r) => a + r.onOrder, 0)),
};

const summary = (e) => ({ counts: e.counts, top3: e.top3 });
const out = {
  asOf: ASOF,
  L,
  C,
  calls,
  pulled: {
    saleListRows: saleRows.length,
    salesNonVoided: sales.length,
    invoicedSales: invoiced.length,
    documentLines: docLines.length,
    availabilityRows: availRows.length,
    productRows: productRows.length,
  },
  combinedInvoiceStatus,
  primary: { W: PRIMARY_W, ...summary(primary) },
  alt: {
    window365: { W: 365, ...summary(window365) },
    bySku: { W: PRIMARY_W, ...summary(bySku) },
    ignoreCreditNotes: { W: PRIMARY_W, ...summary(ignoreCreditNotes) },
    thresholdOnly,
  },
  velocityJoin,
  stockTotalsUniverse: totals,
  definition:
    `Reorder suggestions as of ${ASOF}, windows W in {${WINDOWS.join(', ')}} ending on asOf ([asOf - W + 1, asOf], date parts). ` +
    `Net units per product ID = sum of quantity on AUTHORISED or PAID invoice lines minus AUTHORISED credit-note lines, each by its own document date, ` +
    `from the detail of every non-voided sale whose CombinedInvoiceStatus starts with INVOICED. ` +
    `Stock per product = sums of Available, OnHand, OnOrder over ref/productavailability rows keyed by ID (missing = 0). ` +
    `Universe = product list rows with Type not Service and Status not Deprecated. ` +
    `dailyVelocity = max(0, net) / W; suggested = ceil(max(0, dailyVelocity * (L + C) - available - onOrder)) with 1e-9 tolerance; ` +
    `daysOfCover = null when velocity is 0, else 0 when available <= 0, else available / dailyVelocity. ` +
    `Reasons: below_threshold (MinimumBeforeReorder > 0 and available <= it); stockout_before_delivery (velocity > 0 and daysOfCover < L); needs_cover (suggested > 0). ` +
    `Ranking: daysOfCover ascending (null last), then available minus minimum ascending, then SKU. ` +
    `primary = W 90 keyed by ProductID. alt.window365 = W 365. alt.bySku = keys by SKU throughout. alt.ignoreCreditNotes = credit notes not subtracted. ` +
    `alt.thresholdOnly = primary candidates with below_threshold, ranked by available minus minimum.`,
};
mkdirSync(fileURLToPath(new URL('./out', import.meta.url)), { recursive: true });
writeFileSync(fileURLToPath(new URL('./out/truth-reorder.json', import.meta.url)), `${JSON.stringify(out, null, 2)}\n`);

// Print only counts, totals and top-3 numbers (SKUs allowed). No customer names, no order numbers.
console.log(
  JSON.stringify({
    calls,
    pulled: out.pulled,
    combinedInvoiceStatus,
    primary: out.primary,
    alt: {
      window365: out.alt.window365,
      bySku: out.alt.bySku,
      ignoreCreditNotes: out.alt.ignoreCreditNotes,
      thresholdOnly: out.alt.thresholdOnly,
    },
    velocityJoin,
    stockTotalsUniverse: totals,
  }),
);
