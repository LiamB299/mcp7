import type { PurchaseListRow, SaleListRow } from './cin7/types.js';

/**
 * Workflow stage derivation. Cin7's master `Status` is a rollup and misleads: for Advanced sales it
 * can read ORDERED while the goods are already shipped (9 of 85 ORDERED sales in the sandbox).
 * We derive the stage from `Type` plus the `Combined*Status` sub-statuses instead.
 */

const up = (s: string | null | undefined) => (s ?? '').trim().toUpperCase();

export type Fulfilment =
  | 'not_applicable'
  | 'awaiting_pick'
  | 'picking'
  | 'awaiting_pack'
  | 'packing'
  | 'awaiting_ship'
  | 'shipping'
  | 'shipped';

export type Billing = 'not_invoiced' | 'unpaid' | 'partially_paid' | 'prepaid' | 'paid';

export type SaleStage =
  | 'voided'
  | 'completed'
  | 'quote'
  | 'order_draft'
  | 'awaiting_pick'
  | 'picking'
  | 'awaiting_pack'
  | 'packing'
  | 'awaiting_ship'
  | 'shipping'
  | 'awaiting_invoice'
  | 'awaiting_payment'
  | 'paid_not_completed';

export interface SaleStageInfo {
  stage: SaleStage;
  /** Where the goods are. Service sales skip fulfilment ('not_applicable'). */
  fulfilment: Fulfilment;
  /** Where the money is. Independent of fulfilment: invoices can precede picking. */
  billing: Billing;
  /** Master status BACKORDERED: some lines short of stock (a flag, not a stage). */
  backordered: boolean;
}

export function deriveFulfilment(row: SaleListRow): Fulfilment {
  if (up(row.Type).startsWith('SERVICE')) return 'not_applicable';
  const pick = up(row.CombinedPickingStatus);
  const pack = up(row.CombinedPackingStatus);
  const ship = up(row.CombinedShippingStatus);
  if (ship === 'SHIPPED') return 'shipped';
  if (ship === 'SHIPPING') return 'shipping';
  if (pack === 'PACKED') return 'awaiting_ship';
  if (pack === 'PACKING') return 'packing';
  if (pick === 'PICKED') return 'awaiting_pack';
  if (pick === 'PICKING') return 'picking';
  if (pick === 'NOT PICKED') return 'awaiting_pick';
  return 'not_applicable'; // every sub-status NOT AVAILABLE: no fulfilment exists yet
}

export function deriveBilling(row: SaleListRow): Billing {
  if (!up(row.CombinedInvoiceStatus).startsWith('INVOICED')) return 'not_invoiced';
  const pay = up(row.CombinedPaymentStatus);
  if (pay.startsWith('PARTIALLY')) return 'partially_paid';
  if (pay === 'PAID' || pay.startsWith('OVERPAID')) return 'paid';
  if (pay === 'PREPAID') return 'prepaid';
  return 'unpaid';
}

export function deriveSaleStage(row: SaleListRow): SaleStageInfo {
  const status = up(row.Status);
  const fulfilment = deriveFulfilment(row);
  const billing = deriveBilling(row);
  const backordered = status === 'BACKORDERED';
  const info = (stage: SaleStage): SaleStageInfo => ({ stage, fulfilment, billing, backordered });

  if (status === 'VOIDED') return info('voided');
  if (status === 'COMPLETED') return info('completed');
  if (['ESTIMATING', 'ESTIMATED', 'DRAFT'].includes(status)) return info('quote');
  if (status === 'ORDERING' || up(row.OrderStatus) === 'DRAFT') return info('order_draft');
  if (fulfilment !== 'shipped' && fulfilment !== 'not_applicable') return info(fulfilment);
  if (billing === 'not_invoiced') return info('awaiting_invoice');
  if (billing === 'paid') return info('paid_not_completed');
  return info('awaiting_payment');
}

/** Open = still in progress (neither voided nor completed). */
export const isOpenSale = (stage: SaleStage) => stage !== 'voided' && stage !== 'completed';

export type PurchaseStage =
  | 'voided'
  | 'completed'
  | 'credited'
  | 'order_draft'
  | 'awaiting_receipt'
  | 'receiving'
  | 'awaiting_invoice'
  | 'other';

/**
 * Purchase orders still awaiting goods: master status ORDERED, RECEIVING or INVOICED (invoice
 * first) while the receiving sub-status is not FULLY RECEIVED. Matches the "plusInvoiced" reading
 * in eval/truth.mjs (65 in the sandbox). Partially received orders count as still awaiting.
 */
export function isAwaitingReceipt(row: PurchaseListRow): boolean {
  return (
    ['ORDERED', 'RECEIVING', 'INVOICED'].includes(up(row.Status)) &&
    up(row.CombinedReceivingStatus) !== 'FULLY RECEIVED'
  );
}

export function derivePurchaseStage(row: PurchaseListRow): PurchaseStage {
  const status = up(row.Status);
  if (status === 'VOIDED') return 'voided';
  if (status.startsWith('COMPLETED')) return 'completed';
  if (status === 'ORDERING' || up(row.OrderStatus) === 'DRAFT') return 'order_draft';
  if (isAwaitingReceipt(row)) {
    return status === 'RECEIVING' || up(row.CombinedReceivingStatus) === 'PARTIALLY RECEIVED'
      ? 'receiving'
      : 'awaiting_receipt';
  }
  if (status.includes('CREDITED')) return 'credited';
  if (status === 'RECEIVED') return 'awaiting_invoice';
  return 'other';
}
