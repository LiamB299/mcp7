import type { CachedDoc, CachedSale, Snapshot } from './types.js';

/*
 * Pure read-side queries over a cache Snapshot (ADR 0005). No I/O.
 *
 * revenueBySku semantics:
 * - Only non-voided sales count (status trimmed and upper-cased, 'VOIDED' is excluded).
 * - A doc's attribution date is `doc.date ?? sale.orderDate` (document date, not order date).
 *   from/to are inclusive yyyy-MM-dd bounds. A doc with no usable date is kept only when both
 *   bounds are omitted.
 * - sign is +1 for 'invoice' and -1 for 'credit'.
 * - Line revenue is ex-tax: line.total minus line.tax when taxCalculation is 'Inclusive'
 *   (null is treated as 'Exclusive'). cost = avgCost * quantity. All three are multiplied by sign.
 * - SKU key is `line.sku ?? '(no sku)'`. The first non-null name wins (sales visited in id order).
 * - Rows carry rounded values (money 2 dp, quantity 4 dp, marginPct 2 dp). Rows are sorted by the
 *   rounded value of sortBy, descending, ties broken by sku ascending.
 * - totals cover ALL SKUs; `other` rolls up the SKUs beyond topN (null when there are none).
 * - additionalCharges is the signed sum of doc.additionalCharges over kept docs.
 * - coverage.rangeCovered is true when windowFrom is null, or when from is given and from >= windowFrom.
 *
 * rollupDrift semantics:
 * - Compares non-voided sales with at least one invoice. documentNet = invoice totals minus credit
 *   totals; list = listInvoiceAmount ?? 0. A sale differs when |list - documentNet| > 0.02.
 * - Categories, first match wins: creditNotesNotNetted (has a credit doc and list matches the
 *   invoice total within 0.02), zeroDespiteInvoice (list is ~0 and documentNet > 0.02), else other.
 * - top lists the largest differences first, with order number and amounts only (no names).
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const NO_SKU = '(no sku)';
const DRIFT_TOLERANCE = 0.02;

export interface SkuRevenueOptions {
  /** Inclusive yyyy-MM-dd bounds, applied to the INVOICE or CREDIT-NOTE date (not the order date). */
  from?: string;
  to?: string;
  topN?: number;
  sortBy?: 'revenue' | 'margin' | 'quantity';
}

export interface SkuRow {
  sku: string;
  name: string | null;
  /** Ex-tax revenue: invoice lines minus credit-note lines. */
  revenueExTax: number;
  quantity: number;
  /** Line AverageCost x Quantity, invoices minus credit notes. */
  cost: number;
  margin: number;
  marginPct: number | null;
}

export interface SkuRevenueResult {
  from: string | null;
  to: string | null;
  currency: string | null;
  salesContributing: number;
  documents: { invoices: number; creditNotes: number };
  totals: {
    revenueExTax: number;
    cost: number;
    margin: number;
    quantity: number;
    additionalCharges: number;
  };
  rows: SkuRow[];
  /** Roll-up of SKUs beyond topN; null when none. */
  other: { skus: number; revenueExTax: number; quantity: number; margin: number } | null;
  /** Contributing sales whose customer currency differs from the base currency (summed as stored). */
  nonBaseCurrencySales: number;
  coverage: {
    salesInSnapshot: number;
    withDetail: number;
    pendingDetail: number;
    windowFrom: string | null;
    /** True when the requested range lies inside the loaded window (windowFrom null, or from >= windowFrom). */
    rangeCovered: boolean;
  };
}

