import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CacheLockedError, createMemoryStore } from '../src/cache/store.js';
import { type SyncResult, syncSnapshot } from '../src/cache/sync.js';
import {
  type CachedDoc,
  type CachedSale,
  emptySnapshot,
  type Snapshot,
} from '../src/cache/types.js';
import { type Cin7Client, Cin7Error } from '../src/cin7/client.js';
import { registerSalesSummary } from '../src/tools/sales-summary.js';

vi.mock('../src/cache/sync.js', () => ({ syncSnapshot: vi.fn() }));
vi.mock('../src/dates.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/dates.js')>()),
  resolveAsOf: vi.fn(async () => '2026-06-30'),
}));

const AS_OF = '2026-06-30';

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

/** A small, fully covered snapshot: one March invoice, one customer, one channel. */
function baseSnapshot(): Snapshot {
  return snap([
    sale('1', {
      channel: 'Web',
      customerId: '101',
      customer: 'Acme Test Ltd',
      docs: [doc('invoice', { totalBeforeTax: 100, total: 110 })],
    }),
  ]);
}

function syncResult(over: Partial<SyncResult> = {}): SyncResult {
  return {
    complete: true,
    snapshot: baseSnapshot(),
    windowFrom: null,
    headersListed: 1,
    fetchedDetails: 1,
    remaining: 0,
    cin7Calls: 2,
    elapsedMs: 10,
    mode: 'incremental',
    ...over,
  };
}

const fakeCin7 = { get: vi.fn() } as unknown as Cin7Client;

/** Connects a server with only sales_summary registered. */
async function connect(store = createMemoryStore()) {
  const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
  registerSalesSummary(server, fakeCin7, store);
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, store };
}

async function call(client: Client, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name: 'sales_summary', arguments: args });
  return res as typeof res & { structuredContent?: Record<string, any> };
}

function text(res: { content: unknown }): string {
  return (res.content as Array<{ text: string }>)[0]!.text;
}

const syncMock = vi.mocked(syncSnapshot);

beforeEach(() => {
  vi.clearAllMocks();
  syncMock.mockResolvedValue(syncResult());
});

