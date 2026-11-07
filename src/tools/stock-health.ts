import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { type Cin7Client, Cin7Error } from '../cin7/client.js';
import { listAll } from '../cin7/paginate.js';
import type { AvailabilityRow, ProductRow } from '../cin7/types.js';
import { dataAsOf } from '../shape.js';
import { aggregateAvailability, isStockProduct, num, productKey } from '../stock/availability.js';

const inputSchema = z.object({
  topN: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe('How many products to list in each "top" array (1-50, default 10).'),
  includeReorder: z
    .boolean()
    .default(true)
    .describe(
      'Run the reorder-point check (belowReorderPoint). Default true. Costs a second, full read of ' +
        'the product list (about 2 large calls at 1000 per page). Set false to skip it.',
    ),
});

const skuName = { sku: z.string(), name: z.string() };

const outputSchema = z.object({
  rowsScanned: z.number().int(),
  productCount: z.number().int(),
  negativeAvailable: z.object({
    rows: z.number().int(),
    products: z.number().int(),
    top: z.array(z.object({ ...skuName, available: z.number() })),
  }),
  onOrderNothingOnHand: z.object({
    count: z.number().int(),
    top: z.array(z.object({ ...skuName, onOrder: z.number() })),
  }),
  belowReorderPoint: z
    .object({
      count: z.number().int(),
      withOpenOrder: z.number().int(),
      productsWithThreshold: z.number().int(),
      productsScanned: z.number().int(),
      nonStockExcluded: z.number().int(),
      top: z.array(
        z.object({
          ...skuName,
          available: z.number(),
          minimum: z.number(),
          reorderQuantity: z.number(),
          onOrder: z.number(),
        }),
      ),
    })
    .nullable(),
  formulaMismatchRows: z.object({
    count: z.number().int(),
    top: z.array(
      z.object({
        sku: z.string(),
        onHand: z.number(),
        allocated: z.number(),
        available: z.number(),
      }),
    ),
  }),
  dataAsOf: z.string(),
  definition: z.string(),
});

const DEFINITION =
  'Stock health from Cin7 ref/productavailability (one row per product x location x bin x batch), ' +
  'aggregated by product ID. negativeAvailable: rows with Available < 0, and products whose summed ' +
  'Available < 0 (a negative row can net out at product level). onOrderNothingOnHand: products with ' +
  'summed OnHand = 0 and summed OnOrder > 0. belowReorderPoint (null if includeReorder is false): ' +
  'stock products (Service and deprecated products are excluded: they hold no stock) with product-level ' +
  'MinimumBeforeReorder > 0 whose summed Available (0 if no rows) is at or ' +
  'below that minimum; withOpenOrder counts those with summed OnOrder > 0; top sorted by ' +
  'available minus minimum, ascending. formulaMismatchRows: rows where |Available - (OnHand - ' +
  'Allocated)| > 0.0001, sorted by size of mismatch; the cause is UNVERIFIED (possibly assembly/BOM ' +
  'availability or other adjustments), so treat it as a heads-up, not a confirmed error. Null numbers ' +
  'count as 0. Money is not involved; quantities are rounded to 2 dp.';

const EPS = 1e-9;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function registerStockHealth(server: McpServer, cin7: Cin7Client): void {
  server.registerTool(
    'stock_health',
    {
      title: 'Stock health',
      description:
        'Stock-health heads-up across Cin7 Core: products with negative available stock, products with ' +
        'stock on order but none on hand, products at or below their reorder point (optional), and rows ' +
        'where Available does not equal OnHand minus Allocated (cause unverified). Each check gives a ' +
        'count and a short top list. Read-only. Reads every page of ref/productavailability; when ' +
        'includeReorder is true (default) it also reads every page of the product list, about 2 large ' +
        'calls at 1000 per page (Service and deprecated products are excluded from the reorder check). ' +
        'Set includeReorder to false to skip that second read.',
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ topN, includeReorder }) => {
      try {
        const [availability, products] = await Promise.all([
          listAll<AvailabilityRow>(cin7, 'ref/productavailability', {}, 'ProductAvailabilityList'),
          includeReorder
            ? listAll<ProductRow>(cin7, 'product', {}, 'Products')
            : Promise.resolve({ rows: [] as ProductRow[], total: 0 }),
        ]);
        const rows = availability.rows;

        // Aggregate availability rows per product ID.
        const { aggs, negativeRows, mismatches } = aggregateAvailability(rows);

        const aggList = [...aggs.values()];

        // 1. Negative available, per row (above) and per summed product.
        const negativeProducts = aggList
          .filter((a) => a.available < -EPS)
          .sort((a, b) => a.available - b.available);

        // 2. On order, nothing on hand.
        const onOrderNothing = aggList
          .filter((a) => Math.abs(a.onHand) < EPS && a.onOrder > EPS)
          .sort((a, b) => b.onOrder - a.onOrder);

        // 3. Below reorder point (product-level top-level fields, not ReorderLevels).
        let belowReorderPoint: z.infer<typeof outputSchema>['belowReorderPoint'] = null;
        if (includeReorder) {
          const stockProducts = products.rows.filter(isStockProduct);
          const withThreshold = stockProducts.filter((p) => num(p.MinimumBeforeReorder) > 0);
          const below = withThreshold
            .map((p) => {
              const agg = aggs.get(productKey(p));
              const minimum = num(p.MinimumBeforeReorder);
              const available = agg?.available ?? 0;
              return {
                sku: p.SKU ?? agg?.sku ?? '',
                name: p.Name ?? agg?.name ?? '',
                available,
                minimum,
                reorderQuantity: num(p.ReorderQuantity),
                onOrder: agg?.onOrder ?? 0,
              };
            })
            .filter((p) => p.available <= p.minimum + EPS)
            .sort((a, b) => a.available - a.minimum - (b.available - b.minimum));

          belowReorderPoint = {
            count: below.length,
            withOpenOrder: below.filter((p) => p.onOrder > EPS).length,
            productsWithThreshold: withThreshold.length,
            productsScanned: products.rows.length,
            nonStockExcluded: products.rows.length - stockProducts.length,
            top: below.slice(0, topN).map((p) => ({
              sku: p.sku,
              name: p.name,
              available: round2(p.available),
              minimum: round2(p.minimum),
              reorderQuantity: round2(p.reorderQuantity),
              onOrder: round2(p.onOrder),
            })),
          };
        }

        // 4. Formula mismatch rows, largest mismatch first.
        mismatches.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

        const output = {
          rowsScanned: rows.length,
          productCount: aggs.size,
          negativeAvailable: {
            rows: negativeRows,
            products: negativeProducts.length,
            top: negativeProducts.slice(0, topN).map((a) => ({
              sku: a.sku,
              name: a.name,
              available: round2(a.available),
            })),
          },
          onOrderNothingOnHand: {
            count: onOrderNothing.length,
            top: onOrderNothing.slice(0, topN).map((a) => ({
              sku: a.sku,
              name: a.name,
              onOrder: round2(a.onOrder),
            })),
          },
          belowReorderPoint,
          formulaMismatchRows: {
            count: mismatches.length,
            top: mismatches.slice(0, 10).map((m) => ({
              sku: m.sku,
              onHand: round2(m.onHand),
              allocated: round2(m.allocated),
              available: round2(m.available),
            })),
          },
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
        return { isError: true, content: [{ type: 'text', text: message }] };
      }
    },
  );
}
