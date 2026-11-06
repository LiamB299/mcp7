import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { SnapshotStore } from '../cache/store.js';
import { salesVelocity, windowStart } from '../cache/velocity.js';
import { type Cin7Client, Cin7Error } from '../cin7/client.js';
import { listAll } from '../cin7/paginate.js';
import type { AvailabilityRow, ProductRow } from '../cin7/types.js';
import { resolveAsOf } from '../dates.js';
import { reorderSuggestions } from '../reorder.js';
import { dataAsOf } from '../shape.js';
import { aggregateAvailability } from '../stock/availability.js';
import {
  coverageVerdict,
  dateProblem,
  errorResult,
  loadSnapshotForAnswer,
} from './cache-answer.js';

const inputSchema = z.object({
  asOf: z
    .string()
    .optional()
    .describe(
      'Date the sales window ends on, yyyy-MM-dd. Defaults to today in the tenant time zone. It moves ' +
        'only the sales window: stock is always current, whatever asOf is.',
    ),
  windowDays: z
    .number()
    .int()
    .min(1)
    .max(730)
    .default(90)
    .describe(
      'Sales window length in days, ending on asOf (1-730, default 90). Velocity is net invoiced units ' +
        'over the full window length.',
    ),
  leadTimeDays: z
    .number()
    .min(0)
    .max(365)
    .default(14)
    .describe(
      'ASSUMED supplier lead time in days (0-365, default 14). You set it; it is not supplier data. ' +
        'Drives stockout_before_delivery and the suggested quantity.',
    ),
  targetCoverDays: z
    .number()
    .min(0)
    .max(365)
    .default(30)
    .describe(
      'ASSUMED days of cover to hold after delivery (0-365, default 30). You set it; it is not ' +
        'supplier data. Drives the suggested quantity.',
    ),
  topN: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe('How many candidate products to list in top, most urgent first (1-50, default 10).'),
  refresh: z
    .boolean()
    .default(true)
    .describe(
      'Refresh the local sales cache from Cin7 before answering (default true). Set false to answer from ' +
        'the existing cache only. Stock and the product list are always read live from Cin7.',
    ),
  maxMinutes: z
    .number()
    .min(0.5)
    .max(15)
    .default(4.5)
    .describe(
      'Time budget for the cache refresh in minutes (0.5-15, default 4.5). Later calls resume.',
    ),
});

const reasonSchema = z.enum(['below_cin7_threshold', 'stockout_before_delivery', 'needs_cover']);

const rowSchema = z.object({
  sku: z.string(),
  name: z.string(),
  available: z.number(),
  onHand: z.number(),
  onOrder: z.number(),
  netUnitsSold: z.number(),
  dailyVelocity: z.number(),
  daysOfCover: z.number().nullable(),
  daysOfCoverWithOnOrder: z.number().nullable(),
  minimum: z.number(),
  cin7ReorderQuantity: z.number(),
  reasons: z.array(reasonSchema),
  suggestedQuantity: z.number(),
});

const outputSchema = z.object({
  asOf: z.string(),
  window: z.object({ from: z.string(), to: z.string(), days: z.number().int() }),
  assumptions: z.object({ leadTimeDays: z.number(), targetCoverDays: z.number() }),
  stockAsOf: z.literal('now'),
  counts: z.object({
    products: z.number().int(),
    withVelocity: z.number().int(),
    velocityMatchedToProduct: z.number().int(),
    velocityUnmatched: z.object({ products: z.number().int(), units: z.number() }),
    noProductUnits: z.number(),
    belowThreshold: z.number().int(),
    stockoutBeforeDelivery: z.number().int(),
    needsCover: z.number().int(),
    candidates: z.number().int(),
    productsWithThreshold: z.number().int(),
  }),
  top: z.array(rowSchema),
  coverage: z.object({
    salesInSnapshot: z.number().int(),
    withDetail: z.number().int(),
    pendingDetail: z.number().int(),
    windowFrom: z.string().nullable(),
    rangeCovered: z.boolean(),
  }),
  complete: z.boolean(),
  remaining: z.number().int(),
  estimatedMinutesRemaining: z.number(),
  refreshed: z.boolean(),
  note: z.string().optional(),
  dataAsOf: z.string(),
  definition: z.string(),
});