describe('sales_summary', () => {
  it('is registered with non-read-only, idempotent, open-world annotations', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'sales_summary');
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
  });

  it('omitting from syncs all history (windowDays null) with maxMs from maxMinutes', async () => {
    const { client } = await connect();
    const res = await call(client, { groupBy: 'month' });
    expect(res.isError).toBeFalsy();
    expect(syncMock).toHaveBeenCalledTimes(1);
    const [, opts] = syncMock.mock.calls[0]!;
    expect(opts).toMatchObject({ windowDays: null, maxMs: 4.5 * 60_000 });
    expect(opts).not.toHaveProperty('asOf'); // no date window, so no /me call for the time zone
  });

  it('syncs from the from date through asOf, inclusive, when from is given', async () => {
    const { client } = await connect();
    await call(client, { groupBy: 'month', from: '2026-06-01' });
    const [, opts] = syncMock.mock.calls[0]!;
    // 2026-06-01 .. 2026-06-30 inclusive is 30 days.
    expect(opts).toMatchObject({ windowDays: 30, asOf: AS_OF });
  });

  it('passes groupBy, topN, dateBasis, from and to through to the answer', async () => {
    const store = createMemoryStore(baseSnapshot());
    const { client } = await connect(store);
    const out = (
      await call(client, {
        refresh: false,
        groupBy: 'channel',
        topN: 3,
        dateBasis: 'order',
        from: '2026-03-01',
        to: '2026-03-31',
      })
    ).structuredContent!;
    expect(out).toMatchObject({
      from: '2026-03-01',
      to: '2026-03-31',
      groupBy: 'channel',
      dateBasis: 'order',
    });
  });

  it('is complete when the sync is complete, the range is covered and nothing is pending', async () => {
    const { client } = await connect();
    const res = await call(client, { groupBy: 'month', from: '2026-06-01' });
    const out = res.structuredContent!;
    expect(out.complete).toBe(true);
    expect(out.remaining).toBe(0);
    expect(out.estimatedMinutesRemaining).toBe(0);
    expect(out.refreshed).toBe(true);
    expect(out.note).toBeUndefined();
    expect(out.dataAsOf).toEqual(expect.any(String));
  });

  it('refresh false answers from the stored snapshot without syncing', async () => {
    const store = createMemoryStore(baseSnapshot());
    const { client } = await connect(store);
    const res = await call(client, { refresh: false, groupBy: 'month' });
    expect(res.isError).toBeFalsy();
    expect(syncMock).not.toHaveBeenCalled();
    const out = res.structuredContent!;
    expect(out.refreshed).toBe(false);
    expect(out.complete).toBe(true);
    expect(out.note).toBeUndefined();
    expect(out.groups).toEqual([
      { key: '2026-03', saleCount: 1, revenueExTax: 100, revenueIncTax: 110 },
    ]);
  });

  it('refresh false with no stored snapshot is an error and runs nothing', async () => {
    const { client } = await connect();
    const res = await call(client, { refresh: false, groupBy: 'month' });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('refresh true');
    expect(syncMock).not.toHaveBeenCalled();
  });

  it('dateBasis document places a sale by invoice date; dateBasis order by order date', async () => {
    // Ordered in June, invoiced in July.
    const store = createMemoryStore(
      snap([
        sale('1', {
          orderDate: '2026-06-20',
          docs: [doc('invoice', { date: '2026-07-03', totalBeforeTax: 100, total: 100 })],
        }),
      ]),
    );
    const { client } = await connect(store);

    const byDocument = (
      await call(client, { refresh: false, groupBy: 'month', dateBasis: 'document' })
    ).structuredContent!;
    expect(byDocument.groups.map((g: { key: string }) => g.key)).toEqual(['2026-07']);

    const byOrder = (await call(client, { refresh: false, groupBy: 'month', dateBasis: 'order' }))
      .structuredContent!;
    expect(byOrder.groups).toEqual([
      { key: '2026-06', saleCount: 1, revenueExTax: 100, revenueIncTax: 100 },
    ]);

    const julyDocument = (
      await call(client, {
        refresh: false,
        groupBy: 'month',
        from: '2026-07-01',
        to: '2026-07-31',
      })
    ).structuredContent!;
    expect(julyDocument).toMatchObject({ saleCount: 1, revenueExTax: 100 });

    const julyOrder = (
      await call(client, {
        refresh: false,
        groupBy: 'month',
        from: '2026-07-01',
        to: '2026-07-31',
        dateBasis: 'order',
      })
    ).structuredContent!;
    expect(julyOrder).toMatchObject({ saleCount: 0, revenueExTax: 0, groups: [] });
  });

  it('defaults dateBasis to document', async () => {
    const store = createMemoryStore(baseSnapshot());
    const { client } = await connect(store);
    const out = (await call(client, { refresh: false, groupBy: 'month' })).structuredContent!;
    expect(out.dateBasis).toBe('document');
  });

  it('groups by channel with topN and other, normalising blank channels to (none)', async () => {
    const store = createMemoryStore(
      snap([
        sale('1', { channel: 'Web', docs: [doc('invoice', { totalBeforeTax: 300, total: 300 })] }),
        sale('2', { channel: 'Web', docs: [doc('invoice', { totalBeforeTax: 100, total: 100 })] }),
        sale('3', { channel: 'Store', docs: [doc('invoice', { totalBeforeTax: 50, total: 50 })] }),
        sale('4', { channel: null, docs: [doc('invoice', { totalBeforeTax: 200, total: 200 })] }),
        sale('5', { channel: '   ', docs: [doc('invoice', { totalBeforeTax: 10, total: 10 })] }),
      ]),
    );
    const { client } = await connect(store);
    const out = (await call(client, { refresh: false, groupBy: 'channel', topN: 2 }))
      .structuredContent!;
    expect(out.groups).toEqual([
      { key: 'Web', saleCount: 2, revenueExTax: 400, revenueIncTax: 400 },
      { key: '(none)', saleCount: 2, revenueExTax: 210, revenueIncTax: 210 },
    ]);
    expect(out.other).toEqual({ groups: 1, saleCount: 1, revenueExTax: 50, revenueIncTax: 50 });
    expect(out.revenueExTax).toBe(660);
    expect(out.saleCount).toBe(5);
  });

  it('groups by customer with customerId, the business name, topN and other', async () => {
    const store = createMemoryStore(
      snap([
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
      ]),
    );
    const { client } = await connect(store);
    const out = (await call(client, { refresh: false, groupBy: 'customer', topN: 2 }))
      .structuredContent!;
    // Acme and Bolt tie on revenue (150); Acme wins on saleCount.
    expect(out.groups).toEqual([
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
    expect(out.other).toEqual({ groups: 1, saleCount: 1, revenueExTax: 20, revenueIncTax: 20 });
  });

  it('subtracts credit notes from both ex-tax and inc-tax revenue', async () => {
    const store = createMemoryStore(
      snap([
        sale('1', {
          docs: [
            doc('invoice', { totalBeforeTax: 100, total: 110 }),
            doc('credit', { totalBeforeTax: 20, total: 22, date: '2026-03-12' }),
          ],
        }),
      ]),
    );
    const { client } = await connect(store);
    const out = (await call(client, { refresh: false, groupBy: 'month' })).structuredContent!;
    expect(out.revenueExTax).toBe(80);
    expect(out.revenueIncTax).toBe(88);
    expect(out.documents).toEqual({ invoices: 1, creditNotes: 1 });
    expect(out.saleCount).toBe(1);
  });

  it('returns the old list rollup alongside the document figures', async () => {
    const store = createMemoryStore(
      snap([
        sale('1', {
          orderDate: '2026-03-02',
          listInvoiceAmount: 120,
          docs: [doc('invoice', { date: '2026-03-02', totalBeforeTax: 100, total: 100 })],
        }),
        // Ordered in April, invoiced in March: the list rollup files it under April.
        sale('2', {
          orderDate: '2026-04-01',
          listInvoiceAmount: 50,
          docs: [doc('invoice', { date: '2026-03-20', totalBeforeTax: 50, total: 50 })],
        }),
      ]),
    );
    const { client } = await connect(store);
    const out = (await call(client, { refresh: false, groupBy: 'month' })).structuredContent!;
    expect(out.revenueExTax).toBe(150);
    expect(out.listRollup).toEqual({
      saleCount: 2,
      invoicedTotal: 170,
      groups: [
        { key: '2026-03', saleCount: 1, invoicedTotal: 120 },
        { key: '2026-04', saleCount: 1, invoicedTotal: 50 },
      ],
      other: null,
    });
  });

  it('is partial with a PARTIAL note and time estimate when the sync is incomplete', async () => {
    syncMock.mockResolvedValue(syncResult({ complete: false, remaining: 300 }));
    const { client } = await connect();
    const out = (await call(client, { groupBy: 'month', from: '2026-06-01' })).structuredContent!;
    expect(out.complete).toBe(false);
    expect(out.remaining).toBe(300);
    expect(out.estimatedMinutesRemaining).toBe(5.5);
    expect(out.note).toContain('PARTIAL');
    expect(out.note).toContain('still loading (300 left)');
    expect(out.note).toContain('Call again');
  });

  it('is partial when sales in the cache have no detail yet, even if the sync is complete', async () => {
    const pending = snap([sale('1', { pendingDetail: true, docs: [] })]);
    syncMock.mockResolvedValue(syncResult({ snapshot: pending }));
    const { client } = await connect();
    const out = (await call(client, { groupBy: 'month' })).structuredContent!;
    expect(out.complete).toBe(false);
    expect(out.note).toContain('PARTIAL');
    expect(out.note).toContain('1 sales in the cache have no line detail yet');
  });

  it('is partial when the stored window does not cover the requested range', async () => {
    const store = createMemoryStore(
      snap([sale('1', { docs: [doc('invoice', { totalBeforeTax: 1, total: 1 })] })], '2026-07-01'),
    );
    const { client } = await connect(store);
    const out = (await call(client, { refresh: false, groupBy: 'month', from: '2026-06-01' }))
      .structuredContent!;
    expect(out.complete).toBe(false);
    expect(out.coverage.rangeCovered).toBe(false);
    expect(out.note).toContain('PARTIAL');
    expect(out.note).toContain('does not cover the requested range');
  });

  it('rejects a non-existent calendar date', async () => {
    const { client } = await connect();
    const res = await call(client, { groupBy: 'month', from: '2026-02-30' });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('real calendar date');
    expect(syncMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed date', async () => {
    const { client } = await connect();
    const res = await call(client, { groupBy: 'month', to: '2026/06/30' });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('to must be');
    expect(syncMock).not.toHaveBeenCalled();
  });

  it('rejects from after to', async () => {
    const { client } = await connect();
    const res = await call(client, { groupBy: 'month', from: '2026-06-30', to: '2026-06-01' });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('after to');
    expect(syncMock).not.toHaveBeenCalled();
  });

  it('CacheLockedError with a stored snapshot answers from it and notes the skipped refresh', async () => {
    syncMock.mockRejectedValue(new CacheLockedError());
    const store = createMemoryStore(baseSnapshot());
    const { client } = await connect(store);
    const res = await call(client, { groupBy: 'month', from: '2026-03-01', to: '2026-03-31' });
    expect(res.isError).toBeFalsy();
    const out = res.structuredContent!;
    expect(out.refreshed).toBe(false);
    expect(out.complete).toBe(false);
    expect(out.note).toContain('refresh skipped: another process is refreshing');
    expect(out.revenueExTax).toBe(100);
  });

  it('a Cin7 error during the refresh is an error result with the HTTP status', async () => {
    syncMock.mockRejectedValue(new Cin7Error('Rate limit exceeded', 429));
    const { client } = await connect();
    const res = await call(client, { groupBy: 'month' });
    expect(res.isError).toBe(true);
    expect(text(res)).toBe('Cin7 error (HTTP 429): Rate limit exceeded');
  });

  it('an unexpected error is an error result with the message', async () => {
    syncMock.mockRejectedValue(new Error('boom'));
    const { client } = await connect();
    const res = await call(client, { groupBy: 'month' });
    expect(res.isError).toBe(true);
    expect(text(res)).toBe('Unexpected error: boom');
  });

  it('states dataAsOf and the definition, which covers the basis and the additional-charges rule', async () => {
    const { client } = await connect();
    const out = (await call(client, { groupBy: 'month' })).structuredContent!;
    expect(out.dataAsOf).toEqual(expect.any(String));
    expect(out.definition).toContain('Basis is the invoice and credit-note DOCUMENTS');
    expect(out.definition).toContain('BOTH INCLUDE additional charges');
  });
});
