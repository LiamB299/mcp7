import { compareText, round2, round4, sumOf } from './cache/query.js';
import type { VelocityEntry, VelocityResult } from './cache/velocity.js';
import type { ProductRow } from './cin7/types.js';
import { isStockProduct, num, productKey, type StockAgg } from './stock/availability.js';

/*
 * Reorder suggestions (pure, no I/O). Built on a sales velocity window and a stock aggregate.
 *
 * Universe: products whose Type is not 'Service' (trimmed, case-insensitive) and whose Status is not
 * 'Deprecated' (trimmed, case-insensitive). Product key is ID ?? SKU ?? ''.
 *
 * Stock: stock.get(productKey(p)), else stock.get(SKU), else all zeros. available, onHand and onOrder
 * come from that aggregate.
 *
 * Velocity join: each velocity entry matches at most one universe product. Products are visited in
 * list order; a product takes every unused entry with productId === ID and every unused entry with
 * sku === SKU, merged (lines of one product can be keyed by ID in some sales and by SKU alone in
 * others). Unmatched entries (no universe product) are counted in velocityUnmatched.
 * netUnits of unmatched entries and of noProduct lines are reported, never suggested.
 *
 * Velocity and cover:
 * - dailyVelocity = max(0, netUnits) / days (0 when there is no entry, net <= 0, or days <= 0).
 * - daysOfCover = max(0, available) / dailyVelocity; daysOfCoverWithOnOrder adds onOrder to available.
 *   Both are null when dailyVelocity is 0.
 * - suggestedQuantity = max(0, ceil(dailyVelocity * (leadTimeDays + targetCoverDays) - available -
 *   onOrder - 1e-9)). With zero velocity and negative available this can still be positive (it covers
 *   the shortfall); that is the literal formula.
 *
 * Reasons, in this order (a product with at least one reason is a candidate):
 * - below_cin7_threshold: MinimumBeforeReorder (top-level, not ReorderLevels) > 0 and
 *   available <= minimum + 1e-9. A product with no stock rows is at available 0.
 * - stockout_before_delivery: dailyVelocity > 0 and max(0, available) / dailyVelocity < leadTimeDays
 *   (1e-9 tolerance, so cover exactly equal to lead time does not fire). Never fires when
 *   leadTimeDays is 0.
 * - needs_cover: suggestedQuantity > 0.
 *
 * Ranking: daysOfCover ascending (null last), then available - minimum ascending, then SKU
 * (compareText). top is the first topN candidates. Counts cover all candidates and the universe.
 *
 * Output numbers are rounded for display (quantities and money-free values round2, dailyVelocity
 * round4); the computation uses the raw values. Units in counts are round2.
 */

export interface ReorderInput {
  velocity: VelocityResult;
  /** Keyed by availability product ID (falls back to SKU). Use aggregateAvailability(...).aggs. */
  stock: Map<string, StockAgg>;
  /** The active product list. */
  products: ProductRow[];
  /** >= 0 */
  leadTimeDays: number;
  /** >= 0 */
  targetCoverDays: number;
  topN: number;
}

export type ReorderReason = 'below_cin7_threshold' | 'stockout_before_delivery' | 'needs_cover';

export interface ReorderRow {
  sku: string;
  name: string;
  available: number;
  onHand: number;
  onOrder: number;
  /** The matched velocity entry's netUnits (0 when none). */
  netUnitsSold: number;
  dailyVelocity: number;
  daysOfCover: number | null;
  daysOfCoverWithOnOrder: number | null;
  minimum: number;
  cin7ReorderQuantity: number;
  reasons: ReorderReason[];
  suggestedQuantity: number;
}

export interface ReorderCounts {
  /** Universe size (after excluding Service and Deprecated products). */
  products: number;
  /** Universe products with dailyVelocity > 0. */
  withVelocity: number;
  velocityMatchedToProduct: number;
  velocityUnmatched: { products: number; units: number };
  noProductUnits: number;
  belowThreshold: number;
  stockoutBeforeDelivery: number;
  needsCover: number;
  candidates: number;
  productsWithThreshold: number;
}

export interface ReorderResult {
  window: { from: string; to: string; days: number };
  assumptions: { leadTimeDays: number; targetCoverDays: number };
  counts: ReorderCounts;
  top: ReorderRow[];
}

const EPS = 1e-9;

interface Candidate {
  row: ReorderRow;
  /** Raw days of cover (null when no velocity). */
  cover: number | null;
  /** Raw available minus raw minimum. */
  headroom: number;
}

