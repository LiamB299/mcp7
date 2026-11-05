/**
 * Response shaping: personal data and size. Sale detail carries contact person, email, phone,
 * both addresses, free-text notes and invoice billing lines; none of that reaches the model.
 * The shaper is an ALLOW-LIST (it builds a new object from named safe fields), so a field Cin7
 * adds later is dropped by default. The customer's business name is kept.
 */

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export interface ShapedLine {
  sku: string | null;
  name: string | null;
  quantity: number | null;
  backorderQuantity: number | null;
  price: number | null;
  discount: number | null;
  total: number | null;
}

export interface ShapedSale {
  saleId: string | null;
  orderNumber: string | null;
  customer: string | null;
  type: string | null;
  status: string | null;
  sourceChannel: string | null;
  orderDate: string | null;
  shipBy: string | null;
  location: string | null;
  currency: string | null;
  cogsAmount: number | null;
  subStatuses: {
    picking: string | null;
    packing: string | null;
    shipping: string | null;
    invoice: string | null;
    payment: string | null;
  };
  order: { total: number | null; tax: number | null; totalBeforeTax: number | null };
  lines: ShapedLine[];
  totalLines: number;
  truncated: boolean;
  fulfilments: {
    number: string | null;
    status: string | null;
    pick: string | null;
    pack: string | null;
    ship: string | null;
  }[];
  invoices: {
    number: string | null;
    status: string | null;
    dueDate: string | null;
    total: number | null;
    paid: number | null;
  }[];
  creditNotes: { number: string | null; status: string | null; total: number | null }[];
}

export interface MaskOptions {
  /** Maximum order lines returned (a 23-line order is about 37 KB raw). Default 20. */
  maxLines?: number;
}

/** Shape a `GET sale?ID=` response for the model. Never copies contact, address or note fields. */
export function maskSale(detail: unknown, options: MaskOptions = {}): ShapedSale {
  const d = obj(detail);
  const maxLines = options.maxLines ?? 20;
  const order = obj(d.Order);
  const allLines = arr(order.Lines);
  const lines: ShapedLine[] = allLines.slice(0, maxLines).map((l) => ({
    sku: str(l.SKU),
    name: str(l.Name),
    quantity: num(l.Quantity),
    backorderQuantity: num(l.BackorderQuantity),
    price: num(l.Price),
    discount: num(l.Discount),
    total: num(l.Total),
  }));
  return {
    saleId: str(d.ID),
    orderNumber: str(order.SaleOrderNumber),
    customer: str(d.Customer),
    type: str(d.Type),
    status: str(d.Status),
    sourceChannel: str(d.SourceChannel),
    orderDate: str(d.SaleOrderDate),
    shipBy: str(d.ShipBy),
    location: str(d.Location),
    currency: str(d.BaseCurrency),
    cogsAmount: num(d.COGSAmount),
    subStatuses: {
      picking: str(d.CombinedPickingStatus),
      packing: str(d.CombinedPackingStatus),
      shipping: str(d.CombinedShippingStatus),
      invoice: str(d.CombinedInvoiceStatus),
      payment: str(d.CombinedPaymentStatus),
    },
    order: {
      total: num(order.Total),
      tax: num(order.Tax),
      totalBeforeTax: num(order.TotalBeforeTax),
    },
    lines,
    totalLines: allLines.length,
    truncated: allLines.length > lines.length,
    fulfilments: arr(d.Fulfilments).map((f) => ({
      number: str(f.FulfillmentNumber),
      status: str(f.FulFilmentStatus),
      pick: str(obj(f.Pick).Status),
      pack: str(obj(f.Pack).Status),
      ship: str(obj(f.Ship).Status),
    })),
    invoices: arr(d.Invoices).map((i) => ({
      number: str(i.InvoiceNumber),
      status: str(i.Status),
      dueDate: str(i.InvoiceDueDate),
      total: num(i.Total),
      paid: num(i.Paid),
    })),
    creditNotes: arr(d.CreditNotes).map((c) => ({
      number: str(c.CreditNoteNumber),
      status: str(c.Status),
      total: num(c.Total),
    })),
  };
}

/** "Data as of" stamp (ISO, UTC) so answers state their freshness. */
export const dataAsOf = (now: Date = new Date()): string => now.toISOString();
