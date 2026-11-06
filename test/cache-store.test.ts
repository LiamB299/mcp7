import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyDetail,
  headerFromListRow,
  parseTimestamp,
  toUpdatedSince,
} from '../src/cache/extract.js';
import { CacheLockedError, createFileStore } from '../src/cache/store.js';
import { CACHE_VERSION, emptySnapshot } from '../src/cache/types.js';

describe('file store', () => {
  it('saves atomically (no temp files left) and loads back; wrong version rebuilds', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cin7-cache-'));
    const store = createFileStore(dir);
    expect(await store.load()).toBeNull();
    await store.save(emptySnapshot('2026-11-05T00:00:00.000Z'));
    expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    expect((await store.load())?.version).toBe(CACHE_VERSION);
    expect(await store.sizeBytes()).toBeGreaterThan(0);
    await writeFile(join(dir, 'snapshot.json'), JSON.stringify({ version: 999, sales: {} }));
    expect(await store.load()).toBeNull();
    await writeFile(join(dir, 'snapshot.json'), '{not json');
    expect(await store.load()).toBeNull();
    await rm(dir, { recursive: true });
  });

  it('lock is exclusive, released on demand, and a stale lock is taken over', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cin7-lock-'));
    const a = createFileStore(dir, { staleLockMs: 60_000 });
    const b = createFileStore(dir, { staleLockMs: 60_000 });
    const releaseA = await a.lock();
    await expect(b.lock()).rejects.toBeInstanceOf(CacheLockedError);
    await releaseA();
    const releaseB = await b.lock(); // free again
    // C's clock is far in the future, so B's lock looks stale to C and C takes it over.
    const c = createFileStore(dir, { staleLockMs: 60_000, now: () => Date.now() + 10_000_000 });
    const releaseC = await c.lock(); // stale takeover
    await releaseB(); // must not delete C's lock (token differs)
    await expect(a.lock()).rejects.toBeInstanceOf(CacheLockedError);
    await releaseC();
    await rm(dir, { recursive: true });
  });
});

describe('timestamps', () => {
  it('parses 2, 3 and 4 fraction digits and orders them correctly', () => {
    const a = parseTimestamp('2026-11-05T21:03:24.37Z');
    const b = parseTimestamp('2026-11-05T21:03:24.370Z');
    const c = parseTimestamp('2026-11-05T21:03:24.3709Z');
    expect(a).toBe(b);
    expect(c).toBe(b); // 4th digit truncated, not rounded
    expect(parseTimestamp('2026-11-05T21:03:24.9Z')).toBeGreaterThan(
      parseTimestamp('2026-11-05T21:03:24.37Z'),
    );
    expect(parseTimestamp('garbage')).toBe(0);
    expect(toUpdatedSince(Date.UTC(2026, 10, 5, 21, 3, 24, 370))).toBe('2026-11-05T21:03:24.370');
  });
});

describe('allow-list extraction', () => {
  const header = headerFromListRow({
    SaleID: 's1',
    OrderNumber: 'SO-1',
    Customer: 'Customer A',
    CustomerID: 'c1',
    Status: 'ORDERED',
    OrderDate: '2026-10-01T00:00:00',
    Updated: '2026-10-02T10:00:00.12Z',
    BaseCurrency: 'ZAR',
    CustomerCurrency: 'USD',
    InvoiceAmount: 5,
    PaidAmount: 1,
    CombinedInvoiceStatus: 'INVOICED',
  });

  it('keeps authorised/paid invoices and authorised credit notes only, with document dates', () => {
    const sale = applyDetail(header, {
      LastModifiedOn: '2026-10-02T10:00:00.12Z',
      TaxCalculation: 'Inclusive',
      CurrencyRate: 1,
      Invoices: [
        {
          InvoiceNumber: 'I1',
          InvoiceDate: '2026-10-03T00:00:00',
          Status: 'PAID',
          Total: 115,
          TotalBeforeTax: 100,
          Tax: 15,
          Paid: 115,
          Lines: [{ SKU: 'X', Quantity: 2, Total: 115, Tax: 15, AverageCost: 10 }],
        },
        { InvoiceNumber: 'I2', Status: 'DRAFT', Total: 9 },
        { InvoiceNumber: 'I3', Status: 'VOIDED', Total: 9 },
      ],
      CreditNotes: [
        {
          CreditNoteNumber: 'C1',
          CreditNoteDate: '2026-10-09T00:00:00',
          Status: 'AUTHORISED',
          Total: 23,
          TotalBeforeTax: 20,
          Tax: 3,
          Lines: [{ SKU: 'X', Quantity: 1, Total: 23, Tax: 3, AverageCost: 10 }],
        },
        { CreditNoteNumber: 'C2', Status: 'DRAFT', Total: 5 },
      ],
    });
    expect(sale.docs.map((d) => `${d.kind}:${d.number}:${d.date}`)).toEqual([
      'invoice:I1:2026-10-03',
      'credit:C1:2026-10-09',
    ]);
    expect(sale.taxCalculation).toBe('Inclusive');
    expect(sale.detailFetched).toBe(true);
    expect(sale.customerCurrency).toBe('USD');
    expect(sale.listInvoiceAmount).toBe(5);
  });

  it('never stores personal data, even when the detail carries it', () => {
    const sale = applyDetail(header, {
      Customer: 'Customer A',
      Contact: 'Jane Person',
      Phone: '+27 11 555 0100',
      Email: 'jane.person@example.test',
      BillingAddress: { Line1: '1 Private Street' },
      ShippingAddress: { Line1: '2 Delivery Road' },
      Note: 'call 082 555 0101',
      ShippingNotes: 'ask for Jane',
      SalesRepresentative: 'Rep Person',
      Invoices: [
        {
          InvoiceNumber: 'I1',
          Status: 'PAID',
          BillingAddressLine1: '1 Private Street',
          Memo: 'for Jane',
          Lines: [{ SKU: 'X', Name: 'Item', Comment: 'Jane asked', Quantity: 1 }],
        },
      ],
    });
    const json = JSON.stringify(sale);
    for (const secret of [
      'Jane',
      'jane.person',
      '555',
      'Private Street',
      'Delivery Road',
      'Rep Person',
      'ask for',
    ])
      expect(json).not.toContain(secret);
    expect(json).toContain('Customer A'); // business name is kept
  });
});
