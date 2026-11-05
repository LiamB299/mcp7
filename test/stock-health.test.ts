import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { createCin7Client } from '../src/cin7/client.js';
import type { AvailabilityRow, ProductRow } from '../src/cin7/types.js';
import { registerStockHealth } from '../src/tools/stock-health.js';

const config = { accountId: 'acc', applicationKey: 'key', baseUrl: 'https://example.test/v2/' };

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
    MinimumBeforeReorder: 0,
    ReorderQuantity: 0,
    ...overrides,
  };
}

/** Connects a server with only stock_health registered, backed by a stubbed Cin7 fetch. */
async function connect(fetchImpl: typeof fetch) {
  const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
  registerStockHealth(server, createCin7Client(config, fetchImpl, { minIntervalMs: 0 }));
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

/** Routes by path: ref/productavailability and product. Records every requested URL. */
function stub(
  opts: { rows?: AvailabilityRow[]; products?: ProductRow[] } = {},
  seen: string[] = [],
) {
  return async (url: string | URL | Request) => {
    seen.push(String(url));
    const path = new URL(String(url)).pathname;
    if (path.endsWith('/ref/productavailability')) {
      const rows = opts.rows ?? [];
      return new Response(
        JSON.stringify({ Total: rows.length, Page: 1, ProductAvailabilityList: rows }),
      );
    }
    if (path.endsWith('/product')) {
      const products = opts.products ?? [];
      return new Response(JSON.stringify({ Total: products.length, Page: 1, Products: products }));
    }
    return new Response(JSON.stringify({ ErrorCode: 404, Exception: 'Not found' }), {
      status: 404,
    });
  };
}

async function callHealth(client: Client, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name: 'stock_health', arguments: args });
  return res as typeof res & { structuredContent: Record<string, any> };
}

