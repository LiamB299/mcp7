import { describe, expect, it } from 'vitest';
import type { PurchaseListRow, SaleListRow } from '../src/cin7/types.js';
import {
  derivePurchaseStage,
  deriveSaleStage,
  isAwaitingReceipt,
  isOpenSale,
} from '../src/stage.js';

const sale = (over: SaleListRow): SaleListRow => ({
  Type: 'Simple Sale',
  Status: 'ORDERED',
  QuoteStatus: 'NOT AVAILABLE',
  OrderStatus: 'AUTHORISED',
  CombinedPickingStatus: 'NOT PICKED',
  CombinedPackingStatus: 'NOT PACKED',
  CombinedShippingStatus: 'NOT SHIPPED',
  CombinedInvoiceStatus: 'NOT INVOICED',
  CombinedPaymentStatus: 'UNPAID',
  ...over,
});

describe('deriveSaleStage (sale lifecycle)', () => {
  it('terminal and pre-order states come from master status', () => {
    expect(deriveSaleStage(sale({ Status: 'VOIDED', OrderStatus: 'VOIDED' })).stage).toBe('voided');
    expect(deriveSaleStage(sale({ Status: 'COMPLETED' })).stage).toBe('completed');
    expect(
      deriveSaleStage(sale({ Status: 'ESTIMATING', OrderStatus: 'NOT AVAILABLE' })).stage,
    ).toBe('quote');
    expect(deriveSaleStage(sale({ Status: 'ORDERING', OrderStatus: 'DRAFT' })).stage).toBe(
      'order_draft',
    );
  });

  it('walks the fulfilment chain from sub-statuses', () => {
    expect(deriveSaleStage(sale({})).stage).toBe('awaiting_pick');
    expect(
      deriveSaleStage(sale({ Status: 'PICKING', CombinedPickingStatus: 'PICKING' })).stage,
    ).toBe('picking');
    expect(deriveSaleStage(sale({ CombinedPickingStatus: 'PICKED' })).stage).toBe('awaiting_pack');
    expect(
      deriveSaleStage(sale({ CombinedPickingStatus: 'PICKED', CombinedPackingStatus: 'PACKING' }))
        .stage,
    ).toBe('packing');
    expect(
      deriveSaleStage(sale({ CombinedPickingStatus: 'PICKED', CombinedPackingStatus: 'PACKED' }))
        .stage,
    ).toBe('awaiting_ship');
    expect(
      deriveSaleStage(
        sale({
          CombinedPickingStatus: 'PICKED',
          CombinedPackingStatus: 'PACKED',
          CombinedShippingStatus: 'SHIPPING',
        }),
      ).stage,
    ).toBe('shipping');
  });

  it('THE TRAP: an Advanced sale with master status ORDERED that has shipped is past fulfilment', () => {
    const s = deriveSaleStage(
      sale({
        Type: 'Advanced Sale',
        Status: 'ORDERED',
        CombinedPickingStatus: 'PICKED',
        CombinedPackingStatus: 'PACKED',
        CombinedShippingStatus: 'SHIPPED',
        CombinedInvoiceStatus: 'INVOICED',
        CombinedPaymentStatus: 'UNPAID',
      }),
    );
    expect(s.fulfilment).toBe('shipped');
    expect(s.stage).toBe('awaiting_payment'); // not 'awaiting_pick' / 'ordered'
  });

  it('shipped but not invoiced awaits an invoice; paid but not completed is flagged', () => {
    const shipped = {
      CombinedPickingStatus: 'PICKED',
      CombinedPackingStatus: 'PACKED',
      CombinedShippingStatus: 'SHIPPED',
    };
    expect(deriveSaleStage(sale({ ...shipped })).stage).toBe('awaiting_invoice');
    expect(
      deriveSaleStage(
        sale({ ...shipped, CombinedInvoiceStatus: 'INVOICED', CombinedPaymentStatus: 'PAID' }),
      ).stage,
    ).toBe('paid_not_completed');
  });

  it('billing is independent of fulfilment (invoiced before picking)', () => {
    const s = deriveSaleStage(
      sale({ CombinedInvoiceStatus: 'INVOICED', CombinedPaymentStatus: 'UNPAID' }),
    );
    expect(s.stage).toBe('awaiting_pick');
    expect(s.billing).toBe('unpaid');
  });

  it('service sales skip fulfilment', () => {
    const s = deriveSaleStage(
      sale({
        Type: 'Service Sale',
        CombinedPickingStatus: 'NOT AVAILABLE',
        CombinedPackingStatus: 'NOT AVAILABLE',
        CombinedShippingStatus: 'NOT AVAILABLE',
      }),
    );
    expect(s.fulfilment).toBe('not_applicable');
    expect(s.stage).toBe('awaiting_invoice');
  });

  it('maps payment variants and flags backorders', () => {
    const inv = { CombinedInvoiceStatus: 'INVOICED / CREDITED' };
    expect(deriveSaleStage(sale({ ...inv, CombinedPaymentStatus: 'PARTIALLY PAID' })).billing).toBe(
      'partially_paid',
    );
    expect(
      deriveSaleStage(sale({ ...inv, CombinedPaymentStatus: 'OVERPAID / CREDITED' })).billing,
    ).toBe('paid');
    expect(deriveSaleStage(sale({ CombinedPaymentStatus: 'PREPAID' })).billing).toBe(
      'not_invoiced',
    );
    expect(deriveSaleStage(sale({ Status: 'BACKORDERED' })).backordered).toBe(true);
    expect(deriveSaleStage(sale({ Status: 'BACKORDERED' })).stage).toBe('awaiting_pick');
  });

  it('isOpenSale excludes voided and completed only', () => {
    expect(isOpenSale('voided')).toBe(false);
    expect(isOpenSale('completed')).toBe(false);
    expect(isOpenSale('awaiting_ship')).toBe(true);
  });
});

