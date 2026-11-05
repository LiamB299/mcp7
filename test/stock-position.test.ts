import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { createCin7Client } from '../src/cin7/client.js';
import { registerStockPosition } from '../src/tools/stock-position.js';

const config = { accountId: 'acc', applicationKey: 'key', baseUrl: 'https://example.test/v2/' };

interface Row {
  ID: string;
  SKU: string;
  Name: string;
  Location: string;
  Batch?: string;
  OnHand: number;
  Available: number;
  StockOnHand: number;
}

function row(overrides: Partial<Row> & { ID: string }): Row {
  return {
    SKU: `SKU-${overrides.ID}`,
    Name: `Product ${overrides.ID}`,
    Location: 'Main',
    Batch: '',
    OnHand: 0,
    Available: 0,
    StockOnHand: 0,
    ...overrides,
  };
}

/** Connects a server with only stock_position registered, backed by a stubbed Cin7 fetch. */
async function connect(fetchImpl: typeof fetch) {
  const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
  registerStockPosition(server, createCin7Client(config, fetchImpl, { minIntervalMs: 0 }));
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

/** Fetch stub that serves one page of rows and records every requested URL. */
function stubRows(rows: Row[], seen: string[] = []) {
  return async (url: string | URL | Request) => {
    seen.push(String(url));
    return new Response(
      JSON.stringify({ Total: rows.length, Page: 1, ProductAvailabilityList: rows }),
    );
  };
}

async function callStock(client: Client, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name: 'stock_position', arguments: args });
  return res as typeof res & {
    structuredContent: Record<string, any>;
  };
}

describe('stock_position', () => {
  it('is listed as read-only', async () => {
    const client = await connect(stubRows([]));
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === 'stock_position')?.annotations?.readOnlyHint).toBe(true);
  });

  it('totals StockOnHand as value and OnHand as units', async () => {
    const client = await connect(
      stubRows([
        row({ ID: 'a', OnHand: 10, StockOnHand: 100.004 }),
        row({ ID: 'b', OnHand: 5.5, StockOnHand: 250.1 }),
      ]),
    );
    const res = await callStock(client);
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent.totalValue).toBe(350.1);
    expect(res.structuredContent.totalUnits).toBe(15.5);
    expect(res.structuredContent.rowsScanned).toBe(2);
    expect(res.structuredContent.productCount).toBe(2);
    expect(res.structuredContent.location).toBeNull();
  });

  it('rolls up by location and sorts by value descending', async () => {
    const client = await connect(
      stubRows([
        row({ ID: 'a', Location: 'North', OnHand: 1, StockOnHand: 10 }),
        row({ ID: 'b', Location: 'South', OnHand: 4, StockOnHand: 300 }),
        row({ ID: 'c', Location: 'North', OnHand: 2, StockOnHand: 40 }),
        row({ ID: 'b', Location: 'North', OnHand: 3, StockOnHand: 60 }),
      ]),
    );
    const { byLocation } = (await callStock(client)).structuredContent;
    expect(byLocation).toEqual([
      { location: 'South', value: 300, units: 4, productCount: 1 },
      { location: 'North', value: 110, units: 6, productCount: 3 },
    ]);
  });

  it('aggregates top products across locations, bins and batches by product ID', async () => {
    const client = await connect(
      stubRows([
        row({ ID: 'a', Location: 'North', Batch: 'B1', OnHand: 2, StockOnHand: 20 }),
        row({ ID: 'a', Location: 'North', Batch: 'B2', OnHand: 3, StockOnHand: 30 }),
        row({ ID: 'a', Location: 'South', OnHand: 5, StockOnHand: 50 }),
        row({ ID: 'b', Location: 'North', OnHand: 1, StockOnHand: 90 }),
      ]),
    );
    const res = await callStock(client);
    expect(res.structuredContent.productCount).toBe(2);
    expect(res.structuredContent.topProducts).toEqual([
      { sku: 'SKU-a', name: 'Product a', value: 100, units: 10 },
      { sku: 'SKU-b', name: 'Product b', value: 90, units: 1 },
    ]);
  });

  it('limits topProducts to topN, defaulting to 10', async () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      row({ ID: `p${i}`, OnHand: 1, StockOnHand: i + 1 }),
    );
    const client = await connect(stubRows(rows));
    expect((await callStock(client)).structuredContent.topProducts).toHaveLength(10);
    expect((await callStock(client, { topN: 3 })).structuredContent.topProducts).toEqual([
      { sku: 'SKU-p11', name: 'Product p11', value: 12, units: 1 },
      { sku: 'SKU-p10', name: 'Product p10', value: 11, units: 1 },
      { sku: 'SKU-p9', name: 'Product p9', value: 10, units: 1 },
    ]);
  });

  it('rejects topN outside 1-50', async () => {
    const client = await connect(stubRows([]));
    const res = await client.callTool({ name: 'stock_position', arguments: { topN: 51 } });
    expect(res.isError).toBe(true);
  });

  it('sends the location filter as the Location query param', async () => {
    const seen: string[] = [];
    const client = await connect(stubRows([row({ ID: 'a' })], seen));
    const res = await callStock(client, { location: 'Warehouse 2' });
    expect(res.structuredContent.location).toBe('Warehouse 2');
    expect(seen).toHaveLength(1);
    const url = new URL(seen[0] as string);
    expect(url.pathname).toBe('/v2/ref/productavailability');
    expect(url.searchParams.get('Location')).toBe('Warehouse 2');
  });

  it('omits the Location param when no filter is given', async () => {
    const seen: string[] = [];
    const client = await connect(stubRows([], seen));
    await callStock(client);
    expect(new URL(seen[0] as string).searchParams.has('Location')).toBe(false);
  });

  it('counts negative Available per row and per product', async () => {
    const client = await connect(
      stubRows([
        row({ ID: 'a', Location: 'North', Available: -2 }),
        row({ ID: 'a', Location: 'South', Available: -1 }),
        row({ ID: 'b', Location: 'North', Available: -3 }),
        row({ ID: 'b', Location: 'South', Available: 5 }),
        row({ ID: 'c', Location: 'North', Available: 4 }),
      ]),
    );
    const { negativeAvailable } = (await callStock(client)).structuredContent;
    // Rows: a/North, a/South, b/North are negative. Products: a sums to -3, b sums to 2 (not negative).
    expect(negativeAvailable).toEqual({ rows: 3, products: 1 });
  });

  it('returns zeros, not an error, for an empty result', async () => {
    const client = await connect(stubRows([]));
    const res = await callStock(client);
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toMatchObject({
      rowsScanned: 0,
      productCount: 0,
      totalValue: 0,
      totalUnits: 0,
      byLocation: [],
      topProducts: [],
      negativeAvailable: { rows: 0, products: 0 },
    });
  });

  it('surfaces Cin7 errors as tool errors', async () => {
    const client = await connect(
      async () =>
        new Response(JSON.stringify({ ErrorCode: 403, Exception: 'Auth failed' }), { status: 403 }),
    );
    const res = await client.callTool({ name: 'stock_position', arguments: {} });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain('Auth failed');
  });
});
