import { describe, expect, it } from 'vitest';
import { dataAsOf, maskSale } from '../src/shape.js';

const detail = (lineCount = 2) => ({
  ID: 'sale-guid',
  Customer: 'Customer A (Pty) Ltd',
  CustomerID: 'cust-guid',
  Contact: 'Jane Person',
  Phone: '+27 11 555 0100',
  Email: 'jane.person@example.test',
  BillingAddress: { Line1: '1 Private Street', City: 'Town' },
  ShippingAddress: { Line1: '2 Delivery Road', City: 'Town' },
  ShippingNotes: 'Leave with the guard, ask for Jane',
  Note: 'Customer called from 082 555 0101',
  SalesRepresentative: 'Rep Person',
  CustomerReference: 'PO from Jane',
  BaseCurrency: 'ZAR',
  Type: 'Advanced Sale',
  Status: 'ORDERED',
  SaleOrderDate: '2026-10-01T00:00:00',
  Location: 'Main',
  COGSAmount: 12.5,
  CombinedPickingStatus: 'PICKED',
  CombinedPackingStatus: 'PACKED',
  CombinedShippingStatus: 'NOT SHIPPED',
  CombinedInvoiceStatus: 'INVOICED',
  CombinedPaymentStatus: 'UNPAID',
  Order: {
    SaleOrderNumber: 'SO-TEST-1',
    Memo: 'Memo mentioning jane.person@example.test',
    Total: 115,
    Tax: 15,
    TotalBeforeTax: 100,
    Lines: Array.from({ length: lineCount }, (_, i) => ({
      SKU: `SKU-${i}`,
      Name: `Item ${i}`,
      Quantity: 1,
      Price: 10,
      Discount: 0,
      Total: 10,
      BackorderQuantity: 0,
      ProductID: 'p',
    })),
  },
  Fulfilments: [
    {
      FulfillmentNumber: 'FUL-1',
      FulFilmentStatus: 'NOT FULFILLED',
      Pick: { Status: 'AUTHORISED' },
      Pack: { Status: 'AUTHORISED' },
      Ship: { Status: 'DRAFT', Box: 'x', TrackingNumber: 'TRK' },
    },
  ],
  Invoices: [
    {
      InvoiceNumber: 'INV-1',
      Status: 'AUTHORISED',
      InvoiceDueDate: '2026-10-31T00:00:00',
      Total: 115,
      Paid: 0,
      BillingAddressLine1: '1 Private Street',
      Lines: [{ Name: 'x' }],
    },
  ],
  CreditNotes: [],
});

describe('maskSale', () => {
  it('keeps the business facts', () => {
    const s = maskSale(detail());
    expect(s).toMatchObject({
      saleId: 'sale-guid',
      orderNumber: 'SO-TEST-1',
      customer: 'Customer A (Pty) Ltd',
      type: 'Advanced Sale',
      currency: 'ZAR',
      orderDate: '2026-10-01T00:00:00',
      subStatuses: { picking: 'PICKED', shipping: 'NOT SHIPPED', payment: 'UNPAID' },
      order: { total: 115, tax: 15, totalBeforeTax: 100 },
    });
    expect(s.invoices[0]).toEqual({
      number: 'INV-1',
      status: 'AUTHORISED',
      dueDate: '2026-10-31T00:00:00',
      total: 115,
      paid: 0,
    });
    expect(s.fulfilments[0]).toEqual({
      number: 'FUL-1',
      status: 'NOT FULFILLED',
      pick: 'AUTHORISED',
      pack: 'AUTHORISED',
      ship: 'DRAFT',
    });
  });

  it('never leaks personal data anywhere in the output', () => {
    const json = JSON.stringify(maskSale(detail()));
    for (const secret of [
      'Jane',
      'jane.person',
      '555',
      'Private Street',
      'Delivery Road',
      'guard',
      'Rep Person',
      'TRK',
      'Memo mentioning',
    ]) {
      expect(json).not.toContain(secret);
    }
    expect(Object.keys(maskSale(detail()))).not.toEqual(
      expect.arrayContaining(['Email', 'Phone', 'Contact']),
    );
  });

  it('caps lines and flags truncation', () => {
    const big = maskSale(detail(25));
    expect(big.lines).toHaveLength(20);
    expect(big.totalLines).toBe(25);
    expect(big.truncated).toBe(true);
    const small = maskSale(detail(2), { maxLines: 5 });
    expect(small.truncated).toBe(false);
    expect(maskSale(detail(25), { maxLines: 3 }).lines).toHaveLength(3);
  });

  it('survives missing or malformed input', () => {
    expect(maskSale(undefined).lines).toEqual([]);
    expect(maskSale({ Order: 'nope', Invoices: 'nope' }).invoices).toEqual([]);
  });

  it('dataAsOf is an ISO UTC timestamp', () => {
    expect(dataAsOf(new Date('2026-11-05T10:00:00Z'))).toBe('2026-11-05T10:00:00.000Z');
  });
});
