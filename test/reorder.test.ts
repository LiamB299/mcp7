import { describe, expect, it } from 'vitest';
import type { VelocityEntry, VelocityResult } from '../src/cache/velocity.js';
import type { ProductRow } from '../src/cin7/types.js';
import {
  type ReorderInput,
  type ReorderResult,
  type ReorderRow,
  reorderSuggestions,
} from '../src/reorder.js';
import type { StockAgg } from '../src/stock/availability.js';

function entry(
  netUnits: number,
  o: { productId?: string | null; sku?: string | null } = {},
): VelocityEntry {
  return {
    productId: o.productId ?? null,
    sku: o.sku ?? null,
    name: null,
    netUnits,
    invoicedUnits: Math.max(0, netUnits),
    creditedUnits: Math.max(0, -netUnits),
    saleCount: 1,
  };
}

function velocity(
  entries: VelocityEntry[] = [],
  opts: { days?: number; noProductUnits?: number } = {},
): VelocityResult {
  return {
    from: '2026-10-01',
    to: '2026-10-30',
    days: opts.days ?? 30,
    entries,
    noProduct: { netUnits: opts.noProductUnits ?? 0, invoicedUnits: 0, creditedUnits: 0 },
    coverage: {
      salesInSnapshot: 0,
      withDetail: 0,
      pendingDetail: 0,
      windowFrom: null,
      rangeCovered: true,
    },
  };
}

function prod(overrides: Partial<ProductRow> & { ID: string }): ProductRow {
  return {
    SKU: `SKU-${overrides.ID}`,
    Name: `Product ${overrides.ID}`,
    Status: 'Active',
    Type: 'Product',
    MinimumBeforeReorder: 0,
    ReorderQuantity: 0,
    ...overrides,
  };
}

/** Stock aggregate with onHand equal to available (allocated 0). */
function agg(sku: string, available: number, onOrder = 0): StockAgg {
  return { sku, name: `Stock ${sku}`, onHand: available, allocated: 0, available, onOrder };
}

function run(overrides: Partial<ReorderInput> = {}): ReorderResult {
  return reorderSuggestions({
    velocity: velocity(),
    stock: new Map(),
    products: [],
    leadTimeDays: 0,
    targetCoverDays: 0,
    topN: 10,
    ...overrides,
  });
}

function rowFor(res: ReorderResult, sku: string): ReorderRow {
  const row = res.top.find((r) => r.sku === sku);
  if (!row) throw new Error(`no top row for ${sku}`);
  return row;
}

const skusOf = (res: ReorderResult) => res.top.map((r) => r.sku);

