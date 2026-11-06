import { describe, expect, it } from 'vitest';
import { revenueBySku, rollupDrift } from '../src/cache/query.js';
import {
  type CachedDoc,
  type CachedLine,
  type CachedSale,
  emptySnapshot,
  type Snapshot,
} from '../src/cache/types.js';

function line(overrides: Partial<CachedLine> = {}): CachedLine {
  return {
    sku: 'SKU-A',
    productId: null,
    name: 'Widget A',
    quantity: 1,
    price: 0,
    discount: 0,
    tax: 0,
    total: 0,
    avgCost: 0,
    ...overrides,
  };
}

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

function sale(id: string, overrides: Partial<CachedSale> = {}): CachedSale {
  return {
    id,
    orderNumber: `SO-${id}`,
    customerId: null,
    customer: null,
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

describe('revenueBySku', () => {
  it('uses ex-tax line revenue: Exclusive totals are already ex-tax', () => {
    const s = snap([
      sale('1', {
        taxCalculation: 'Exclusive',
        docs: [doc('invoice', { lines: [line({ total: 100, tax: 10, avgCost: 40 })] })],
      }),
    ]);
    const result = revenueBySku(s, {});
    expect(result.rows[0]?.revenueExTax).toBe(100);
    expect(result.rows[0]?.cost).toBe(40);
  });

  it('subtracts line tax when taxCalculation is Inclusive', () => {
    const s = snap([
      sale('1', {
        taxCalculation: 'Inclusive',
        docs: [doc('invoice', { lines: [line({ total: 110, tax: 10, avgCost: 40 })] })],
      }),
    ]);
    const result = revenueBySku(s, {});
    expect(result.rows[0]?.revenueExTax).toBe(100);
    expect(result.rows[0]?.margin).toBe(60);
  });

  it('treats null taxCalculation as Exclusive', () => {
    const s = snap([
      sale('1', {
        taxCalculation: null,
        docs: [doc('invoice', { lines: [line({ total: 110, tax: 10 })] })],
      }),
    ]);
    expect(revenueBySku(s, {}).rows[0]?.revenueExTax).toBe(110);
  });

  it('subtracts credit-note revenue, quantity and cost', () => {
    const s = snap([
      sale('1', {
        docs: [
          doc('invoice', { lines: [line({ total: 100, quantity: 2, avgCost: 30 })] }),
          doc('credit', { lines: [line({ total: 50, quantity: 1, avgCost: 30 })] }),
        ],
      }),
    ]);
    const result = revenueBySku(s, {});
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual({
      sku: 'SKU-A',
      name: 'Widget A',
      revenueExTax: 50,
      quantity: 1,
      cost: 30,
      margin: 20,
      marginPct: 40,
    });
    expect(result.documents).toEqual({ invoices: 1, creditNotes: 1 });
    expect(result.salesContributing).toBe(1);
  });

  it('attributes revenue by document date, not sale order date', () => {
    const s = snap([
      // Ordered in February, but invoiced in March: outside the February range.
      sale('1', {
        orderDate: '2026-02-20',
        docs: [doc('invoice', { date: '2026-03-05', lines: [line({ sku: 'LATE', total: 100 })] })],
      }),
      // Invoice dated January (outside), credit note dated February (inside).
      sale('2', {
        orderDate: '2026-01-15',
        docs: [
          doc('invoice', {
            date: '2026-01-15',
            lines: [line({ sku: 'B', total: 200, quantity: 2, avgCost: 50 })],
          }),
          doc('credit', {
            date: '2026-02-10',
            lines: [line({ sku: 'B', total: 80, quantity: 1, avgCost: 50 })],
          }),
        ],
      }),
    ]);
    const result = revenueBySku(s, { from: '2026-02-01', to: '2026-02-28' });
    expect(result.rows.map((r) => r.sku)).toEqual(['B']);
    expect(result.rows[0]).toMatchObject({
      revenueExTax: -80,
      quantity: -1,
      cost: -50,
      margin: -30,
    });
    expect(result.documents).toEqual({ invoices: 0, creditNotes: 1 });
    expect(result.salesContributing).toBe(1);
  });

  it('falls back to the order date when the document has no date', () => {
    const s = snap([
      sale('1', {
        orderDate: '2026-02-14',
        docs: [doc('invoice', { date: null, lines: [line({ total: 60 })] })],
      }),
    ]);
    expect(revenueBySku(s, { from: '2026-02-01', to: '2026-02-28' }).rows[0]?.revenueExTax).toBe(
      60,
    );
    expect(revenueBySku(s, { from: '2026-03-01' }).rows).toHaveLength(0);
  });

  it('keeps an undated document only when both bounds are omitted', () => {
    const s = snap([
      sale('1', {
        orderDate: null,
        docs: [doc('invoice', { date: null, lines: [line({ total: 60 })] })],
      }),
    ]);
    expect(revenueBySku(s, {}).rows[0]?.revenueExTax).toBe(60);
    expect(revenueBySku(s, { from: '2026-01-01' }).rows).toHaveLength(0);
    expect(revenueBySku(s, { to: '2026-12-31' }).rows).toHaveLength(0);
  });

  it('includes both bounds inclusively', () => {
    const s = snap([
      sale('1', {
        docs: [
          doc('invoice', { date: '2026-01-31', lines: [line({ sku: 'C', total: 80 })] }),
          doc('invoice', { date: '2026-02-01', lines: [line({ sku: 'C', total: 10 })] }),
          doc('invoice', { date: '2026-02-28', lines: [line({ sku: 'C', total: 20 })] }),
          doc('invoice', { date: '2026-03-01', lines: [line({ sku: 'C', total: 40 })] }),
        ],
      }),
    ]);
    const result = revenueBySku(s, { from: '2026-02-01', to: '2026-02-28' });
    expect(result.rows[0]?.revenueExTax).toBe(30);
    expect(result.from).toBe('2026-02-01');
    expect(result.to).toBe('2026-02-28');
  });

  it('excludes voided sales, ignoring case and whitespace', () => {
    const s = snap([
      sale('1', { status: ' voided ', docs: [doc('invoice', { lines: [line({ total: 500 })] })] }),
      sale('2', { docs: [doc('invoice', { lines: [line({ total: 10 })] })] }),
    ]);
    const result = revenueBySku(s, {});
    expect(result.rows[0]?.revenueExTax).toBe(10);
    expect(result.salesContributing).toBe(1);
  });

  it('groups lines with no sku under (no sku)', () => {
    const s = snap([
      sale('1', {
        docs: [doc('invoice', { lines: [line({ sku: null, name: null, total: 25 })] })],
      }),
    ]);
    const result = revenueBySku(s, {});
    expect(result.rows[0]).toMatchObject({ sku: '(no sku)', name: null, revenueExTax: 25 });
  });

  it('keeps the first non-null name seen for a SKU', () => {
    const s = snap([
      sale('1', { docs: [doc('invoice', { lines: [line({ name: null, total: 10 })] })] }),
      sale('2', { docs: [doc('invoice', { lines: [line({ name: 'Named', total: 10 })] })] }),
      sale('3', { docs: [doc('invoice', { lines: [line({ name: 'Other', total: 10 })] })] }),
    ]);
    expect(revenueBySku(s, {}).rows[0]?.name).toBe('Named');
  });

  describe('sorting, topN and other', () => {
    // P: revenue 100, margin 10, qty 5
    // Q: revenue 50, margin 50, qty 10
    // R: revenue 100, margin 80, qty 1 (ties P on revenue)
    const data = snap([
      sale('1', {
        docs: [
          doc('invoice', {
            lines: [
              line({ sku: 'P', total: 100, quantity: 5, avgCost: 18 }),
              line({ sku: 'Q', total: 50, quantity: 10, avgCost: 0 }),
              line({ sku: 'R', total: 100, quantity: 1, avgCost: 20 }),
            ],
          }),
        ],
      }),
    ]);

    it('sorts by revenue with sku tie-break', () => {
      expect(revenueBySku(data, {}).rows.map((r) => r.sku)).toEqual(['P', 'R', 'Q']);
    });

    it('sorts by margin', () => {
      expect(revenueBySku(data, { sortBy: 'margin' }).rows.map((r) => r.sku)).toEqual([
        'R',
        'Q',
        'P',
      ]);
    });

    it('sorts by quantity', () => {
      expect(revenueBySku(data, { sortBy: 'quantity' }).rows.map((r) => r.sku)).toEqual([
        'Q',
        'P',
        'R',
      ]);
    });

    it('breaks ties by sku ascending', () => {
      const tied = snap([
        sale('1', {
          docs: [
            doc('invoice', {
              lines: [line({ sku: 'Z', total: 10 }), line({ sku: 'M', total: 10 })],
            }),
          ],
        }),
      ]);
      expect(revenueBySku(tied, {}).rows.map((r) => r.sku)).toEqual(['M', 'Z']);
    });

    it('limits rows to topN and rolls the rest into other, with totals over all SKUs', () => {
      const result = revenueBySku(data, { topN: 1 });
      expect(result.rows.map((r) => r.sku)).toEqual(['P']);
      expect(result.other).toEqual({ skus: 2, revenueExTax: 150, quantity: 11, margin: 130 });
      expect(result.totals).toMatchObject({
        revenueExTax: 250,
        cost: 110,
        margin: 140,
        quantity: 16,
      });
    });

    it('returns other as null when no SKUs lie beyond topN', () => {
      expect(revenueBySku(data, { topN: 3 }).other).toBeNull();
      expect(revenueBySku(data, {}).other).toBeNull();
    });
  });

  it('returns null margin percentage when revenue is zero', () => {
    const s = snap([
      sale('1', {
        docs: [doc('invoice', { lines: [line({ sku: 'Z', total: 0, quantity: 1, avgCost: 5 })] })],
      }),
    ]);
    expect(revenueBySku(s, {}).rows[0]).toMatchObject({
      revenueExTax: 0,
      cost: 5,
      margin: -5,
      marginPct: null,
    });
  });

  it('rounds money to 2 dp and quantity to 4 dp', () => {
    const s = snap([
      sale('1', {
        docs: [doc('invoice', { lines: [line({ total: 10.006, quantity: 1.23456, avgCost: 1 })] })],
      }),
    ]);
    const row = revenueBySku(s, {}).rows[0];
    expect(row?.quantity).toBe(1.2346);
    expect(row?.revenueExTax).toBe(10.01);
  });

  it('signs additionalCharges by document kind', () => {
    const s = snap([
      sale('1', {
        docs: [
          doc('invoice', { additionalCharges: 15, lines: [line({ total: 100 })] }),
          doc('credit', { additionalCharges: 4, lines: [line({ total: 10 })] }),
        ],
      }),
    ]);
    expect(revenueBySku(s, {}).totals.additionalCharges).toBe(11);
  });

  it('counts non-base currency sales among contributing sales only', () => {
    const s = snap([
      sale('a', {
        currency: 'AUD',
        customerCurrency: 'AUD',
        docs: [doc('invoice', { lines: [line({ total: 1 })] })],
      }),
      sale('b', {
        currency: 'NZD',
        customerCurrency: 'USD',
        docs: [doc('invoice', { lines: [line({ total: 1 })] })],
      }),
      sale('c', {
        currency: 'NZD',
        customerCurrency: null,
        docs: [doc('invoice', { lines: [line({ total: 1 })] })],
      }),
      sale('d', {
        currency: 'NZD',
        customerCurrency: 'USD',
        status: 'VOIDED',
        docs: [doc('invoice', { lines: [line({ total: 1 })] })],
      }),
      sale('e', { currency: 'NZD', customerCurrency: 'USD', docs: [] }),
    ]);
    const result = revenueBySku(s, {});
    expect(result.nonBaseCurrencySales).toBe(1);
    expect(result.salesContributing).toBe(3);
  });

  it('reports the currency of the first contributing sale by id order', () => {
    const s = snap([
      sale('b', { currency: 'NZD', docs: [doc('invoice', { lines: [line({ total: 1 })] })] }),
      sale('a', { currency: 'AUD', docs: [doc('invoice', { lines: [line({ total: 1 })] })] }),
    ]);
    expect(revenueBySku(s, {}).currency).toBe('AUD');
  });

  it('reports coverage counts', () => {
    const s = snap(
      [
        sale('1', { docs: [doc('invoice', { lines: [line({ total: 1 })] })] }),
        sale('2', { docs: [], pendingDetail: true }),
        sale('3', { status: 'VOIDED', docs: [doc('invoice', { lines: [line({ total: 1 })] })] }),
      ],
      '2026-01-01',
    );
    expect(revenueBySku(s, {}).coverage).toEqual({
      salesInSnapshot: 3,
      withDetail: 2,
      pendingDetail: 1,
      windowFrom: '2026-01-01',
      rangeCovered: false,
    });
  });

  describe('rangeCovered', () => {
    const withWindow = (windowFrom: string | null) =>
      snap([sale('1', { docs: [doc('invoice', { lines: [line({ total: 1 })] })] })], windowFrom);

    it('is true when windowFrom is null (all history loaded)', () => {
      expect(revenueBySku(withWindow(null), {}).coverage.rangeCovered).toBe(true);
      expect(revenueBySku(withWindow(null), { from: '2015-01-01' }).coverage.rangeCovered).toBe(
        true,
      );
    });

    it('is true when from is on or after windowFrom', () => {
      expect(
        revenueBySku(withWindow('2026-01-01'), { from: '2026-02-01' }).coverage.rangeCovered,
      ).toBe(true);
      expect(
        revenueBySku(withWindow('2026-01-01'), { from: '2026-01-01' }).coverage.rangeCovered,
      ).toBe(true);
    });

    it('is false when from is before windowFrom', () => {
      expect(
        revenueBySku(withWindow('2026-01-01'), { from: '2025-12-31' }).coverage.rangeCovered,
      ).toBe(false);
    });

    it('is false when from is omitted and windowFrom is set', () => {
      expect(revenueBySku(withWindow('2026-01-01'), {}).coverage.rangeCovered).toBe(false);
      expect(
        revenueBySku(withWindow('2026-01-01'), { to: '2026-06-30' }).coverage.rangeCovered,
      ).toBe(false);
    });
  });

  it('returns zeros for an empty snapshot without throwing', () => {
    const result = revenueBySku(emptySnapshot('2026-01-01T00:00:00Z'), {});
    expect(result).toEqual({
      from: null,
      to: null,
      currency: null,
      salesContributing: 0,
      documents: { invoices: 0, creditNotes: 0 },
      totals: { revenueExTax: 0, cost: 0, margin: 0, quantity: 0, additionalCharges: 0 },
      rows: [],
      other: null,
      nonBaseCurrencySales: 0,
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

describe('rollupDrift', () => {
  const s = snap([
    // Matches: invoice 100, list 100.
    sale('01', {
      orderNumber: 'OK',
      listInvoiceAmount: 100,
      docs: [doc('invoice', { total: 100 })],
    }),
    // Within tolerance (0.015 < 0.02): not differing.
    sale('02', {
      orderNumber: 'TOL',
      listInvoiceAmount: 100.015,
      docs: [doc('invoice', { total: 100 })],
    }),
    // Credit note not netted by list: list = invoice 100, documentNet 70. Gap 30.
    sale('03', {
      orderNumber: 'CN',
      listInvoiceAmount: 100,
      docs: [doc('invoice', { total: 100 }), doc('credit', { total: 30 })],
    }),
    // List zero despite invoice 50. Gap 50.
    sale('04', {
      orderNumber: 'ZERO',
      listInvoiceAmount: 0,
      docs: [doc('invoice', { total: 50 })],
    }),
    // Other: list 60 vs documentNet 80. Gap 20.
    sale('05', {
      orderNumber: 'OTHER',
      listInvoiceAmount: 60,
      docs: [doc('invoice', { total: 80 })],
    }),
    // Other: list 210 vs documentNet 200. Gap 10.
    sale('06', {
      orderNumber: 'OTHER2',
      listInvoiceAmount: 210,
      docs: [doc('invoice', { total: 200 })],
    }),
    // Voided: excluded.
    sale('07', {
      orderNumber: 'VOID',
      status: 'VOIDED',
      listInvoiceAmount: 0,
      docs: [doc('invoice', { total: 99 })],
    }),
    // Credit only, no invoice: excluded from compared.
    sale('08', {
      orderNumber: 'CREDITONLY',
      listInvoiceAmount: 0,
      docs: [doc('credit', { total: 10 })],
    }),
  ]);

  it('counts compared sales and categorises differences', () => {
    const result = rollupDrift(s);
    expect(result).toMatchObject({
      compared: 6,
      differing: 4,
      creditNotesNotNetted: 1,
      zeroDespiteInvoice: 1,
      other: 2,
    });
  });

  it('lists differences by absolute gap, with order number and amounts only', () => {
    const result = rollupDrift(s);
    expect(result.top).toEqual([
      { orderNumber: 'ZERO', listInvoiceAmount: 0, documentNet: 50 },
      { orderNumber: 'CN', listInvoiceAmount: 100, documentNet: 70 },
      { orderNumber: 'OTHER', listInvoiceAmount: 60, documentNet: 80 },
      { orderNumber: 'OTHER2', listInvoiceAmount: 210, documentNet: 200 },
    ]);
  });

  it('limits the top list', () => {
    expect(rollupDrift(s, { top: 2 }).top.map((t) => t.orderNumber)).toEqual(['ZERO', 'CN']);
    expect(rollupDrift(s, { top: 0 }).top).toEqual([]);
  });

  it('returns zeros for an empty snapshot without throwing', () => {
    expect(rollupDrift(emptySnapshot('2026-01-01T00:00:00Z'))).toEqual({
      compared: 0,
      differing: 0,
      creditNotesNotNetted: 0,
      zeroDespiteInvoice: 0,
      other: 0,
      top: [],
    });
  });
});
