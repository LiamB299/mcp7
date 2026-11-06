import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../src/cache/store.js';
import { type Cin7Client, Cin7Error } from '../src/cin7/client.js';
import { registerCacheRefresh } from '../src/tools/cache-refresh.js';

interface FakeSale {
  id: string;
  orderDate: string;
  invoiceDate?: string;
  updated: string;
  status?: string;
  invoiced?: boolean;
}

/**
 * Fake Cin7: `me` (time zone), `saleList` (Page/Limit) and `sale?ID=`. Records every path it serves.
 * Dates are fixed in the past and loads use windowDays 'all', so results do not depend on today's date.
 */
function fakeCin7(sales: FakeSale[]) {
  const log: string[] = [];
  const client: Cin7Client = {
    async get(path: string, query: Record<string, string | number | boolean | undefined> = {}) {
      log.push(path);
      if (path === 'me') return { TimeZone: 'UTC' };
      if (path === 'saleList') {
        const rows = sales.map((s) => ({
          SaleID: s.id,
          OrderNumber: `SO-${s.id}`,
          Customer: 'Customer A',
          CustomerID: 'c1',
          Type: 'Simple Sale',
          Status: s.status ?? 'ORDERED',
          CombinedInvoiceStatus: s.invoiced === false ? 'NOT INVOICED' : 'INVOICED',
          OrderDate: `${s.orderDate}T00:00:00`,
          InvoiceDate: s.invoiceDate ? `${s.invoiceDate}T00:00:00` : null,
          Updated: s.updated,
          BaseCurrency: 'ZAR',
          CustomerCurrency: 'ZAR',
          InvoiceAmount: 100,
          PaidAmount: 0,
        }));
        return { Total: rows.length, Page: 1, SaleList: query.Page === 1 ? rows : [] };
      }
      if (path === 'sale') {
        const s = sales.find((x) => x.id === query.ID);
        if (!s) throw new Cin7Error('not found', 404);
        return {
          ID: s.id,
          LastModifiedOn: s.updated,
          TaxCalculation: 'Exclusive',
          CurrencyRate: 1,
          Invoices: [
            {
              InvoiceNumber: `INV-${s.id}`,
              InvoiceDate: `${s.invoiceDate ?? s.orderDate}T00:00:00`,
              Status: 'AUTHORISED',
              Total: 115,
              TotalBeforeTax: 100,
              Tax: 15,
              Lines: [
                { SKU: 'SKU-0', Quantity: 1, Price: 100, Total: 100, Tax: 15, AverageCost: 40 },
              ],
            },
          ],
        };
      }
      throw new Error(`unexpected ${path}`);
    },
  };
  return { client, log };
}

const sales = (): FakeSale[] => [
  {
    id: 'a',
    orderDate: '2025-10-20',
    invoiceDate: '2025-10-21',
    updated: '2025-10-21T10:00:00.1Z',
  },
  {
    id: 'b',
    orderDate: '2025-10-25',
    invoiceDate: '2025-10-26',
    updated: '2025-10-26T09:00:00.1Z',
  },
  {
    id: 'v',
    orderDate: '2025-10-22',
    updated: '2025-10-22T08:00:00.5Z',
    status: 'VOIDED',
    invoiced: false,
  },
];

/** Connects a server with only cache_refresh registered, backed by the given Cin7 client and store. */
async function connect(cin7: Cin7Client, store: ReturnType<typeof createMemoryStore>) {
  const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
  registerCacheRefresh(server, cin7, store);
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

async function callRefresh(client: Client, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name: 'cache_refresh', arguments: args });
  return res as typeof res & { structuredContent: Record<string, any> };
}