describe('reorderSuggestions', () => {
  it('gives each reason alone and in combination', () => {
    // Lead 7, target 10, velocity 2/day (60 net over 30 days).
    const res = run({
      velocity: velocity([
        entry(60, { productId: 'stockout' }),
        entry(60, { productId: 'needs' }),
        entry(60, { productId: 'all' }),
        entry(60, { productId: 'none' }),
      ]),
      stock: new Map([
        ['thr', agg('SKU-thr', 5)],
        ['stockout', agg('SKU-stockout', 10, 30)],
        ['needs', agg('SKU-needs', 20)],
        ['all', agg('SKU-all', 10)],
        ['none', agg('SKU-none', 100)],
      ]),
      products: [
        prod({ ID: 'thr', MinimumBeforeReorder: 10 }),
        prod({ ID: 'stockout' }),
        prod({ ID: 'needs' }),
        prod({ ID: 'all', MinimumBeforeReorder: 25 }),
        prod({ ID: 'none' }),
      ],
      leadTimeDays: 7,
      targetCoverDays: 10,
    });

    expect(rowFor(res, 'SKU-thr').reasons).toEqual(['below_cin7_threshold']);
    expect(rowFor(res, 'SKU-thr').suggestedQuantity).toBe(0);
    expect(rowFor(res, 'SKU-stockout').reasons).toEqual(['stockout_before_delivery']);
    expect(rowFor(res, 'SKU-stockout').suggestedQuantity).toBe(0);
    expect(rowFor(res, 'SKU-needs').reasons).toEqual(['needs_cover']);
    expect(rowFor(res, 'SKU-needs').suggestedQuantity).toBe(14);
    expect(rowFor(res, 'SKU-all').reasons).toEqual([
      'below_cin7_threshold',
      'stockout_before_delivery',
      'needs_cover',
    ]);
    expect(rowFor(res, 'SKU-all').suggestedQuantity).toBe(24);
    expect(skusOf(res)).not.toContain('SKU-none');

    expect(res.counts).toMatchObject({
      products: 5,
      withVelocity: 4,
      belowThreshold: 2,
      stockoutBeforeDelivery: 2,
      needsCover: 2,
      candidates: 4,
      productsWithThreshold: 2,
    });
  });

  it('takes the threshold from top-level MinimumBeforeReorder and ignores ReorderLevels', () => {
    const ignored = {
      ...prod({ ID: 'lvl', MinimumBeforeReorder: 5, ReorderQuantity: 20 }),
      ReorderLevels: [{ MinimumBeforeReorder: 99 }],
    } as ProductRow;
    const res = run({
      stock: new Map([
        ['lvl', agg('SKU-lvl', 8)],
        ['lvl2', agg('SKU-lvl2', 5)],
      ]),
      products: [ignored, prod({ ID: 'lvl2', MinimumBeforeReorder: 5, ReorderQuantity: 20 })],
    });
    expect(res.counts.productsWithThreshold).toBe(2);
    expect(res.counts.belowThreshold).toBe(1);
    expect(res.top).toHaveLength(1);
    expect(rowFor(res, 'SKU-lvl2')).toMatchObject({
      minimum: 5,
      cin7ReorderQuantity: 20,
      available: 5,
      reasons: ['below_cin7_threshold'],
    });
  });

  it('puts a threshold product with no stock rows at available 0 and below threshold', () => {
    const res = run({
      products: [prod({ ID: 'ghost', MinimumBeforeReorder: 4, ReorderQuantity: 10 })],
    });
    expect(rowFor(res, 'SKU-ghost')).toMatchObject({
      name: 'Product ghost',
      available: 0,
      onHand: 0,
      onOrder: 0,
      daysOfCover: null,
      reasons: ['below_cin7_threshold'],
      suggestedQuantity: 0,
    });
  });

  it('excludes Service and Deprecated products from the universe and candidates', () => {
    const res = run({
      velocity: velocity([entry(30, { productId: 'svc' })]),
      products: [
        prod({ ID: 'svc', Type: 'Service', MinimumBeforeReorder: 5 }),
        prod({ ID: 'svc2', Type: ' SERVICE ', MinimumBeforeReorder: 5 }),
        prod({ ID: 'dep', Status: 'deprecated', MinimumBeforeReorder: 5 }),
        prod({ ID: 'phys', MinimumBeforeReorder: 5 }),
      ],
    });
    expect(res.counts.products).toBe(1);
    expect(res.counts.productsWithThreshold).toBe(1);
    expect(res.counts.belowThreshold).toBe(1);
    expect(res.counts.candidates).toBe(1);
    expect(skusOf(res)).toEqual(['SKU-phys']);
    // The Service product's sales are not matched to a universe product.
    expect(res.counts.velocityUnmatched).toEqual({ products: 1, units: 30 });
    expect(res.counts.velocityMatchedToProduct).toBe(0);
  });

  it('joins velocity by product ID, falls back to SKU, and reports unmatched entries', () => {
    const res = run({
      velocity: velocity(
        [
          entry(30, { productId: 'pA', sku: 'SKU-A' }),
          entry(60, { sku: 'SKU-B' }),
          entry(12, { productId: 'pZ', sku: 'SKU-Z' }),
          entry(-4, { sku: 'SKU-Q' }),
        ],
        { noProductUnits: 3 },
      ),
      products: [
        prod({ ID: 'pA', SKU: 'SKU-A' }),
        prod({ ID: 'pB', SKU: 'SKU-B' }),
        // Same SKU as pA, but pA's entry is already used, so this product gets no velocity.
        prod({ ID: 'pC', SKU: 'SKU-A' }),
      ],
      targetCoverDays: 1,
    });
    expect(res.counts).toMatchObject({
      products: 3,
      withVelocity: 2,
      velocityMatchedToProduct: 2,
      velocityUnmatched: { products: 2, units: 8 },
      noProductUnits: 3,
    });
    expect(res.top.map((r) => r.sku)).toEqual(['SKU-A', 'SKU-B']);
    expect(rowFor(res, 'SKU-A')).toMatchObject({ netUnitsSold: 30, dailyVelocity: 1 });
    expect(rowFor(res, 'SKU-B')).toMatchObject({ netUnitsSold: 60, dailyVelocity: 2 });
  });

  it('merges the entries of one product keyed by ID and by SKU alone', () => {
    const res = run({
      velocity: velocity([
        entry(20, { productId: 'pA', sku: 'SKU-A' }),
        entry(10, { sku: 'SKU-A' }), // lines that only carried the SKU
      ]),
      products: [prod({ ID: 'pA', SKU: 'SKU-A' })],
      targetCoverDays: 1,
    });
    expect(res.counts).toMatchObject({
      withVelocity: 1,
      velocityMatchedToProduct: 2,
      velocityUnmatched: { products: 0, units: 0 },
    });
    expect(rowFor(res, 'SKU-A')).toMatchObject({ netUnitsSold: 30, dailyVelocity: 1 });
  });

  it('reads stock by product ID first, then by SKU key', () => {
    const res = run({
      stock: new Map([
        ['SKU-D', agg('SKU-D', 4)],
        ['pE', agg('SKU-E', 3)],
        ['SKU-E', agg('SKU-E', 99)],
      ]),
      products: [
        prod({ ID: 'pD', SKU: 'SKU-D', MinimumBeforeReorder: 10 }),
        prod({ ID: 'pE', SKU: 'SKU-E', MinimumBeforeReorder: 10 }),
      ],
    });
    expect(rowFor(res, 'SKU-D').available).toBe(4);
    expect(rowFor(res, 'SKU-E').available).toBe(3);
  });

  it('gives null cover and no stockout reason at zero velocity, and treats net <= 0 as zero', () => {
    const res = run({
      velocity: velocity([entry(-5, { productId: 'g' })]),
      stock: new Map([
        ['f', agg('SKU-f', 3)],
        ['g', agg('SKU-g', 3)],
      ]),
      products: [prod({ ID: 'f' }), prod({ ID: 'g', MinimumBeforeReorder: 10 })],
      leadTimeDays: 7,
    });
    expect(skusOf(res)).toEqual(['SKU-g']);
    expect(rowFor(res, 'SKU-g')).toMatchObject({
      netUnitsSold: -5,
      dailyVelocity: 0,
      daysOfCover: null,
      daysOfCoverWithOnOrder: null,
      reasons: ['below_cin7_threshold'],
    });
  });

  it('gives 0 days of cover for negative available and does not count it as stock', () => {
    const res = run({
      velocity: velocity([entry(30, { productId: 'h' })]),
      stock: new Map([['h', agg('SKU-h', -4, 2)]]),
      products: [prod({ ID: 'h' })],
    });
    expect(rowFor(res, 'SKU-h')).toMatchObject({
      available: -4,
      daysOfCover: 0,
      daysOfCoverWithOnOrder: 0,
      // Need = 1 * (0 + 0) - (-4) - 2 = 2.
      suggestedQuantity: 2,
      reasons: ['needs_cover'],
    });
  });

  it('offsets the suggested quantity by on-order stock', () => {
    // Velocity 2/day, lead 10, target 0 gives a need of 20.
    const res = run({
      velocity: velocity([entry(60, { productId: 'i' }), entry(60, { productId: 'j' })]),
      stock: new Map([
        ['i', agg('SKU-i', 6, 9)],
        ['j', agg('SKU-j', 6, 14)],
      ]),
      products: [prod({ ID: 'i' }), prod({ ID: 'j' })],
      leadTimeDays: 10,
    });
    expect(rowFor(res, 'SKU-i')).toMatchObject({
      suggestedQuantity: 5,
      daysOfCover: 3,
      daysOfCoverWithOnOrder: 7.5,
      reasons: ['stockout_before_delivery', 'needs_cover'],
    });
    expect(rowFor(res, 'SKU-j')).toMatchObject({
      suggestedQuantity: 0,
      reasons: ['stockout_before_delivery'],
    });
  });

  it('does not round up an exact integer need', () => {
    // Velocity 1.5/day, lead 10, target 0 gives 15. Available 5 plus on order 5 leaves exactly 5.
    const res = run({
      velocity: velocity([entry(45, { productId: 'k' })]),
      stock: new Map([['k', agg('SKU-k', 5, 5)]]),
      products: [prod({ ID: 'k' })],
      leadTimeDays: 10,
    });
    expect(rowFor(res, 'SKU-k').suggestedQuantity).toBe(5);
  });

  it('does not round up float noise on an exact need', () => {
    // 3 / 30 = 0.1 per day; 0.1 * 7 is 0.7000000000000001 in floating point, but the need is exactly 0.7 - 0.7.
    const res = run({
      velocity: velocity([entry(3, { productId: 'm' })]),
      stock: new Map([['m', agg('SKU-m', 0.7)]]),
      products: [prod({ ID: 'm', MinimumBeforeReorder: 1 })],
      leadTimeDays: 7,
    });
    expect(rowFor(res, 'SKU-m')).toMatchObject({
      suggestedQuantity: 0,
      reasons: ['below_cin7_threshold'],
    });
  });

  it('rounds a fractional need up to the next integer', () => {
    // Velocity 1.5/day (3 over 2 days), lead 3, target 0 gives 4.5 needed with no stock.
    const res = run({
      velocity: velocity([entry(3, { productId: 'n' })], { days: 2 }),
      stock: new Map([['n', agg('SKU-n', 0)]]),
      products: [prod({ ID: 'n' })],
      leadTimeDays: 3,
    });
    expect(rowFor(res, 'SKU-n')).toMatchObject({
      dailyVelocity: 1.5,
      suggestedQuantity: 5,
      reasons: ['stockout_before_delivery', 'needs_cover'],
    });
  });

  it('does not fire stockout when cover is exactly the lead time', () => {
    // Velocity 2/day, lead 7, target 0. Cover 14 / 2 = 7 is not below 7.
    const res = run({
      velocity: velocity([entry(60, { productId: 'p' }), entry(60, { productId: 'q' })]),
      stock: new Map([
        ['p', agg('SKU-p', 14)],
        ['q', agg('SKU-q', 13.5)],
      ]),
      products: [prod({ ID: 'p' }), prod({ ID: 'q' })],
      leadTimeDays: 7,
    });
    expect(skusOf(res)).toEqual(['SKU-q']);
    expect(rowFor(res, 'SKU-q')).toMatchObject({
      daysOfCover: 6.75,
      suggestedQuantity: 1,
      reasons: ['stockout_before_delivery', 'needs_cover'],
    });
  });

  it('never fires stockout when leadTimeDays is 0', () => {
    const res = run({
      velocity: velocity([entry(60, { productId: 'r' }), entry(60, { productId: 's' })]),
      stock: new Map([
        ['r', agg('SKU-r', 0)],
        ['s', agg('SKU-s', 0)],
      ]),
      products: [prod({ ID: 'r' }), prod({ ID: 's' })],
      targetCoverDays: 3,
    });
    expect(skusOf(res)).toEqual(['SKU-r', 'SKU-s']);
    for (const row of res.top) {
      expect(row.reasons).toEqual(['needs_cover']);
    }
    expect(res.counts.stockoutBeforeDelivery).toBe(0);
    expect(res.assumptions).toEqual({ leadTimeDays: 0, targetCoverDays: 3 });
  });

  it('ranks by cover ascending (null last), then headroom, then SKU', () => {
    // Velocity 1/day (30 over 30 days), lead 5, target 0.
    const res = run({
      velocity: velocity([
        entry(30, { productId: 'pD' }),
        entry(30, { productId: 'pAA' }),
        entry(30, { productId: 'pBB' }),
        entry(30, { productId: 'pC' }),
        entry(30, { productId: 'pOK' }),
      ]),
      stock: new Map([
        ['pD', agg('SKU-D', 2)],
        ['pAA', agg('SKU-AA', 2)],
        ['pBB', agg('SKU-BB', 2)],
        ['pC', agg('SKU-C', 3)],
        ['pB', agg('SKU-B', 4)],
        ['pOK', agg('SKU-OK', 100)],
      ]),
      products: [
        // Cover 2, headroom 2 - 5 = -3: first in the cover-2 group.
        prod({ ID: 'pD', SKU: 'SKU-D', MinimumBeforeReorder: 5 }),
        // Cover 2, headroom 2: ties with pBB, so SKU decides.
        prod({ ID: 'pAA', SKU: 'SKU-AA' }),
        prod({ ID: 'pBB', SKU: 'SKU-BB' }),
        // Cover 3.
        prod({ ID: 'pC', SKU: 'SKU-C' }),
        // No velocity, so cover is null and it sorts last despite the smallest headroom.
        prod({ ID: 'pB', SKU: 'SKU-B', MinimumBeforeReorder: 10 }),
        prod({ ID: 'pOK', SKU: 'SKU-OK' }),
      ],
      leadTimeDays: 5,
    });
    expect(skusOf(res)).toEqual(['SKU-D', 'SKU-AA', 'SKU-BB', 'SKU-C', 'SKU-B']);
    expect(res.counts.candidates).toBe(5);
  });

  it('caps top at topN but counts every candidate', () => {
    const products = [prod({ ID: 'a' }), prod({ ID: 'b' }), prod({ ID: 'c' })];
    const stock = new Map([
      ['a', agg('SKU-a', 0)],
      ['b', agg('SKU-b', 0)],
      ['c', agg('SKU-c', 0)],
    ]);
    const velocityEntries = [
      entry(30, { productId: 'a' }),
      entry(30, { productId: 'b' }),
      entry(30, { productId: 'c' }),
    ];
    const res = run({
      velocity: velocity(velocityEntries),
      stock,
      products,
      targetCoverDays: 2,
      topN: 2,
    });
    expect(res.top).toHaveLength(2);
    expect(res.counts.candidates).toBe(3);
    expect(res.counts.needsCover).toBe(3);
    expect(res.counts.products).toBe(3);

    const none = run({
      velocity: velocity(velocityEntries),
      stock,
      products,
      targetCoverDays: 2,
      topN: 0,
    });
    expect(none.top).toEqual([]);
    expect(none.counts.candidates).toBe(3);
  });

  it('returns zero counts and an empty top for empty inputs, and copies the window', () => {
    const res = run({ velocity: velocity([], { noProductUnits: 5 }) });
    expect(res).toEqual({
      window: { from: '2026-10-01', to: '2026-10-30', days: 30 },
      assumptions: { leadTimeDays: 0, targetCoverDays: 0 },
      counts: {
        products: 0,
        withVelocity: 0,
        velocityMatchedToProduct: 0,
        velocityUnmatched: { products: 0, units: 0 },
        noProductUnits: 5,
        belowThreshold: 0,
        stockoutBeforeDelivery: 0,
        needsCover: 0,
        candidates: 0,
        productsWithThreshold: 0,
      },
      top: [],
    });
  });
});