export function revenueBySku(snapshot: Snapshot, options: SkuRevenueOptions): SkuRevenueResult {
  const { from, to, topN = 10, sortBy = 'revenue' } = options;
  const allSales = Object.values(snapshot.sales).sort((a, b) => compareText(a.id, b.id));

  const accumulators = new Map<string, Accumulator>();
  const contributing: CachedSale[] = [];
  let invoiceCount = 0;
  let creditCount = 0;
  let additionalCharges = 0;

  for (const sale of allSales) {
    if (isVoided(sale)) continue;
    let contributes = false;
    for (const doc of sale.docs) {
      const sign = signOf(doc);
      if (sign === 0) continue;
      if (!isInRange(attributionDate(doc, sale), from, to)) continue;
      contributes = true;
      if (sign > 0) invoiceCount++;
      else creditCount++;
      additionalCharges += sign * doc.additionalCharges;

      const taxInclusive = sale.taxCalculation === 'Inclusive';
      for (const line of doc.lines) {
        const key = line.sku ?? NO_SKU;
        let acc = accumulators.get(key);
        if (!acc) {
          acc = { name: null, revenue: 0, quantity: 0, cost: 0 };
          accumulators.set(key, acc);
        }
        if (acc.name === null && line.name != null) acc.name = line.name;
        const exTax = line.total - (taxInclusive ? line.tax : 0);
        acc.revenue += sign * exTax;
        acc.quantity += sign * line.quantity;
        acc.cost += sign * line.avgCost * line.quantity;
      }
    }
    if (contributes) contributing.push(sale);
  }

  const sortable = [...accumulators.entries()].map(([sku, acc]) => ({
    acc,
    row: buildRow(sku, acc),
  }));
  sortable.sort((x, y) => {
    const diff = sortValue(y.row, sortBy) - sortValue(x.row, sortBy);
    return diff !== 0 ? diff : compareText(x.row.sku, y.row.sku);
  });

  const count = Math.max(0, Math.floor(topN));
  const rows = sortable.slice(0, count).map((entry) => entry.row);
  const rest = sortable.slice(count);

  const sumRevenue = sumOf(sortable.map((e) => e.acc.revenue));
  const sumCost = sumOf(sortable.map((e) => e.acc.cost));
  const sumQuantity = sumOf(sortable.map((e) => e.acc.quantity));

  const other =
    rest.length === 0
      ? null
      : {
          skus: rest.length,
          revenueExTax: round2(sumOf(rest.map((e) => e.acc.revenue))),
          quantity: round4(sumOf(rest.map((e) => e.acc.quantity))),
          margin: round2(sumOf(rest.map((e) => e.acc.revenue - e.acc.cost))),
        };

  const sales = allSales;
  const windowFrom = snapshot.windowFrom;

  const contributingCurrency = contributing[0]?.currency ?? null;

  return {
    from: from ?? null,
    to: to ?? null,
    currency: contributingCurrency,
    salesContributing: contributing.length,
    documents: { invoices: invoiceCount, creditNotes: creditCount },
    totals: {
      revenueExTax: round2(sumRevenue),
      cost: round2(sumCost),
      margin: round2(sumRevenue - sumCost),
      quantity: round4(sumQuantity),
      additionalCharges: round2(additionalCharges),
    },
    rows,
    other,
    nonBaseCurrencySales: contributing.filter(
      (sale) =>
        sale.customerCurrency != null &&
        sale.currency != null &&
        sale.customerCurrency !== sale.currency,
    ).length,
    coverage: {
      salesInSnapshot: sales.length,
      withDetail: sales.filter((sale) => sale.docs.length > 0).length,
      pendingDetail: sales.filter((sale) => sale.pendingDetail).length,
      windowFrom,
      rangeCovered: windowFrom === null || (from !== undefined && from >= windowFrom),
    },
  };
}

export interface RollupDrift {
  /** Sales with documents loaded that were compared. */
  compared: number;
  /** Sales where list InvoiceAmount differs from (invoice totals minus credit-note totals) by more than 0.02. */
  differing: number;
  creditNotesNotNetted: number;
  zeroDespiteInvoice: number;
  other: number;
  /** Largest absolute differences first: order number and amounts only (no names). */
  top: { orderNumber: string | null; listInvoiceAmount: number | null; documentNet: number }[];
}

