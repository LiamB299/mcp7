import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { createCin7Client } from '../src/cin7/client.js';
import type { PurchaseListRow, SaleListRow } from '../src/cin7/types.js';
import { registerOpenOrdersPipeline } from '../src/tools/open-orders-pipeline.js';

const config = { accountId: 'acc', applicationKey: 'key', baseUrl: 'https://example.test/v2/' };

async function connect(fetchImpl: typeof fetch) {
  const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
  registerOpenOrdersPipeline(server, createCin7Client(config, fetchImpl, { minIntervalMs: 0 }));
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** Serves saleList and purchaseList from the given rows and records every requested URL. */
function stubLists(
  lists: { sales?: SaleListRow[]; purchases?: PurchaseListRow[] },
  seen: string[] = [],
) {
  return async (url: string | URL | Request) => {
    seen.push(String(url));
    const { pathname } = new URL(String(url));
    if (pathname === '/v2/saleList') {
      const rows = lists.sales ?? [];
      return json({ Total: rows.length, Page: 1, SaleList: rows });
    }
    if (pathname === '/v2/purchaseList') {
      const rows = lists.purchases ?? [];
      return json({ Total: rows.length, Page: 1, PurchaseList: rows });
    }
    return json({ ErrorCode: 404, Exception: 'unexpected path' }, 404);
  };
}

async function callPipeline(client: Client, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name: 'open_orders_pipeline', arguments: args });
  return res as typeof res & { structuredContent: Record<string, any> };
}

const SHIPPED = {
  CombinedPickingStatus: 'PICKED',
  CombinedPackingStatus: 'PACKED',
  CombinedShippingStatus: 'SHIPPED',
};

function sale(overrides: Partial<SaleListRow> & { SaleID: string }): SaleListRow {
  return {
    OrderNumber: `SO-${overrides.SaleID}`,
    Customer: 'Customer A',
    Type: 'Simple Sale',
    Status: 'ORDERED',
    ...overrides,
  };
}

function purchase(overrides: Partial<PurchaseListRow> & { ID: string }): PurchaseListRow {
  return {
    OrderNumber: `PO-${overrides.ID}`,
    Supplier: 'Supplier A',
    Status: 'ORDERED',
    ...overrides,
  };
}

/** One sale per pipeline stage, plus the Advanced-sale master-status trap and two closed sales. */
const ONE_OF_EACH: SaleListRow[] = [
  sale({ SaleID: 'quote', Status: 'ESTIMATING' }),
  sale({ SaleID: 'draft', Status: 'ORDERING' }),
  sale({ SaleID: 'pick', CombinedPickingStatus: 'NOT PICKED' }),
  sale({ SaleID: 'picking', CombinedPickingStatus: 'PICKING' }),
  sale({ SaleID: 'awaitPack', CombinedPickingStatus: 'PICKED' }),
  sale({ SaleID: 'packing', CombinedPickingStatus: 'PICKED', CombinedPackingStatus: 'PACKING' }),
  sale({
    SaleID: 'awaitShip',
    CombinedPickingStatus: 'PICKED',
    CombinedPackingStatus: 'PACKED',
  }),
  sale({
    SaleID: 'shipping',
    CombinedPickingStatus: 'PICKED',
    CombinedPackingStatus: 'PACKED',
    CombinedShippingStatus: 'SHIPPING',
  }),
  sale({ SaleID: 'shippedNotInvoiced', ...SHIPPED }),
  sale({
    SaleID: 'advancedTrap',
    Type: 'Advanced Sale',
    ...SHIPPED,
    CombinedInvoiceStatus: 'INVOICED',
    CombinedPaymentStatus: 'UNPAID',
  }),
  sale({
    SaleID: 'paidNotCompleted',
    ...SHIPPED,
    CombinedInvoiceStatus: 'INVOICED',
    CombinedPaymentStatus: 'PAID',
  }),
  sale({ SaleID: 'voided', Status: 'VOIDED' }),
  sale({ SaleID: 'completed', Status: 'COMPLETED' }),
];

const PIPELINE = [
  'quote',
  'order_draft',
  'awaiting_pick',
  'picking',
  'awaiting_pack',
  'packing',
  'awaiting_ship',
  'shipping',
  'awaiting_invoice',
  'awaiting_payment',
  'paid_not_completed',
];

