// Independent document-basis truth for evaluation Q1 (overdue receivables), Q2 (revenue by SourceChannel)
// and Q3 (top customers). Deliberately NOT importing anything from src/.
// Read-only: one paced saleList pass, then one sale detail per non-voided sale (about 170 GETs, about 3.5 minutes).
// Writes eval/out/truth-docs.json as its own file (it does not merge into truth.json). Output stays local (gitignored).
// Console output carries counts and totals only: no customer names, no order numbers.
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
const Q2_FROM = '2026-07-01';
const Q2_TO = '2026-09-30';
const EPS = 0.005;

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

const r2 = (n) => Math.round(n * 100) / 100;
const up = (v) => String(v ?? '').toUpperCase();
const num = (v) => Number(v ?? 0) || 0;
const day = (v) => (typeof v === 'string' && v.length >= 10 ? v.slice(0, 10) : null);
const isInvoice = (i) => ['AUTHORISED', 'PAID'].includes(up(i.Status));
const isCreditNote = (c) => up(c.Status) === 'AUTHORISED';
const add = (m, k, v) => {
  m[k] = (m[k] ?? 0) + v;
};
const roundMap = (m) =>
  Object.fromEntries(
    Object.entries(m)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, r2(v)]),
  );

// 1. Sale list, every page, honouring Total. Deduplicated by SaleID.
const listAll = new Map();
let listTotal = Infinity;
for (let page = 1; listAll.size < listTotal; page++) {
  const j = await get(`saleList?Page=${page}&Limit=1000`);
  if (typeof j.Total === 'number') listTotal = j.Total;
  const batch = j.SaleList ?? [];
  if (!batch.length) break;
  for (const s of batch) listAll.set(s.SaleID, s);
}
const listRows = [...listAll.values()];
const sales = listRows.filter((s) => s.Status !== 'VOIDED');

// Distinct CombinedInvoiceStatus values on non-voided list rows (which sales can have documents).
const combinedInvoiceStatus = {};
for (const s of sales) {
  const k = s.CombinedInvoiceStatus ?? '(none)';
  combinedInvoiceStatus[k] = (combinedInvoiceStatus[k] ?? 0) + 1;
}

// 2. Detail for every non-voided sale (documents live only on the detail).
const details = new Map();
for (const s of sales) {
  details.set(s.SaleID, await get(`sale?ID=${s.SaleID}&HideInventoryMovements=true`));
}
const docsOf = (saleId) => {
  const d = details.get(saleId) ?? {};
  return { invs: (d.Invoices ?? []).filter(isInvoice), cns: (d.CreditNotes ?? []).filter(isCreditNote) };
};

// Q1: overdue receivables as of ASOF, document basis.
function q1Document(useCreditNotes) {
  let count = 0;
  let total = 0;
  for (const s of sales) {
    const { invs, cns } = docsOf(s.SaleID);
    const outstanding =
      invs.reduce((a, i) => a + num(i.Total) - num(i.Paid), 0) -
      (useCreditNotes ? cns.reduce((a, c) => a + num(c.Total), 0) : 0);
    if (outstanding <= EPS) continue;
    const dues = invs
      .filter((i) => num(i.Total) - num(i.Paid) > EPS)
      .map((i) => day(i.InvoiceDueDate))
      .filter(Boolean)
      .sort();
    const dueDate = dues[0] ?? null;
    if (dueDate && dueDate < ASOF) {
      count++;
      total += outstanding;
    }
  }
  return { count, total: r2(total) };
}
// Q1 alt: list rollup (InvoiceAmount - PaidAmount, list InvoiceDueDate). Must equal the old list-basis truth (29 / 26,447).
function q1ListRollup() {
  let count = 0;
  let total = 0;
  for (const s of sales) {
    const balance = num(s.InvoiceAmount) - num(s.PaidAmount);
    const due = day(s.InvoiceDueDate);
    if (balance > EPS && due && due < ASOF) {
      count++;
      total += balance;
    }
  }
  return { count, total: r2(total) };
}
const q1Primary = q1Document(true);
const Q1 = {
  ...q1Primary,
  alt: { ignoreCreditNotes: q1Document(false), listRollup: q1ListRollup() },
  definition:
    `Document basis, non-voided sales. Per sale: outstanding = sum of AUTHORISED or PAID invoice Total - sum of invoice Paid - sum of AUTHORISED credit-note Total; receivable when > 0.005. ` +
    `Due date = earliest InvoiceDueDate (date part) among invoices with Total - Paid > 0.005; overdue when due date < asOf (${ASOF}, yyyy-MM-dd string compare). ` +
    `Sales with no due date are not overdue. total = sum of outstanding over overdue sales. ` +
    `alt.ignoreCreditNotes: same without subtracting credit notes. alt.listRollup: list InvoiceAmount - PaidAmount with list InvoiceDueDate (the old list-basis truth).`,
};

