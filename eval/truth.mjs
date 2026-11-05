// Independent ground truth for the evaluation questions. Deliberately NOT using src/.
// Pulls fresh data from the Cin7 sandbox (read-only, paced) and writes eval/out/truth.json.
// Definitions are written next to each answer. Output stays local (gitignored).
import { loadEnvFile } from 'node:process';
import { mkdirSync, writeFileSync } from 'node:fs';

loadEnvFile(new URL('../.env', import.meta.url).pathname);
const base = `${process.env.CIN7_BASE_URL.replace(/\/+$/, '')}/v2/`;
const headers = {
  'api-auth-accountid': process.env.CIN7_ACCOUNT_ID,
  'api-auth-applicationkey': process.env.CIN7_APPLICATION_KEY,
};
const ASOF = JSON.parse((await import('node:fs')).readFileSync(new URL('./questions.json', import.meta.url))).asOf;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let calls = 0;

async function all(path, key, extra = '') {
  const rows = [];
  for (let page = 1; ; page++) {
    await sleep(1200);
    calls++;
    const res = await fetch(`${base}${path}?Page=${page}&Limit=500${extra}`, { headers });
    if (!res.ok) throw new Error(`${path} ${res.status}`);
    const j = await res.json();
    rows.push(...j[key]);
    if (!j[key].length || rows.length >= j.Total) return rows;
  }
}
const r2 = (n) => Math.round(n * 100) / 100;
const sales = (await all('saleList', 'SaleList')).filter((s) => s.Status !== 'VOIDED');
const avail = await all('ref/productavailability', 'ProductAvailabilityList');
const purchases = await all('purchaseList', 'PurchaseList');

// Q1 overdue: net invoiced (InvoiceAmount, net of credit notes) minus paid > 0 and due date < asOf.
const q1 = (amountOf) => {
  const od = sales.filter((s) => amountOf(s) - s.PaidAmount > 0.005 && s.InvoiceDueDate && s.InvoiceDueDate.slice(0, 10) < ASOF);
  return { count: od.length, total: r2(od.reduce((a, s) => a + amountOf(s) - s.PaidAmount, 0)) };
};
// Q2 revenue by channel: OrderDate in range, sum InvoiceAmount (net of credit notes).
const q2 = (amountOf) => {
  const out = {};
  for (const s of sales) {
    const d = s.OrderDate.slice(0, 10);
    if (d < '2026-07-01' || d > '2026-09-30') continue;
    const k = s.SourceChannel || '(none)';
    out[k] = r2((out[k] ?? 0) + amountOf(s));
  }
  return out;
};
// Q3 top customers by invoiced amount (net), grouped by CustomerID.
const q3 = (amountOf) => {
  const m = new Map();
  for (const s of sales) m.set(s.CustomerID, (m.get(s.CustomerID) ?? 0) + amountOf(s));
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, v]) => ({ customerId: id, name: sales.find((s) => s.CustomerID === id).Customer, invoiced: r2(v) }));
};
// Q4 stock value: sum StockOnHand (a VALUE, not units).
const byLoc = {};
for (const a of avail) byLoc[a.Location] = (byLoc[a.Location] ?? 0) + a.StockOnHand;
const locs = Object.entries(byLoc).sort((a, b) => b[1] - a[1]);
// Q5 distinct products with summed Available < 0.
const av = new Map();
for (const a of avail) av.set(a.ID, (av.get(a.ID) ?? 0) + a.Available);
// Q6 POs awaiting receipt: Status ORDERED or RECEIVING (not RECEIVED/COMPLETED/VOIDED...).
const cnt = (st) => purchases.filter((p) => st.includes(p.Status)).length;
const q6 = { orderedReceiving: cnt(['ORDERED', 'RECEIVING']), plusInvoiced: cnt(['ORDERED', 'RECEIVING', 'INVOICED']), plusOrdering: cnt(['ORDERING', 'ORDERED', 'RECEIVING']) };

const truth = {
  asOf: ASOF, calls, salesNonVoided: sales.length,
  Q1: { primary: q1((s) => s.InvoiceAmount), altGrossInvoices: q1((s) => s.SaleInvoicesTotalAmount ?? s.InvoiceAmount), definition: 'outstanding = InvoiceAmount (net of credit notes) - PaidAmount > 0; due date < asOf; non-voided' },
  Q2: { primary: q2((s) => s.InvoiceAmount), altGrossInvoices: q2((s) => s.SaleInvoicesTotalAmount ?? s.InvoiceAmount), definition: 'OrderDate within range, non-voided, sum InvoiceAmount (net of credit notes)' },
  Q3: { primary: q3((s) => s.InvoiceAmount), altGrossInvoices: q3((s) => s.SaleInvoicesTotalAmount ?? s.InvoiceAmount), definition: 'grouped by CustomerID, sum InvoiceAmount (net), non-voided, all dates' },
  Q4: { totalValue: r2(locs.reduce((a, [, v]) => a + v, 0)), topLocationShare: r2(locs[0][1] / locs.reduce((a, [, v]) => a + v, 0)), topLocation: locs[0][0], topLocationValue: r2(locs[0][1]), altIfUnitsMisread: r2(avail.reduce((a, r) => a + r.OnHand, 0)), definition: 'StockOnHand is a value (OnHand x AverageCost), summed over all availability rows' },
  Q5: { products: [...av.values()].filter((v) => v < 0).length, definition: 'distinct product IDs whose summed Available across rows is < 0' },
  Q6: { readings: q6, definition: "purchaseList Status counts under three defensible readings of 'awaiting receipt'; out of MVP scope, excluded from the kill criterion" },
};
mkdirSync(new URL('./out', import.meta.url).pathname, { recursive: true });
writeFileSync(new URL('./out/truth.json', import.meta.url).pathname, JSON.stringify(truth, null, 2));
// Print only non-identifying numbers.
console.log(JSON.stringify({ calls, salesNonVoided: sales.length, Q1: truth.Q1, Q2keys: Object.keys(truth.Q2.primary).length, Q4: { totalValue: truth.Q4.totalValue, share: truth.Q4.topLocationShare }, Q5: truth.Q5, Q6: truth.Q6.readings }));
