import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { createCin7Client } from '../src/cin7/client.js';
import type { SaleListRow } from '../src/cin7/types.js';
import { registerOrderLookup } from '../src/tools/order-lookup.js';

const config = { accountId: 'acc', applicationKey: 'key', baseUrl: 'https://example.test/v2/' };

/** Advanced sale: master Status reads ORDERED, but it has shipped and is invoiced but unpaid. */
const row = (over: Partial<SaleListRow> = {}): SaleListRow => ({
  SaleID: 'sale-guid-1',
  OrderNumber: 'SO-TEST-1',
  Customer: 'Customer A',
  Type: 'Advanced Sale',
  Status: 'ORDERED',
  OrderStatus: 'ORDERED',
  CombinedPickingStatus: 'PICKED',
  CombinedPackingStatus: 'PACKED',
  CombinedShippingStatus: 'SHIPPED',
  CombinedInvoiceStatus: 'INVOICED',
  CombinedPaymentStatus: 'UNPAID',
  InvoiceAmount: 115,
  PaidAmount: 0,
  ...over,
});

/** Sale detail with personal data that must never reach the model. */
const SALE_DETAIL = {
  ID: 'sale-guid-1',
  Customer: 'Customer A',
  Type: 'Advanced Sale',
  Status: 'ORDERED',
  SourceChannel: 'Manual',
  SaleOrderDate: '2026-10-01T00:00:00',
  Location: 'Main',
  BaseCurrency: 'NZD',
  Contact: 'Contact Person X',
  Email: 'x@example.test',
  Phone: '+64 000 000 000',
  BillingAddress: { Line1: '1 Test Street' },
  Note: 'SECRET-NOTE-XYZ',
  CombinedPickingStatus: 'PICKED',
  CombinedPackingStatus: 'PACKED',
  CombinedShippingStatus: 'SHIPPED',
  CombinedInvoiceStatus: 'INVOICED',
  CombinedPaymentStatus: 'UNPAID',
  Order: {
    SaleOrderNumber: 'SO-TEST-1',
    Total: 115,
    Tax: 15,
    TotalBeforeTax: 100,
    Lines: [{ SKU: 'SKU-1', Name: 'Widget', Quantity: 2, Price: 50, Total: 100 }],
  },
  Fulfilments: [
    {
      FulfillmentNumber: 'F-1',
      FulFilmentStatus: 'SHIPPED',
      Pick: { Status: 'PICKED' },
      Pack: { Status: 'PACKED' },
      Ship: { Status: 'SHIPPED' },
    },
  ],
  Invoices: [
    {
      InvoiceNumber: 'INV-1',
      Status: 'AUTHORISED',
      InvoiceDueDate: '2026-10-31T00:00:00',
      Total: 115,
      Paid: 0,
    },
  ],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Serves `rows` for saleList and `detail` for sale; anything else 404s. Records every URL. */
function stubFetch(rows: SaleListRow[], detail: unknown = SALE_DETAIL) {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = async (url) => {
    const u = String(url);
    urls.push(u);
    if (u.includes('/saleList')) return json({ Total: rows.length, Page: 1, SaleList: rows });
    if (u.includes('/sale?')) return json(detail);
    return json({}, 404);
  };
  return { fetchImpl, urls };
}

async function connect(fetchImpl: typeof fetch) {
  const cin7 = createCin7Client(config, fetchImpl, { minIntervalMs: 0 });
  const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
  registerOrderLookup(server, cin7);
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

async function lookup(
  rows: SaleListRow[],
  orderNumber = 'SO-TEST-1',
  detail: unknown = SALE_DETAIL,
) {
  const { fetchImpl, urls } = stubFetch(rows, detail);
  const client = await connect(fetchImpl);
  const res = await client.callTool({ name: 'order_lookup', arguments: { orderNumber } });
  return { res, urls };
}

interface Output {
  found: boolean;
  orderNumber?: string;
  stage?: { stage: string; fulfilment: string; billing: string; backordered: boolean };
  sale?: { customer: string | null; lines: unknown[]; totalLines: number };
  dataAsOf?: string;
  note?: string;
  reason?: string;
  candidates?: { orderNumber: string | null; customer: string | null; status: string | null }[];
}

describe('order_lookup', () => {
  it('is listed as read-only', async () => {
    const client = await connect(stubFetch([]).fetchImpl);
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'order_lookup');
    expect(tool?.annotations?.readOnlyHint).toBe(true);
    expect(tool?.description).toContain('exact order number');
  });

  it('returns masked detail for an exact match and omits personal data', async () => {
    const { res, urls } = await lookup([row()]);
    expect(res.isError).toBeFalsy();
    const out = res.structuredContent as unknown as Output;
    expect(out.found).toBe(true);
    expect(out.orderNumber).toBe('SO-TEST-1');
    expect(out.sale?.customer).toBe('Customer A');
    expect(out.sale?.lines).toHaveLength(1);
    expect(out.dataAsOf).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(out.note).toBeTruthy();

    const text = JSON.stringify(res.content);
    const structured = JSON.stringify(out);
    for (const secret of [
      'x@example.test',
      '+64 000 000 000',
      '1 Test Street',
      'SECRET-NOTE-XYZ',
      'Contact Person X',
    ]) {
      expect(text).not.toContain(secret);
      expect(structured).not.toContain(secret);
    }
  });

  it('makes exactly two calls on success: saleList Search, then sale by ID', async () => {
    const { urls } = await lookup([row()]);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('/saleList');
    expect(urls[0]).toContain('Search=');
    expect(urls[1]).toContain('/sale?');
    expect(urls[1]).toContain('ID=');
  });

  it('ignores search hits that are not exact order-number matches', async () => {
    const rows = [
      row({ SaleID: 'sale-guid-10', OrderNumber: 'SO-TEST-10' }),
      row({ SaleID: 'sale-guid-2', OrderNumber: 'SO-TEST-2', Customer: 'SO-TEST-1' }),
      row({ SaleID: 'sale-guid-1', OrderNumber: 'SO-TEST-1' }),
    ];
    const { res, urls } = await lookup(rows);
    const out = res.structuredContent as unknown as Output;
    expect(out.found).toBe(true);
    expect(urls[1]).toContain('ID=sale-guid-1');
    expect(urls).toHaveLength(2);
  });

  it('returns candidates and makes only one call when nothing matches exactly', async () => {
    const rows = [row({ SaleID: 'sale-guid-10', OrderNumber: 'SO-TEST-10', Status: 'COMPLETED' })];
    const { res, urls } = await lookup(rows);
    expect(res.isError).toBeFalsy();
    const out = res.structuredContent as unknown as Output;
    expect(out.found).toBe(false);
    expect(out.reason).toBe('no exact match');
    expect(out.candidates).toEqual([
      { orderNumber: 'SO-TEST-10', customer: 'Customer A', status: 'COMPLETED' },
    ]);
    expect(out.stage).toBeUndefined();
    expect(out.sale).toBeUndefined();
    expect(urls).toHaveLength(1);
  });

  it('caps candidates at 10 when nothing matches exactly', async () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      row({ SaleID: `sale-guid-${i}`, OrderNumber: `SO-TEST-1${i}` }),
    );
    const { res } = await lookup(rows);
    const out = res.structuredContent as unknown as Output;
    expect(out.found).toBe(false);
    expect(out.candidates).toHaveLength(10);
  });

  it('returns candidates and makes only one call when several sales share the number', async () => {
    const rows = [
      row({ SaleID: 'sale-guid-a', OrderNumber: 'SO-TEST-1', Customer: 'Customer A' }),
      row({ SaleID: 'sale-guid-b', OrderNumber: 'SO-TEST-1', Customer: 'Customer B' }),
    ];
    const { res, urls } = await lookup(rows);
    expect(res.isError).toBeFalsy();
    const out = res.structuredContent as unknown as Output;
    expect(out.found).toBe(false);
    expect(out.reason).toBe('ambiguous: multiple sales share this order number');
    expect(out.candidates?.map((c) => c.customer)).toEqual(['Customer A', 'Customer B']);
    expect(urls).toHaveLength(1);
  });

  it('matches case-insensitively and ignores surrounding whitespace', async () => {
    const { res, urls } = await lookup([row({ OrderNumber: 'SO-TEST-1' })], '  so-test-1  ');
    const out = res.structuredContent as unknown as Output;
    expect(out.found).toBe(true);
    expect(out.orderNumber).toBe('SO-TEST-1');
    expect(urls[0]).toContain('Search=so-test-1');
    expect(urls).toHaveLength(2);
  });

  it('derives the stage from sub-statuses, not the misleading master status', async () => {
    const { res } = await lookup([row()]);
    const out = res.structuredContent as unknown as Output;
    expect(out.stage).toEqual({
      stage: 'awaiting_payment',
      fulfilment: 'shipped',
      billing: 'unpaid',
      backordered: false,
    });
  });

  it('surfaces Cin7 HTTP errors as tool errors', async () => {
    const client = await connect(async () =>
      json({ ErrorCode: 403, Exception: 'Auth failed' }, 403),
    );
    const res = await client.callTool({
      name: 'order_lookup',
      arguments: { orderNumber: 'SO-TEST-1' },
    });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain('Auth failed');
  });

  it('rejects an empty order number without calling Cin7', async () => {
    const { fetchImpl, urls } = stubFetch([row()]);
    const client = await connect(fetchImpl);
    const res = await client
      .callTool({ name: 'order_lookup', arguments: { orderNumber: '   ' } })
      .catch((e: unknown) => e);
    expect(urls).toHaveLength(0);
    if (res instanceof Error) {
      expect(res.message).toBeTruthy();
    } else {
      expect(res.isError).toBe(true);
    }
  });
});
