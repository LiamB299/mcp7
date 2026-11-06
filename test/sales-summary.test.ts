import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { createCin7Client } from '../src/cin7/client.js';
import { registerSalesSummary } from '../src/tools/sales-summary.js';

const config = { accountId: 'acc', applicationKey: 'key', baseUrl: 'https://example.test/v2/' };

type Row = Record<string, unknown>;

function sale(overrides: Row): Row {
  return {
    SaleID: 1,
    OrderNumber: 'SO-1',
    Customer: 'Customer A',
    CustomerID: 1,
    Status: 'COMPLETED',
    OrderDate: '2026-01-15T00:00:00',
    SourceChannel: 'Web',
    InvoiceAmount: 100,
    BaseCurrency: 'USD',
    ...overrides,
  };
}

async function callSummary(rows: Row[], args: Row) {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ Total: rows.length, Page: 1, SaleList: rows }));
  const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
  registerSalesSummary(server, createCin7Client(config, fetchImpl, { minIntervalMs: 0 }));
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client.callTool({ name: 'sales_summary', arguments: args });
}

type Out = any;

describe('sales_summary', () => {
  it('is listed as read-only', async () => {
    const server = new McpServer(
      { name: 'test', version: '0.0.0' },
      { capabilities: { tools: {} } },
    );
    registerSalesSummary(
      server,
      createCin7Client(config, async () => new Response('{}'), { minIntervalMs: 0 }),
    );
    const client = new Client({ name: 'test', version: '0.0.0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === 'sales_summary')?.annotations?.readOnlyHint).toBe(true);
  });

  it('includes both ends of the date range and excludes days outside it', async () => {
    const rows = [
      sale({ SaleID: 1, OrderDate: '2026-01-09T23:00:00', InvoiceAmount: 1 }),
      sale({ SaleID: 2, OrderDate: '2026-01-10T00:00:00', InvoiceAmount: 2 }),
      sale({ SaleID: 3, OrderDate: '2026-01-20T23:59:00', InvoiceAmount: 4 }),
      sale({ SaleID: 4, OrderDate: '2026-01-21T00:00:00', InvoiceAmount: 8 }),
    ];
    const res = await callSummary(rows, { from: '2026-01-10', to: '2026-01-20', groupBy: 'month' });
    const out: Out = res.structuredContent;
    expect(res.isError).toBeFalsy();
    expect(out.salesScanned).toBe(4);
    expect(out.saleCount).toBe(2);
    expect(out.invoicedTotal).toBe(6);
  });

  it('excludes VOIDED sales', async () => {
    const rows = [
      sale({ Status: 'VOIDED', InvoiceAmount: 500 }),
      sale({ Status: 'COMPLETED', InvoiceAmount: 50 }),
    ];
    const res = await callSummary(rows, { from: '2026-01-01', to: '2026-12-31', groupBy: 'month' });
    const out: Out = res.structuredContent;
    expect(out.saleCount).toBe(1);
    expect(out.invoicedTotal).toBe(50);
  });

  it('counts uninvoiced sales in saleCount with zero invoiced', async () => {
    const rows = [sale({ InvoiceAmount: 0, Status: 'ORDERED' }), sale({ InvoiceAmount: 30 })];
    const res = await callSummary(rows, { from: '2026-01-01', to: '2026-01-31', groupBy: 'month' });
    const out: Out = res.structuredContent;
    expect(out.saleCount).toBe(2);
    expect(out.invoicedTotal).toBe(30);
    expect(out.groups).toEqual([{ key: '2026-01', saleCount: 2, invoicedTotal: 30 }]);
  });

  it('returns months in ascending order', async () => {
    const rows = [
      sale({ OrderDate: '2026-03-02T00:00:00' }),
      sale({ OrderDate: '2026-01-02T00:00:00' }),
      sale({ OrderDate: '2026-02-02T00:00:00' }),
    ];
    const res = await callSummary(rows, { from: '2026-01-01', to: '2026-03-31', groupBy: 'month' });
    const out: Out = res.structuredContent;
    expect(out.groups.map((g: { key: string }) => g.key)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
    ]);
    expect(out.other).toBeUndefined();
  });

  it('buckets null and empty SourceChannel as (none)', async () => {
    const rows = [
      sale({ SourceChannel: null, InvoiceAmount: 10 }),
      sale({ SourceChannel: '', InvoiceAmount: 20 }),
      sale({ SourceChannel: 'Web', InvoiceAmount: 5 }),
    ];
    const res = await callSummary(rows, {
      from: '2026-01-01',
      to: '2026-01-31',
      groupBy: 'channel',
    });
    const out: Out = res.structuredContent;
    expect(out.groups).toEqual([
      { key: '(none)', saleCount: 2, invoicedTotal: 30 },
      { key: 'Web', saleCount: 1, invoicedTotal: 5 },
    ]);
  });

  it('groups customers by CustomerID, not by name', async () => {
    const rows = [
      sale({ CustomerID: 7, Customer: 'Customer A', InvoiceAmount: 10 }),
      sale({ CustomerID: 7, Customer: 'Customer A Ltd', InvoiceAmount: 15 }),
      sale({ CustomerID: 8, Customer: 'Customer B', InvoiceAmount: 1 }),
    ];
    const res = await callSummary(rows, {
      from: '2026-01-01',
      to: '2026-01-31',
      groupBy: 'customer',
    });
    const out: Out = res.structuredContent;
    expect(out.groups).toHaveLength(2);
    expect(out.groups[0]).toMatchObject({ customerId: '7', saleCount: 2, invoicedTotal: 25 });
    expect(out.groups[1]).toMatchObject({ customerId: '8', saleCount: 1, invoicedTotal: 1 });
  });

  it('keeps topN groups and rolls the rest into other', async () => {
    const rows = [
      sale({ CustomerID: 1, Customer: 'Customer A', InvoiceAmount: 300 }),
      sale({ CustomerID: 2, Customer: 'Customer B', InvoiceAmount: 200 }),
      sale({ CustomerID: 3, Customer: 'Customer C', InvoiceAmount: 50.1 }),
      sale({ CustomerID: 3, Customer: 'Customer C', InvoiceAmount: 0.2 }),
    ];
    const res = await callSummary(rows, {
      from: '2026-01-01',
      to: '2026-01-31',
      groupBy: 'customer',
      topN: 2,
    });
    const out: Out = res.structuredContent;
    expect(out.groups.map((g: { key: string }) => g.key)).toEqual(['Customer A', 'Customer B']);
    expect(out.other).toEqual({ groups: 1, saleCount: 2, invoicedTotal: 50.3 });
    expect(out.saleCount).toBe(4);
    expect(out.invoicedTotal).toBe(550.3);
  });

  it('sums negative InvoiceAmount values as given by Cin7', async () => {
    const rows = [sale({ InvoiceAmount: 100 }), sale({ InvoiceAmount: -40.25 })];
    const res = await callSummary(rows, { from: '2026-01-01', to: '2026-01-31', groupBy: 'month' });
    const out: Out = res.structuredContent;
    expect(out.invoicedTotal).toBe(59.75);
    expect(out.groups[0].invoicedTotal).toBe(59.75);
  });

  it('rejects from after to with an error result', async () => {
    const res = await callSummary([], { from: '2026-02-01', to: '2026-01-01', groupBy: 'month' });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain('must not be after');
  });

  it('rejects malformed dates with an error result', async () => {
    const res = await callSummary([], { from: '01/01/2026', to: '2026-01-31', groupBy: 'month' });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain('yyyy-MM-dd');
  });

  it('rejects impossible calendar dates', async () => {
    const res = await callSummary([], { from: '2026-02-30', to: '2026-03-31', groupBy: 'month' });
    expect(res.isError).toBe(true);
  });

  it('treats omitted from and to as all time, including old and undated sales', async () => {
    const rows = [
      sale({ SaleID: 1, OrderDate: '1999-06-01T00:00:00', InvoiceAmount: 1 }),
      sale({ SaleID: 2, OrderDate: '2026-01-15T00:00:00', InvoiceAmount: 2 }),
      sale({ SaleID: 3, OrderDate: '2031-12-31T00:00:00', InvoiceAmount: 4 }),
      sale({ SaleID: 4, OrderDate: null, InvoiceAmount: 8 }),
    ];
    const res = await callSummary(rows, { groupBy: 'channel' });
    const out: Out = res.structuredContent;
    expect(res.isError).toBeFalsy();
    expect(out.from).toBeNull();
    expect(out.to).toBeNull();
    expect(out.saleCount).toBe(4);
    expect(out.invoicedTotal).toBe(15);
  });

  it('applies only a lower bound when only from is given', async () => {
    const rows = [
      sale({ SaleID: 1, OrderDate: '2025-12-31T23:59:00', InvoiceAmount: 1 }),
      sale({ SaleID: 2, OrderDate: '2026-01-10T00:00:00', InvoiceAmount: 2 }),
      sale({ SaleID: 3, OrderDate: '2030-05-05T00:00:00', InvoiceAmount: 4 }),
      sale({ SaleID: 4, OrderDate: null, InvoiceAmount: 8 }),
    ];
    const res = await callSummary(rows, { from: '2026-01-10', groupBy: 'channel' });
    const out: Out = res.structuredContent;
    expect(res.isError).toBeFalsy();
    expect(out.from).toBe('2026-01-10');
    expect(out.to).toBeNull();
    expect(out.saleCount).toBe(2);
    expect(out.invoicedTotal).toBe(6);
  });

  it('applies only an upper bound when only to is given', async () => {
    const rows = [
      sale({ SaleID: 1, OrderDate: '1999-06-01T00:00:00', InvoiceAmount: 1 }),
      sale({ SaleID: 2, OrderDate: '2026-01-20T23:59:00', InvoiceAmount: 2 }),
      sale({ SaleID: 3, OrderDate: '2026-01-21T00:00:00', InvoiceAmount: 4 }),
      sale({ SaleID: 4, OrderDate: null, InvoiceAmount: 8 }),
    ];
    const res = await callSummary(rows, { to: '2026-01-20', groupBy: 'channel' });
    const out: Out = res.structuredContent;
    expect(res.isError).toBeFalsy();
    expect(out.from).toBeNull();
    expect(out.to).toBe('2026-01-20');
    expect(out.saleCount).toBe(2);
    expect(out.invoicedTotal).toBe(3);
  });

  it('excludes undated sales from a bounded range but groups them under (no date) by month when unbounded', async () => {
    const rows = [
      sale({ SaleID: 1, OrderDate: '2026-01-15T00:00:00', InvoiceAmount: 10 }),
      sale({ SaleID: 2, OrderDate: null, InvoiceAmount: 5 }),
    ];
    const bounded = await callSummary(rows, {
      from: '2026-01-01',
      to: '2026-01-31',
      groupBy: 'month',
    });
    const boundedOut: Out = bounded.structuredContent;
    expect(boundedOut.saleCount).toBe(1);
    expect(boundedOut.groups.map((g: { key: string }) => g.key)).toEqual(['2026-01']);

    const unbounded = await callSummary(rows, { groupBy: 'month' });
    const unboundedOut: Out = unbounded.structuredContent;
    expect(unboundedOut.saleCount).toBe(2);
    expect(unboundedOut.invoicedTotal).toBe(15);
    expect(unboundedOut.groups).toContainEqual({
      key: '(no date)',
      saleCount: 1,
      invoicedTotal: 5,
    });
    expect(unboundedOut.groups).toContainEqual({ key: '2026-01', saleCount: 1, invoicedTotal: 10 });
  });

  it('still rejects a malformed to when from is omitted', async () => {
    const res = await callSummary([], { to: '31/01/2026', groupBy: 'month' });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain('yyyy-MM-dd');
  });

  it('still rejects a malformed from when to is omitted', async () => {
    const res = await callSummary([], { from: '2026-02-30', groupBy: 'month' });
    expect(res.isError).toBe(true);
  });
});
