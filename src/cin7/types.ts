/**
 * Row shapes for the Cin7 list endpoints, limited to the fields we read. Field names and
 * quirks are verified against the sandbox (docs/research/cin7-core-api.md §7):
 * ids are GUID strings; the sale list has `OrderDate` where sale detail has `SaleOrderDate`;
 * the purchase list id key is `ID`; money fields are numbers.
 */
type Str = string | null;

export interface SaleListRow {
  SaleID?: string;
  OrderNumber?: Str;
  Customer?: Str;
  CustomerID?: Str;
  /** 'Simple Sale' | 'Advanced Sale' | 'Service Sale' */
  Type?: Str;
  /** Master status: a rollup. For Advanced sales it can read ORDERED while already shipped. */
  Status?: Str;
  QuoteStatus?: Str;
  OrderStatus?: Str;
  CombinedPickingStatus?: Str;
  CombinedPackingStatus?: Str;
  CombinedShippingStatus?: Str;
  CombinedInvoiceStatus?: Str;
  CombinedPaymentStatus?: Str;
  FulFilmentStatus?: Str;
  OrderDate?: Str;
  ShipBy?: Str;
  SourceChannel?: Str;
  /** Net of credit notes. */
  InvoiceAmount?: number | null;
  PaidAmount?: number | null;
  InvoiceDueDate?: Str;
  BaseCurrency?: Str;
  Updated?: Str;
}

export interface PurchaseListRow {
  ID?: string;
  OrderNumber?: Str;
  Supplier?: Str;
  SupplierID?: Str;
  Type?: Str;
  Status?: Str;
  OrderStatus?: Str;
  CombinedReceivingStatus?: Str;
  StockReceivedStatus?: Str;
  InvoiceStatus?: Str;
  CombinedInvoiceStatus?: Str;
  CombinedPaymentStatus?: Str;
  OrderDate?: Str;
  RequiredBy?: Str;
  LastUpdatedDate?: Str;
  BaseCurrency?: Str;
}

/** One row of ref/productavailability: product x location x bin x batch. */
export interface AvailabilityRow {
  ID?: string;
  SKU?: Str;
  Name?: Str;
  Location?: Str;
  Batch?: Str;
  OnHand?: number | null;
  Allocated?: number | null;
  Available?: number | null;
  OnOrder?: number | null;
  /** A monetary VALUE (OnHand x average cost), not units. */
  StockOnHand?: number | null;
  InTransit?: number | null;
}

/** Product fields used for reorder checks. `ReorderLevels` comes back empty; use the top-level fields. */
export interface ProductRow {
  ID?: string;
  SKU?: Str;
  Name?: Str;
  Status?: Str;
  Type?: Str;
  MinimumBeforeReorder?: number | null;
  ReorderQuantity?: number | null;
}
