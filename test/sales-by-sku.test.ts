import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { revenueBySku, type SkuRevenueResult } from '../src/cache/query.js';
import { CacheLockedError, createMemoryStore } from '../src/cache/store.js';
import { type SyncResult, syncSnapshot } from '../src/cache/sync.js';
import { emptySnapshot, type Snapshot } from '../src/cache/types.js';
import type { Cin7Client } from '../src/cin7/client.js';
import { registerSalesBySku } from '../src/tools/sales-by-sku.js';

vi.mock('../src/cache/query.js', () => ({ revenueBySku: vi.fn() }));
vi.mock('../src/cache/sync.js', () => ({ syncSnapshot: vi.fn() }));
vi.mock('../src/dates.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/dates.js')>()),
  resolveAsOf: vi.fn(async () => '2026-06-30'),
}));

const AS_OF = '2026-06-30';

function snapshotWithCustomer(): Snapshot {
  const snap = emptySnapshot('2026-06-30T00:00:00.000Z');
  snap.sales['1'] = {
    id: '1',
    customer: 'Secret Customer Pty Ltd',
  } as unknown as Snapshot['sales'][string];
  return snap;
}

function revenue(over: Partial<SkuRevenueResult['coverage']> = {}): SkuRevenueResult {
  return {
    from: '2026-06-01',
    to: null,
    currency: 'ZAR',
    salesContributing: 3,
    documents: { invoices: 3, creditNotes: 1 },
    totals: { revenueExTax: 1000, cost: 600, margin: 400, quantity: 12, additionalCharges: 50 },
    rows: [
      {
        sku: 'SKU-A',
        name: 'Widget',
        revenueExTax: 700,
        quantity: 8,
        cost: 400,
        margin: 300,
        marginPct: 300 / 700,
      },
    ],
    other: null,
    nonBaseCurrencySales: 0,
    coverage: {
      salesInSnapshot: 3,
      withDetail: 3,
      pendingDetail: 0,
      windowFrom: '2026-06-01',
      rangeCovered: true,
      ...over,
    },
  };
}

function syncResult(over: Partial<SyncResult> = {}): SyncResult {
  return {
    complete: true,
    snapshot: snapshotWithCustomer(),
    windowFrom: '2026-06-01',
    headersListed: 3,
    fetchedDetails: 3,
    remaining: 0,
    cin7Calls: 4,
    elapsedMs: 10,
    mode: 'incremental',
    ...over,
  };
}

const fakeCin7 = { get: vi.fn() } as unknown as Cin7Client;

/** Connects a server with only sales_by_sku registered. */
async function connect(store = createMemoryStore()) {
  const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
  registerSalesBySku(server, fakeCin7, store);
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, store };
}

async function call(client: Client, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name: 'sales_by_sku', arguments: args });
  return res as typeof res & { structuredContent?: Record<string, any> };
}

const syncMock = vi.mocked(syncSnapshot);
const revenueMock = vi.mocked(revenueBySku);

beforeEach(() => {
  vi.clearAllMocks();
  revenueMock.mockReturnValue(revenue());
  syncMock.mockResolvedValue(syncResult());
});

