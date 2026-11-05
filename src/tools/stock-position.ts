import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { type Cin7Client, Cin7Error } from '../cin7/client.js';
import { listAll } from '../cin7/paginate.js';

/** One row of GET ref/productavailability: product x location x bin x batch. */
interface AvailabilityRow {
  ID?: string;
  SKU?: string;
  Name?: string;
  Location?: string;
  Batch?: string;
  OnHand?: number;
  Allocated?: number;
  Available?: number;
  OnOrder?: number;
  /** A monetary VALUE (OnHand x average cost), not a unit count. */
  StockOnHand?: number;
  InTransit?: number;
}

const inputSchema = z.object({
  location: z
    .string()
    .min(1)
    .optional()
    .describe('Exact Cin7 location name to filter on. Omit for all locations.'),
  topN: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe('How many products to return in topProducts (1-50, default 10).'),
});

const outputSchema = z.object({
  location: z.string().nullable(),
  rowsScanned: z.number().int(),
  productCount: z.number().int(),
  totalValue: z.number(),
  totalUnits: z.number(),
  byLocation: z.array(
    z.object({
      location: z.string(),
      value: z.number(),
      units: z.number(),
      productCount: z.number().int(),
    }),
  ),
  topProducts: z.array(
    z.object({
      sku: z.string(),
      name: z.string(),
      value: z.number(),
      units: z.number(),
    }),
  ),
  negativeAvailable: z.object({
    rows: z.number().int(),
    products: z.number().int(),
  }),
  definition: z.string(),
});

const DEFINITION =
  'Stock position from Cin7 ref/productavailability. "value" is the StockOnHand field, a monetary ' +
  'value (OnHand x average cost), NOT a unit count; "units" is the OnHand field. Totals sum every ' +
  'row scanned. byLocation groups rows by Location and is sorted by value desc. topProducts ' +
  'aggregates rows by product ID (across locations, bins and batches), sorted by value desc, ' +
  'limited to topN. negativeAvailable is a heads-up, not a full health check: rows = rows with ' +
  'Available < 0; products = distinct products whose summed Available < 0. Money and units are ' +
  'rounded to 2 dp.';

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (n: number | undefined) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);
const productKey = (r: AvailabilityRow) => r.ID ?? r.SKU ?? '';

export function registerStockPosition(server: McpServer, cin7: Cin7Client): void {
  server.registerTool(
    'stock_position',
    {
      title: 'Stock position',
      description:
        'Summarise stock on hand across Cin7 Core: total value and units, a per-location rollup, ' +
        'the top products by value, and a count of negative-available rows and products. ' +
        'Optionally filter to one location. Note: "value" is StockOnHand (a monetary value, ' +
        'OnHand x average cost), not a unit count. Read-only; reads every page of ref/productavailability.',
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ location, topN }) => {
      try {
        const { rows } = await listAll<AvailabilityRow>(
          cin7,
          'ref/productavailability',
          location ? { Location: location } : {},
          'ProductAvailabilityList',
        );

        let totalValue = 0;
        let totalUnits = 0;
        const products = new Set<string>();
        const locations = new Map<
          string,
          { value: number; units: number; products: Set<string> }
        >();
        const byProduct = new Map<
          string,
          { sku: string; name: string; value: number; units: number; available: number }
        >();
        let negativeRows = 0;

        for (const r of rows) {
          const value = num(r.StockOnHand);
          const units = num(r.OnHand);
          const key = productKey(r);
          totalValue += value;
          totalUnits += units;
          products.add(key);

          const locName = r.Location ?? '(none)';
          let loc = locations.get(locName);
          if (!loc) {
            loc = { value: 0, units: 0, products: new Set() };
            locations.set(locName, loc);
          }
          loc.value += value;
          loc.units += units;
          loc.products.add(key);

          let prod = byProduct.get(key);
          if (!prod) {
            prod = { sku: r.SKU ?? '', name: r.Name ?? '', value: 0, units: 0, available: 0 };
            byProduct.set(key, prod);
          }
          prod.value += value;
          prod.units += units;
          prod.available += num(r.Available);

          if (num(r.Available) < 0) negativeRows++;
        }

        const byLocation = [...locations.entries()]
          .map(([location, v]) => ({
            location,
            value: round2(v.value),
            units: round2(v.units),
            productCount: v.products.size,
          }))
          .sort((a, b) => b.value - a.value);

        const topProducts = [...byProduct.values()]
          .sort((a, b) => b.value - a.value)
          .slice(0, topN)
          .map((p) => ({
            sku: p.sku,
            name: p.name,
            value: round2(p.value),
            units: round2(p.units),
          }));

        const negativeProducts = [...byProduct.values()].filter((p) => p.available < 0).length;

        const output = {
          location: location ?? null,
          rowsScanned: rows.length,
          productCount: products.size,
          totalValue: round2(totalValue),
          totalUnits: round2(totalUnits),
          byLocation,
          topProducts,
          negativeAvailable: { rows: negativeRows, products: negativeProducts },
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
