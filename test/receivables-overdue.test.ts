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
import { registerReceivablesOverdue } from '../src/tools/receivables-overdue.js';

vi.mock('../src/cache/sync.js', () => ({ syncSnapshot: vi.fn() }));
vi.mock('../src/dates.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/dates.js')>()),
  resolveAsOf: vi.fn(async (_c: unknown, asOf?: string) => asOf ?? '2026-06-30'),
}));

const ASOF = '2026-06-30';

/** The date `n` days before asOf. */
function ago(n: number): string {
  return new Date(Date.parse(`${ASOF}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
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
    customerId: `cust-${id}`,
    customer: 'Example Customer Ltd',
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

/**
 * Fixture (fake names):
 * - 1: invoice 100, unpaid, due 10 days ago (overdue, 1-30). List rollup agrees.
 * - 2: invoice 50, fully paid (ignored on both bases).
 * - 3: invoice 200, unpaid, due 45 days ago, with a 50 credit note: document outstanding 150 (31-60).
 *      The list rollup ignores the credit note and shows 200, so the bases differ.
 */
function fixtureSnapshot(windowFrom: string | null = null, extra: CachedSale[] = []): Snapshot {
  const sales = [
    sale('1', {
      orderNumber: 'SO-1001',
      customerId: 'cust-alpha',
      customer: 'Alpha Trading Ltd',
      listInvoiceAmount: 100,
      listPaidAmount: 0,
      listInvoiceDueDate: ago(10),
      docs: [doc('invoice', { total: 100, paid: 0, dueDate: ago(10) })],
    }),
    sale('2', {
      orderNumber: 'SO-1002',
      customerId: 'cust-beta',
      customer: 'Beta Supplies Ltd',
      listInvoiceAmount: 50,
      listPaidAmount: 50,
      listInvoiceDueDate: ago(5),
      docs: [doc('invoice', { total: 50, paid: 50, dueDate: ago(5) })],
    }),
    sale('3', {
      orderNumber: 'SO-1003',
      customerId: 'cust-gamma',
      customer: 'Gamma Retail Ltd',
      listInvoiceAmount: 200,
      listPaidAmount: 0,
      listInvoiceDueDate: ago(45),
      docs: [
        doc('invoice', { total: 200, paid: 0, dueDate: ago(45) }),
        doc('credit', { total: 50 }),
      ],
    }),
    ...extra,
  ];
  return {
    ...emptySnapshot('2026-06-30T00:00:00.000Z'),
    windowFrom,
    sales: Object.fromEntries(sales.map((s) => [s.id, s])),
  };
}

function syncResult(over: Partial<SyncResult> = {}): SyncResult {
  return {
    complete: true,
    snapshot: fixtureSnapshot(),
    windowFrom: null,
    headersListed: 3,
    fetchedDetails: 3,
    remaining: 0,
    cin7Calls: 4,
    elapsedMs: 10,
    mode: 'full',
    ...over,
  };
}

const fakeCin7 = { get: vi.fn() } as unknown as Cin7Client;

/** Connects a server with only receivables_overdue registered. */
async function connect(store = createMemoryStore()) {
  const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
  registerReceivablesOverdue(server, fakeCin7, store);
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, store };
}

async function call(client: Client, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name: 'receivables_overdue', arguments: args });
  return res as typeof res & { structuredContent?: Record<string, any> };
}

const syncMock = vi.mocked(syncSnapshot);

beforeEach(() => {
  vi.clearAllMocks();
  syncMock.mockResolvedValue(syncResult());
});

describe('receivables_overdue', () => {
  it('is registered with non-read-only, idempotent, open-world annotations', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'receivables_overdue');
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
  });

  it('refresh true syncs all history once, with full re-listing and the time budget', async () => {
    const { client } = await connect();
    const res = await call(client);
    expect(res.isError).toBeFalsy();
    expect(syncMock).toHaveBeenCalledTimes(1);
    const [, opts] = syncMock.mock.calls[0]!;
    expect(opts).toMatchObject({ full: true, windowDays: null, maxMs: 4.5 * 60_000 });
    expect(opts).not.toHaveProperty('asOf'); // no date window, so no /me call for the time zone
  });

  it('honours a custom maxMinutes', async () => {
    const { client } = await connect();
    await call(client, { maxMinutes: 2 });
    expect(syncMock.mock.calls[0]![1]).toMatchObject({ maxMs: 120_000 });
  });

  it('refresh false answers from the stored snapshot and does not sync', async () => {
    const store = createMemoryStore(fixtureSnapshot());
    const { client } = await connect(store);
    const res = await call(client, { refresh: false });
    expect(res.isError).toBeFalsy();
    expect(syncMock).not.toHaveBeenCalled();
    const out = res.structuredContent!;
    expect(out.refreshed).toBe(false);
    expect(out.complete).toBe(true);
    expect(out.note).toBeUndefined();
  });

  it('refresh false with no stored snapshot is an error and runs nothing', async () => {
    const { client } = await connect();
    const res = await call(client, { refresh: false });
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain('refresh true');
    expect(syncMock).not.toHaveBeenCalled();
  });

  it('reports headline figures and the top overdue row on the document basis', async () => {
    const { client } = await connect();
    const out = (await call(client)).structuredContent!;
    expect(out.asOf).toBe(ASOF);
    expect(out.currency).toBe('NZD');
    expect(out.salesScanned).toBe(3);
    expect(out.outstanding).toEqual({ count: 2, total: 250 });
    expect(out.overdue).toEqual({ count: 2, total: 250 });
    expect(out.noDueDate).toEqual({ count: 0, total: 0 });
    expect(out.ageBuckets).toEqual({
      '1-30': { count: 1, total: 100 },
      '31-60': { count: 1, total: 150 },
      '61-90': { count: 0, total: 0 },
      '90+': { count: 0, total: 0 },
    });
    expect(out.top).toEqual([
      {
        orderNumber: 'SO-1003',
        customer: 'Gamma Retail Ltd',
        customerId: 'cust-gamma',
        dueDate: ago(45),
        daysOverdue: 45,
        outstanding: 150,
      },
      {
        orderNumber: 'SO-1001',
        customer: 'Alpha Trading Ltd',
        customerId: 'cust-alpha',
        dueDate: ago(10),
        daysOverdue: 10,
        outstanding: 100,
      },
    ]);
    expect(out.nonBaseCurrencySales).toBe(0);
  });

  it('reports the comparison figures: withoutCreditNetting and the list rollup', async () => {
    const { client } = await connect();
    const out = (await call(client)).structuredContent!;
    // Credit note ignored: sale 3 counts 200, so 100 + 200.
    expect(out.withoutCreditNetting).toEqual({
      outstanding: { count: 2, total: 300 },
      overdue: { count: 2, total: 300 },
    });
    // Old basis: list rollups, which ignore the credit note (200 for sale 3).
    expect(out.listRollup).toEqual({
      salesScanned: 3,
      outstanding: { count: 2, total: 300 },
      overdue: { count: 2, total: 300 },
      noDueDate: { count: 0, total: 0 },
    });
  });

  it('honours an explicit asOf for overdue measurement', async () => {
    const { client } = await connect();
    const out = (await call(client, { asOf: '2026-07-15' })).structuredContent!;
    expect(out.asOf).toBe('2026-07-15');
    // Sale 1 due 2026-06-20 is 25 days overdue at 2026-07-15 (1-30 bucket still).
    expect(out.top[1]).toMatchObject({ orderNumber: 'SO-1001', daysOverdue: 25 });
  });

  it('limits top to topN', async () => {
    const { client } = await connect();
    const out = (await call(client, { topN: 1 })).structuredContent!;
    expect(out.top).toHaveLength(1);
    expect(out.top[0]).toMatchObject({ orderNumber: 'SO-1003' });
  });

  it('is complete when the sync is complete, all history is loaded and nothing is pending', async () => {
    const { client } = await connect();
    const out = (await call(client)).structuredContent!;
    expect(out.complete).toBe(true);
    expect(out.remaining).toBe(0);
    expect(out.estimatedMinutesRemaining).toBe(0);
    expect(out.refreshed).toBe(true);
    expect(out.coverage).toMatchObject({ rangeCovered: true, pendingDetail: 0, windowFrom: null });
    expect(out.note).toBeUndefined();
  });

  it('is partial when the sync is incomplete, with a note and a time estimate', async () => {
    syncMock.mockResolvedValue(syncResult({ complete: false, remaining: 300 }));
    const { client } = await connect();
    const out = (await call(client)).structuredContent!;
    expect(out.complete).toBe(false);
    expect(out.remaining).toBe(300);
    expect(out.estimatedMinutesRemaining).toBe(5.5);
    expect(out.note).toContain('PARTIAL');
    expect(out.note).toContain('still loading (300 left)');
    expect(out.note).toContain('Call again');
  });

  it('is partial when the loaded window starts after all history', async () => {
    syncMock.mockResolvedValue(
      syncResult({ snapshot: fixtureSnapshot('2026-01-01'), windowFrom: '2026-01-01' }),
    );
    const { client } = await connect();
    const out = (await call(client)).structuredContent!;
    expect(out.complete).toBe(false);
    expect(out.coverage).toMatchObject({ rangeCovered: false, windowFrom: '2026-01-01' });
    expect(out.note).toContain('does not cover the requested range');
  });

  it('is partial when sales in the snapshot still have no detail, even if the sync is complete', async () => {
    const pending = sale('4', {
      orderNumber: 'SO-1004',
      customer: 'Delta Hire Ltd',
      pendingDetail: true,
      detailFetched: false,
      docs: [],
    });
    syncMock.mockResolvedValue(syncResult({ snapshot: fixtureSnapshot(null, [pending]) }));
    const { client } = await connect();
    const out = (await call(client)).structuredContent!;
    expect(out.complete).toBe(false);
    expect(out.coverage.pendingDetail).toBe(1);
    expect(out.note).toContain('1 sales in the cache have no line detail yet');
  });

  it('a refresh that stopped on a Cin7 error is partial and says so', async () => {
    syncMock.mockResolvedValue(syncResult({ complete: false, remaining: 4, error: 'HTTP 500' }));
    const { client } = await connect();
    const out = (await call(client)).structuredContent!;
    expect(out.complete).toBe(false);
    expect(out.note).toContain('stopped early on a Cin7 error');
  });

  it('rejects a non-existent calendar date for asOf and runs nothing', async () => {
    const { client } = await connect();
    const res = await call(client, { asOf: '2026-02-30' });
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain('real calendar date');
    expect(syncMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed asOf', async () => {
    const { client } = await connect();
    const res = await call(client, { asOf: '2026/06/30' });
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain('asOf must be');
    expect(syncMock).not.toHaveBeenCalled();
  });

  it('CacheLockedError with a stored snapshot answers and notes the skipped refresh', async () => {
    syncMock.mockRejectedValue(new CacheLockedError());
    const store = createMemoryStore(fixtureSnapshot());
    const { client } = await connect(store);
    const res = await call(client);
    expect(res.isError).toBeFalsy();
    const out = res.structuredContent!;
    expect(out.refreshed).toBe(false);
    expect(out.complete).toBe(false);
    expect(out.note).toContain('refresh skipped');
    expect(out.outstanding).toEqual({ count: 2, total: 250 });
  });

  it('CacheLockedError with no stored snapshot is an error asking for a retry', async () => {
    syncMock.mockRejectedValue(new CacheLockedError());
    const { client } = await connect();
    const res = await call(client);
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain('retry shortly');
  });

  it('a Cin7 error is reported as an error result with the HTTP status', async () => {
    syncMock.mockRejectedValue(new Cin7Error('boom', 500));
    const { client } = await connect();
    const res = await call(client);
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toBe('Cin7 error (HTTP 500): boom');
  });

  it('carries dataAsOf and the definition in the output', async () => {
    const { client } = await connect();
    const out = (await call(client)).structuredContent!;
    expect(out.dataAsOf).toEqual(expect.any(String));
    expect(out.definition).toContain('Basis is the invoice and credit-note DOCUMENTS');
    expect(out.definition).toContain('listRollup');
  });
});
