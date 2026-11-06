import { describe, expect, it } from 'vitest';
import { CacheLockedError, createMemoryStore } from '../src/cache/store.js';
import { syncSnapshot } from '../src/cache/sync.js';
import { type Cin7Client, Cin7Error } from '../src/cin7/client.js';

interface FakeSale {
  id: string;
  orderDate: string;
  invoiceDate?: string;
  updated: string;
  status?: string;
  invoiced?: boolean;
  lines?: number;
}

/** Fake Cin7: honours Page/Limit and UpdatedSince like the real list, counts every call. */
function fakeApi(sales: FakeSale[]) {
  const log: string[] = [];
  const failDetailAt = { n: 0 };
  const api = {
    sales,
    log,
    failDetailAt,
    client: {
      async get(path: string, query: Record<string, string | number | boolean | undefined> = {}) {
        log.push(
          path === 'saleList' ? `list${query.UpdatedSince ? ':since' : ':full'}` : `${path}`,
        );
        if (path === 'saleList') {
          const since = query.UpdatedSince ? Date.parse(`${query.UpdatedSince}Z`) : 0;
          const rows = sales
            .filter((s) => Date.parse(s.updated.replace(/(\.\d{3})\d+/, '$1')) >= since)
            .map((s) => ({
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
          if (failDetailAt.n && log.filter((l) => l === 'sale').length === failDetailAt.n)
            throw new Cin7Error('boom', 500);
          const s = sales.find((x) => x.id === query.ID);
          if (!s) throw new Cin7Error('not found', 404);
          return {
            ID: s.id,
            LastModifiedOn: s.updated,
            TaxCalculation: 'Exclusive',
            CurrencyRate: 1,
            Email: 'secret@example.test',
            Invoices: [
              {
                InvoiceNumber: `INV-${s.id}`,
                InvoiceDate: `${s.invoiceDate ?? s.orderDate}T00:00:00`,
                Status: 'AUTHORISED',
                Total: 115,
                TotalBeforeTax: 100,
                Tax: 15,
                Lines: Array.from({ length: s.lines ?? 1 }, (_, i) => ({
                  SKU: `SKU-${i}`,
                  Quantity: 1,
                  Price: 100,
                  Total: 100,
                  Tax: 15,
                  AverageCost: 40,
                })),
              },
            ],
          };
        }
        throw new Error(`unexpected ${path}`);
      },
    } as Cin7Client,
  };
  return api;
}

const base = (over: Partial<Parameters<typeof syncSnapshot>[1]> = {}) => ({
  asOf: '2026-11-05',
  windowDays: 30,
  ...over,
});
const sales = (): FakeSale[] => [
  {
    id: 'a',
    orderDate: '2026-10-20',
    invoiceDate: '2026-10-21',
    updated: '2026-10-21T10:00:00.1234Z',
  },
  {
    id: 'b',
    orderDate: '2026-10-25',
    invoiceDate: '2026-10-26',
    updated: '2026-10-26T09:00:00.12Z',
  },
  {
    id: 'v',
    orderDate: '2026-10-22',
    updated: '2026-10-22T08:00:00.5Z',
    status: 'VOIDED',
    invoiced: false,
  },
  { id: 'n', orderDate: '2026-10-23', updated: '2026-10-23T08:00:00.5Z', invoiced: false },
  {
    id: 'old',
    orderDate: '2025-01-01',
    invoiceDate: '2025-01-02',
    updated: '2025-01-02T08:00:00.5Z',
  },
];

describe('syncSnapshot', () => {
  it('cold load: fetches details only for invoiced, non-voided, in-window sales', async () => {
    const api = fakeApi(sales());
    const store = createMemoryStore();
    const r = await syncSnapshot({ cin7: api.client, store }, base());
    expect(r.complete).toBe(true);
    expect(r.mode).toBe('full');
    expect(r.fetchedDetails).toBe(2);
    expect(r.cin7Calls).toBe(3); // 1 list + 2 details
    const snap = (await store.load())!;
    expect(Object.keys(snap.sales).sort()).toEqual(['a', 'b', 'n', 'old', 'v']);
    expect(snap.sales.a!.docs).toHaveLength(1);
    expect(snap.sales.v!.docs).toHaveLength(0);
    expect(snap.sales.old!.detailFetched).toBe(false); // out of window: header only
    expect(snap.sales.old!.pendingDetail).toBe(false);
    expect(snap.windowFrom).toBe('2026-10-06');
  });

  it('no-change refresh costs 1 list call and 0 details', async () => {
    const api = fakeApi(sales());
    const store = createMemoryStore();
    await syncSnapshot({ cin7: api.client, store }, base());
    api.log.length = 0;
    const r = await syncSnapshot({ cin7: api.client, store }, base());
    expect(r.mode).toBe('incremental');
    expect(r.cin7Calls).toBe(1);
    expect(r.fetchedDetails).toBe(0);
    expect(r.complete).toBe(true);
  });

  it('refetches a changed sale and a newly invoiced sale only', async () => {
    const api = fakeApi(sales());
    const store = createMemoryStore();
    await syncSnapshot({ cin7: api.client, store }, base());
    api.sales[0]!.updated = '2026-11-02T10:00:00.9Z'; // a changed
    api.sales[3]!.invoiced = true; // n newly invoiced
    api.sales[3]!.invoiceDate = '2026-11-03';
    api.sales[3]!.updated = '2026-11-03T10:00:00.1Z';
    api.log.length = 0;
    const r = await syncSnapshot({ cin7: api.client, store }, base());
    expect(r.fetchedDetails).toBe(2);
    expect(r.cin7Calls).toBe(3);
    const snap = (await store.load())!;
    expect(snap.sales.n!.docs).toHaveLength(1);
    expect(snap.sales.a!.updated).toBe('2026-11-02T10:00:00.9Z');
  });

  it('a sale voided after being cached loses its documents', async () => {
    const api = fakeApi(sales());
    const store = createMemoryStore();
    await syncSnapshot({ cin7: api.client, store }, base());
    api.sales[1]!.status = 'VOIDED';
    api.sales[1]!.updated = '2026-11-04T10:00:00.1Z';
    await syncSnapshot({ cin7: api.client, store }, base());
    const b = (await store.load())!.sales.b!;
    expect(b.status).toBe('VOIDED');
    expect(b.docs).toHaveLength(0);
    expect(b.detailFetched).toBe(true);
  });

  it('stops at the time budget with pending work persisted, then resumes without refetching', async () => {
    const many = Array.from(
      { length: 6 },
      (_, i): FakeSale => ({
        id: `s${i}`,
        orderDate: '2026-10-30',
        invoiceDate: `2026-10-${10 + i}`,
        updated: `2026-10-${10 + i}T00:00:00.1Z`,
      }),
    );
    const api = fakeApi(many);
    const store = createMemoryStore();
    let t = 0;
    const clock = () => (t += 1000); // each clock read advances 1 s
    const first = await syncSnapshot(
      { cin7: api.client, store },
      base({ now: clock, maxMs: 4500 }),
    );
    expect(first.complete).toBe(false);
    expect(first.remaining).toBeGreaterThan(0);
    expect(first.fetchedDetails).toBeLessThan(6);
    const stored = (await store.load())!;
    expect(Object.values(stored.sales).filter((s) => s.pendingDetail)).toHaveLength(
      first.remaining,
    );
    api.log.length = 0;
    const second = await syncSnapshot({ cin7: api.client, store }, base());
    expect(second.complete).toBe(true);
    expect(second.fetchedDetails).toBe(first.remaining);
    expect(api.log.filter((l) => l === 'sale')).toHaveLength(first.remaining);
  });

  it('records an error mid-load, keeps what was fetched, and resumes', async () => {
    const many = Array.from(
      { length: 5 },
      (_, i): FakeSale => ({
        id: `s${i}`,
        orderDate: '2026-10-30',
        invoiceDate: `2026-10-${10 + i}`,
        updated: `2026-10-${10 + i}T00:00:00.1Z`,
      }),
    );
    const api = fakeApi(many);
    const store = createMemoryStore();
    api.failDetailAt.n = 3; // third detail call fails
    const r = await syncSnapshot({ cin7: api.client, store }, base());
    expect(r.complete).toBe(false);
    expect(r.error).toContain('boom');
    expect(r.fetchedDetails).toBe(2);
    api.failDetailAt.n = 0;
    api.log.length = 0;
    const again = await syncSnapshot({ cin7: api.client, store }, base());
    expect(again.complete).toBe(true);
    expect(again.fetchedDetails).toBe(3); // only the rest
  });

  it('refuses to run while the lock is held, and releases it afterwards', async () => {
    const api = fakeApi(sales());
    const store = createMemoryStore();
    store.locked = true;
    await expect(syncSnapshot({ cin7: api.client, store }, base())).rejects.toBeInstanceOf(
      CacheLockedError,
    );
    store.locked = false;
    await syncSnapshot({ cin7: api.client, store }, base());
    expect(store.locked).toBe(false);
    api.failDetailAt.n = 1;
    await syncSnapshot({ cin7: api.client, store }, base());
    expect(store.locked).toBe(false); // released even when a detail fails
  });

  it('window edges: order date on the boundary is in; day before is out unless invoiced or updated in window', async () => {
    const edge: FakeSale[] = [
      {
        id: 'on',
        orderDate: '2026-10-06',
        invoiceDate: '2026-09-01',
        updated: '2026-09-01T00:00:00.1Z',
      },
      {
        id: 'before',
        orderDate: '2026-10-05',
        invoiceDate: '2026-09-01',
        updated: '2026-09-01T00:00:00.1Z',
      },
      {
        id: 'invoicedIn',
        orderDate: '2026-01-01',
        invoiceDate: '2026-10-07',
        updated: '2026-10-07T00:00:00.1Z',
      },
    ];
    const api = fakeApi(edge);
    const store = createMemoryStore();
    await syncSnapshot({ cin7: api.client, store }, base()); // windowFrom 2026-10-06
    const s = (await store.load())!.sales;
    expect(s.on!.detailFetched).toBe(true);
    expect(s.before!.detailFetched).toBe(false);
    expect(s.invoicedIn!.detailFetched).toBe(true); // old order, recent invoice
  });

  it('widening the window to all history lists everything again and loads the older sales', async () => {
    const api = fakeApi(sales());
    const store = createMemoryStore();
    await syncSnapshot({ cin7: api.client, store }, base());
    api.log.length = 0;
    const r = await syncSnapshot({ cin7: api.client, store }, base({ windowDays: null }));
    expect(r.mode).toBe('full');
    expect(r.fetchedDetails).toBe(1); // the old sale
    expect((await store.load())!.windowFrom).toBeNull();
  });

  it('a narrower later request never shrinks coverage', async () => {
    const api = fakeApi(sales());
    const store = createMemoryStore();
    await syncSnapshot({ cin7: api.client, store }, base({ windowDays: null }));
    const r = await syncSnapshot({ cin7: api.client, store }, base({ windowDays: 7 }));
    expect(r.mode).toBe('incremental');
    expect(r.windowFrom).toBeNull();
  });

  it('reports progress and checkpoints', async () => {
    const api = fakeApi(sales());
    const store = createMemoryStore();
    const seen: string[] = [];
    await syncSnapshot(
      { cin7: api.client, store },
      base({ checkpointEvery: 1, onProgress: (p) => seen.push(`${p.phase}:${p.done}/${p.total}`) }),
    );
    expect(seen).toContain('details:2/2');
    expect(store.saves).toBeGreaterThanOrEqual(4);
  });
});