describe('sales_by_sku', () => {
  it('is registered with non-read-only, idempotent, open-world annotations', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'sales_by_sku');
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
  });

  it('omitting from syncs all history (windowDays null) with maxMs from maxMinutes', async () => {
    const { client } = await connect();
    const res = await call(client);
    expect(res.isError).toBeFalsy();
    expect(syncMock).toHaveBeenCalledTimes(1);
    const [, opts] = syncMock.mock.calls[0]!;
    expect(opts).toMatchObject({ windowDays: null, maxMs: 4.5 * 60_000 });
    expect(opts).not.toHaveProperty('asOf'); // no date window, so no /me call for the time zone
  });

  it('computes windowDays from from through asOf, inclusive', async () => {
    const { client } = await connect();
    await call(client, { from: '2026-06-01' });
    const [, opts] = syncMock.mock.calls[0]!;
    // 2026-06-01 .. 2026-06-30 inclusive is 30 days.
    expect(opts).toMatchObject({ windowDays: 30, asOf: AS_OF });
  });

  it('honours a custom maxMinutes', async () => {
    const { client } = await connect();
    await call(client, { maxMinutes: 2 });
    expect(syncMock.mock.calls[0]![1]).toMatchObject({ maxMs: 120_000 });
  });

  it('is complete when the sync is complete, the range is covered and nothing is pending', async () => {
    const { client } = await connect();
    const res = await call(client, { from: '2026-06-01' });
    const out = res.structuredContent!;
    expect(out.complete).toBe(true);
    expect(out.remaining).toBe(0);
    expect(out.estimatedMinutesRemaining).toBe(0);
    expect(out.refreshed).toBe(true);
    expect(out.note).toBeUndefined();
    expect(out.definition).toContain('EX-TAX');
    expect(out.dataAsOf).toEqual(expect.any(String));
  });

  it('is partial when the sync is incomplete, with a note and a time estimate', async () => {
    syncMock.mockResolvedValue(syncResult({ complete: false, remaining: 300 }));
    const { client } = await connect();
    const out = (await call(client, { from: '2026-06-01' })).structuredContent!;
    expect(out.complete).toBe(false);
    expect(out.remaining).toBe(300);
    expect(out.estimatedMinutesRemaining).toBe(5.5);
    expect(out.note).toContain('PARTIAL');
    expect(out.note).toContain('still loading (300 left)');
    expect(out.note).toContain('Call again');
  });

  it('notes a refresh that stopped on a Cin7 error', async () => {
    syncMock.mockResolvedValue(syncResult({ complete: false, remaining: 4, error: 'HTTP 500' }));
    const { client } = await connect();
    const out = (await call(client)).structuredContent!;
    expect(out.complete).toBe(false);
    expect(out.note).toContain('stopped early on a Cin7 error');
  });

  it('is partial when the window does not cover the requested range', async () => {
    revenueMock.mockReturnValue(revenue({ rangeCovered: false, windowFrom: '2026-07-01' }));
    const { client } = await connect();
    const out = (await call(client, { from: '2026-06-01' })).structuredContent!;
    expect(out.complete).toBe(false);
    expect(out.note).toContain('PARTIAL');
    expect(out.note).toContain('does not cover the requested range');
  });

  it('is partial when details are pending in the snapshot, even if the sync reports complete', async () => {
    revenueMock.mockReturnValue(revenue({ pendingDetail: 7 }));
    const { client } = await connect();
    const out = (await call(client)).structuredContent!;
    expect(out.complete).toBe(false);
    expect(out.note).toContain('7 sales in the cache have no line detail yet');
  });

  it('refresh false answers from the stored snapshot without syncing', async () => {
    const store = createMemoryStore(snapshotWithCustomer());
    const { client } = await connect(store);
    const res = await call(client, { refresh: false });
    expect(res.isError).toBeFalsy();
    expect(syncMock).not.toHaveBeenCalled();
    const out = res.structuredContent!;
    expect(out.refreshed).toBe(false);
    expect(out.complete).toBe(true);
    expect(out.note).toBeUndefined();
  });

  it('refresh false reports partial coverage and tells the user to refresh', async () => {
    revenueMock.mockReturnValue(revenue({ pendingDetail: 2 }));
    const store = createMemoryStore(snapshotWithCustomer());
    const { client } = await connect(store);
    const out = (await call(client, { refresh: false })).structuredContent!;
    expect(out.complete).toBe(false);
    expect(out.remaining).toBe(2);
    expect(out.note).toContain('Call with refresh true');
  });

  it('refresh false with no stored snapshot is an error and runs nothing', async () => {
    const { client } = await connect();
    const res = await call(client, { refresh: false });
    expect(res.isError).toBe(true);
    expect(res.content[0]).toMatchObject({ type: 'text' });
    expect((res.content[0] as { text: string }).text).toContain('refresh true');
    expect(syncMock).not.toHaveBeenCalled();
    expect(revenueMock).not.toHaveBeenCalled();
  });

  it('CacheLockedError with a stored snapshot falls back and notes the skipped refresh', async () => {
    syncMock.mockRejectedValue(new CacheLockedError());
    const store = createMemoryStore(snapshotWithCustomer());
    const { client } = await connect(store);
    const res = await call(client, { from: '2026-06-01' });
    expect(res.isError).toBeFalsy();
    const out = res.structuredContent!;
    expect(out.refreshed).toBe(false);
    expect(out.complete).toBe(false);
    expect(out.note).toContain('refresh skipped: another process is refreshing');
    expect(revenueMock).toHaveBeenCalledTimes(1);
  });

  it('CacheLockedError with no stored snapshot is an error asking for a retry', async () => {
    syncMock.mockRejectedValue(new CacheLockedError());
    const { client } = await connect();
    const res = await call(client);
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain('retry shortly');
    expect(revenueMock).not.toHaveBeenCalled();
  });

  it('rejects a non-existent calendar date', async () => {
    const { client } = await connect();
    const res = await call(client, { from: '2026-02-30' });
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain('real calendar date');
    expect(syncMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed date', async () => {
    const { client } = await connect();
    const res = await call(client, { to: '2026/06/30' });
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain('to must be');
  });

  it('rejects from after to', async () => {
    const { client } = await connect();
    const res = await call(client, { from: '2026-06-30', to: '2026-06-01' });
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain('after to');
    expect(syncMock).not.toHaveBeenCalled();
    expect(revenueMock).not.toHaveBeenCalled();
  });

  it('passes topN, sortBy, from and to through to revenueBySku (defaults topN 10, revenue)', async () => {
    const { client } = await connect();
    await call(client, { from: '2026-06-01', to: '2026-06-30', topN: 5, sortBy: 'margin' });
    expect(revenueMock).toHaveBeenLastCalledWith(expect.anything(), {
      from: '2026-06-01',
      to: '2026-06-30',
      topN: 5,
      sortBy: 'margin',
    });
    const cached = createMemoryStore(snapshotWithCustomer());
    await (await connect(cached)).client.callTool({
      name: 'sales_by_sku',
      arguments: { refresh: false },
    });
    expect(revenueMock).toHaveBeenLastCalledWith(expect.anything(), {
      topN: 10,
      sortBy: 'revenue',
    });
  });

  it('never returns customer names', async () => {
    const { client } = await connect();
    const res = await call(client);
    expect(JSON.stringify(res.structuredContent)).not.toContain('Secret Customer');
    expect(res.content[0]).toMatchObject({ type: 'text' });
    expect((res.content[0] as { text: string }).text).not.toContain('Secret Customer');
  });
});
