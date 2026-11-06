import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CacheLockedError, createMemoryStore } from '../src/cache/store.js';
import { type SyncResult, syncSnapshot } from '../src/cache/sync.js';
import {
  type CachedDoc,
  type CachedLine,
  type CachedSale,
  emptySnapshot,
  type Snapshot,
} from '../src/cache/types.js';
import { createCin7Client } from '../src/cin7/client.js';
import type { AvailabilityRow, ProductRow } from '../src/cin7/types.js';
import { registerReorderSuggestions } from '../src/tools/reorder-suggestions.js';

vi.mock('../src/cache/sync.js', () => ({ syncSnapshot: vi.fn() }));
vi.mock('../src/dates.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/dates.js')>()),
  resolveAsOf: vi.fn(async (_c: unknown, asOf?: string) => asOf ?? '2026-06-30'),
}));

const config = { accountId: 'acc', applicationKey: 'key', baseUrl: 'https://example.test/v2/' };

function line(overrides: Partial<CachedLine> = {}): CachedLine {
  return {
    sku: null,
    productId: null,
    name: null,
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
    date: '2026-06-10',
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
    orderDate: '2026-06-01',
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
 * Fixture (fake names). Window for asOf 2026-06-30 and windowDays 90 is 2026-04-02 to 2026-06-30.
 * Sales (all invoiced inside the window):
 * - p-low: 90 invoiced units. Stock 6, Cin7 minimum 10: below threshold and stocks out before delivery.
 * - p-out: 90 invoiced units. Stock 10 summed over two locations, no threshold: stocks out before delivery.
 * - p-ok: 9 invoiced units. Stock 500: healthy, not a candidate.
 * - p-gone: 4 units on a sale line, but no product in the list has that ID or SKU: unmatched.
 * Universe: p-low, p-out, p-ok. p-svc (Service) and p-old (Deprecated, with a minimum) are excluded.
 */
function fixtureSnapshot(
  windowFrom: string | null = '2026-04-01',
  extra: CachedSale[] = [],
): Snapshot {
  const sales = [
    sale('1', {
      customer: 'Secret Customer Pty Ltd',
      docs: [
        doc('invoice', {
          date: '2026-06-10',
          lines: [line({ sku: 'SKU-LOW', productId: 'p-low', name: 'Widget Low', quantity: 90 })],
        }),
      ],
    }),
    sale('2', {
      customer: 'Another Customer Ltd',
      docs: [
        doc('invoice', {
          date: '2026-06-12',
          lines: [line({ sku: 'SKU-OUT', productId: 'p-out', name: 'Widget Out', quantity: 90 })],
        }),
      ],
    }),
    sale('3', {
      customer: 'Third Customer Ltd',
      docs: [
        doc('invoice', {
          date: '2026-06-15',
          lines: [
            line({ sku: 'SKU-OK', productId: 'p-ok', name: 'Widget OK', quantity: 9 }),
            line({ sku: 'SKU-GONE', productId: 'p-gone', name: 'Retired Widget', quantity: 4 }),
          ],
        }),
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
    windowFrom: '2026-04-01',
    headersListed: 3,
    fetchedDetails: 3,
    remaining: 0,
    cin7Calls: 4,
    elapsedMs: 10,
    mode: 'full',
    ...over,
  };
}

function avail(overrides: Partial<AvailabilityRow> & { ID: string }): AvailabilityRow {
  return {
    SKU: `SKU-${overrides.ID}`,
    Name: `Product ${overrides.ID}`,
    Location: 'Main',
    Batch: '',
    OnHand: 0,
    Allocated: 0,
    Available: 0,
    OnOrder: 0,
    ...overrides,
  };
}

function prod(overrides: Partial<ProductRow> & { ID: string }): ProductRow {
  return {
    SKU: `SKU-${overrides.ID}`,
    Name: `Product ${overrides.ID}`,
    Status: 'Active',
    Type: 'Product',
    MinimumBeforeReorder: 0,
    ReorderQuantity: 0,
    ...overrides,
  };
}

const AVAILABILITY: AvailabilityRow[] = [
  avail({ ID: 'p-low', SKU: 'SKU-LOW', Name: 'Widget Low', OnHand: 6, Available: 6 }),
  // p-out is stocked in two locations; the summed available is 10.
  avail({
    ID: 'p-out',
    SKU: 'SKU-OUT',
    Name: 'Widget Out',
    Location: 'North',
    OnHand: 4,
    Available: 4,
  }),
  avail({
    ID: 'p-out',
    SKU: 'SKU-OUT',
    Name: 'Widget Out',
    Location: 'South',
    OnHand: 6,
    Available: 6,
  }),
  avail({ ID: 'p-ok', SKU: 'SKU-OK', Name: 'Widget OK', OnHand: 500, Available: 500 }),
];

const PRODUCTS: ProductRow[] = [
  prod({
    ID: 'p-low',
    SKU: 'SKU-LOW',
    Name: 'Widget Low',
    MinimumBeforeReorder: 10,
    ReorderQuantity: 20,
  }),
  prod({ ID: 'p-out', SKU: 'SKU-OUT', Name: 'Widget Out' }),
  prod({ ID: 'p-ok', SKU: 'SKU-OK', Name: 'Widget OK' }),
  prod({ ID: 'p-svc', SKU: 'SKU-SVC', Name: 'Install Service', Type: 'Service' }),
  prod({
    ID: 'p-old',
    SKU: 'SKU-OLD',
    Name: 'Old Widget',
    Status: 'Deprecated',
    MinimumBeforeReorder: 5,
  }),
];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** Routes by path: ref/productavailability and product. Records every requested URL. */
function stub(
  opts: { rows?: AvailabilityRow[]; products?: ProductRow[] } = {},
  seen: string[] = [],
) {
  return async (url: string | URL | Request) => {
    seen.push(String(url));
    const path = new URL(String(url)).pathname;
    if (path.endsWith('/ref/productavailability')) {
      const rows = opts.rows ?? AVAILABILITY;
      return json({ Total: rows.length, Page: 1, ProductAvailabilityList: rows });
    }
    if (path.endsWith('/product')) {
      const products = opts.products ?? PRODUCTS;
      return json({ Total: products.length, Page: 1, Products: products });
    }
    return json({ ErrorCode: 404, Exception: 'Not found' }, 404);
  };
}

/** Connects a server with only reorder_suggestions registered, backed by a stubbed Cin7 fetch. */
async function connect(store = createMemoryStore(), fetchImpl: typeof fetch = stub()) {
  const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
  registerReorderSuggestions(
    server,
    createCin7Client(config, fetchImpl, { minIntervalMs: 0 }),
    store,
  );
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, store };
}

async function call(client: Client, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name: 'reorder_suggestions', arguments: args });
  return res as typeof res & { structuredContent?: Record<string, any> };
}

const syncMock = vi.mocked(syncSnapshot);

beforeEach(() => {
  vi.clearAllMocks();
  syncMock.mockResolvedValue(syncResult());
});

describe('reorder_suggestions', () => {
  it('is registered with non-read-only, idempotent, open-world annotations', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'reorder_suggestions');
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
  });

  it('ranks the products that need reordering and suggests quantities (end to end)', async () => {
    const { client } = await connect();
    const res = await call(client);
    expect(res.isError).toBeFalsy();
    const out = res.structuredContent!;

    expect(out.asOf).toBe('2026-06-30');
    expect(out.window).toEqual({ from: '2026-04-02', to: '2026-06-30', days: 90 });
    expect(out.assumptions).toEqual({ leadTimeDays: 14, targetCoverDays: 30 });
    expect(out.stockAsOf).toBe('now');

    expect(out.counts).toEqual({
      products: 3,
      withVelocity: 3,
      velocityMatchedToProduct: 3,
      velocityUnmatched: { products: 1, units: 4 },
      noProductUnits: 0,
      belowThreshold: 1,
      stockoutBeforeDelivery: 2,
      needsCover: 2,
      candidates: 2,
      productsWithThreshold: 1,
    });

    // Fewest days of cover first: p-low (6 days) before p-out (10 days).
    expect(out.top.map((r: { sku: string }) => r.sku)).toEqual(['SKU-LOW', 'SKU-OUT']);
    expect(out.top[0]).toEqual({
      sku: 'SKU-LOW',
      name: 'Widget Low',
      available: 6,
      onHand: 6,
      onOrder: 0,
      netUnitsSold: 90,
      dailyVelocity: 1,
      daysOfCover: 6,
      daysOfCoverWithOnOrder: 6,
      minimum: 10,
      cin7ReorderQuantity: 20,
      reasons: ['below_cin7_threshold', 'stockout_before_delivery', 'needs_cover'],
      // ceil(1 x (14 + 30) - 6 - 0)
      suggestedQuantity: 38,
    });
    // Stock summed over two locations (4 + 6); no threshold, so only stockout and cover reasons.
    expect(out.top[1]).toMatchObject({
      sku: 'SKU-OUT',
      available: 10,
      onHand: 10,
      daysOfCover: 10,
      minimum: 0,
      reasons: ['stockout_before_delivery', 'needs_cover'],
      suggestedQuantity: 34,
    });
  });

  it('refresh true syncs once with a 90 day window ending at asOf and the time budget', async () => {
    const { client } = await connect();
    const res = await call(client, { maxMinutes: 2 });
    expect(res.isError).toBeFalsy();
    expect(syncMock).toHaveBeenCalledTimes(1);
    const [, opts] = syncMock.mock.calls[0]!;
    expect(opts).toMatchObject({ windowDays: 90, asOf: '2026-06-30', maxMs: 120_000 });
    expect(res.structuredContent!.refreshed).toBe(true);
  });

  it('refresh false answers from the stored snapshot with no sync call', async () => {
    const store = createMemoryStore(fixtureSnapshot());
    const { client } = await connect(store);
    const res = await call(client, { refresh: false });
    expect(res.isError).toBeFalsy();
    expect(syncMock).not.toHaveBeenCalled();
    const out = res.structuredContent!;
    expect(out.refreshed).toBe(false);
    expect(out.complete).toBe(true);
    expect(out.note).toBeUndefined();
    expect(out.counts.candidates).toBe(2);
  });

  it('refresh false with an empty store is an error that asks for refresh true', async () => {
    const { client } = await connect();
    const res = await call(client, { refresh: false });
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain('refresh true');
    expect(syncMock).not.toHaveBeenCalled();
  });

  it('echoes leadTimeDays and targetCoverDays, and changing them changes the suggestions', async () => {
    const { client } = await connect();
    const out = (await call(client, { leadTimeDays: 0, targetCoverDays: 0 })).structuredContent!;
    expect(out.assumptions).toEqual({ leadTimeDays: 0, targetCoverDays: 0 });
    // No lead time means no stockout reason; no target cover means no quantity for p-out.
    expect(out.counts.candidates).toBe(1);
    expect(out.top).toEqual([
      expect.objectContaining({
        sku: 'SKU-LOW',
        reasons: ['below_cin7_threshold'],
        suggestedQuantity: 0,
      }),
    ]);
  });

  it('is complete when the sync is complete, the range is covered and nothing is pending', async () => {
    const { client } = await connect();
    const out = (await call(client)).structuredContent!;
    expect(out.complete).toBe(true);
    expect(out.remaining).toBe(0);
    expect(out.estimatedMinutesRemaining).toBe(0);
    expect(out.refreshed).toBe(true);
    expect(out.coverage).toEqual({
      salesInSnapshot: 3,
      withDetail: 3,
      pendingDetail: 0,
      windowFrom: '2026-04-01',
      rangeCovered: true,
    });
    expect(out.note).toBeUndefined();
  });

  it('is partial when the sync is incomplete, with a note', async () => {
    syncMock.mockResolvedValue(syncResult({ complete: false, remaining: 300 }));
    const { client } = await connect();
    const out = (await call(client)).structuredContent!;
    expect(out.complete).toBe(false);
    expect(out.remaining).toBe(300);
    expect(out.note).toContain('PARTIAL');
    expect(out.note).toContain('still loading (300 left)');
  });

  it('is partial when sales in the snapshot still have no line detail', async () => {
    const pending = sale('4', {
      customer: 'Pending Customer Ltd',
      pendingDetail: true,
      detailFetched: false,
      docs: [],
    });
    syncMock.mockResolvedValue(syncResult({ snapshot: fixtureSnapshot('2026-04-01', [pending]) }));
    const { client } = await connect();
    const out = (await call(client)).structuredContent!;
    expect(out.complete).toBe(false);
    expect(out.coverage.pendingDetail).toBe(1);
    expect(out.note).toContain('PARTIAL');
    expect(out.note).toContain('1 sales in the cache have no line detail yet');
  });

  it('is partial when the loaded window starts after the requested window', async () => {
    syncMock.mockResolvedValue(
      syncResult({ snapshot: fixtureSnapshot('2026-05-01'), windowFrom: '2026-05-01' }),
    );
    const { client } = await connect();
    const out = (await call(client)).structuredContent!;
    expect(out.complete).toBe(false);
    expect(out.coverage).toMatchObject({ rangeCovered: false, windowFrom: '2026-05-01' });
    expect(out.note).toContain('PARTIAL');
    expect(out.note).toContain('does not cover the requested range');
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
    expect(out.counts.candidates).toBe(2);
  });

  it.each([
    [500, 'Upstream down'],
    [403, 'Auth failed'],
  ])(
    'a Cin7 %i on the availability list is a tool error with the Cin7 message',
    async (status, msg) => {
      const failing = async (url: string | URL | Request) =>
        new URL(String(url)).pathname.endsWith('/ref/productavailability')
          ? json({ ErrorCode: status, Exception: msg }, status)
          : json({ Total: 0, Products: [] });
      const { client } = await connect(createMemoryStore(), failing);
      const res = await call(client);
      expect(res.isError).toBe(true);
      expect((res.content[0] as { text: string }).text).toBe(`Cin7 error (HTTP ${status}): ${msg}`);
    },
  );

  it('carries dataAsOf, stockAsOf now and the definition in the output', async () => {
    const { client } = await connect();
    const out = (await call(client)).structuredContent!;
    expect(out.dataAsOf).toEqual(expect.any(String));
    expect(out.stockAsOf).toBe('now');
    expect(out.definition).toContain('Reorder suggestions combine Cin7 reorder thresholds');
    expect(out.definition).toContain('suggestedQuantity');
  });

  it('never returns customer names', async () => {
    const { client } = await connect();
    const res = await call(client);
    expect(JSON.stringify(res.structuredContent)).not.toContain('Secret Customer');
    expect((res.content[0] as { text: string }).text).not.toContain('Secret Customer');
    expect((res.content[0] as { text: string }).text).not.toContain('Customer Ltd');
  });
});
