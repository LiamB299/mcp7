import { describe, expect, it } from 'vitest';
import { receivablesFromDocs } from '../src/cache/receivables.js';
import {
  type CachedDoc,
  type CachedSale,
  emptySnapshot,
  type Snapshot,
} from '../src/cache/types.js';

const ASOF = '2026-06-30';
const OPTIONS = { asOf: ASOF, topN: 10 };

/** The date `days` days from asOf (negative = earlier). */
function shift(days: number): string {
  return new Date(Date.parse(`${ASOF}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The date `n` days before asOf. */
const ago = (n: number) => shift(-n);

function doc(kind: 'invoice' | 'credit', overrides: Partial<CachedDoc> = {}): CachedDoc {
  return {
    kind,
    number: null,
    date: '2026-03-10',
    status: 'AUTHORISED',
    total: 0,
    totalBeforeTax: 0,
    tax: 0,
    paid: null,
    dueDate: null,
    additionalCharges: 0,
    lines: [],
    ...overrides,
  };
}

function invoice(total: number, overrides: Partial<CachedDoc> = {}): CachedDoc {
  return doc('invoice', { total, ...overrides });
}

function credit(total: number, overrides: Partial<CachedDoc> = {}): CachedDoc {
  return doc('credit', { total, ...overrides });
}

function sale(id: string, overrides: Partial<CachedSale> = {}): CachedSale {
  return {
    id,
    orderNumber: `SO-${id}`,
    customerId: `cust-${id}`,
    customer: 'Example Customer',
    type: null,
    status: 'AUTHORISED',
    orderDate: '2026-03-01',
    invoiceDate: null,
    updated: '',
    updatedMs: 0,
    currency: 'NZD',
    customerCurrency: 'NZD',
    currencyRate: null,
    channel: null,
    taxCalculation: 'Exclusive',
    listInvoiceAmount: null,
    listPaidAmount: null,
    listInvoiceStatus: null,
    detailFetched: true,
    pendingDetail: false,
    docs: [],
    ...overrides,
  };
}

function snap(sales: CachedSale[], windowFrom: string | null = null): Snapshot {
  return {
    ...emptySnapshot('2026-01-01T00:00:00Z'),
    windowFrom,
    sales: Object.fromEntries(sales.map((s) => [s.id, s])),
  };
}

function run(sales: CachedSale[], options = OPTIONS, windowFrom: string | null = null) {
  return receivablesFromDocs(snap(sales, windowFrom), options);
}

const ZERO = { count: 0, total: 0 };

describe('receivablesFromDocs (document basis)', () => {
  it('buckets overdue sales at the 30/31, 60/61 and 90/91 day boundaries', () => {
    const sales = [30, 31, 60, 61, 90, 91].map((n, i) =>
      sale(String(i + 1), { docs: [invoice(10, { dueDate: ago(n) })] }),
    );
    const result = run(sales);
    expect(result.ageBuckets).toEqual({
      '1-30': { count: 1, total: 10 },
      '31-60': { count: 2, total: 20 },
      '61-90': { count: 2, total: 20 },
      '90+': { count: 1, total: 10 },
    });
    expect(result.outstanding).toEqual({ count: 6, total: 60 });
    expect(result.overdue).toEqual({ count: 6, total: 60 });
    expect(result.noDueDate).toEqual(ZERO);
  });

  it('does not treat a due date equal to asOf, or later, as overdue', () => {
    const sales = [
      sale('1', { docs: [invoice(15, { dueDate: ASOF })] }),
      sale('2', { docs: [invoice(15, { dueDate: shift(1) })] }),
    ];
    const result = run(sales);
    expect(result.outstanding).toEqual({ count: 2, total: 30 });
    expect(result.overdue).toEqual(ZERO);
    expect(result.noDueDate).toEqual(ZERO);
    expect(result.top).toEqual([]);
  });

  it('measures a partially paid invoice on its open balance', () => {
    const result = run([sale('1', { docs: [invoice(100, { paid: 40, dueDate: ago(10) })] })]);
    expect(result.outstanding).toEqual({ count: 1, total: 60 });
    expect(result.overdue).toEqual({ count: 1, total: 60 });
    expect(result.ageBuckets['1-30']).toEqual({ count: 1, total: 60 });
    expect(result.top[0]).toMatchObject({ outstanding: 60, daysOverdue: 10 });
  });

  it('ignores fully paid and overpaid sales without netting them against others', () => {
    const result = run([
      sale('1', { docs: [invoice(100, { paid: 100, dueDate: ago(5) })] }),
      sale('2', { docs: [invoice(50, { paid: 80, dueDate: ago(5) })] }),
      sale('3', { docs: [invoice(40, { dueDate: ago(5) })] }),
    ]);
    expect(result.outstanding).toEqual({ count: 1, total: 40 });
    expect(result.overdue).toEqual({ count: 1, total: 40 });
    expect(result.salesScanned).toBe(3);
  });

  it('nets a credit note against the invoice balance', () => {
    const result = run([sale('1', { docs: [invoice(100, { dueDate: ago(10) }), credit(30)] })]);
    expect(result.outstanding).toEqual({ count: 1, total: 70 });
    expect(result.overdue).toEqual({ count: 1, total: 70 });
    expect(result.top[0]).toMatchObject({ outstanding: 70 });
  });

  it('ignores a fully credited sale and does not net its credit against other sales', () => {
    const result = run([
      sale('1', { docs: [invoice(100, { dueDate: ago(10) }), credit(100)] }),
      sale('2', { docs: [invoice(50, { dueDate: ago(10) })] }),
    ]);
    expect(result.outstanding).toEqual({ count: 1, total: 50 });
    expect(result.overdue).toEqual({ count: 1, total: 50 });
  });

  it('withoutCreditNetting ignores credit notes and differs from the netted figure', () => {
    const result = run([
      // Credit note not yet reflected in paid: netted 70, gross 100.
      sale('1', { docs: [invoice(100, { paid: 0, dueDate: ago(10) }), credit(30)] }),
      // Refund already reflected in paid: netted 0 (ignored), gross 30 (double count).
      sale('2', { docs: [invoice(100, { paid: 70, dueDate: ago(10) }), credit(30)] }),
    ]);
    expect(result.outstanding).toEqual({ count: 1, total: 70 });
    expect(result.withoutCreditNetting.outstanding).toEqual({ count: 2, total: 130 });
    expect(result.withoutCreditNetting.overdue).toEqual({ count: 2, total: 130 });
  });

  it('takes the due date from the earliest invoice with an open balance only', () => {
    const result = run([
      sale('1', {
        docs: [
          // Fully paid, but due earliest: must not count.
          invoice(50, { paid: 50, dueDate: ago(100) }),
          invoice(80, { paid: 0, dueDate: ago(10) }),
          // Open balance 15, due 40 days ago: the earliest open due date.
          invoice(20, { paid: 5, dueDate: ago(40) }),
        ],
      }),
    ]);
    expect(result.outstanding).toEqual({ count: 1, total: 95 });
    expect(result.ageBuckets['31-60']).toEqual({ count: 1, total: 95 });
    expect(result.ageBuckets['90+']).toEqual(ZERO);
    expect(result.top[0]).toMatchObject({ dueDate: ago(40), daysOverdue: 40 });
  });

  it('counts a sale with no open invoice due date under noDueDate, not overdue', () => {
    const result = run([
      sale('1', { docs: [invoice(40, { dueDate: null })] }),
      // The paid invoice's due date must not count; the open one has none.
      sale('2', {
        docs: [invoice(60, { paid: 60, dueDate: ago(10) }), invoice(25, { dueDate: null })],
      }),
    ]);
    expect(result.noDueDate).toEqual({ count: 2, total: 65 });
    expect(result.outstanding).toEqual({ count: 2, total: 65 });
    expect(result.overdue).toEqual(ZERO);
    expect(result.top).toEqual([]);
  });

  it('ignores voided sales on both bases', () => {
    const result = run([
      sale('1', {
        status: 'VOIDED',
        listInvoiceAmount: 100,
        listInvoiceDueDate: ago(10),
        docs: [invoice(100, { dueDate: ago(10) })],
      }),
    ]);
    expect(result.salesScanned).toBe(0);
    expect(result.outstanding).toEqual(ZERO);
    expect(result.listRollup.salesScanned).toBe(0);
    expect(result.listRollup.outstanding).toEqual(ZERO);
  });

  it('ignores sales without an invoice on the document basis but counts them in listRollup', () => {
    const result = run([
      sale('1', { listInvoiceAmount: 25, listPaidAmount: 0, listInvoiceDueDate: ago(5), docs: [] }),
      // Credit-only sale: no invoice, so no document figures.
      sale('2', { docs: [credit(10)] }),
    ]);
    expect(result.salesScanned).toBe(0);
    expect(result.outstanding).toEqual(ZERO);
    expect(result.listRollup.salesScanned).toBe(2);
    expect(result.listRollup.outstanding).toEqual({ count: 1, total: 25 });
    expect(result.listRollup.overdue).toEqual({ count: 1, total: 25 });
  });

  it('keeps the document figures and the list rollup separate', () => {
    // Sale 6 has documents but a zero list rollup: only the document basis counts it.
    const result = run([
      sale('1', { listInvoiceAmount: 100, listPaidAmount: 40, listInvoiceDueDate: ago(10) }),
      sale('2', { listInvoiceAmount: 50, listPaidAmount: 50, listInvoiceDueDate: ago(10) }),
      sale('3', { listInvoiceAmount: 30, listPaidAmount: null, listInvoiceDueDate: null }),
      sale('4', { listInvoiceAmount: 10, listPaidAmount: null, listInvoiceDueDate: ASOF }),
      sale('5', { listInvoiceAmount: null, listPaidAmount: null, listInvoiceDueDate: ago(10) }),
      sale('6', {
        listInvoiceAmount: 0,
        listPaidAmount: 0,
        listInvoiceDueDate: ago(10),
        docs: [invoice(100, { dueDate: ago(10) })],
      }),
    ]);
    expect(result.listRollup).toEqual({
      salesScanned: 6,
      outstanding: { count: 3, total: 100 },
      overdue: { count: 1, total: 60 },
      noDueDate: { count: 1, total: 30 },
    });
    expect(result.outstanding).toEqual({ count: 1, total: 100 });
    expect(result.overdue).toEqual({ count: 1, total: 100 });
  });

  it('orders top by outstanding, then orderNumber (null as empty), then id', () => {
    const due = { dueDate: ago(10) };
    const result = run([
      sale('a', { orderNumber: 'SO-200', customerId: 'a', docs: [invoice(500, due)] }),
      sale('b', { orderNumber: 'SO-100', customerId: 'b', docs: [invoice(500, due)] }),
      sale('c', { orderNumber: null, customerId: 'c', docs: [invoice(500, due)] }),
      sale('d', { orderNumber: 'SO-300', customerId: 'd', docs: [invoice(900, due)] }),
      sale('e', { orderNumber: 'SO-900', customerId: 'e', docs: [invoice(10, due)] }),
      // Largest balance but not overdue: excluded from top.
      sale('f', {
        orderNumber: 'SO-050',
        customerId: 'f',
        docs: [invoice(700, { dueDate: shift(5) })],
      }),
      // Same order number as b, lower id: sorts before b.
      sale('0', { orderNumber: 'SO-100', customerId: '0', docs: [invoice(500, due)] }),
    ]);
    expect(result.top.map((row) => row.customerId)).toEqual(['d', 'c', '0', 'b', 'a', 'e']);
    expect(result.top[0]).toEqual({
      orderNumber: 'SO-300',
      customer: 'Example Customer',
      customerId: 'd',
      dueDate: ago(10),
      daysOverdue: 10,
      outstanding: 900,
    });
  });

  it('limits top to topN, and to nothing when topN is 0', () => {
    const sales = ['a', 'b', 'c'].map((id, i) =>
      sale(id, { customerId: id, docs: [invoice(100 + i, { dueDate: ago(10) })] }),
    );
    expect(run(sales, { asOf: ASOF, topN: 2 }).top.map((row) => row.customerId)).toEqual([
      'c',
      'b',
    ]);
    expect(run(sales, { asOf: ASOF, topN: 0 }).top).toEqual([]);
  });

  it('counts receivable sales whose customer currency differs from the sale currency', () => {
    const result = run([
      sale('1', {
        currency: 'NZD',
        customerCurrency: 'USD',
        docs: [invoice(10, { dueDate: ago(1) })],
      }),
      sale('2', { currency: 'NZD', customerCurrency: null, docs: [invoice(10)] }),
      sale('3', { currency: 'NZD', customerCurrency: 'NZD', docs: [invoice(10)] }),
      sale('4', { currency: 'NZD', customerCurrency: 'USD', docs: [invoice(10, { paid: 10 })] }),
      sale('5', {
        status: 'VOIDED',
        currency: 'NZD',
        customerCurrency: 'USD',
        docs: [invoice(10)],
      }),
    ]);
    expect(result.nonBaseCurrencySales).toBe(1);
  });

  it('reports the currency of the first receivable sale, falling back to the first live sale', () => {
    const withReceivable = run([
      sale('a', { currency: 'AUD', docs: [invoice(10, { paid: 10 })] }),
      sale('b', { currency: 'NZD', docs: [invoice(10)] }),
    ]);
    expect(withReceivable.currency).toBe('NZD');

    const noReceivable = run([sale('a', { currency: 'AUD', docs: [invoice(10, { paid: 10 })] })]);
    expect(noReceivable.currency).toBe('AUD');
  });

  it('rounds money totals to 2 dp', () => {
    const result = run([sale('1', { docs: [invoice(0.1)] }), sale('2', { docs: [invoice(0.2)] })]);
    expect(result.outstanding).toEqual({ count: 2, total: 0.3 });
    expect(result.noDueDate).toEqual({ count: 2, total: 0.3 });
  });

  it('reports coverage, with rangeCovered false when windowFrom is set', () => {
    const sales = [
      sale('1', { docs: [invoice(10, { dueDate: ago(1) })] }),
      sale('2', { docs: [], pendingDetail: true }),
      sale('3', { status: 'VOIDED', docs: [invoice(10)] }),
    ];
    expect(run(sales, OPTIONS, '2026-01-01').coverage).toEqual({
      salesInSnapshot: 3,
      withDetail: 2,
      pendingDetail: 1,
      windowFrom: '2026-01-01',
      rangeCovered: false,
    });
    expect(run(sales, OPTIONS, null).coverage).toMatchObject({
      windowFrom: null,
      rangeCovered: true,
    });
  });

  it('returns zeros for an empty snapshot without throwing', () => {
    expect(run([])).toEqual({
      asOf: ASOF,
      currency: null,
      salesScanned: 0,
      outstanding: ZERO,
      overdue: ZERO,
      noDueDate: ZERO,
      ageBuckets: { '1-30': ZERO, '31-60': ZERO, '61-90': ZERO, '90+': ZERO },
      top: [],
      nonBaseCurrencySales: 0,
      withoutCreditNetting: { outstanding: ZERO, overdue: ZERO },
      listRollup: { salesScanned: 0, outstanding: ZERO, overdue: ZERO, noDueDate: ZERO },
      coverage: {
        salesInSnapshot: 0,
        withDetail: 0,
        pendingDetail: 0,
        windowFrom: null,
        rangeCovered: true,
      },
    });
  });
});