describe('cache_refresh', () => {
  it('is annotated as a non-destructive, idempotent write to the local cache only', async () => {
    const { client: cin7 } = fakeCin7([]);
    const client = await connect(cin7, createMemoryStore());
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'cache_refresh');
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
  });

  it('cold load with windowDays "all" completes, counts sales and details, and carries the note', async () => {
    const { client: cin7, log } = fakeCin7(sales());
    const store = createMemoryStore();
    const client = await connect(cin7, store);
    const res = await callRefresh(client, { windowDays: 'all' });
    expect(res.isError).toBeFalsy();
    const out = res.structuredContent;
    expect(out.complete).toBe(true);
    expect(out.mode).toBe('full');
    expect(out.windowFrom).toBeNull();
    expect(out.headersListed).toBe(3);
    expect(out.fetchedDetails).toBe(2); // a and b; v is voided
    expect(out.remaining).toBe(0);
    expect(out.salesInSnapshot).toBe(3);
    expect(out.estimatedMinutesRemaining).toBe(0);
    expect(out.cin7Calls).toBe(log.length);
    expect(log.filter((p) => p === 'sale')).toHaveLength(2);
    expect(out.note).toMatch(/business names/);
    expect(out.note).toMatch(/no contact data/);
    expect(typeof out.dataAsOf).toBe('string');
    expect((await store.load())!.sales.a!.docs).toHaveLength(1);
  });

  it('a numeric windowDays sets a date windowFrom, and omitting it still loads (default window)', async () => {
    const { client: cin7 } = fakeCin7(sales());
    const store = createMemoryStore();
    const client = await connect(cin7, store);
    const numeric = await callRefresh(client, { windowDays: 30 });
    expect(numeric.isError).toBeFalsy();
    expect(numeric.structuredContent.windowFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(numeric.structuredContent.windowFrom).not.toBeNull();

    const defaults = await callRefresh(client);
    expect(defaults.isError).toBeFalsy();
    expect(defaults.structuredContent.windowFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(defaults.structuredContent.complete).toBe(true);
  });

  it('a second run with no changes is incremental and loads no details', async () => {
    const { client: cin7 } = fakeCin7(sales());
    const client = await connect(cin7, createMemoryStore());
    await callRefresh(client, { windowDays: 'all' });
    const again = await callRefresh(client, { windowDays: 'all' });
    expect(again.structuredContent.mode).toBe('incremental');
    expect(again.structuredContent.fetchedDetails).toBe(0);
    expect(again.structuredContent.complete).toBe(true);
  });

  it('full: true re-lists every header as a full sync', async () => {
    const { client: cin7 } = fakeCin7(sales());
    const client = await connect(cin7, createMemoryStore());
    await callRefresh(client, { windowDays: 'all' });
    const full = await callRefresh(client, { windowDays: 'all', full: true });
    expect(full.structuredContent.mode).toBe('full');
    expect(full.structuredContent.headersListed).toBe(3);
  });

  it('refuses while the store lock is held, with an isError result that says another process is refreshing', async () => {
    const { client: cin7 } = fakeCin7(sales());
    const store = createMemoryStore();
    store.locked = true;
    const client = await connect(cin7, store);
    const res = await callRefresh(client, { windowDays: 'all' });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toMatch(/another process is refreshing/i);
    expect(store.saves).toBe(0);
  });

  it('surfaces Cin7 header errors as tool errors', async () => {
    const cin7: Cin7Client = {
      async get(path: string) {
        if (path === 'me') return { TimeZone: 'UTC' };
        throw new Cin7Error('Auth failed', 403);
      },
    };
    const client = await connect(cin7, createMemoryStore());
    const res = await callRefresh(client, { windowDays: 'all' });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain('Auth failed');
  });

  it('rejects windowDays 0 without touching Cin7 or the store', async () => {
    const { client: cin7, log } = fakeCin7(sales());
    const store = createMemoryStore();
    const client = await connect(cin7, store);
    const rejected = await client
      .callTool({ name: 'cache_refresh', arguments: { windowDays: 0 } })
      .then(
        (r) => r.isError === true,
        () => true,
      );
    expect(rejected).toBe(true);
    expect(log).toEqual([]);
    expect(store.saves).toBe(0);
  });

  it('rejects maxMinutes outside 0.5-15', async () => {
    const client = await connect(fakeCin7(sales()).client, createMemoryStore());
    for (const maxMinutes of [0.1, 16]) {
      const rejected = await client
        .callTool({ name: 'cache_refresh', arguments: { windowDays: 'all', maxMinutes } })
        .then(
          (r) => r.isError === true,
          () => true,
        );
      expect(rejected).toBe(true);
    }
  });

  // Not covered: a maxMinutes budget that stops mid-load (complete false, remaining > 0). syncSnapshot
  // reads the wall clock and the tool does not accept an injected clock, so a fake Cin7 cannot make the
  // budget expire deterministically. The resumable path is covered by test/cache-sync.test.ts.
});
