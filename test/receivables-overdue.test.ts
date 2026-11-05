import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { createCin7Client } from '../src/cin7/client.js';
import { registerReceivablesOverdue } from '../src/tools/receivables-overdue.js';

const config = { accountId: 'acc', applicationKey: 'key', baseUrl: 'https://example.test/v2/' };
const ASOF = '2026-11-05';

/** `yyyy-MM-dd` for ASOF minus `n` days, as Cin7 datetime text. */
function dueAgo(n: number): string {
  const d = new Date(`${ASOF}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return `${d.toISOString().slice(0, 10)}T00:00:00`;
}

interface Row {
  SaleID?: string;
  OrderNumber?: string;
  Customer?: string;
  CustomerID?: string;
  Status?: string;
  InvoiceAmount?: number;
  PaidAmount?: number;
  InvoiceDueDate?: string | null;
  InvoiceNumber?: string;
  BaseCurrency?: string;
}

const sale = (overrides: Row): Row => ({
  SaleID: 's1',
  OrderNumber: 'SO-1',
  Customer: 'Customer A',
  CustomerID: 'c10',
  Status: 'ORDERED',
  InvoiceAmount: 100,
  PaidAmount: 0,
  InvoiceDueDate: dueAgo(10),
  InvoiceNumber: 'INV-1',
  BaseCurrency: 'USD',
  ...overrides,
});

interface Money {
  count: number;
  total: number;
}
interface Output {
  asOf: string;
  currency: string | null;
  salesScanned: number;
  outstanding: Money;
  overdue: Money;
  noDueDate: Money;
  ageBuckets: Record<'1-30' | '31-60' | '61-90' | '90+', Money>;
  top: {
    orderNumber: string | null;
    customer: string | null;
    customerId: string | null;
    dueDate: string;
    daysOverdue: number;
    outstanding: number;
  }[];
  definition: string;
}

/** Stub for `saleList` that serves `rows` in one page; other paths get 404. */
function saleFetch(rows: Row[]): typeof fetch {
  return async (url) => {
    if (String(url).includes('/saleList')) {
      return new Response(JSON.stringify({ Total: rows.length, Page: 1, SaleList: rows }));
    }
    return new Response('{}', { status: 404 });
  };
}

async function connect(fetchImpl: typeof fetch) {
  const cin7 = createCin7Client(config, fetchImpl, { minIntervalMs: 0 });
  const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
  registerReceivablesOverdue(server, cin7);
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

async function run(rows: Row[], args: Record<string, unknown> = { asOf: ASOF }) {
  const client = await connect(saleFetch(rows));
  const res = await client.callTool({ name: 'receivables_overdue', arguments: args });
  return res;
}

async function runOk(rows: Row[], args: Record<string, unknown> = { asOf: ASOF }): Promise<Output> {
  const res = await run(rows, args);
  expect(res.isError).toBeFalsy();
  return res.structuredContent as unknown as Output;
}

describe('receivables_overdue', () => {
  it('is listed as read-only', async () => {
    const client = await connect(saleFetch([]));
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'receivables_overdue');
    expect(tool?.annotations?.readOnlyHint).toBe(true);
  });

  it('excludes VOIDED sales', async () => {
    const out = await runOk([
      sale({ SaleID: 's1', Status: 'VOIDED', InvoiceAmount: 500 }),
      sale({ SaleID: 's2', Status: 'ORDERED', InvoiceAmount: 40 }),
    ]);
    expect(out.salesScanned).toBe(2);
    expect(out.outstanding).toEqual({ count: 1, total: 40 });
    expect(out.overdue).toEqual({ count: 1, total: 40 });
  });

  it('ignores overpaid and credited rows without netting them against others', async () => {
    const out = await runOk([
      sale({ SaleID: 's1', InvoiceAmount: 100, PaidAmount: 120 }),
      sale({ SaleID: 's2', InvoiceAmount: -50, PaidAmount: 0 }),
      sale({ SaleID: 's3', InvoiceAmount: 80, PaidAmount: 80 }),
      sale({ SaleID: 's4', InvoiceAmount: 50, PaidAmount: 0 }),
    ]);
    expect(out.outstanding).toEqual({ count: 1, total: 50 });
    expect(out.overdue).toEqual({ count: 1, total: 50 });
  });

  it('treats a due date equal to asOf as not overdue', async () => {
    const out = await runOk([
      sale({ SaleID: 's1', InvoiceDueDate: `${ASOF}T00:00:00`, InvoiceAmount: 10 }),
      sale({ SaleID: 's2', InvoiceDueDate: dueAgo(1), InvoiceAmount: 20, OrderNumber: 'SO-2' }),
    ]);
    expect(out.outstanding.count).toBe(2);
    expect(out.overdue).toEqual({ count: 1, total: 20 });
    expect(out.top).toHaveLength(1);
    expect(out.top[0]).toMatchObject({ orderNumber: 'SO-2', daysOverdue: 1, outstanding: 20 });
  });

  it('places days overdue in the right age buckets at the edges', async () => {
    const days = [30, 31, 60, 61, 90, 91];
    const out = await runOk(
      days.map((d, i) =>
        sale({
          SaleID: i + 1,
          OrderNumber: `SO-${d}`,
          InvoiceAmount: 10,
          InvoiceDueDate: dueAgo(d),
        }),
      ),
    );
    expect(out.ageBuckets['1-30']).toEqual({ count: 1, total: 10 });
    expect(out.ageBuckets['31-60']).toEqual({ count: 2, total: 20 });
    expect(out.ageBuckets['61-90']).toEqual({ count: 2, total: 20 });
    expect(out.ageBuckets['90+']).toEqual({ count: 1, total: 10 });
    expect(out.overdue).toEqual({ count: 6, total: 60 });
  });

  it('counts outstanding rows with no due date under noDueDate, not overdue', async () => {
    const out = await runOk([
      sale({ SaleID: 's1', InvoiceDueDate: null, InvoiceAmount: 75 }),
      sale({ SaleID: 's2', InvoiceDueDate: 'not-a-date', InvoiceAmount: 25 }),
      sale({ SaleID: 's3', InvoiceAmount: 5 }),
    ]);
    expect(out.noDueDate).toEqual({ count: 2, total: 100 });
    expect(out.outstanding).toEqual({ count: 3, total: 105 });
    expect(out.overdue).toEqual({ count: 1, total: 5 });
  });

  it('collects every page of saleList', async () => {
    const pages: Record<string, Row[]> = {
      '1': [sale({ SaleID: 's1', OrderNumber: 'SO-A', InvoiceAmount: 30 })],
      '2': [sale({ SaleID: 's2', OrderNumber: 'SO-B', InvoiceAmount: 40 })],
    };
    const fetchImpl: typeof fetch = async (url) => {
      const u = new URL(String(url));
      const page = u.searchParams.get('Page') ?? '1';
      return new Response(
        JSON.stringify({ Total: 2, Page: Number(page), SaleList: pages[page] ?? [] }),
      );
    };
    const cin7 = createCin7Client(config, fetchImpl, { minIntervalMs: 0 });
    const server = new McpServer(
      { name: 'test', version: '0.0.0' },
      { capabilities: { tools: {} } },
    );
    registerReceivablesOverdue(server, cin7);
    const client = new Client({ name: 'test', version: '0.0.0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const res = await client.callTool({ name: 'receivables_overdue', arguments: { asOf: ASOF } });
    const out = res.structuredContent as unknown as Output;
    expect(out.salesScanned).toBe(2);
    expect(out.outstanding).toEqual({ count: 2, total: 70 });
  });

  it('limits top to topN, largest outstanding first', async () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      sale({
        SaleID: i + 1,
        OrderNumber: `SO-${i}`,
        InvoiceAmount: 10 + i,
        InvoiceDueDate: dueAgo(5),
      }),
    );
    const defaulted = await runOk(rows);
    expect(defaulted.top).toHaveLength(10);
    expect(defaulted.top[0]?.outstanding).toBe(21);
    expect(defaulted.top[9]?.outstanding).toBe(12);

    const limited = await runOk(rows, { asOf: ASOF, topN: 2 });
    expect(limited.top.map((t) => t.outstanding)).toEqual([21, 20]);
    expect(limited.overdue.count).toBe(12);
  });

  it('reports currency from the first row and echoes the definition', async () => {
    const out = await runOk([sale({ BaseCurrency: 'NZD' })]);
    expect(out.currency).toBe('NZD');
    expect(out.asOf).toBe(ASOF);
    expect(out.definition).toContain('VOIDED');
  });

  it('uses today in the tenant time zone when asOf is omitted', async () => {
    const fetchImpl: typeof fetch = async (url) => {
      if (String(url).endsWith('/me')) return new Response(JSON.stringify({ TimeZone: 'UTC' }));
      return new Response(JSON.stringify({ Total: 0, SaleList: [] }));
    };
    const client = await connect(fetchImpl);
    const res = await client.callTool({ name: 'receivables_overdue', arguments: {} });
    const out = res.structuredContent as unknown as Output;
    expect(out.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('rejects an invalid asOf as a tool error', async () => {
    const res = await run([], { asOf: '05/11/2026' });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain('yyyy-MM-dd');
  });

  it('surfaces Cin7 HTTP errors as tool errors', async () => {
    const client = await connect(
      async () =>
        new Response(JSON.stringify({ ErrorCode: 403, Exception: 'Auth failed' }), { status: 403 }),
    );
    const res = await client.callTool({ name: 'receivables_overdue', arguments: { asOf: ASOF } });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain('Auth failed');
  });
});
