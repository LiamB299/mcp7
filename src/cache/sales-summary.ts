import { attributionDate, compareText, isInRange, isVoided, round2, sumOf } from './query.js';
import type { CachedDoc, CachedSale, Snapshot } from './types.js';

/*
 * Sales summary from the cached documents (ADR 0005). Pure, no I/O.
 *
 * Definitions:
 * - Only non-voided sales count (isVoided: status trimmed and upper-cased, 'VOIDED' excluded).
 * - Money is document totals and INCLUDES additional charges (freight etc.). This differs from
 *   sales_by_sku, whose SKU rows are line-only. revenueExTax = doc.totalBeforeTax,
 *   revenueIncTax = doc.total. Invoices add (+1), credit notes subtract (-1); other kinds are ignored.
 * - from/to are inclusive yyyy-MM-dd bounds. A doc with no usable date is kept only when both
 *   bounds are omitted (isInRange).
 * - dateBasis 'document': each doc is attributed to attributionDate(doc, sale) (doc date, falling
 *   back to order date). A sale contributes when at least one of its docs is kept. Each kept doc
 *   is counted in documents and in the revenue of its group. Month groups use each kept doc's own
 *   month; channel and customer groups use the sale. A sale counts toward a group's saleCount once
 *   per group it has kept docs in, and once in the overall saleCount.
 * - dateBasis 'order': a sale is kept when its orderDate is in [from, to] (undated sales only when
 *   both bounds are omitted). ALL of its docs count. Every kept sale counts toward saleCount,
 *   including uninvoiced sales (which add 0). Month groups use the order month.
 * - Group keys: month = yyyy-MM ('(no date)' when undated, sorted last). channel = trimmed channel,
 *   '(none)' when blank. customer = trimmed customer name, '(unknown)' when blank; mapKey =
 *   customerId ?? `name:${name}`; customerId is kept only when present.
 * - channel and customer groups: sorted by revenueExTax (rounded) desc, saleCount desc, key asc.
 *   The first topN are kept and the rest roll into `other` (null when none). month: all groups,
 *   key ascending.
 * - Sums are accumulated unrounded and rounded to 2 dp at the end (not the sum of rounded values).
 * - Sales are visited in id order, so `currency` is the currency of the first contributing sale.
 * - coverage.rangeCovered is true when windowFrom is null, or when from is given and from >= windowFrom.
 *
 * listRollup (labelled old basis; reproduces the sales_summary list tool exactly): every non-voided
 * sale, including sales without docs, is kept by ORDER date and sums the Cin7 list rollup
 * listInvoiceAmount (null = 0). Ordering uses localeCompare on keys and raw totals, as the old tool.
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const NO_DATE = '(no date)';
const NO_CHANNEL = '(none)';
const NO_CUSTOMER = '(unknown)';

export type SalesSummaryGroupBy = 'month' | 'channel' | 'customer';

export interface SalesSummaryOptions {
  /** Inclusive yyyy-MM-dd lower bound. Omitted = open-ended. */
  from?: string;
  /** Inclusive yyyy-MM-dd upper bound. Omitted = open-ended. */
  to?: string;
  groupBy: SalesSummaryGroupBy;
  topN: number;
  dateBasis: 'document' | 'order';
}

export interface SalesSummaryGroup {
  key: string;
  customerId?: string;
  saleCount: number;
  revenueExTax: number;
  revenueIncTax: number;
}

export interface SalesSummaryOther {
  groups: number;
  saleCount: number;
  revenueExTax: number;
  revenueIncTax: number;
}

export interface ListRollupGroup {
  key: string;
  customerId?: string;
  saleCount: number;
  invoicedTotal: number;
}

export interface ListRollupResult {
  saleCount: number;
  invoicedTotal: number;
  groups: ListRollupGroup[];
  other: { groups: number; saleCount: number; invoicedTotal: number } | null;
}

export interface SalesSummaryResult {
  from: string | null;
  to: string | null;
  groupBy: SalesSummaryGroupBy;
  dateBasis: 'document' | 'order';
  /** Currency of the first contributing sale (id order). */
  currency: string | null;
  /** Distinct contributing sales across all groups. */
  saleCount: number;
  /** Kept documents. */
  documents: { invoices: number; creditNotes: number };
  revenueExTax: number;
  revenueIncTax: number;
  groups: SalesSummaryGroup[];
  other: SalesSummaryOther | null;
  /** Contributing sales whose customer currency and currency are both set and differ. */
  nonBaseCurrencySales: number;
  /** Old list-rollup basis (order date, Cin7 InvoiceAmount), kept for comparison. */
  listRollup: ListRollupResult;
  coverage: {
    salesInSnapshot: number;
    withDetail: number;
    pendingDetail: number;
    windowFrom: string | null;
    rangeCovered: boolean;
  };
}