const DEFINITION =
  'Reorder suggestions combine Cin7 reorder thresholds, current stock (summed over locations from product ' +
  'availability) and sales velocity from the local cache. Velocity = net units (invoice line quantity minus ' +
  'credit-note line quantity, by document date, non-voided sales) over the window [asOf minus windowDays ' +
  'plus 1, asOf], divided by the full window length (not shortened to the first sale). Demand is INVOICED ' +
  'units only: open, uninvoiced orders are not in the cache. Product universe = active (Status not ' +
  'Deprecated), non-Service products from the product list; a product with no stock rows counts as 0 ' +
  'available. Sales lines join to a product by product ID, then SKU; velocityUnmatched and noProductUnits ' +
  'report units that match no product. daysOfCover = available / daily velocity (null when there is no ' +
  'velocity); daysOfCoverWithOnOrder adds open purchase quantity. suggestedQuantity = ceil(max(0, daily ' +
  'velocity x (leadTimeDays + targetCoverDays) - available - on order)). leadTimeDays and targetCoverDays ' +
  'are ASSUMPTIONS you set (defaults 14 and 30), not supplier data. Reasons: below_cin7_threshold ' +
  '(product MinimumBeforeReorder > 0 and available at or below it), stockout_before_delivery (days of ' +
  'cover shorter than the lead time), needs_cover (suggested quantity above 0). Negative available stock ' +
  'counts as a shortfall in the suggested quantity even with no sales. Ranking: fewest days of cover ' +
  'first, products without sales last. Stock is current (stockAsOf now); with a past asOf only the sales ' +
  'window moves. Zero velocity with a short or unloaded window does not mean no demand: check coverage; ' +
  'when complete is false totals are PARTIAL. By default the cache is refreshed first (read-only GETs; the ' +
  'first load takes minutes, about 1.1 s per invoiced sale, resumable). Output carries SKUs and product ' +
  'names only.';

export function registerReorderSuggestions(
  server: McpServer,
  cin7: Cin7Client,
  store: SnapshotStore,
): void {
  server.registerTool(
    'reorder_suggestions',
    {
      title: 'Reorder suggestions',
      description:
        'What to reorder, how soon stock runs out, and how much to order: products ranked by days of ' +
        'cover, with a suggested quantity for lead time plus target cover. Reads the local sales cache plus ' +
        'two live Cin7 lists (product availability and products). By default (refresh true) it first ' +
        'refreshes the sales cache with read-only GETs, so it may warm the cache: the first load takes ' +
        'minutes (about 1.1 s per invoiced sale). Calls resume where they stopped, bounded by maxMinutes. ' +
        'Every answer states coverage (complete, remaining, pendingDetail); when complete is false the ' +
        'totals are PARTIAL. Set refresh false to answer from the existing cache only. ' +
        `Definitions: ${DEFINITION}`,
      inputSchema,
      outputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (
      { asOf: asOfArg, windowDays, leadTimeDays, targetCoverDays, topN, refresh, maxMinutes },
      ctx,
    ) => {
      try {
        const badAsOf = dateProblem('asOf', asOfArg);
        if (badAsOf) return errorResult(badAsOf);
        const asOf = await resolveAsOf(cin7, asOfArg);
        const from = windowStart(asOf, windowDays);

        const loaded = await loadSnapshotForAnswer({
          cin7,
          store,
          ctx,
          refresh,
          maxMinutes,
          from,
          noCacheMessage:
            'No cached sales data yet. Call reorder_suggestions with refresh true (or cache_refresh) to build it; the first load takes minutes.',
        });
        if (!loaded.ok) return errorResult(loaded.error);

        // The product list defines the universe, so it is always read.
        const [availability, products] = await Promise.all([
          listAll<AvailabilityRow>(cin7, 'ref/productavailability', {}, 'ProductAvailabilityList'),
          listAll<ProductRow>(cin7, 'product', {}, 'Products'),
        ]);

        const velocity = salesVelocity(loaded.snapshot, { asOf, windowDays });
        const stock = aggregateAvailability(availability.rows).aggs;
        const result = reorderSuggestions({
          velocity,
          stock,
          products: products.rows,
          leadTimeDays,
          targetCoverDays,
          topN,
        });
        const { note, ...verdict } = coverageVerdict(refresh, loaded, velocity.coverage);

        const output = {
          asOf,
          window: result.window,
          assumptions: result.assumptions,
          stockAsOf: 'now' as const,
          counts: result.counts,
          top: result.top,
          coverage: velocity.coverage,
          ...verdict,
          ...(note !== undefined ? { note } : {}),
          dataAsOf: dataAsOf(),
          definition: DEFINITION,
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(output) }],
          structuredContent: output,
        };
      } catch (e) {
        const message =
          e instanceof Cin7Error
            ? `Cin7 error (HTTP ${e.status}): ${e.message}`
            : `Unexpected error: ${(e as Error).message}`;
        return errorResult(message);
      }
    },
  );
}
