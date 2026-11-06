import type { Snapshot } from './types.js';

// STUB (contract pinned for the implementing agent): replaced by the implementation.

export interface SkuRevenueOptions {
  /** Inclusive yyyy-MM-dd bounds, applied to the INVOICE or CREDIT-NOTE date (not the order date). */
  from?: string;
  to?: string;
  topN?: number;
  sortBy?: 'revenue' | 'margin' | 'quantity';
}

export interface SkuRow {
  sku: string;
  name: string | null;
  /** Ex-tax revenue: invoice lines minus credit-note lines. */
  revenueExTax: number;
  quantity: number;
  /** Line AverageCost x Quantity, invoices minus credit notes. */
  cost: number;
  margin: number;
  marginPct: number | null;
}

export interface SkuRevenueResult {
  from: string | null;
  to: string | null;
  currency: string | null;
  salesContributing: number;
  documents: { invoices: number; creditNotes: number };
  totals: {
    revenueExTax: number;
    cost: number;
    margin: number;
    quantity: number;
    additionalCharges: number;
  };
  rows: SkuRow[];
  /** Roll-up of SKUs beyond topN; null when none. */
  other: { skus: number; revenueExTax: number; quantity: number; margin: number } | null;
  /** Contributing sales whose customer currency differs from the base currency (summed as stored). */
  nonBaseCurrencySales: number;
  coverage: {
    salesInSnapshot: number;
    withDetail: number;
    pendingDetail: number;
    windowFrom: string | null;
    /** True when the requested range lies inside the loaded window (windowFrom null, or from >= windowFrom). */
    rangeCovered: boolean;
  };
}

export function revenueBySku(_snapshot: Snapshot, _options: SkuRevenueOptions): SkuRevenueResult {
  throw new Error('not implemented');
}

export interface RollupDrift {
  /** Sales with documents loaded that were compared. */
  compared: number;
  /** Sales where list InvoiceAmount differs from (invoice totals minus credit-note totals) by more than 0.02. */
  differing: number;
  creditNotesNotNetted: number;
  zeroDespiteInvoice: number;
  other: number;
  /** Largest absolute differences first: order number and amounts only (no names). */
  top: { orderNumber: string | null; listInvoiceAmount: number | null; documentNet: number }[];
}

export function rollupDrift(_snapshot: Snapshot, _options?: { top?: number }): RollupDrift {
  throw new Error('not implemented');
}
