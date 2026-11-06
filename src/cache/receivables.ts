import { dateOnly, daysBetween } from '../dates.js';
import { compareText, isVoided, round2, sumOf } from './query.js';
import type { CachedDoc, CachedSale, Snapshot } from './types.js';

/*
 * Receivables over a cache Snapshot (ADR 0005). Pure: no I/O.
 *
 * Document basis (headline figures):
 * - Scope: non-voided sales with at least one 'invoice' doc (cached invoices are AUTHORISED or PAID).
 * - invoiced = sum of invoice totals; paid = sum of invoice paid (null counts as 0); credited = sum of
 *   credit-doc totals. Amounts are tax-inclusive (what was billed).
 * - outstanding = round2(invoiced - paid - credited). A sale is a receivable when outstanding > 0.005.
 *   Fully paid, overpaid or fully credited sales are ignored, never netted against other sales.
 * - Due date = earliest dueDate among invoices whose own open balance (total - (paid ?? 0)) > 0.005.
 *   If none has a dueDate, the sale counts under noDueDate (not overdue).
 * - daysOverdue = daysBetween(due, asOf). Overdue when > 0 (due strictly before asOf).
 *   Age buckets cover overdue sales only: '1-30' (<= 30), '31-60' (<= 60), '61-90' (<= 90), '90+'.
 * - top = overdue sales by outstanding, largest first; ties by orderNumber ascending (null as ''),
 *   then id ascending. Limited to topN.
 *
 * withoutCreditNetting: the same rules with outstanding = round2(invoiced - paid) and credit notes
 * ignored. A refunded credit note may already be reflected in `paid`, so this figure can double count
 * it; it is shown so the gap between the two bases is visible.
 *
 * listRollup (old basis, labelled): every non-voided sale, including sales with no documents, using
 * the list rollups listInvoiceAmount - listPaidAmount (null = 0) and listInvoiceDueDate. Same overdue
 * and no-due-date rules. This reproduces the previous receivables_overdue tool. Cin7 rollups disagree
 * with the documents on about 30% of sandbox sales.
 *
 * coverage.rangeCovered is true only when windowFrom is null: receivables need all history.
 * Sales are visited in id order so results are deterministic. Money is accumulated raw and rounded
 * to 2 dp at the end; counts are integers.
 */

const BUCKETS = ['1-30', '31-60', '61-90', '90+'] as const;
export type AgeBucket = (typeof BUCKETS)[number];

/** Balances at or below this are treated as settled. */
const SETTLED = 0.005;

export interface Money {
  count: number;
  total: number;
}

export interface ReceivablesOptions {
  /** Date overdue is measured against, yyyy-MM-dd. */
  asOf: string;
  /** How many of the largest overdue sales to list. */
  topN: number;
}

export interface ReceivableRow {
  orderNumber: string | null;
  customer: string | null;
  customerId: string | null;
  dueDate: string;
  daysOverdue: number;
  outstanding: number;
}

export interface ReceivablesResult {
  asOf: string;
  /** Currency of the first receivable sale in id order, else of the first non-voided sale, else null. */
  currency: string | null;
  /** Non-voided sales with at least one invoice (document basis). */
  salesScanned: number;
  outstanding: Money;
  overdue: Money;
  noDueDate: Money;
  ageBuckets: Record<AgeBucket, Money>;
  top: ReceivableRow[];
  /** Receivable sales whose customer currency and sale currency are both set and differ. */
  nonBaseCurrencySales: number;
  withoutCreditNetting: { outstanding: Money; overdue: Money };
  /** Old list-rollup basis (labelled): see the header comment. */
  listRollup: {
    salesScanned: number;
    outstanding: Money;
    overdue: Money;
    noDueDate: Money;
  };
  coverage: {
    salesInSnapshot: number;
    withDetail: number;
    pendingDetail: number;
    windowFrom: string | null;
    /** True only when windowFrom is null (all history loaded). */
    rangeCovered: boolean;
  };
}

interface Acc {
  count: number;
  total: number;
}

interface Tally {
  outstanding: Acc;
  overdue: Acc;
  noDueDate: Acc;
  buckets: Record<AgeBucket, Acc>;
}

interface DocFigures {
  invoiced: number;
  paid: number;
  credited: number;
  /** Earliest dueDate among invoices with an open balance. */
  due: string | undefined;
}

interface Candidate {
  sale: CachedSale;
  outstanding: number;
  dueDate: string;
  daysOverdue: number;
}