// Q2: revenue by SourceChannel for sales ordered Q2_FROM..Q2_TO (list OrderDate), plus document-date and tax-inclusive readings.
const inRange = (d) => d !== null && d >= Q2_FROM && d <= Q2_TO;
const primary = {};
const incTax = {};
const byDocumentDate = {};
const listRollupQ2 = {};
for (const s of sales) {
  const channel = s.SourceChannel || '(none)';
  const { invs, cns } = docsOf(s.SaleID);
  if (inRange(day(s.OrderDate))) {
    for (const i of invs) {
      add(primary, channel, num(i.TotalBeforeTax));
      add(incTax, channel, num(i.Total));
    }
    for (const c of cns) {
      add(primary, channel, -num(c.TotalBeforeTax));
      add(incTax, channel, -num(c.Total));
    }
    add(listRollupQ2, channel, num(s.InvoiceAmount));
  }
  for (const i of invs) {
    if (inRange(day(i.InvoiceDate))) add(byDocumentDate, channel, num(i.TotalBeforeTax));
  }
  for (const c of cns) {
    if (inRange(day(c.CreditNoteDate))) add(byDocumentDate, channel, -num(c.TotalBeforeTax));
  }
}
const Q2 = {
  primary: roundMap(primary),
  incTax: roundMap(incTax),
  byDocumentDate: roundMap(byDocumentDate),
  listRollup: roundMap(listRollupQ2),
  definition:
    `Revenue by SourceChannel for non-voided sales whose list OrderDate (date part) is ${Q2_FROM}..${Q2_TO} inclusive; blank channel = (none). ` +
    `primary: sum of AUTHORISED or PAID invoice TotalBeforeTax minus AUTHORISED credit-note TotalBeforeTax of those sales (ex tax, includes additional charges). ` +
    `incTax: Total instead of TotalBeforeTax. ` +
    `byDocumentDate: each document attributed by its InvoiceDate / CreditNoteDate within the range, regardless of order date (ex tax, channel of its sale). ` +
    `listRollup: sum of list InvoiceAmount (old list-basis figure; 10,349 for the API channel).`,
};

// Q3: top 3 customers across all non-voided sales, grouped by CustomerID.
const byCustomer = new Map();
for (const s of sales) {
  const key = s.CustomerID ?? '(none)';
  if (!byCustomer.has(key)) byCustomer.set(key, { customerId: key, name: s.Customer ?? null, billed: 0, exTax: 0, list: 0 });
  const rec = byCustomer.get(key);
  const { invs, cns } = docsOf(s.SaleID);
  for (const i of invs) {
    rec.billed += num(i.Total);
    rec.exTax += num(i.TotalBeforeTax);
  }
  for (const c of cns) {
    rec.billed -= num(c.Total);
    rec.exTax -= num(c.TotalBeforeTax);
  }
  rec.list += num(s.InvoiceAmount);
}
const top3 = (field) =>
  [...byCustomer.values()]
    .sort((a, b) => b[field] - a[field] || String(a.customerId).localeCompare(String(b.customerId)))
    .slice(0, 3)
    .map((r) => ({ customerId: r.customerId, name: r.name, invoiced: r2(r[field]) }));
const Q3 = {
  primary: top3('billed'),
  altExTax: top3('exTax'),
  listRollup: top3('list'),
  definition:
    'Top 3 CustomerID by total across all non-voided sales, all dates. primary: sum of AUTHORISED or PAID invoice Total minus AUTHORISED credit-note Total (tax-inclusive, billed). ' +
    'altExTax: same on TotalBeforeTax. listRollup: sum of list InvoiceAmount per CustomerID (the old list-basis truth).',
};

const out = {
  asOf: ASOF,
  calls,
  salesListRows: listRows.length,
  salesNonVoided: sales.length,
  combinedInvoiceStatus,
  Q1,
  Q2,
  Q3,
};
mkdirSync(fileURLToPath(new URL('./out', import.meta.url)), { recursive: true });
writeFileSync(fileURLToPath(new URL('./out/truth-docs.json', import.meta.url)), `${JSON.stringify(out, null, 2)}\n`);

// Print only non-identifying numbers: no customer names, no order numbers.
console.log(
  JSON.stringify({
    calls,
    salesListRows: listRows.length,
    salesNonVoided: sales.length,
    combinedInvoiceStatus,
    Q1: { count: Q1.count, total: Q1.total, alt: Q1.alt },
    Q2: { channels: Object.keys(Q2.primary), primary: Q2.primary, incTax: Q2.incTax, byDocumentDate: Q2.byDocumentDate, listRollup: Q2.listRollup },
    Q3: {
      primaryInvoiced: Q3.primary.map((x) => x.invoiced),
      altExTaxInvoiced: Q3.altExTax.map((x) => x.invoiced),
      listRollupInvoiced: Q3.listRollup.map((x) => x.invoiced),
    },
  }),
);
