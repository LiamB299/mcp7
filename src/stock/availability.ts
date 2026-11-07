import type { AvailabilityRow, ProductRow } from '../cin7/types.js';

/** Null, undefined and non-finite numbers count as 0. */
export const num = (n: number | null | undefined): number =>
  typeof n === 'number' && Number.isFinite(n) ? n : 0;

/** Availability rows are keyed by product ID, falling back to SKU. */
export const availKey = (r: AvailabilityRow): string => r.ID ?? r.SKU ?? '';
export const productKey = (p: ProductRow): string => p.ID ?? p.SKU ?? '';

/**
 * Products that can hold stock: not `Service` and not deprecated (trimmed, case-insensitive). Service
 * products have no availability rows, so treating them as stock reads as "available 0, below threshold".
 * Shared by stock_health and reorder_suggestions.
 */
export function isStockProduct(p: ProductRow): boolean {
  const type = typeof p.Type === 'string' ? p.Type.trim().toLowerCase() : '';
  if (type === 'service') return false;
  const status = typeof p.Status === 'string' ? p.Status.trim().toLowerCase() : '';
  return status !== 'deprecated';
}

/** Per-product stock summed over locations, bins and batches. */
export interface StockAgg {
  sku: string;
  name: string;
  onHand: number;
  allocated: number;
  available: number;
  onOrder: number;
}

export interface FormulaMismatch {
  sku: string;
  onHand: number;
  allocated: number;
  available: number;
  /** Available - (OnHand - Allocated) */
  diff: number;
}

export interface AvailabilitySummary {
  aggs: Map<string, StockAgg>;
  /** Rows (not products) with Available < 0. */
  negativeRows: number;
  /** Rows where |Available - (OnHand - Allocated)| > 0.0001. */
  mismatches: FormulaMismatch[];
}

/** Aggregate `ref/productavailability` rows per product ID (shared by stock_health and reorder_suggestions). */
export function aggregateAvailability(rows: AvailabilityRow[]): AvailabilitySummary {
  const aggs = new Map<string, StockAgg>();
  const mismatches: FormulaMismatch[] = [];
  let negativeRows = 0;

  for (const r of rows) {
    const onHand = num(r.OnHand);
    const allocated = num(r.Allocated);
    const available = num(r.Available);
    const onOrder = num(r.OnOrder);
    const key = availKey(r);

    let agg = aggs.get(key);
    if (!agg) {
      agg = {
        sku: r.SKU ?? '',
        name: r.Name ?? '',
        onHand: 0,
        allocated: 0,
        available: 0,
        onOrder: 0,
      };
      aggs.set(key, agg);
    }
    agg.onHand += onHand;
    agg.allocated += allocated;
    agg.available += available;
    agg.onOrder += onOrder;

    if (available < 0) negativeRows++;

    const diff = available - (onHand - allocated);
    if (Math.abs(diff) > 0.0001) {
      mismatches.push({ sku: r.SKU ?? '', onHand, allocated, available, diff });
    }
  }
  return { aggs, negativeRows, mismatches };
}
