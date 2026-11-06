import { describe, expect, it } from 'vitest';
import {
  type CachedDoc,
  type CachedLine,
  type CachedSale,
  emptySnapshot,
  type Snapshot,
} from '../src/cache/types.js';
import { salesVelocity } from '../src/cache/velocity.js';

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

/** Window of 90 days ending 2026-03-31 starts 2026-01-01. */
const ASOF = '2026-03-31';
const OPTS = { asOf: ASOF, windowDays: 90 };

describe('salesVelocity', () => {
  it('nets credit-note quantity off invoice quantity', () => {
    const s = snap([
      sale('1', {
        docs: [
          doc('invoice', { lines: [line({ productId: 'P-1', quantity: 5 })] }),
          doc('credit', { lines: [line({ productId: 'P-1', quantity: 2 })] }),
        ],
      }),
    ]);
    const result = salesVelocity(s, OPTS);
    expect(result.entries).toEqual([
      {
        productId: 'P-1',
        sku: 'SKU-A',
        name: 'Widget A',
        netUnits: 3,
        invoicedUnits: 5,
        creditedUnits: 2,
        saleCount: 1,
      },
    ]);
  });

  it('includes both window bounds and excludes the days either side', () => {
    const s = snap([
      sale('1', {
        docs: [
          doc('invoice', {
            date: '2026-02-28',
            lines: [line({ productId: 'P-1', quantity: 100 })],
          }),
          doc('invoice', { date: '2026-03-01', lines: [line({ productId: 'P-1', quantity: 1 })] }),
          doc('invoice', { date: '2026-03-31', lines: [line({ productId: 'P-1', quantity: 10 })] }),
          doc('invoice', {
            date: '2026-04-01',
            lines: [line({ productId: 'P-1', quantity: 100 })],
          }),
        ],
      }),
    ]);
    const result = salesVelocity(s, { asOf: '2026-03-31', windowDays: 31 });
    expect(result.from).toBe('2026-03-01');
    expect(result.to).toBe('2026-03-31');
    expect(result.days).toBe(31);
    expect(result.entries[0]?.invoicedUnits).toBe(11);
  });

  it('computes the start date across a month and leap-day boundary', () => {
    const s = snap([
      sale('1', {
        docs: [
          doc('invoice', {
            date: '2024-02-28',
            lines: [line({ productId: 'P-1', quantity: 100 })],
          }),
          doc('invoice', { date: '2024-02-29', lines: [line({ productId: 'P-1', quantity: 1 })] }),
        ],
      }),
    ]);
    const result = salesVelocity(s, { asOf: '2024-03-01', windowDays: 3 });
    expect(result.from).toBe('2024-02-28');
    expect(result.entries[0]?.invoicedUnits).toBe(101);
  });

  it('treats windowDays 1 as a single day', () => {
    const s = snap([
      sale('1', {
        docs: [
          doc('invoice', {
            date: '2026-03-09',
            lines: [line({ productId: 'P-1', quantity: 100 })],
          }),
          doc('invoice', { date: '2026-03-10', lines: [line({ productId: 'P-1', quantity: 7 })] }),
          doc('invoice', {
            date: '2026-03-11',
            lines: [line({ productId: 'P-1', quantity: 100 })],
          }),
        ],
      }),
    ]);
    const result = salesVelocity(s, { asOf: '2026-03-10', windowDays: 1 });
    expect(result.from).toBe('2026-03-10');
    expect(result.to).toBe('2026-03-10');
    expect(result.entries[0]?.invoicedUnits).toBe(7);
  });

  it('ignores voided sales', () => {
    const s = snap([
      sale('1', {
        status: ' voided ',
        docs: [doc('invoice', { lines: [line({ productId: 'P-1', quantity: 500 })] })],
      }),
      sale('2', { docs: [doc('invoice', { lines: [line({ productId: 'P-1', quantity: 3 })] })] }),
    ]);
    const result = salesVelocity(s, OPTS);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({ invoicedUnits: 3, saleCount: 1 });
  });

  describe('document dates', () => {
    it('uses doc.date, not the order date, when the doc has one', () => {
      const s = snap([
        sale('1', {
          orderDate: '2026-03-15',
          docs: [doc('invoice', { date: '2026-02-01', lines: [line({ productId: 'P-1' })] })],
        }),
      ]);
      expect(salesVelocity(s, { asOf: '2026-03-31', windowDays: 31 }).entries).toHaveLength(0);
    });

    it('falls back to the order date when the doc has no date', () => {
      const s = snap([
        sale('1', {
          orderDate: '2026-03-15',
          docs: [doc('invoice', { date: null, lines: [line({ productId: 'P-1', quantity: 4 })] })],
        }),
      ]);
      const result = salesVelocity(s, { asOf: '2026-03-31', windowDays: 31 });
      expect(result.entries[0]?.invoicedUnits).toBe(4);
    });

    it('excludes a doc with no date at all, even with a window covering everything', () => {
      const s = snap([
        sale('1', {
          orderDate: null,
          docs: [doc('invoice', { date: null, lines: [line({ productId: 'P-1' })] })],
        }),
      ]);
      const result = salesVelocity(s, { asOf: '2026-03-31', windowDays: 3650 });
      expect(result.entries).toHaveLength(0);
      expect(result.noProduct).toEqual({ netUnits: 0, invoicedUnits: 0, creditedUnits: 0 });
    });
  });

  describe('keys', () => {
    it('keys on productId when present and on SKU when only a SKU is present', () => {
      const s = snap([
        sale('1', {
          docs: [
            doc('invoice', {
              lines: [
                line({ productId: 'P-1', sku: 'SKU-1', name: 'One', quantity: 2 }),
                line({ productId: null, sku: 'SKU-2', name: 'Two', quantity: 3 }),
              ],
            }),
          ],
        }),
      ]);
      expect(salesVelocity(s, OPTS).entries).toEqual([
        {
          productId: 'P-1',
          sku: 'SKU-1',
          name: 'One',
          netUnits: 2,
          invoicedUnits: 2,
          creditedUnits: 0,
          saleCount: 1,
        },
        {
          productId: null,
          sku: 'SKU-2',
          name: 'Two',
          netUnits: 3,
          invoicedUnits: 3,
          creditedUnits: 0,
          saleCount: 1,
        },
      ]);
    });

    it('merges lines with the same productId and different SKUs, first SKU wins', () => {
      const s = snap([
        sale('1', {
          docs: [
            doc('invoice', {
              lines: [line({ productId: 'P-1', sku: 'FIRST', name: null, quantity: 1 })],
            }),
          ],
        }),
        sale('2', {
          docs: [
            doc('invoice', {
              lines: [line({ productId: 'P-1', sku: 'SECOND', name: 'Named', quantity: 2 })],
            }),
          ],
        }),
      ]);
      const result = salesVelocity(s, OPTS);
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]).toEqual({
        productId: 'P-1',
        sku: 'FIRST',
        name: 'Named',
        netUnits: 3,
        invoicedUnits: 3,
        creditedUnits: 0,
        saleCount: 2,
      });
    });

    it('sends lines with neither productId nor SKU to noProduct and creates no entry', () => {
      const s = snap([
        sale('1', {
          docs: [
            doc('invoice', { lines: [line({ productId: null, sku: null, quantity: 3 })] }),
            doc('credit', { lines: [line({ productId: null, sku: null, quantity: 1 })] }),
          ],
        }),
      ]);
      const result = salesVelocity(s, OPTS);
      expect(result.entries).toEqual([]);
      expect(result.noProduct).toEqual({ netUnits: 2, invoicedUnits: 3, creditedUnits: 1 });
    });
  });

  it('reports negative net when credits exceed invoices, including credit-only products', () => {
    const s = snap([
      sale('1', {
        docs: [
          doc('invoice', { lines: [line({ productId: 'P-1', quantity: 2 })] }),
          doc('credit', { lines: [line({ productId: 'P-1', quantity: 5 })] }),
          doc('credit', { lines: [line({ productId: 'P-2', quantity: 4 })] }),
        ],
      }),
    ]);
    const result = salesVelocity(s, OPTS);
    expect(
      result.entries.map((e) => [e.productId, e.netUnits, e.invoicedUnits, e.creditedUnits]),
    ).toEqual([
      ['P-1', -3, 2, 5],
      ['P-2', -4, 0, 4],
    ]);
  });

  it('counts distinct sales for saleCount', () => {
    const s = snap([
      sale('1', {
        docs: [
          doc('invoice', {
            lines: [
              line({ productId: 'P-1', quantity: 1 }),
              line({ productId: 'P-1', quantity: 2 }),
            ],
          }),
          doc('invoice', { lines: [line({ productId: 'P-1', quantity: 3 })] }),
        ],
      }),
      sale('2', { docs: [doc('invoice', { lines: [line({ productId: 'P-1', quantity: 4 })] })] }),
    ]);
    const result = salesVelocity(s, OPTS);
    expect(result.entries[0]).toMatchObject({ invoicedUnits: 10, saleCount: 2 });
  });

  it('orders entries by key ascending, independent of insertion order', () => {
    const sales = [
      sale('1', { docs: [doc('invoice', { lines: [line({ productId: 'P-3' })] })] }),
      sale('2', {
        docs: [doc('invoice', { lines: [line({ productId: null, sku: 'Z-SKU' })] })],
      }),
      sale('3', { docs: [doc('invoice', { lines: [line({ productId: 'P-1' })] })] }),
      sale('4', { docs: [doc('invoice', { lines: [line({ productId: 'P-2' })] })] }),
    ];
    const forward = salesVelocity(snap(sales), OPTS);
    const reversed = salesVelocity(snap([...sales].reverse()), OPTS);
    expect(forward.entries.map((e) => e.productId ?? e.sku)).toEqual([
      'P-1',
      'P-2',
      'P-3',
      'Z-SKU',
    ]);
    expect(reversed).toEqual(forward);
  });

  it('rounds units to 4 dp', () => {
    const s = snap([
      sale('1', {
        docs: [doc('invoice', { lines: [line({ productId: 'P-1', quantity: 1.23456 })] })],
      }),
    ]);
    expect(salesVelocity(s, OPTS).entries[0]).toMatchObject({
      invoicedUnits: 1.2346,
      netUnits: 1.2346,
    });
  });

  describe('coverage', () => {
    it('counts all sales, sales with docs, pending sales and carries windowFrom', () => {
      const s = snap(
        [
          sale('1', { docs: [doc('invoice', { lines: [line({ productId: 'P-1' })] })] }),
          sale('2', { docs: [], pendingDetail: true }),
          sale('3', {
            status: 'VOIDED',
            docs: [doc('invoice', { lines: [line({ productId: 'P-1' })] })],
          }),
        ],
        '2026-01-01',
      );
      expect(salesVelocity(s, OPTS).coverage).toEqual({
        salesInSnapshot: 3,
        withDetail: 2,
        pendingDetail: 1,
        windowFrom: '2026-01-01',
        rangeCovered: true,
      });
    });

    it('is not range-covered when windowFrom is later than the window start', () => {
      const s = snap([sale('1')], '2026-02-01');
      expect(salesVelocity(s, OPTS).coverage.rangeCovered).toBe(false);
    });

    it('is range-covered when windowFrom equals the window start', () => {
      const s = snap([sale('1')], '2026-01-01');
      expect(salesVelocity(s, OPTS).coverage.rangeCovered).toBe(true);
    });

    it('is range-covered when windowFrom is null (all history loaded)', () => {
      const s = snap([sale('1')], null);
      expect(salesVelocity(s, { asOf: '2026-03-31', windowDays: 1 }).coverage.rangeCovered).toBe(
        true,
      );
    });
  });

  it('rejects an invalid asOf or windowDays', () => {
    const s = snap([]);
    expect(() => salesVelocity(s, { asOf: '2026-02-30', windowDays: 1 })).toThrow(/asOf/);
    expect(() => salesVelocity(s, { asOf: '31/03/2026', windowDays: 1 })).toThrow(/asOf/);
    expect(() => salesVelocity(s, { asOf: '2026-03-31', windowDays: 0 })).toThrow(/windowDays/);
    expect(() => salesVelocity(s, { asOf: '2026-03-31', windowDays: 1.5 })).toThrow(/windowDays/);
  });

  it('returns zeros for an empty snapshot without throwing', () => {
    const result = salesVelocity(emptySnapshot('2026-01-01T00:00:00Z'), OPTS);
    expect(result).toEqual({
      from: '2026-01-01',
      to: '2026-03-31',
      days: 90,
      entries: [],
      noProduct: { netUnits: 0, invoicedUnits: 0, creditedUnits: 0 },
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