interface Target {
  mapKey: string;
  key: string;
  customerId?: string;
}

interface Bucket {
  key: string;
  customerId?: string;
  saleCount: number;
  revenueExTax: number;
  revenueIncTax: number;
}

interface ListBucket {
  key: string;
  customerId?: string;
  saleCount: number;
  total: number;
}

interface KeptDoc {
  day: string | null;
  doc: CachedDoc;
  sign: number;
}

export function salesSummaryFromDocs(
  snapshot: Snapshot,
  options: SalesSummaryOptions,
): SalesSummaryResult {
  const { from, to, groupBy, dateBasis } = options;
  const topLimit = Math.max(0, Math.floor(options.topN));
  const allSales = Object.values(snapshot.sales).sort((a, b) => compareText(a.id, b.id));
  const liveSales = allSales.filter((sale) => !isVoided(sale));

  const buckets = new Map<string, Bucket>();
  const contributing: CachedSale[] = [];
  const totals = { invoices: 0, creditNotes: 0, revenueExTax: 0, revenueIncTax: 0 };

  const bucketFor = (target: Target): Bucket => {
    let bucket = buckets.get(target.mapKey);
    if (!bucket) {
      bucket = {
        key: target.key,
        ...(target.customerId !== undefined ? { customerId: target.customerId } : {}),
        saleCount: 0,
        revenueExTax: 0,
        revenueIncTax: 0,
      };
      buckets.set(target.mapKey, bucket);
    }
    return bucket;
  };

  const addDoc = (bucket: Bucket, { doc, sign }: KeptDoc): void => {
    const exTax = sign * doc.totalBeforeTax;
    const incTax = sign * doc.total;
    bucket.revenueExTax += exTax;
    bucket.revenueIncTax += incTax;
    totals.revenueExTax += exTax;
    totals.revenueIncTax += incTax;
    if (sign > 0) totals.invoices++;
    else totals.creditNotes++;
  };

  for (const sale of liveSales) {
    if (dateBasis === 'document') {
      const kept: KeptDoc[] = [];
      for (const doc of sale.docs) {
        const sign = signOf(doc);
        const day = attributionDate(doc, sale);
        if (sign !== 0 && isInRange(day, from, to)) kept.push({ day, doc, sign });
      }
      if (kept.length === 0) continue;
      contributing.push(sale);

      const countedGroups = new Set<string>();
      for (const entry of kept) {
        const target = targetFor(sale, groupBy, entry.day);
        const bucket = bucketFor(target);
        if (!countedGroups.has(target.mapKey)) {
          countedGroups.add(target.mapKey);
          bucket.saleCount++;
        }
        addDoc(bucket, entry);
      }
    } else {
      const day = orderDayOf(sale);
      if (!isInRange(day, from, to)) continue;
      contributing.push(sale);

      const bucket = bucketFor(targetFor(sale, groupBy, day));
      bucket.saleCount++;
      for (const doc of sale.docs) {
        const sign = signOf(doc);
        if (sign !== 0) addDoc(bucket, { day, doc, sign });
      }
    }
  }

  let groups: SalesSummaryGroup[];
  let other: SalesSummaryOther | null = null;
  if (groupBy === 'month') {
    groups = [...buckets.values()].sort((a, b) => compareMonth(a.key, b.key)).map(toGroup);
  } else {
    const ranked = [...buckets.values()].sort(
      (a, b) =>
        round2(b.revenueExTax) - round2(a.revenueExTax) ||
        b.saleCount - a.saleCount ||
        compareText(a.key, b.key),
    );
    groups = ranked.slice(0, topLimit).map(toGroup);
    const rest = ranked.slice(topLimit);
    if (rest.length > 0) {
      other = {
        groups: rest.length,
        saleCount: sumOf(rest.map((bucket) => bucket.saleCount)),
        revenueExTax: round2(sumOf(rest.map((bucket) => bucket.revenueExTax))),
        revenueIncTax: round2(sumOf(rest.map((bucket) => bucket.revenueIncTax))),
      };
    }
  }

  const windowFrom = snapshot.windowFrom;
  return {
    from: from ?? null,
    to: to ?? null,
    groupBy,
    dateBasis,
    currency: contributing[0]?.currency ?? null,
    saleCount: contributing.length,
    documents: { invoices: totals.invoices, creditNotes: totals.creditNotes },
    revenueExTax: round2(totals.revenueExTax),
    revenueIncTax: round2(totals.revenueIncTax),
    groups,
    other,
    nonBaseCurrencySales: contributing.filter(
      (sale) =>
        sale.customerCurrency != null &&
        sale.currency != null &&
        sale.customerCurrency !== sale.currency,
    ).length,
    listRollup: listRollupFor(liveSales, from, to, groupBy, topLimit),
    coverage: {
      salesInSnapshot: allSales.length,
      withDetail: allSales.filter((sale) => sale.docs.length > 0).length,
      pendingDetail: allSales.filter((sale) => sale.pendingDetail).length,
      windowFrom,
      rangeCovered: windowFrom === null || (from !== undefined && from >= windowFrom),
    },
  };
}