describe('open_orders_pipeline', () => {
  it('is listed as read-only', async () => {
    const client = await connect(stubLists({}));
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'open_orders_pipeline');
    expect(tool?.annotations?.readOnlyHint).toBe(true);
  });

  it('counts every pipeline stage once, in pipeline order, and excludes voided and completed', async () => {
    const client = await connect(stubLists({ sales: ONE_OF_EACH, purchases: [] }));
    const res = await callPipeline(client);
    expect(res.isError).toBeFalsy();
    const { sales } = res.structuredContent;
    expect(sales.scanned).toBe(13);
    expect(sales.open).toBe(11);
    expect(sales.byStage).toEqual(PIPELINE.map((stage) => ({ stage, count: 1 })));
  });

  it('omits stages with zero count from byStage', async () => {
    const client = await connect(
      stubLists({ sales: [sale({ SaleID: 'a', CombinedPickingStatus: 'NOT PICKED' })] }),
    );
    const { sales } = (await callPipeline(client, { includePurchases: false })).structuredContent;
    expect(sales.byStage).toEqual([{ stage: 'awaiting_pick', count: 1 }]);
  });

  it('keeps the Advanced-sale trap under awaiting_payment and counts it as misleading', async () => {
    const trap = sale({
      SaleID: 't',
      Type: 'Advanced Sale',
      Status: ' ordered ',
      ...SHIPPED,
      CombinedInvoiceStatus: 'INVOICED',
      CombinedPaymentStatus: 'UNPAID',
    });
    const client = await connect(stubLists({ sales: [trap] }));
    const { sales } = (await callPipeline(client, { includePurchases: false })).structuredContent;
    expect(sales.byStage).toEqual([{ stage: 'awaiting_payment', count: 1 }]);
    expect(sales.masterStatusMisleading).toBe(1);
    expect(sales.stuck.unpaidInvoiced).toBe(1);
    expect(sales.stuck.shippedNotInvoiced).toBe(0);
  });

  it('does not count a Simple sale ORDERED NOT PICKED as misleading', async () => {
    const client = await connect(
      stubLists({ sales: [sale({ SaleID: 'p', CombinedPickingStatus: 'NOT PICKED' })] }),
    );
    const { sales } = (await callPipeline(client, { includePurchases: false })).structuredContent;
    expect(sales.byStage).toEqual([{ stage: 'awaiting_pick', count: 1 }]);
    expect(sales.masterStatusMisleading).toBe(0);
  });

  it('counts master ORDERED rows that are past picking as misleading across the full fixture set', async () => {
    const client = await connect(stubLists({ sales: ONE_OF_EACH }));
    const { sales } = (await callPipeline(client, { includePurchases: false })).structuredContent;
    // Nine rows are master ORDERED; only the NOT PICKED sale is at awaiting_pick.
    expect(sales.masterStatusMisleading).toBe(8);
  });

  it('reports stuck counters from the open stages', async () => {
    const client = await connect(stubLists({ sales: ONE_OF_EACH }));
    const { sales } = (await callPipeline(client, { includePurchases: false })).structuredContent;
    expect(sales.stuck).toEqual({
      awaitingPick: 1,
      awaitingShip: 1,
      shippedNotInvoiced: 1,
      unpaidInvoiced: 1,
    });
  });

  it('does not count a service sale awaiting invoice as shipped-not-invoiced', async () => {
    const client = await connect(
      stubLists({ sales: [sale({ SaleID: 's', Type: 'Service Sale' })] }),
    );
    const { sales } = (await callPipeline(client, { includePurchases: false })).structuredContent;
    expect(sales.byStage).toEqual([{ stage: 'awaiting_invoice', count: 1 }]);
    expect(sales.stuck.shippedNotInvoiced).toBe(0);
  });

  it('counts backordered open sales', async () => {
    const client = await connect(
      stubLists({
        sales: [
          sale({ SaleID: 'b', Status: 'BACKORDERED', CombinedPickingStatus: 'NOT PICKED' }),
          sale({ SaleID: 'n', CombinedPickingStatus: 'NOT PICKED' }),
        ],
      }),
    );
    const { sales } = (await callPipeline(client, { includePurchases: false })).structuredContent;
    expect(sales.backordered).toBe(1);
    expect(sales.byStage).toEqual([{ stage: 'awaiting_pick', count: 2 }]);
  });

  it('returns zero open sales when only voided and completed rows exist', async () => {
    const client = await connect(
      stubLists({
        sales: [
          sale({ SaleID: 'v', Status: 'VOIDED' }),
          sale({ SaleID: 'c', Status: 'COMPLETED' }),
        ],
      }),
    );
    const { sales } = (await callPipeline(client, { includePurchases: false })).structuredContent;
    expect(sales).toMatchObject({ scanned: 2, open: 0, byStage: [], backordered: 0 });
  });

  it('returns zeros, not an error, for empty lists', async () => {
    const client = await connect(stubLists({ sales: [], purchases: [] }));
    const res = await callPipeline(client);
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent.sales).toMatchObject({
      scanned: 0,
      open: 0,
      byStage: [],
      backordered: 0,
      masterStatusMisleading: 0,
    });
    expect(res.structuredContent.purchases).toMatchObject({
      scanned: 0,
      open: 0,
      byStage: [],
      awaitingReceipt: 0,
    });
  });

  describe('purchases', () => {
    const PURCHASES: PurchaseListRow[] = [
      purchase({ ID: 'draft', Status: 'ORDERING' }),
      purchase({ ID: 'ordered', Status: 'ORDERED', CombinedReceivingStatus: 'NOT RECEIVED' }),
      purchase({ ID: 'partial', Status: 'ORDERED', CombinedReceivingStatus: 'PARTIALLY RECEIVED' }),
      purchase({ ID: 'receiving', Status: 'RECEIVING', CombinedReceivingStatus: 'NOT RECEIVED' }),
      purchase({ ID: 'received', Status: 'RECEIVED' }),
      purchase({
        ID: 'invoicedFull',
        Status: 'INVOICED',
        CombinedReceivingStatus: 'FULLY RECEIVED',
      }),
      purchase({
        ID: 'invoicedNotReceived',
        Status: 'INVOICED',
        CombinedReceivingStatus: 'NOT RECEIVED',
      }),
      purchase({ ID: 'voided', Status: 'VOIDED' }),
      purchase({ ID: 'completed', Status: 'COMPLETED' }),
      purchase({ ID: 'credited', Status: 'CREDITED' }),
    ];

    it('counts open purchases by stage in pipeline order, excluding voided, completed and credited', async () => {
      const client = await connect(stubLists({ sales: [], purchases: PURCHASES }));
      const { purchases } = (await callPipeline(client)).structuredContent;
      expect(purchases.scanned).toBe(10);
      expect(purchases.open).toBe(7);
      expect(purchases.byStage).toEqual([
        { stage: 'order_draft', count: 1 },
        { stage: 'awaiting_receipt', count: 2 },
        { stage: 'receiving', count: 2 },
        { stage: 'awaiting_invoice', count: 1 },
        { stage: 'other', count: 1 },
      ]);
      expect(purchases.awaitingReceipt).toBe(4);
    });

    it('counts ORDERED, RECEIVING and INVOICED-not-received as awaiting receipt only', async () => {
      const client = await connect(
        stubLists({
          purchases: [
            purchase({ ID: 'a', Status: 'ORDERED', CombinedReceivingStatus: 'NOT RECEIVED' }),
            purchase({ ID: 'b', Status: 'RECEIVING', CombinedReceivingStatus: 'NOT RECEIVED' }),
            purchase({ ID: 'c', Status: 'INVOICED', CombinedReceivingStatus: 'NOT RECEIVED' }),
            purchase({ ID: 'd', Status: 'RECEIVED' }),
            purchase({ ID: 'e', Status: 'VOIDED' }),
            purchase({ ID: 'f', Status: 'COMPLETED' }),
            purchase({ ID: 'g', Status: 'ORDERED', CombinedReceivingStatus: 'FULLY RECEIVED' }),
          ],
        }),
      );
      const { purchases } = (await callPipeline(client)).structuredContent;
      expect(purchases.awaitingReceipt).toBe(3);
    });

    it('omits purchases (null) and makes no purchaseList request when includePurchases is false', async () => {
      const seen: string[] = [];
      const client = await connect(stubLists({ sales: ONE_OF_EACH, purchases: PURCHASES }, seen));
      const res = await callPipeline(client, { includePurchases: false });
      expect(res.isError).toBeFalsy();
      expect(res.structuredContent.purchases).toBeNull();
      expect(seen.some((url) => new URL(url).pathname === '/v2/purchaseList')).toBe(false);
      expect(seen.some((url) => new URL(url).pathname === '/v2/saleList')).toBe(true);
    });

    it('requests both lists by default', async () => {
      const seen: string[] = [];
      const client = await connect(stubLists({ sales: [], purchases: PURCHASES }, seen));
      const res = await callPipeline(client);
      expect(res.structuredContent.purchases).not.toBeNull();
      const paths = seen.map((url) => new URL(url).pathname);
      expect(paths).toEqual(['/v2/saleList', '/v2/purchaseList']);
    });
  });

  it('follows pagination with sequential list requests', async () => {
    const seen: string[] = [];
    const salesPages = [
      sale({ SaleID: 'p1', CombinedPickingStatus: 'NOT PICKED' }),
      sale({ SaleID: 'p2', CombinedPickingStatus: 'NOT PICKED' }),
    ];
    const fetchImpl = async (url: string | URL | Request) => {
      seen.push(String(url));
      const u = new URL(String(url));
      if (u.pathname === '/v2/saleList') {
        const page = Number(u.searchParams.get('Page'));
        // Report Total as 2 so the first page (one row) does not end the walk.
        return page === 1
          ? json({ Total: 2, Page: 1, SaleList: [salesPages[0]] })
          : json({ Total: 2, Page: 2, SaleList: [salesPages[1]] });
      }
      return json({ Total: 0, Page: 1, PurchaseList: [] });
    };
    const client = await connect(fetchImpl);
    const res = await callPipeline(client);
    expect(res.structuredContent.sales.scanned).toBe(2);
    expect(res.structuredContent.sales.byStage).toEqual([{ stage: 'awaiting_pick', count: 2 }]);
    const saleRequests = seen.filter((url) => new URL(url).pathname === '/v2/saleList');
    const purchaseRequests = seen.filter((url) => new URL(url).pathname === '/v2/purchaseList');
    expect(saleRequests.map((url) => new URL(url).searchParams.get('Page'))).toEqual(['1', '2']);
    expect(purchaseRequests).toHaveLength(1);
  });

  it('surfaces Cin7 errors as tool errors', async () => {
    const client = await connect(async () =>
      json({ ErrorCode: 403, Exception: 'Auth failed' }, 403),
    );
    const res = await client.callTool({ name: 'open_orders_pipeline', arguments: {} });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain('Auth failed');
  });
});