export function rollupDrift(snapshot: Snapshot, options: { top?: number } = {}): RollupDrift {
  const topLimit = Math.max(0, Math.floor(options.top ?? 5));
  const result: RollupDrift = {
    compared: 0,
    differing: 0,
    creditNotesNotNetted: 0,
    zeroDespiteInvoice: 0,
    other: 0,
    top: [],
  };
  const differences: { sale: CachedSale; documentNet: number; gap: number }[] = [];

  for (const sale of Object.values(snapshot.sales)) {
    if (isVoided(sale)) continue;
    const invoices = sale.docs.filter((doc) => doc.kind === 'invoice');
    if (invoices.length === 0) continue;
    const credits = sale.docs.filter((doc) => doc.kind === 'credit');

    result.compared++;
    const invoiceTotal = sumOf(invoices.map((doc) => doc.total));
    const documentNet = invoiceTotal - sumOf(credits.map((doc) => doc.total));
    const list = sale.listInvoiceAmount ?? 0;
    const gap = Math.abs(list - documentNet);
    if (!(gap > DRIFT_TOLERANCE)) continue;

    result.differing++;
    if (credits.length > 0 && Math.abs(list - invoiceTotal) <= DRIFT_TOLERANCE) {
      result.creditNotesNotNetted++;
    } else if (Math.abs(list) <= DRIFT_TOLERANCE && documentNet > DRIFT_TOLERANCE) {
      result.zeroDespiteInvoice++;
    } else {
      result.other++;
    }
    differences.push({ sale, documentNet, gap });
  }

  differences.sort(
    (x, y) =>
      y.gap - x.gap ||
      compareText(x.sale.orderNumber ?? '', y.sale.orderNumber ?? '') ||
      compareText(x.sale.id, y.sale.id),
  );
  result.top = differences.slice(0, topLimit).map(({ sale, documentNet }) => ({
    orderNumber: sale.orderNumber,
    listInvoiceAmount: sale.listInvoiceAmount === null ? null : round2(sale.listInvoiceAmount),
    documentNet: round2(documentNet),
  }));
  return result;
}

interface Accumulator {
  name: string | null;
  revenue: number;
  quantity: number;
  cost: number;
}

function buildRow(sku: string, acc: Accumulator): SkuRow {
  const revenueExTax = round2(acc.revenue);
  const cost = round2(acc.cost);
  const margin = round2(acc.revenue - acc.cost);
  return {
    sku,
    name: acc.name,
    revenueExTax,
    quantity: round4(acc.quantity),
    cost,
    margin,
    marginPct: revenueExTax !== 0 ? round2((margin / revenueExTax) * 100) : null,
  };
}

function sortValue(row: SkuRow, sortBy: 'revenue' | 'margin' | 'quantity'): number {
  if (sortBy === 'margin') return row.margin;
  if (sortBy === 'quantity') return row.quantity;
  return row.revenueExTax;
}

function isVoided(sale: CachedSale): boolean {
  return (sale.status ?? '').trim().toUpperCase() === 'VOIDED';
}

/** +1 for invoices, -1 for credit notes, 0 for anything else (ignored). */
function signOf(doc: CachedDoc): number {
  if (doc.kind === 'invoice') return 1;
  if (doc.kind === 'credit') return -1;
  return 0;
}

function attributionDate(doc: CachedDoc, sale: CachedSale): string | null {
  const date = doc.date ?? sale.orderDate;
  return date !== null && DATE_PATTERN.test(date) ? date : null;
}

function isInRange(date: string | null, from: string | undefined, to: string | undefined): boolean {
  if (date === null) return from === undefined && to === undefined;
  if (from !== undefined && date < from) return false;
  if (to !== undefined && date > to) return false;
  return true;
}

function sumOf(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function compareText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Rounds to 2 dp; the `+ 0` turns -0 into 0. */
function round2(value: number): number {
  return Math.round(value * 100) / 100 + 0;
}

/** Rounds to 4 dp; the `+ 0` turns -0 into 0. */
function round4(value: number): number {
  return Math.round(value * 10000) / 10000 + 0;
}
