import { attributionDate, compareText, isInRange, isVoided, round4 } from './query.js';
import type { CachedDoc, Snapshot } from './types.js';

/*
 * Sales velocity over a window of cache Snapshot (ADR 0005). Pure, no I/O.
 *
 * Window: `to` = asOf, `from` = asOf - (windowDays - 1) days, both inclusive yyyy-MM-dd.
 * windowDays must be an integer >= 1 and asOf a real yyyy-MM-dd date; otherwise it throws.
 *
 * Semantics:
 * - Only non-voided sales count (isVoided). Sales are visited in id order.
 * - Only 'invoice' (+1) and 'credit' (-1) docs count. A doc's date is attributionDate (doc.date,
 *   falling back to sale.orderDate). A doc with no usable date is excluded (unlike query.ts).
 * - Each line of a kept doc is keyed on `line.productId ?? line.sku`. Lines with neither go to
 *   `noProduct` (totals only, never an entry).
 * - invoicedUnits sums invoice line quantities; creditedUnits sums credit-note line quantities
 *   as POSITIVE numbers. netUnits = invoicedUnits - creditedUnits (may be negative).
 * - productId is the keyed productId (null for SKU-keyed entries); sku and name are the first
 *   non-null value seen, so two lines of one productId with different SKUs merge (first SKU wins).
 * - saleCount counts distinct sales that contributed a line to the entry.
 * - Numbers are summed raw and rounded to 4 dp once at the end; netUnits is derived from the
 *   rounded invoiced and credited values so the printed figures reconcile.
 * - entries are sorted by `productId ?? sku` (compareText), productId-keyed entries first on a tie.
 * - coverage: salesInSnapshot counts all sales (voided included); withDetail counts sales with docs;
 *   pendingDetail counts sales flagged pendingDetail; rangeCovered is true when windowFrom is null
 *   or `from >= windowFrom`.
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** One product's sales over a window. Keyed on the sale line's productId, falling back to its SKU. */
export interface VelocityEntry {
  /** Sale-line productId (null when the lines had only a SKU). */
  productId: string | null;
  /** SKU of the first line that carried one. */
  sku: string | null;
  /** First non-null line name. */
  name: string | null;
  /** invoicedUnits - creditedUnits */
  netUnits: number;
  invoicedUnits: number;
  creditedUnits: number;
  /** Distinct non-voided sales with a kept document line for this product. */
  saleCount: number;
}

export interface VelocityResult {
  /** Window start and end (inclusive yyyy-MM-dd) and its length in days. */
  from: string;
  to: string;
  days: number;
  entries: VelocityEntry[];
  /** Lines with neither productId nor SKU (kept so totals reconcile with sales_by_sku; never suggested). */
  noProduct: { netUnits: number; invoicedUnits: number; creditedUnits: number };
  coverage: {
    salesInSnapshot: number;
    withDetail: number;
    pendingDetail: number;
    windowFrom: string | null;
    /** True when windowFrom is null or the window start is on or after windowFrom. */
    rangeCovered: boolean;
  };
}

export interface VelocityOptions {
  /** Window end, inclusive, yyyy-MM-dd. */
  asOf: string;
  /** Window length in days (>= 1). The window is [asOf - days + 1, asOf]. */
  windowDays: number;
}

interface Accumulator {
  productId: string | null;
  sku: string | null;
  name: string | null;
  invoiced: number;
  credited: number;
  saleIds: Set<string>;
  /** Namespace of the key: productId-keyed entries sort before SKU-keyed ones on a tie. */
  byProductId: boolean;
  key: string;
}

