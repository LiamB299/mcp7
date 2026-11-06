import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../src/cache/store.js';
import { type CachedSale, emptySnapshot, type Snapshot } from '../src/cache/types.js';
import { registerCacheStatus } from '../src/tools/cache-status.js';

function sale(overrides: Partial<CachedSale> & { id: string }): CachedSale {
  return {
    orderNumber: `SO-${overrides.id}`,
    customerId: 'c1',
    customer: 'Customer A',
    type: 'Simple Sale',
    status: 'ORDERED',
    orderDate: '2026-10-20',
    invoiceDate: '2026-10-21',
    updated: '2026-10-21T10:00:00.1Z',
    updatedMs: Date.parse('2026-10-21T10:00:00.1Z'),
    currency: 'ZAR',
    customerCurrency: 'ZAR',
    currencyRate: 1,
    channel: null,
    taxCalculation: 'Exclusive',
    listInvoiceAmount: 100,
    listPaidAmount: 0,
    listInvoiceStatus: 'INVOICED',
    detailFetched: true,
    pendingDetail: false,
    docs: [],
    ...overrides,
    id: overrides.id,
  };
}

function snapshotWith(sales: CachedSale[]): Snapshot {
  const snap = emptySnapshot('2026-11-01T00:00:00.000Z');
  return {
    ...snap,
    lastSyncAt: '2026-11-05T08:00:00.000Z',
    windowFrom: '2026-10-06',
    cursorMs: Date.parse('2026-11-05T08:00:00.000Z'),
    sales: Object.fromEntries(sales.map((s) => [s.id, s])),
  };
}

/** Connects a server with only cache_status registered. Status takes no Cin7 client. */
async function connect(store: ReturnType<typeof createMemoryStore>) {
  const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
  registerCacheStatus(server, store);
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

async function callStatus(client: Client) {
  const res = await client.callTool({ name: 'cache_status', arguments: {} });
  return res as typeof res & { structuredContent: Record<string, any> };
}

describe('cache_status', () => {
  it('is listed as read-only', async () => {
    const client = await connect(createMemoryStore());
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'cache_status');
    expect(tool?.annotations?.readOnlyHint).toBe(true);
    expect(tool?.description).toMatch(/no Cin7 calls/i);
  });

  it('reports no snapshot with zeros and a note on how to build it', async () => {
    const client = await connect(createMemoryStore());
    const res = await callStatus(client);
    expect(res.isError).toBeFalsy();
    const out = res.structuredContent;
    expect(out.exists).toBe(false);
    expect(out.location).toBe('memory');
    expect(out.sizeBytes).toBeNull();
    expect(out.createdAt).toBeNull();
    expect(out.lastSyncAt).toBeNull();
    expect(out.windowFrom).toBeNull();
    expect(out.sales).toEqual({ total: 0, withDocuments: 0, pendingDetail: 0, voided: 0 });
    expect(out.estimatedMinutesToLoadPending).toBe(0);
    expect(out.rollupDrift).toBeNull();
    expect(out.note).toMatch(/cache_refresh/);
    expect(typeof out.dataAsOf).toBe('string');
  });

  it('counts total, documents, pending and voided sales from a snapshot', async () => {
    const store = createMemoryStore(
      snapshotWith([
        sale({
          id: 'a',
          docs: [
            {
              kind: 'invoice',
              number: 'INV-a',
              date: '2026-10-21',
              status: 'AUTHORISED',
              total: 100,
              totalBeforeTax: 100,
              tax: 0,
              paid: 0,
              dueDate: null,
              additionalCharges: 0,
              lines: [],
            },
          ],
        }),
        sale({ id: 'b', status: 'VOIDED', listInvoiceStatus: null }),
        sale({ id: 'c', detailFetched: false, pendingDetail: true }),
      ]),
    );
    const client = await connect(store);
    const res = await callStatus(client);
    expect(res.isError).toBeFalsy();
    const out = res.structuredContent;
    expect(out.exists).toBe(true);
    expect(out.createdAt).toBe('2026-11-01T00:00:00.000Z');
    expect(out.lastSyncAt).toBe('2026-11-05T08:00:00.000Z');
    expect(out.windowFrom).toBe('2026-10-06');
    expect(out.sales).toEqual({ total: 3, withDocuments: 1, pendingDetail: 1, voided: 1 });
    expect(out.estimatedMinutesToLoadPending).toBe(0);
    expect(out.note).toMatch(/cache_refresh/);
  });

  it('estimates minutes to load pending detail at 1.1 s per call, rounded to 1 dp', async () => {
    const pending = Array.from({ length: 60 }, (_, i) =>
      sale({ id: `p${i}`, detailFetched: false, pendingDetail: true }),
    );
    const client = await connect(createMemoryStore(snapshotWith(pending)));
    const out = (await callStatus(client)).structuredContent;
    expect(out.sales.pendingDetail).toBe(60);
    expect(out.estimatedMinutesToLoadPending).toBe(1.1);
  });

  it('reports the windowFrom null as all history', async () => {
    const snap = { ...snapshotWith([sale({ id: 'a' })]), windowFrom: null };
    const client = await connect(createMemoryStore(snap));
    const out = (await callStatus(client)).structuredContent;
    expect(out.exists).toBe(true);
    expect(out.windowFrom).toBeNull();
  });

  it('reports the store label and size', async () => {
    const client = await connect(createMemoryStore(snapshotWith([sale({ id: 'a' })])));
    const out = (await callStatus(client)).structuredContent;
    expect(out.location).toBe('memory');
    expect(typeof out.sizeBytes).toBe('number');
    expect(out.sizeBytes).toBeGreaterThan(0);
  });

  it('returns rollupDrift as null or the drift counts, never an error, when the drift check fails', async () => {
    const client = await connect(createMemoryStore(snapshotWith([sale({ id: 'a' })])));
    const res = await callStatus(client);
    expect(res.isError).toBeFalsy();
    const drift = res.structuredContent.rollupDrift;
    expect(drift === null || typeof drift.compared === 'number').toBe(true);
  });
});
