// Independent document-basis truth for Q11 (revenue by SKU). Deliberately NOT importing src/.
// Fetches every non-voided sale detail (paced, read-only, about 3 minutes) and merges Q11 into eval/out/truth.json.
import { loadEnvFile } from 'node:process';
import { readFileSync, writeFileSync } from 'node:fs';

loadEnvFile(new URL('../.env', import.meta.url).pathname);
const base = `${process.env.CIN7_BASE_URL.replace(/\/+$/, '')}/v2/`;
const headers = { 'api-auth-accountid': process.env.CIN7_ACCOUNT_ID, 'api-auth-applicationkey': process.env.CIN7_APPLICATION_KEY };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let calls = 0;
async function get(path) {
  for (let a = 0; a < 4; a++) {
    await sleep(1150);
    calls++;
    const res = await fetch(base + path, { headers });
    if (res.status === 429 || res.status === 503) { await sleep(5000 * 2 ** a); continue; }
    if (!res.ok) throw new Error(`${path} ${res.status}`);
    return res.json();
  }
  throw new Error('gave up ' + path);
}
const r2 = (n) => Math.round(n * 100) / 100;
const list = (await get('saleList?Page=1&Limit=1000')).SaleList.filter((s) => s.Status !== 'VOIDED');

// variant: which invoice statuses count, whether credit notes count, and how tax is treated
const acc = { primary: new Map(), altDrafts: new Map(), altIgnoreCreditNotes: new Map(), altTaxInclusive: new Map() };
const add = (m, sku, v) => m.set(sku, (m.get(sku) ?? 0) + v);
for (const s of list) {
  const d = await get(`sale?ID=${s.SaleID}&HideInventoryMovements=true`);
  const inclusive = (d.TaxCalculation ?? '').toUpperCase() === 'INCLUSIVE';
  const exTax = (l) => (l.Total ?? 0) - (inclusive ? l.Tax ?? 0 : 0);
  const inclTax = (l) => (l.Total ?? 0) + (inclusive ? 0 : l.Tax ?? 0);
  for (const i of d.Invoices ?? []) {
    const st = (i.Status ?? '').toUpperCase();
    for (const l of i.Lines ?? []) {
      const sku = l.SKU ?? '(no sku)';
      if (['AUTHORISED', 'PAID'].includes(st)) { add(acc.primary, sku, exTax(l)); add(acc.altIgnoreCreditNotes, sku, exTax(l)); add(acc.altTaxInclusive, sku, inclTax(l)); }
      if (['AUTHORISED', 'PAID', 'DRAFT'].includes(st)) add(acc.altDrafts, sku, exTax(l));
    }
  }
  for (const c of d.CreditNotes ?? []) {
    if ((c.Status ?? '').toUpperCase() !== 'AUTHORISED') continue;
    for (const l of c.Lines ?? []) {
      const sku = l.SKU ?? '(no sku)';
      add(acc.primary, sku, -exTax(l)); add(acc.altDrafts, sku, -exTax(l)); add(acc.altTaxInclusive, sku, -inclTax(l));
    }
  }
}
const top3 = (m) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([sku, revenue]) => ({ sku, revenue: r2(revenue) }));
const Q11 = {
  primary: top3(acc.primary), altDrafts: top3(acc.altDrafts), altIgnoreCreditNotes: top3(acc.altIgnoreCreditNotes), altTaxInclusive: top3(acc.altTaxInclusive),
  salesFetched: list.length,
  definition: 'authorised or paid invoice lines minus authorised credit-note lines, ex tax (line Total minus line Tax on tax-inclusive sales), all time, non-voided sales. Alt readings: include draft invoices; ignore credit notes; tax-inclusive.',
};
const path = new URL('./out/truth.json', import.meta.url).pathname;
const truth = JSON.parse(readFileSync(path));
truth.Q11 = Q11;
writeFileSync(path, JSON.stringify(truth, null, 2));
console.log(JSON.stringify({ calls, salesFetched: list.length, primaryTop3Revenue: Q11.primary.map((x) => x.revenue), distinctAltTop3: Object.fromEntries(['altDrafts', 'altIgnoreCreditNotes', 'altTaxInclusive'].map((k) => [k, JSON.stringify(Q11[k]) !== JSON.stringify(Q11.primary)])) }));
