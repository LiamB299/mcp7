import { describe, expect, it } from 'vitest';
import { type SalesSummaryOptions, salesSummaryFromDocs } from '../src/cache/sales-summary.js';
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

function opts(overrides: Partial<SalesSummaryOptions> = {}): SalesSummaryOptions {
  return { groupBy: 'month', topN: 10, dateBasis: 'document', ...overrides };
}

describe('salesSummaryFromDocs', () => {
  it('nets invoices minus credit notes on both ex-tax and inc-tax figures', () => {
    const s = snap([
      sale('1', {
        docs: [
          doc('invoice', { totalBeforeTax: 100, total: 110 }),
          doc('credit', { totalBeforeTax: 20, total: 22, date: '2026-03-12' }),
        ],
      }),
    ]);
    const result = salesSummaryFromDocs(s, opts());
    expect(result.revenueExTax).toBe(80);
    expect(result.revenueIncTax).toBe(88);
    expect(result.documents).toEqual({ invoices: 1, creditNotes: 1 });
    expect(result.saleCount).toBe(1);
    expect(result.groups).toEqual([
      { key: '2026-03', saleCount: 1, revenueExTax: 80, revenueIncTax: 88 },
    ]);
  });

  it('attributes to the document date on the document basis and the order date on the order basis', () => {
    // Ordered in June, invoiced in July.
    const s = snap([
      sale('1', {
        orderDate: '2026-06-20',
        docs: [doc('invoice', { date: '2026-07-03', totalBeforeTax: 100, total: 100 })],
      }),
    ]);
    const byDocument = salesSummaryFromDocs(s, opts({ dateBasis: 'document' }));
    expect(byDocument.groups.map((g) => g.key)).toEqual(['2026-07']);

    const byOrder = salesSummaryFromDocs(s, opts({ dateBasis: 'order' }));
    expect(byOrder.groups.map((g) => g.key)).toEqual(['2026-06']);
    expect(byOrder.groups[0]).toMatchObject({ saleCount: 1, revenueExTax: 100 });

    const julyDocument = salesSummaryFromDocs(s, opts({ from: '2026-07-01', to: '2026-07-31' }));
    expect(julyDocument.saleCount).toBe(1);
    expect(julyDocument.revenueExTax).toBe(100);

    const julyOrder = salesSummaryFromDocs(
      s,
      opts({ from: '2026-07-01', to: '2026-07-31', dateBasis: 'order' }),
    );
    expect(julyOrder).toMatchObject({ saleCount: 0, revenueExTax: 0, groups: [] });
  });

  it('sorts month groups ascending with (no date) last', () => {
    const s = snap([
      sale('1', { docs: [doc('invoice', { date: '2026-05-01', totalBeforeTax: 5, total: 5 })] }),
      sale('2', {
        orderDate: null,
        docs: [doc('invoice', { date: null, totalBeforeTax: 7, total: 7 })],
      }),
      sale('3', { docs: [doc('invoice', { date: '2026-02-14', totalBeforeTax: 3, total: 3 })] }),
    ]);
    const result = salesSummaryFromDocs(s, opts());
    expect(result.groups.map((g) => g.key)).toEqual(['2026-02', '2026-05', '(no date)']);
    expect(result.groups[2]).toEqual({
      key: '(no date)',
      saleCount: 1,
      revenueExTax: 7,
      revenueIncTax: 7,
    });
    expect(result.other).toBeNull();
  });

  it('groups by channel, normalising blank channels to (none), with topN and other', () => {
    const s = snap([
      sale('1', {
        channel: 'Web',
        docs: [doc('invoice', { totalBeforeTax: 300, total: 300 })],
      }),
      sale('2', {
        channel: 'Web',
        docs: [doc('invoice', { totalBeforeTax: 100, total: 100 })],
      }),
      sale('3', {
        channel: 'Store',
        docs: [doc('invoice', { totalBeforeTax: 50, total: 50 })],
      }),
      sale('4', { channel: null, docs: [doc('invoice', { totalBeforeTax: 200, total: 200 })] }),
      sale('5', { channel: '   ', docs: [doc('invoice', { totalBeforeTax: 10, total: 10 })] }),
    ]);
    const top2 = salesSummaryFromDocs(s, opts({ groupBy: 'channel', topN: 2 }));
    expect(top2.groups).toEqual([
      { key: 'Web', saleCount: 2, revenueExTax: 400, revenueIncTax: 400 },
      { key: '(none)', saleCount: 2, revenueExTax: 210, revenueIncTax: 210 },
    ]);
    expect(top2.other).toEqual({
      groups: 1,
      saleCount: 1,
      revenueExTax: 50,
      revenueIncTax: 50,
    });
    expect(top2.revenueExTax).toBe(660);

    const all = salesSummaryFromDocs(s, opts({ groupBy: 'channel', topN: 10 }));
    expect(all.groups.map((g) => g.key)).toEqual(['Web', '(none)', 'Store']);
    expect(all.other).toBeNull();
  });

  it('breaks channel revenue ties by saleCount then key ascending', () => {
    const s = snap([
      sale('1', { channel: 'Beta', docs: [doc('invoice', { totalBeforeTax: 100, total: 100 })] }),
      sale('2', { channel: 'Alpha', docs: [doc('invoice', { totalBeforeTax: 100, total: 100 })] }),
      // Gamma also totals 100, but over two sales, so it ranks above Alpha and Beta.
      sale('3', { channel: 'Gamma', docs: [doc('invoice', { totalBeforeTax: 60, total: 60 })] }),
      sale('4', { channel: 'Gamma', docs: [doc('invoice', { totalBeforeTax: 40, total: 40 })] }),
    ]);
    const result = salesSummaryFromDocs(s, opts({ groupBy: 'channel' }));
    expect(result.groups.map((g) => g.key)).toEqual(['Gamma', 'Alpha', 'Beta']);
  });

  it('groups by customer with customerId, name fallbacks, topN and other', () => {
    const s = snap([
      sale('1', {
        customerId: '101',
        customer: 'Acme Test Ltd',
        docs: [doc('invoice', { totalBeforeTax: 100, total: 100 })],
      }),
      sale('2', {
        customerId: '101',
        customer: 'Acme Test Ltd',
        docs: [doc('invoice', { totalBeforeTax: 50, total: 50 })],
      }),
      sale('3', {
        customerId: '202',
        customer: 'Bolt Test Co',
        docs: [doc('invoice', { totalBeforeTax: 150, total: 150 })],
      }),
      sale('4', {
        customerId: null,
        customer: 'Crux Test Ltd',
        docs: [doc('invoice', { totalBeforeTax: 20, total: 20 })],
      }),
      sale('5', {
        customerId: null,
        customer: null,
        docs: [doc('invoice', { totalBeforeTax: 5, total: 5 })],
      }),
    ]);
    const result = salesSummaryFromDocs(s, opts({ groupBy: 'customer', topN: 2 }));
    // Acme and Bolt tie on revenue (150); Acme wins on saleCount.
    expect(result.groups).toEqual([
      {
        key: 'Acme Test Ltd',
        customerId: '101',
        saleCount: 2,
        revenueExTax: 150,
        revenueIncTax: 150,
      },
      {
        key: 'Bolt Test Co',
        customerId: '202',
        saleCount: 1,
        revenueExTax: 150,
        revenueIncTax: 150,
      },
    ]);
    expect(result.groups[0]).toHaveProperty('customerId', '101');
    expect(result.other).toEqual({
      groups: 2,
      saleCount: 2,
      revenueExTax: 25,
      revenueIncTax: 25,
    });

    const all = salesSummaryFromDocs(s, opts({ groupBy: 'customer', topN: 10 }));
    const crux = all.groups.find((g) => g.key === 'Crux Test Ltd');
    expect(crux).toEqual({
      key: 'Crux Test Ltd',
      saleCount: 1,
      revenueExTax: 20,
      revenueIncTax: 20,
    });
    expect(crux).not.toHaveProperty('customerId');
    expect(all.groups.find((g) => g.key === '(unknown)')).toMatchObject({ revenueExTax: 5 });
    expect(all.other).toBeNull();
  });

  it('reports ex-tax and inc-tax figures separately', () => {
    const s = snap([
      sale('1', {
        docs: [doc('invoice', { totalBeforeTax: 100, tax: 15, total: 115 })],
      }),
    ]);
    const result = salesSummaryFromDocs(s, opts());
    expect(result.revenueExTax).toBe(100);
    expect(result.revenueIncTax).toBe(115);
    expect(result.groups[0]).toMatchObject({ revenueExTax: 100, revenueIncTax: 115 });
  });

  it('includes additional charges in both document totals', () => {
    const s = snap([
      sale('1', {
        docs: [
          doc('invoice', {
            additionalCharges: 15,
            totalBeforeTax: 115,
            tax: 11.5,
            total: 126.5,
          }),
          doc('credit', {
            additionalCharges: 4,
            totalBeforeTax: 14,
            tax: 1.4,
            total: 15.4,
          }),
        ],
      }),
    ]);
    const result = salesSummaryFromDocs(s, opts());
    expect(result.revenueExTax).toBe(101);
    expect(result.revenueIncTax).toBe(111.1);
  });

  it('ignores voided sales', () => {
    const s = snap([
      sale('1', {
        status: ' voided ',
        docs: [doc('invoice', { totalBeforeTax: 500, total: 500 })],
      }),
      sale('2', { docs: [doc('invoice', { totalBeforeTax: 10, total: 10 })] }),
    ]);
    for (const dateBasis of ['document', 'order'] as const) {
      const result = salesSummaryFromDocs(s, opts({ dateBasis }));
      expect(result.saleCount).toBe(1);
      expect(result.revenueExTax).toBe(10);
      expect(result.listRollup.saleCount).toBe(1);
    }
  });

  it('counts an uninvoiced sale on the order basis only', () => {
    const s = snap([sale('u', { orderDate: '2026-03-04', docs: [] })]);

    const document = salesSummaryFromDocs(s, opts({ dateBasis: 'document' }));
    expect(document).toMatchObject({ saleCount: 0, groups: [], revenueExTax: 0 });

    const order = salesSummaryFromDocs(s, opts({ dateBasis: 'order' }));
    expect(order.saleCount).toBe(1);
    expect(order.groups).toEqual([
      { key: '2026-03', saleCount: 1, revenueExTax: 0, revenueIncTax: 0 },
    ]);
  });

  it('counts a sale once per month group but once in the overall saleCount', () => {
    const s = snap([
      sale('1', {
        docs: [
          doc('invoice', { date: '2026-02-10', totalBeforeTax: 100, total: 100 }),
          doc('invoice', { date: '2026-03-05', totalBeforeTax: 50, total: 50 }),
        ],
      }),
    ]);
    const result = salesSummaryFromDocs(s, opts());
    expect(result.saleCount).toBe(1);
    expect(result.documents).toEqual({ invoices: 2, creditNotes: 0 });
    expect(result.groups).toEqual([
      { key: '2026-02', saleCount: 1, revenueExTax: 100, revenueIncTax: 100 },
      { key: '2026-03', saleCount: 1, revenueExTax: 50, revenueIncTax: 50 },
    ]);
  });

  it('applies from and to inclusively on the document date', () => {
    const s = snap([
      sale('1', {
        docs: [
          doc('invoice', { date: '2026-01-31', totalBeforeTax: 80, total: 80 }),
          doc('invoice', { date: '2026-02-01', totalBeforeTax: 10, total: 10 }),
          doc('invoice', { date: '2026-02-28', totalBeforeTax: 20, total: 20 }),
          doc('invoice', { date: '2026-03-01', totalBeforeTax: 40, total: 40 }),
        ],
      }),
    ]);
    const result = salesSummaryFromDocs(s, opts({ from: '2026-02-01', to: '2026-02-28' }));
    expect(result.revenueExTax).toBe(30);
    expect(result.documents).toEqual({ invoices: 2, creditNotes: 0 });
    expect(result.from).toBe('2026-02-01');
    expect(result.to).toBe('2026-02-28');
  });

  it('applies from and to inclusively on the order date for the order basis', () => {
    const s = snap([
      sale('1', {
        orderDate: '2026-01-31',
        docs: [doc('invoice', { totalBeforeTax: 1, total: 1 })],
      }),
      sale('2', {
        orderDate: '2026-02-01',
        docs: [doc('invoice', { totalBeforeTax: 2, total: 2 })],
      }),
      sale('3', { orderDate: '2026-02-28', docs: [] }),
      sale('4', {
        orderDate: '2026-03-01',
        docs: [doc('invoice', { totalBeforeTax: 4, total: 4 })],
      }),
    ]);
    const result = salesSummaryFromDocs(
      s,
      opts({ from: '2026-02-01', to: '2026-02-28', dateBasis: 'order' }),
    );
    expect(result.saleCount).toBe(2);
    expect(result.revenueExTax).toBe(2);
  });

  it('reproduces the old list rollup: order date, listInvoiceAmount, sales without docs included', () => {
    const s = snap([
      sale('1', {
        orderDate: '2026-03-02',
        channel: 'Web',
        listInvoiceAmount: 120,
        docs: [doc('invoice', { date: '2026-03-02', totalBeforeTax: 100, total: 100 })],
      }),
      sale('2', {
        orderDate: '2026-03-05',
        channel: null,
        listInvoiceAmount: null,
        docs: [],
      }),
      // Ordered in April, invoiced in March: the list rollup files it under April.
      sale('3', {
        orderDate: '2026-04-01',
        channel: 'Store',
        listInvoiceAmount: 50,
        docs: [doc('invoice', { date: '2026-03-20', totalBeforeTax: 50, total: 50 })],
      }),
      sale('4', {
        status: 'VOIDED',
        orderDate: '2026-03-06',
        listInvoiceAmount: 999,
        docs: [],
      }),
    ]);
    const march = salesSummaryFromDocs(s, opts({ from: '2026-03-01', to: '2026-03-31' }));
    expect(march.listRollup).toEqual({
      saleCount: 2,
      invoicedTotal: 120,
      groups: [{ key: '2026-03', saleCount: 2, invoicedTotal: 120 }],
      other: null,
    });
    // Document basis sees sale 3's March invoice; the list rollup does not.
    expect(march.saleCount).toBe(2);
    expect(march.revenueExTax).toBe(150);

    const byChannel = salesSummaryFromDocs(s, opts({ groupBy: 'channel', topN: 2 }));
    expect(byChannel.listRollup).toEqual({
      saleCount: 3,
      invoicedTotal: 170,
      groups: [
        { key: 'Web', saleCount: 1, invoicedTotal: 120 },
        { key: 'Store', saleCount: 1, invoicedTotal: 50 },
      ],
      other: { groups: 1, saleCount: 1, invoicedTotal: 0 },
    });
  });

  it('keeps undated sales in the list rollup only when no bound is given', () => {
    const s = snap([
      sale('1', { orderDate: '2026-03-02', listInvoiceAmount: 120 }),
      sale('2', { orderDate: null, listInvoiceAmount: 7 }),
    ]);
    const unbounded = salesSummaryFromDocs(s, opts());
    expect(unbounded.listRollup).toEqual({
      saleCount: 2,
      invoicedTotal: 127,
      groups: [
        { key: '2026-03', saleCount: 1, invoicedTotal: 120 },
        { key: '(no date)', saleCount: 1, invoicedTotal: 7 },
      ],
      other: null,
    });
    const bounded = salesSummaryFromDocs(s, opts({ from: '2026-01-01' }));
    expect(bounded.listRollup.saleCount).toBe(1);
    expect(bounded.listRollup.invoicedTotal).toBe(120);
  });

  it('counts non-base currency contributing sales for each basis', () => {
    const s = snap([
      sale('a', {
        currency: 'AUD',
        customerCurrency: 'AUD',
        docs: [doc('invoice', { totalBeforeTax: 1, total: 1 })],
      }),
      sale('b', {
        currency: 'NZD',
        customerCurrency: 'USD',
        docs: [doc('invoice', { totalBeforeTax: 1, total: 1 })],
      }),
      sale('c', {
        currency: 'NZD',
        customerCurrency: null,
        docs: [doc('invoice', { totalBeforeTax: 1, total: 1 })],
      }),
      sale('d', {
        currency: 'NZD',
        customerCurrency: 'USD',
        status: 'VOIDED',
        docs: [doc('invoice', { totalBeforeTax: 1, total: 1 })],
      }),
      sale('e', { currency: 'NZD', customerCurrency: 'USD', orderDate: '2026-03-02', docs: [] }),
    ]);
    expect(salesSummaryFromDocs(s, opts()).nonBaseCurrencySales).toBe(1);
    expect(salesSummaryFromDocs(s, opts({ dateBasis: 'order' })).nonBaseCurrencySales).toBe(2);
  });

  it('reports the currency of the first contributing sale in id order', () => {
    const s = snap([
      sale('b', { currency: 'NZD', docs: [doc('invoice', { totalBeforeTax: 1, total: 1 })] }),
      sale('a', { currency: 'AUD', docs: [doc('invoice', { totalBeforeTax: 1, total: 1 })] }),
    ]);
    expect(salesSummaryFromDocs(s, opts()).currency).toBe('AUD');
  });

  it('reports coverage and rangeCovered', () => {
    const s = snap(
      [
        sale('1', { docs: [doc('invoice', { totalBeforeTax: 1, total: 1 })] }),
        sale('2', { docs: [], pendingDetail: true }),
        sale('3', { status: 'VOIDED', docs: [doc('invoice', { totalBeforeTax: 1, total: 1 })] }),
      ],
      '2026-01-01',
    );
    const result = salesSummaryFromDocs(s, opts());
    expect(result.coverage).toEqual({
      salesInSnapshot: 3,
      withDetail: 2,
      pendingDetail: 1,
      windowFrom: '2026-01-01',
      rangeCovered: false,
    });
    expect(salesSummaryFromDocs(s, opts({ from: '2026-02-01' })).coverage.rangeCovered).toBe(true);
    expect(salesSummaryFromDocs(s, opts({ from: '2026-01-01' })).coverage.rangeCovered).toBe(true);
    expect(salesSummaryFromDocs(s, opts({ from: '2025-12-31' })).coverage.rangeCovered).toBe(false);
    expect(salesSummaryFromDocs(s, opts({ to: '2026-06-30' })).coverage.rangeCovered).toBe(false);

    const allHistory = snap([sale('1')], null);
    expect(
      salesSummaryFromDocs(allHistory, opts({ from: '2015-01-01' })).coverage.rangeCovered,
    ).toBe(true);
  });

  it('returns zeros for an empty snapshot without throwing', () => {
    const result = salesSummaryFromDocs(emptySnapshot('2026-01-01T00:00:00Z'), opts());
    expect(result).toEqual({
      from: null,
      to: null,
      groupBy: 'month',
      dateBasis: 'document',
      currency: null,
      saleCount: 0,
      documents: { invoices: 0, creditNotes: 0 },
      revenueExTax: 0,
      revenueIncTax: 0,
      groups: [],
      other: null,
      nonBaseCurrencySales: 0,
      listRollup: { saleCount: 0, invoicedTotal: 0, groups: [], other: null },
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