describe('stock_health', () => {
  it('is listed as read-only', async () => {
    const client = await connect(stub());
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === 'stock_health')?.annotations?.readOnlyHint).toBe(true);
  });

  it('counts negative rows and products separately (rows that net out are not negative products)', async () => {
    const client = await connect(
      stub({
        rows: [
          avail({ ID: 'a', Location: 'North', OnHand: -5, Available: -5 }),
          avail({ ID: 'a', Location: 'South', OnHand: 7, Available: 7 }),
          avail({ ID: 'b', Location: 'North', OnHand: 0, Available: -3 }),
        ],
      }),
    );
    const res = await callHealth(client);
    expect(res.isError).toBeFalsy();
    const { negativeAvailable } = res.structuredContent;
    // a: one negative row (-5) nets to +2 across locations, so it is not a negative product.
    // b: one negative row, and it is a negative product.
    expect(negativeAvailable.rows).toBe(2);
    expect(negativeAvailable.products).toBe(1);
    expect(negativeAvailable.top).toEqual([{ sku: 'SKU-b', name: 'Product b', available: -3 }]);
  });

  it('orders negative top lists most negative first and respects topN', async () => {
    const rows = [
      avail({ ID: 'a', Available: -1, OnHand: -1 }),
      avail({ ID: 'b', Available: -9, OnHand: -9 }),
      avail({ ID: 'c', Available: -4, OnHand: -4 }),
      avail({ ID: 'd', Available: 3, OnHand: 3 }),
    ];
    const client = await connect(stub({ rows }));
    const { negativeAvailable } = (await callHealth(client)).structuredContent;
    expect(negativeAvailable.products).toBe(3);
    expect(negativeAvailable.top.map((t: { sku: string }) => t.sku)).toEqual([
      'SKU-b',
      'SKU-c',
      'SKU-a',
    ]);
    const limited = (await callHealth(client, { topN: 2 })).structuredContent;
    expect(limited.negativeAvailable.top).toHaveLength(2);
    expect(limited.negativeAvailable.products).toBe(3);
  });

  it('flags products with stock on order and nothing on hand, ordered by onOrder desc', async () => {
    const client = await connect(
      stub({
        rows: [
          avail({ ID: 'a', OnHand: 0, OnOrder: 4 }),
          avail({ ID: 'b', OnHand: 0, OnOrder: 10 }),
          avail({ ID: 'c', OnHand: 2, OnOrder: 5 }),
          avail({ ID: 'd', OnHand: 0, OnOrder: 0 }),
        ],
      }),
    );
    const { onOrderNothingOnHand } = (await callHealth(client)).structuredContent;
    expect(onOrderNothingOnHand.count).toBe(2);
    expect(onOrderNothingOnHand.top).toEqual([
      { sku: 'SKU-b', name: 'Product b', onOrder: 10 },
      { sku: 'SKU-a', name: 'Product a', onOrder: 4 },
    ]);
  });

  it('checks reorder point with <= and counts products with no availability rows as 0 available', async () => {
    const client = await connect(
      stub({
        rows: [
          avail({ ID: 'atMin', OnHand: 5, Available: 5, OnOrder: 0 }),
          avail({ ID: 'above', OnHand: 6, Available: 6, OnOrder: 0 }),
          avail({ ID: 'low', OnHand: 1, Available: 1, OnOrder: 2 }),
        ],
        products: [
          prod({ ID: 'atMin', MinimumBeforeReorder: 5, ReorderQuantity: 20 }),
          prod({ ID: 'above', MinimumBeforeReorder: 5 }),
          prod({ ID: 'low', MinimumBeforeReorder: 4, ReorderQuantity: 10 }),
          prod({ ID: 'none', MinimumBeforeReorder: 2, ReorderQuantity: 8 }),
          prod({ ID: 'noThreshold', MinimumBeforeReorder: 0 }),
        ],
      }),
    );
    const { belowReorderPoint } = (await callHealth(client)).structuredContent;
    expect(belowReorderPoint.productsWithThreshold).toBe(4);
    expect(belowReorderPoint.productsScanned).toBe(5);
    expect(belowReorderPoint.count).toBe(3);
    // Only "low" has open orders among the below-threshold products.
    expect(belowReorderPoint.withOpenOrder).toBe(1);
    // Sorted by available minus minimum ascending: low (-3), none (-2), atMin (0).
    expect(belowReorderPoint.top).toEqual([
      {
        sku: 'SKU-low',
        name: 'Product low',
        available: 1,
        minimum: 4,
        reorderQuantity: 10,
        onOrder: 2,
      },
      {
        sku: 'SKU-none',
        name: 'Product none',
        available: 0,
        minimum: 2,
        reorderQuantity: 8,
        onOrder: 0,
      },
      {
        sku: 'SKU-atMin',
        name: 'Product atMin',
        available: 5,
        minimum: 5,
        reorderQuantity: 20,
        onOrder: 0,
      },
    ]);
  });

  it('uses the top-level MinimumBeforeReorder and ignores an empty or populated ReorderLevels list', async () => {
    const product = {
      ...prod({ ID: 'p', MinimumBeforeReorder: 5 }),
      ReorderLevels: [{ MinimumBeforeReorder: 99 }],
    } as ProductRow;
    const client = await connect(
      stub({
        rows: [avail({ ID: 'p', OnHand: 8, Available: 8 })],
        products: [product],
      }),
    );
    const { belowReorderPoint } = (await callHealth(client)).structuredContent;
    expect(belowReorderPoint.count).toBe(0);
    expect(belowReorderPoint.top).toEqual([]);
  });

  it('makes no product request and returns belowReorderPoint null when includeReorder is false', async () => {
    const seen: string[] = [];
    const client = await connect(
      stub(
        {
          rows: [avail({ ID: 'a', Available: -1, OnHand: -1 })],
          products: [prod({ ID: 'a', MinimumBeforeReorder: 50 })],
        },
        seen,
      ),
    );
    const res = await callHealth(client, { includeReorder: false });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent.belowReorderPoint).toBeNull();
    expect(res.structuredContent.negativeAvailable.products).toBe(1);
    expect(seen.some((u) => new URL(u).pathname.endsWith('/product'))).toBe(false);
    expect(seen.some((u) => new URL(u).pathname.endsWith('/ref/productavailability'))).toBe(true);
  });

  it('requests the product list by default', async () => {
    const seen: string[] = [];
    const client = await connect(stub({}, seen));
    await callHealth(client);
    expect(seen.some((u) => new URL(u).pathname === '/v2/product')).toBe(true);
  });

  it('lists formula mismatch rows where Available differs from OnHand minus Allocated', async () => {
    const client = await connect(
      stub({
        rows: [
          avail({ ID: 'x', SKU: 'SKU-x', OnHand: 150, Allocated: 0, Available: 183 }),
          avail({ ID: 'y', OnHand: 10, Allocated: 4, Available: 6 }),
        ],
      }),
    );
    const { formulaMismatchRows } = (await callHealth(client)).structuredContent;
    expect(formulaMismatchRows.count).toBe(1);
    expect(formulaMismatchRows.top).toEqual([
      { sku: 'SKU-x', onHand: 150, allocated: 0, available: 183 },
    ]);
    expect(JSON.stringify(formulaMismatchRows)).not.toContain('SKU-y');
  });

  it('caps formula mismatch rows at 10 but reports the full count', async () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      avail({ ID: `m${i}`, OnHand: 1, Allocated: 0, Available: i + 2 }),
    );
    const client = await connect(stub({ rows }));
    const { formulaMismatchRows } = (await callHealth(client)).structuredContent;
    expect(formulaMismatchRows.count).toBe(12);
    expect(formulaMismatchRows.top).toHaveLength(10);
  });

  it('treats null numerics as 0', async () => {
    const client = await connect(
      stub({
        rows: [
          avail({
            ID: 'n',
            OnHand: null as unknown as number,
            Allocated: null as unknown as number,
            Available: null as unknown as number,
            OnOrder: 3,
          }),
        ],
        products: [prod({ ID: 'n', MinimumBeforeReorder: 2 })],
      }),
    );
    const res = await callHealth(client);
    expect(res.isError).toBeFalsy();
    const out = res.structuredContent;
    expect(out.negativeAvailable).toEqual({ rows: 0, products: 0, top: [] });
    expect(out.onOrderNothingOnHand.count).toBe(1);
    expect(out.onOrderNothingOnHand.top[0].onOrder).toBe(3);
    expect(out.formulaMismatchRows.count).toBe(0);
    expect(out.belowReorderPoint.count).toBe(1);
  });

  it('returns zeros, not an error, for empty lists', async () => {
    const client = await connect(stub());
    const res = await callHealth(client);
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toMatchObject({
      rowsScanned: 0,
      productCount: 0,
      negativeAvailable: { rows: 0, products: 0, top: [] },
      onOrderNothingOnHand: { count: 0, top: [] },
      belowReorderPoint: {
        count: 0,
        withOpenOrder: 0,
        productsWithThreshold: 0,
        productsScanned: 0,
      },
      formulaMismatchRows: { count: 0, top: [] },
    });
    expect(typeof res.structuredContent.dataAsOf).toBe('string');
    expect(typeof res.structuredContent.definition).toBe('string');
  });

  it('surfaces Cin7 errors as tool errors', async () => {
    const client = await connect(
      async () =>
        new Response(JSON.stringify({ ErrorCode: 403, Exception: 'Auth failed' }), { status: 403 }),
    );
    const res = await client.callTool({ name: 'stock_health', arguments: {} });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain('Auth failed');
  });
});