export function salesVelocity(snapshot: Snapshot, options: VelocityOptions): VelocityResult {
  const { asOf, windowDays } = options;
  if (
    !DATE_PATTERN.test(asOf) ||
    Number.isNaN(Date.parse(`${asOf}T00:00:00Z`)) ||
    addDays(asOf, 0) !== asOf
  ) {
    throw new Error(`asOf must be a yyyy-MM-dd date, got "${asOf}"`);
  }
  if (!Number.isInteger(windowDays) || windowDays < 1) {
    throw new Error(`windowDays must be an integer >= 1, got ${windowDays}`);
  }
  const to = asOf;
  const from = addDays(asOf, -(windowDays - 1));

  const sales = Object.values(snapshot.sales).sort((a, b) => compareText(a.id, b.id));
  const accumulators = new Map<string, Accumulator>();
  const noProductTotals = { invoiced: 0, credited: 0 };

  for (const sale of sales) {
    if (isVoided(sale)) continue;
    for (const doc of sale.docs) {
      const sign = signOf(doc);
      if (sign === 0) continue;
      const date = attributionDate(doc, sale);
      if (date === null || !isInRange(date, from, to)) continue;

      for (const line of doc.lines) {
        const quantity = line.quantity;
        if (line.productId === null && line.sku === null) {
          if (sign > 0) noProductTotals.invoiced += quantity;
          else noProductTotals.credited += quantity;
          continue;
        }
        const byProductId = line.productId !== null;
        const key = line.productId ?? line.sku ?? '';
        const mapKey = `${byProductId ? 'id' : 'sku'}:${key}`;
        let acc = accumulators.get(mapKey);
        if (!acc) {
          acc = {
            productId: line.productId,
            sku: null,
            name: null,
            invoiced: 0,
            credited: 0,
            saleIds: new Set<string>(),
            byProductId,
            key,
          };
          accumulators.set(mapKey, acc);
        }
        if (acc.sku === null && line.sku !== null) acc.sku = line.sku;
        if (acc.name === null && line.name !== null) acc.name = line.name;
        if (sign > 0) acc.invoiced += quantity;
        else acc.credited += quantity;
        acc.saleIds.add(sale.id);
      }
    }
  }

  const ordered = [...accumulators.values()].sort(
    (x, y) => compareText(x.key, y.key) || Number(y.byProductId) - Number(x.byProductId),
  );
  const entries: VelocityEntry[] = ordered.map((acc) => {
    const invoicedUnits = round4(acc.invoiced);
    const creditedUnits = round4(acc.credited);
    return {
      productId: acc.productId,
      sku: acc.sku,
      name: acc.name,
      netUnits: round4(invoicedUnits - creditedUnits),
      invoicedUnits,
      creditedUnits,
      saleCount: acc.saleIds.size,
    };
  });

  const noProductInvoiced = round4(noProductTotals.invoiced);
  const noProductCredited = round4(noProductTotals.credited);
  const windowFrom = snapshot.windowFrom;

  return {
    from,
    to,
    days: windowDays,
    entries,
    noProduct: {
      netUnits: round4(noProductInvoiced - noProductCredited),
      invoicedUnits: noProductInvoiced,
      creditedUnits: noProductCredited,
    },
    coverage: {
      salesInSnapshot: sales.length,
      withDetail: sales.filter((sale) => sale.docs.length > 0).length,
      pendingDetail: sales.filter((sale) => sale.pendingDetail).length,
      windowFrom,
      rangeCovered: windowFrom === null || from >= windowFrom,
    },
  };
}

/** +1 for invoices, -1 for credit notes, 0 for anything else (ignored). */
function signOf(doc: CachedDoc): number {
  if (doc.kind === 'invoice') return 1;
  if (doc.kind === 'credit') return -1;
  return 0;
}

/** First day of the window that ends on `asOf` and spans `windowDays` days (inclusive). */
export function windowStart(asOf: string, windowDays: number): string {
  return addDays(asOf, -(windowDays - 1));
}

/** Adds whole days to a yyyy-MM-dd date (UTC arithmetic, so no DST drift). */
function addDays(date: string, days: number): string {
  const start = new Date(`${date}T00:00:00Z`);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + days))
    .toISOString()
    .slice(0, 10);
}