export function reorderSuggestions(input: ReorderInput): ReorderResult {
  const { velocity, stock, leadTimeDays, targetCoverDays } = input;
  const universe = input.products.filter(isStockProduct);
  const matcher = createVelocityMatcher(velocity.entries);

  const candidates: Candidate[] = [];
  let withVelocity = 0;
  let productsWithThreshold = 0;
  let belowThreshold = 0;
  let stockoutBeforeDelivery = 0;
  let needsCover = 0;

  for (const p of universe) {
    const agg = stock.get(productKey(p)) ?? (p.SKU != null ? stock.get(p.SKU) : undefined);
    const available = agg?.available ?? 0;
    const onHand = agg?.onHand ?? 0;
    const onOrder = agg?.onOrder ?? 0;
    const entry = matcher.take(p);
    const netUnits = entry?.netUnits ?? 0;
    const dailyVelocity = velocity.days > 0 ? Math.max(0, netUnits) / velocity.days : 0;
    if (dailyVelocity > 0) withVelocity++;

    const minimum = num(p.MinimumBeforeReorder);
    const cin7ReorderQuantity = num(p.ReorderQuantity);
    if (minimum > 0) productsWithThreshold++;

    const cover = dailyVelocity === 0 ? null : Math.max(0, available) / dailyVelocity;
    const coverWithOnOrder =
      dailyVelocity === 0 ? null : Math.max(0, available + onOrder) / dailyVelocity;
    const suggestedQuantity = Math.max(
      0,
      Math.ceil(dailyVelocity * (leadTimeDays + targetCoverDays) - available - onOrder - EPS),
    );

    const reasons: ReorderReason[] = [];
    const isBelow = minimum > 0 && available <= minimum + EPS;
    if (isBelow) {
      reasons.push('below_cin7_threshold');
      belowThreshold++;
    }
    const isStockout =
      dailyVelocity > 0 && Math.max(0, available) / dailyVelocity < leadTimeDays - EPS;
    if (isStockout) {
      reasons.push('stockout_before_delivery');
      stockoutBeforeDelivery++;
    }
    if (suggestedQuantity > 0) {
      reasons.push('needs_cover');
      needsCover++;
    }
    if (reasons.length === 0) continue;

    const sku = p.SKU ?? agg?.sku ?? '';
    candidates.push({
      cover,
      headroom: available - minimum,
      row: {
        sku,
        name: p.Name ?? agg?.name ?? '',
        available: round2(available),
        onHand: round2(onHand),
        onOrder: round2(onOrder),
        netUnitsSold: round2(netUnits),
        dailyVelocity: round4(dailyVelocity),
        daysOfCover: cover === null ? null : round2(cover),
        daysOfCoverWithOnOrder: coverWithOnOrder === null ? null : round2(coverWithOnOrder),
        minimum: round2(minimum),
        cin7ReorderQuantity: round2(cin7ReorderQuantity),
        reasons,
        suggestedQuantity,
      },
    });
  }

  candidates.sort(
    (a, b) =>
      compareCover(a.cover, b.cover) ||
      a.headroom - b.headroom ||
      compareText(a.row.sku, b.row.sku),
  );

  const unmatched = matcher.unmatched();
  const limit = Math.max(0, Math.floor(input.topN));

  return {
    window: { from: velocity.from, to: velocity.to, days: velocity.days },
    assumptions: { leadTimeDays, targetCoverDays },
    counts: {
      products: universe.length,
      withVelocity,
      velocityMatchedToProduct: matcher.matchedCount(),
      velocityUnmatched: {
        products: unmatched.length,
        units: round2(sumOf(unmatched.map((e) => e.netUnits))),
      },
      noProductUnits: round2(velocity.noProduct.netUnits),
      belowThreshold,
      stockoutBeforeDelivery,
      needsCover,
      candidates: candidates.length,
      productsWithThreshold,
    },
    top: candidates.slice(0, limit).map((c) => c.row),
  };
}

/** Null (no cover) sorts last. */
function compareCover(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

interface VelocityMatcher {
  /**
   * Every unused entry for this product, matched by product ID and then by SKU, merged into one
   * (sale lines of one product can appear under its ID and, elsewhere, under its SKU only).
   * Marks them used.
   */
  take(p: ProductRow): VelocityEntry | undefined;
  matchedCount(): number;
  unmatched(): VelocityEntry[];
}

function createVelocityMatcher(entries: VelocityEntry[]): VelocityMatcher {
  const used = entries.map(() => false);
  const byProductId = indexEntries(entries, (e) => e.productId);
  const bySku = indexEntries(entries, (e) => e.sku);

  const unusedFor = (index: Map<string, number[]>, key: string | null | undefined): number[] =>
    key == null ? [] : (index.get(key) ?? []).filter((i) => !used[i]);

  return {
    take(p) {
      const hits = [...new Set([...unusedFor(byProductId, p.ID), ...unusedFor(bySku, p.SKU)])];
      if (hits.length === 0) return undefined;
      for (const i of hits) used[i] = true;
      const parts = hits.map((i) => entries[i] as VelocityEntry);
      if (parts.length === 1) return parts[0];
      const first = parts[0] as VelocityEntry;
      return {
        ...first,
        netUnits: sumOf(parts.map((e) => e.netUnits)),
        invoicedUnits: sumOf(parts.map((e) => e.invoicedUnits)),
        creditedUnits: sumOf(parts.map((e) => e.creditedUnits)),
        saleCount: sumOf(parts.map((e) => e.saleCount)),
      };
    },
    matchedCount() {
      return used.filter(Boolean).length;
    },
    unmatched() {
      return entries.filter((_, i) => !used[i]);
    },
  };
}

function indexEntries(
  entries: VelocityEntry[],
  keyOf: (e: VelocityEntry) => string | null,
): Map<string, number[]> {
  const index = new Map<string, number[]>();
  entries.forEach((e, i) => {
    const key = keyOf(e);
    if (key == null) return;
    const list = index.get(key);
    if (list) list.push(i);
    else index.set(key, [i]);
  });
  return index;
}