const po = (over: PurchaseListRow): PurchaseListRow => ({
  Status: 'ORDERED',
  OrderStatus: 'AUTHORISED',
  CombinedReceivingStatus: 'NOT RECEIVED',
  ...over,
});

describe('purchase awaiting receipt', () => {
  it('counts ORDERED, RECEIVING and INVOICED (invoice first) that are not fully received', () => {
    expect(isAwaitingReceipt(po({}))).toBe(true);
    expect(
      isAwaitingReceipt(po({ Status: 'INVOICED', CombinedReceivingStatus: 'NOT RECEIVED' })),
    ).toBe(true);
    expect(
      isAwaitingReceipt(po({ Status: 'INVOICED', CombinedReceivingStatus: 'PARTIALLY RECEIVED' })),
    ).toBe(true);
    expect(
      isAwaitingReceipt(po({ Status: 'RECEIVING', CombinedReceivingStatus: 'NOT RECEIVED' })),
    ).toBe(true);
    expect(isAwaitingReceipt(po({ CombinedReceivingStatus: 'NOT AVAILABLE' }))).toBe(true);
    expect(isAwaitingReceipt(po({ CombinedReceivingStatus: '' }))).toBe(true);
  });

  it('excludes received, voided, completed, drafts and credited', () => {
    expect(
      isAwaitingReceipt(po({ Status: 'RECEIVED', CombinedReceivingStatus: 'FULLY RECEIVED' })),
    ).toBe(false);
    expect(
      isAwaitingReceipt(po({ Status: 'VOIDED', CombinedReceivingStatus: 'NOT RECEIVED' })),
    ).toBe(false);
    expect(
      isAwaitingReceipt(po({ Status: 'COMPLETED', CombinedReceivingStatus: 'FULLY RECEIVED' })),
    ).toBe(false);
    expect(isAwaitingReceipt(po({ Status: 'ORDERING', OrderStatus: 'DRAFT' }))).toBe(false);
    expect(
      isAwaitingReceipt(po({ Status: 'CREDITED', CombinedReceivingStatus: 'FULLY RECEIVED' })),
    ).toBe(false);
  });

  it('derives purchase stages', () => {
    expect(derivePurchaseStage(po({}))).toBe('awaiting_receipt');
    expect(derivePurchaseStage(po({ Status: 'RECEIVING' }))).toBe('receiving');
    expect(derivePurchaseStage(po({ CombinedReceivingStatus: 'PARTIALLY RECEIVED' }))).toBe(
      'receiving',
    );
    expect(derivePurchaseStage(po({ Status: 'ORDERING', OrderStatus: 'DRAFT' }))).toBe(
      'order_draft',
    );
    expect(
      derivePurchaseStage(po({ Status: 'RECEIVED', CombinedReceivingStatus: 'FULLY RECEIVED' })),
    ).toBe('awaiting_invoice');
    expect(derivePurchaseStage(po({ Status: 'COMPLETED / CREDIT NOTE CLOSED' }))).toBe('completed');
    expect(
      derivePurchaseStage(
        po({ Status: 'RECEIVED / CREDITED', CombinedReceivingStatus: 'FULLY RECEIVED' }),
      ),
    ).toBe('credited');
    expect(derivePurchaseStage(po({ Status: 'VOIDED' }))).toBe('voided');
  });
});
