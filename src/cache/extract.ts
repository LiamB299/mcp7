import type { SaleListRow } from '../cin7/types.js';
import { dateOnly } from '../dates.js';
import type { CachedDoc, CachedLine, CachedSale } from './types.js';

/**
 * ALLOW-LIST extraction: builds cache records from named safe fields only. Anything Cin7 adds later,
 * and every contact, address and note field, is dropped by construction.
 */

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const up = (v: unknown) => (typeof v === 'string' ? v.trim().toUpperCase() : '');

const INVOICE_OK = new Set(['AUTHORISED', 'PAID']);
const CREDIT_OK = new Set(['AUTHORISED']);

/** Parse a Cin7 timestamp (UTC, 2-4 fraction digits, optional Z) to ms since epoch; 0 if unparsable. */
export function parseTimestamp(value: string | null | undefined): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z?$/.exec(value ?? '');
  if (!m) return 0;
  const ms = Number(((m[7] ?? '') + '000').slice(0, 3));
  return Date.UTC(
    +(m[1] as string),
    +(m[2] as string) - 1,
    +(m[3] as string),
    +(m[4] as string),
    +(m[5] as string),
    +(m[6] as string),
    ms,
  );
}

/** `UpdatedSince` query value: ISO without the trailing Z, millisecond precision. */
export const toUpdatedSince = (ms: number): string => new Date(ms).toISOString().replace('Z', '');

const toLine = (l: Obj): CachedLine => ({
  sku: str(l.SKU),
  productId: str(l.ProductID),
  name: str(l.Name),
  quantity: num(l.Quantity),
  price: num(l.Price),
  discount: num(l.Discount),
  tax: num(l.Tax),
  total: num(l.Total),
  avgCost: num(l.AverageCost),
});

const charges = (d: Obj): number => arr(d.AdditionalCharges).reduce((a, c) => a + num(c.Total), 0);

function toDocs(detail: Obj): CachedDoc[] {
  const docs: CachedDoc[] = [];
  for (const i of arr(detail.Invoices)) {
    if (!INVOICE_OK.has(up(i.Status))) continue;
    docs.push({
      kind: 'invoice',
      number: str(i.InvoiceNumber),
      date: dateOnly(str(i.InvoiceDate)) ?? null,
      status: up(i.Status),
      total: num(i.Total),
      totalBeforeTax: num(i.TotalBeforeTax),
      tax: num(i.Tax),
      paid: numOrNull(i.Paid),
      dueDate: dateOnly(str(i.InvoiceDueDate)) ?? null,
      additionalCharges: charges(i),
      lines: arr(i.Lines).map(toLine),
    });
  }
  for (const c of arr(detail.CreditNotes)) {
    if (!CREDIT_OK.has(up(c.Status))) continue;
    docs.push({
      kind: 'credit',
      number: str(c.CreditNoteNumber),
      date: dateOnly(str(c.CreditNoteDate)) ?? null,
      status: up(c.Status),
      total: num(c.Total),
      totalBeforeTax: num(c.TotalBeforeTax),
      tax: num(c.Tax),
      paid: null,
      dueDate: null,
      additionalCharges: charges(c),
      lines: arr(c.Lines).map(toLine),
    });
  }
  return docs;
}

/** Header record from a saleList row. `detailFetched`/`pendingDetail` are set by the sync engine. */
export function headerFromListRow(row: SaleListRow): CachedSale {
  const updated = row.Updated ?? '';
  return {
    id: row.SaleID ?? '',
    orderNumber: row.OrderNumber ?? null,
    customerId: row.CustomerID ?? null,
    customer: row.Customer ?? null,
    type: row.Type ?? null,
    status: row.Status ?? null,
    orderDate: dateOnly(row.OrderDate) ?? null,
    invoiceDate: dateOnly(row.InvoiceDate) ?? null,
    updated,
    updatedMs: parseTimestamp(updated),
    currency: row.BaseCurrency ?? null,
    customerCurrency: row.CustomerCurrency ?? null,
    currencyRate: null,
    channel: row.SourceChannel ?? null,
    taxCalculation: null,
    listInvoiceAmount: typeof row.InvoiceAmount === 'number' ? row.InvoiceAmount : null,
    listPaidAmount: typeof row.PaidAmount === 'number' ? row.PaidAmount : null,
    listInvoiceStatus: row.CombinedInvoiceStatus ?? null,
    listInvoiceDueDate: dateOnly(row.InvoiceDueDate) ?? null,
    detailFetched: false,
    pendingDetail: false,
    docs: [],
  };
}

/** Fill detail-only fields and documents from a `GET sale?ID=` response. */
export function applyDetail(header: CachedSale, detail: unknown): CachedSale {
  const d = obj(detail);
  const tax = up(d.TaxCalculation);
  const updated = str(d.LastModifiedOn) ?? header.updated;
  return {
    ...header,
    updated,
    updatedMs: parseTimestamp(updated) || header.updatedMs,
    currencyRate: numOrNull(d.CurrencyRate),
    taxCalculation: tax === 'INCLUSIVE' ? 'Inclusive' : tax === 'EXCLUSIVE' ? 'Exclusive' : null,
    detailFetched: true,
    pendingDetail: false,
    docs: toDocs(d),
  };
}