export function receivablesFromDocs(
  snapshot: Snapshot,
  options: ReceivablesOptions,
): ReceivablesResult {
  const { asOf } = options;
  const topN = Math.max(0, Math.floor(options.topN));
  const sales = Object.values(snapshot.sales).sort((a, b) => compareText(a.id, b.id));

  const net = newTally();
  const gross = newTally();
  const list = newTally();
  const candidates: Candidate[] = [];
  let salesScanned = 0;
  let listScanned = 0;
  let nonBaseCurrencySales = 0;
  let firstReceivable: CachedSale | null = null;
  let firstLive: CachedSale | null = null;

  for (const sale of sales) {
    if (isVoided(sale)) continue;
    firstLive ??= sale;

    listScanned++;
    const listBalance = round2((sale.listInvoiceAmount ?? 0) - (sale.listPaidAmount ?? 0));
    if (listBalance > SETTLED) {
      const listDue = dateOnly(sale.listInvoiceDueDate);
      tallyBalance(list, listBalance, listDue === undefined ? null : daysBetween(listDue, asOf));
    }

    const figures = documentFigures(sale);
    if (figures === null) continue;
    salesScanned++;

    const daysOverdue = figures.due === undefined ? null : daysBetween(figures.due, asOf);

    const outstanding = round2(figures.invoiced - figures.paid - figures.credited);
    if (outstanding > SETTLED) {
      firstReceivable ??= sale;
      if (isNonBaseCurrency(sale)) nonBaseCurrencySales++;
      tallyBalance(net, outstanding, daysOverdue);
      if (figures.due !== undefined && daysOverdue !== null && daysOverdue > 0) {
        candidates.push({ sale, outstanding, dueDate: figures.due, daysOverdue });
      }
    }

    const grossBalance = round2(figures.invoiced - figures.paid);
    if (grossBalance > SETTLED) tallyBalance(gross, grossBalance, daysOverdue);
  }

  candidates.sort(
    (x, y) =>
      y.outstanding - x.outstanding ||
      compareText(x.sale.orderNumber ?? '', y.sale.orderNumber ?? '') ||
      compareText(x.sale.id, y.sale.id),
  );
  const top: ReceivableRow[] = candidates.slice(0, topN).map((candidate) => ({
    orderNumber: candidate.sale.orderNumber,
    customer: candidate.sale.customer,
    customerId: candidate.sale.customerId,
    dueDate: candidate.dueDate,
    daysOverdue: candidate.daysOverdue,
    outstanding: candidate.outstanding,
  }));

  const all = Object.values(snapshot.sales);
  const basisSale = firstReceivable ?? firstLive;

  return {
    asOf,
    currency: basisSale?.currency ?? null,
    salesScanned,
    outstanding: toMoney(net.outstanding),
    overdue: toMoney(net.overdue),
    noDueDate: toMoney(net.noDueDate),
    ageBuckets: {
      '1-30': toMoney(net.buckets['1-30']),
      '31-60': toMoney(net.buckets['31-60']),
      '61-90': toMoney(net.buckets['61-90']),
      '90+': toMoney(net.buckets['90+']),
    },
    top,
    nonBaseCurrencySales,
    withoutCreditNetting: {
      outstanding: toMoney(gross.outstanding),
      overdue: toMoney(gross.overdue),
    },
    listRollup: {
      salesScanned: listScanned,
      outstanding: toMoney(list.outstanding),
      overdue: toMoney(list.overdue),
      noDueDate: toMoney(list.noDueDate),
    },
    coverage: {
      salesInSnapshot: all.length,
      withDetail: all.filter((sale) => sale.docs.length > 0).length,
      pendingDetail: all.filter((sale) => sale.pendingDetail).length,
      windowFrom: snapshot.windowFrom,
      rangeCovered: snapshot.windowFrom === null,
    },
  };
}

/** Invoice and credit figures for a sale, or null when it has no invoice. */
function documentFigures(sale: CachedSale): DocFigures | null {
  const invoices = sale.docs.filter((doc) => doc.kind === 'invoice');
  if (invoices.length === 0) return null;
  const credits = sale.docs.filter((doc) => doc.kind === 'credit');
  return {
    invoiced: sumOf(invoices.map((doc) => doc.total)),
    paid: sumOf(invoices.map((doc) => doc.paid ?? 0)),
    credited: sumOf(credits.map((doc) => doc.total)),
    due: earliestOpenDue(invoices),
  };
}

/** Earliest yyyy-MM-dd dueDate among invoices that still have an open balance. */
function earliestOpenDue(invoices: CachedDoc[]): string | undefined {
  let earliest: string | undefined;
  for (const invoice of invoices) {
    if (!(invoice.total - (invoice.paid ?? 0) > SETTLED)) continue;
    const due = dateOnly(invoice.dueDate);
    if (due !== undefined && (earliest === undefined || due < earliest)) earliest = due;
  }
  return earliest;
}

/**
 * Adds one receivable. `days` is daysBetween(due, asOf), or null when there is no due date.
 * Overdue only when days > 0.
 */
function tallyBalance(tally: Tally, balance: number, days: number | null): void {
  add(tally.outstanding, balance);
  if (days === null) {
    add(tally.noDueDate, balance);
    return;
  }
  if (days <= 0) return;
  add(tally.overdue, balance);
  add(tally.buckets[bucketFor(days)], balance);
}

function bucketFor(days: number): AgeBucket {
  if (days <= 30) return '1-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

function isNonBaseCurrency(sale: CachedSale): boolean {
  return (
    sale.customerCurrency != null &&
    sale.currency != null &&
    sale.customerCurrency !== sale.currency
  );
}

function newAcc(): Acc {
  return { count: 0, total: 0 };
}

function newTally(): Tally {
  return {
    outstanding: newAcc(),
    overdue: newAcc(),
    noDueDate: newAcc(),
    buckets: { '1-30': newAcc(), '31-60': newAcc(), '61-90': newAcc(), '90+': newAcc() },
  };
}

function add(acc: Acc, amount: number): void {
  acc.count += 1;
  acc.total += amount;
}

function toMoney(acc: Acc): Money {
  return { count: acc.count, total: round2(acc.total) };
}