/** Old list-rollup basis: order date, listInvoiceAmount, every non-voided sale (no docs needed). */
function listRollupFor(
  liveSales: CachedSale[],
  from: string | undefined,
  to: string | undefined,
  groupBy: SalesSummaryGroupBy,
  topLimit: number,
): ListRollupResult {
  const buckets = new Map<string, ListBucket>();
  let saleCount = 0;
  let invoicedTotal = 0;

  for (const sale of liveSales) {
    const day = orderDayOf(sale);
    if (!isInRange(day, from, to)) continue;
    const amount = sale.listInvoiceAmount ?? 0;
    const target = targetFor(sale, groupBy, day);
    let bucket = buckets.get(target.mapKey);
    if (!bucket) {
      bucket = {
        key: target.key,
        ...(target.customerId !== undefined ? { customerId: target.customerId } : {}),
        saleCount: 0,
        total: 0,
      };
      buckets.set(target.mapKey, bucket);
    }
    bucket.saleCount += 1;
    bucket.total += amount;
    saleCount += 1;
    invoicedTotal += amount;
  }

  const all = [...buckets.values()];
  let groups: ListBucket[];
  let other: ListRollupResult['other'] = null;
  if (groupBy === 'month') {
    groups = all.sort(
      (a, b) =>
        (a.key === NO_DATE ? 1 : 0) - (b.key === NO_DATE ? 1 : 0) || a.key.localeCompare(b.key),
    );
  } else {
    all.sort(
      (a, b) => b.total - a.total || b.saleCount - a.saleCount || a.key.localeCompare(b.key),
    );
    groups = all.slice(0, topLimit);
    const rest = all.slice(topLimit);
    if (rest.length > 0) {
      other = {
        groups: rest.length,
        saleCount: sumOf(rest.map((bucket) => bucket.saleCount)),
        invoicedTotal: round2(sumOf(rest.map((bucket) => bucket.total))),
      };
    }
  }

  return {
    saleCount,
    invoicedTotal: round2(invoicedTotal),
    groups: groups.map((bucket) => ({
      key: bucket.key,
      ...(bucket.customerId !== undefined ? { customerId: bucket.customerId } : {}),
      saleCount: bucket.saleCount,
      invoicedTotal: round2(bucket.total),
    })),
    other,
  };
}

function targetFor(sale: CachedSale, groupBy: SalesSummaryGroupBy, day: string | null): Target {
  if (groupBy === 'month') {
    const month = day === null ? NO_DATE : day.slice(0, 7);
    return { mapKey: month, key: month };
  }
  if (groupBy === 'channel') {
    const channel = sale.channel?.trim() || NO_CHANNEL;
    return { mapKey: channel, key: channel };
  }
  const name = sale.customer?.trim() || NO_CUSTOMER;
  const customerId = sale.customerId ? sale.customerId : undefined;
  return {
    mapKey: customerId ?? `name:${name}`,
    key: name,
    ...(customerId !== undefined ? { customerId } : {}),
  };
}

function toGroup(bucket: Bucket): SalesSummaryGroup {
  return {
    key: bucket.key,
    ...(bucket.customerId !== undefined ? { customerId: bucket.customerId } : {}),
    saleCount: bucket.saleCount,
    revenueExTax: round2(bucket.revenueExTax),
    revenueIncTax: round2(bucket.revenueIncTax),
  };
}

/** Month ordering: ascending, '(no date)' last. */
function compareMonth(a: string, b: string): number {
  if (a === NO_DATE || b === NO_DATE) return (a === NO_DATE ? 1 : 0) - (b === NO_DATE ? 1 : 0);
  return compareText(a, b);
}

/** Sale order date when it is a yyyy-MM-dd string, else null. */
function orderDayOf(sale: CachedSale): string | null {
  const date = sale.orderDate;
  return date !== null && DATE_PATTERN.test(date) ? date : null;
}

/** +1 for invoices, -1 for credit notes, 0 for anything else (ignored). */
function signOf(doc: CachedDoc): number {
  if (doc.kind === 'invoice') return 1;
  if (doc.kind === 'credit') return -1;
  return 0;
}
