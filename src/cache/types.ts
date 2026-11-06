/**
 * Line-level snapshot cache schema (ADR 0005). Everything stored is allow-listed: business names,
 * order lines and money only. No contact person, email, phone, address or free-text notes.
 */

export const CACHE_VERSION = 1;
/** Default detail-loading window in days (headers are always loaded; details cost 1 call each). */
export const DEFAULT_WINDOW_DAYS = 90;

export interface CachedLine {
  sku: string | null;
  productId: string | null;
  name: string | null;
  quantity: number;
  price: number;
  discount: number;
  /** Line tax. Needed because line `total` INCLUDES tax when the sale's taxCalculation is 'Inclusive'. */
  tax: number;
  total: number;
  /** Cin7 `AverageCost` on the line (cost per unit). */
  avgCost: number;
}

export interface CachedDoc {
  kind: 'invoice' | 'credit';
  number: string | null;
  /** Invoice or credit-note date, yyyy-MM-dd. Revenue is attributed by this date, not the order date. */
  date: string | null;
  /** AUTHORISED or PAID for invoices; AUTHORISED for credit notes (drafts and voided are not stored). */
  status: string;
  total: number;
  totalBeforeTax: number;
  tax: number;
  /** Amount paid (invoices only). */
  paid: number | null;
  dueDate: string | null;
  /** Sum of additional charges (freight etc.); these are not lines. */
  additionalCharges: number;
  lines: CachedLine[];
}

export interface CachedSale {
  id: string;
  orderNumber: string | null;
  customerId: string | null;
  /** Customer business name. */
  customer: string | null;
  type: string | null;
  /** Cin7 master status (a rollup: do not use for workflow stage). */
  status: string | null;
  /** yyyy-MM-dd */
  orderDate: string | null;
  /** yyyy-MM-dd, from the list row */
  invoiceDate: string | null;
  /** Version key: the Cin7 `Updated` / `LastModifiedOn` string as last seen. */
  updated: string;
  updatedMs: number;
  currency: string | null;
  customerCurrency: string | null;
  currencyRate: number | null;
  channel: string | null;
  taxCalculation: 'Inclusive' | 'Exclusive' | null;
  /** List rollups kept so rollup drift can be measured against the documents. */
  listInvoiceAmount: number | null;
  listPaidAmount: number | null;
  listInvoiceStatus: string | null;
  /** List `InvoiceDueDate` (yyyy-MM-dd). Optional: snapshots written before this field existed lack it. */
  listInvoiceDueDate?: string | null;
  /** True when `docs` reflect `updated` (header-only sales are final when voided or not invoiced). */
  detailFetched: boolean;
  /** True when the sale is wanted (in window, invoiced) but its detail is not loaded yet. */
  pendingDetail: boolean;
  docs: CachedDoc[];
}

export interface Snapshot {
  version: number;
  createdAt: string;
  lastSyncAt: string | null;
  /** Max server `Updated` seen (ms since epoch); the incremental-refresh cursor. Never the local clock. */
  cursorMs: number | null;
  /** Detail coverage lower bound, yyyy-MM-dd. null means all history. */
  windowFrom: string | null;
  sales: Record<string, CachedSale>;
}

export const emptySnapshot = (nowIso: string): Snapshot => ({
  version: CACHE_VERSION,
  createdAt: nowIso,
  lastSyncAt: null,
  cursorMs: null,
  windowFrom: null,
  sales: {},
});

export interface SyncProgress {
  phase: 'headers' | 'details';
  done: number;
  total: number;
}
