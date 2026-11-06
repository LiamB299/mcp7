import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { revenueBySku, type SkuRevenueOptions } from '../cache/query.js';
import type { SnapshotStore } from '../cache/store.js';
import { type Cin7Client, Cin7Error } from '../cin7/client.js';
import { dataAsOf } from '../shape.js';
import {
  coverageVerdict,
  dateProblem,
  errorResult,
  loadSnapshotForAnswer,
} from './cache-answer.js';

const inputSchema = z.object({
  from: z
    .string()
    .optional()
    .describe(
      'Start date, yyyy-MM-dd (inclusive). Omit for ALL HISTORY (loads details for every invoiced sale).',
    ),
  to: z.string().optional().describe('End date, yyyy-MM-dd (inclusive). Omit for no end date.'),
  topN: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe('How many SKUs to list in rows (1-50, default 10). The rest roll up into "other".'),
  sortBy: z
    .enum(['revenue', 'margin', 'quantity'])
    .default('revenue')
    .describe('Sort order for rows (default revenue).'),
  refresh: z
    .boolean()
    .default(true)
    .describe(
      'Refresh the local cache from Cin7 before answering (default true). Set false to answer from the existing cache only.',
    ),
  maxMinutes: z
    .number()
    .min(0.5)
    .max(15)
    .default(4.5)
    .describe('Time budget for this call in minutes (0.5-15, default 4.5). Later calls resume.'),
});

const skuRow = z.object({
  sku: z.string(),
  name: z.string().nullable(),
  revenueExTax: z.number(),
  quantity: z.number(),
  cost: z.number(),
  margin: z.number(),
  marginPct: z.number().nullable(),
});

const outputSchema = z.object({
  from: z.string().nullable(),
  to: z.string().nullable(),
  currency: z.string().nullable(),
  salesContributing: z.number().int(),
  documents: z.object({ invoices: z.number().int(), creditNotes: z.number().int() }),
  totals: z.object({
    revenueExTax: z.number(),
    cost: z.number(),
    margin: z.number(),
    quantity: z.number(),
    additionalCharges: z.number(),
  }),
  rows: z.array(skuRow),
  other: z
    .object({
      skus: z.number().int(),
      revenueExTax: z.number(),
      quantity: z.number(),
      margin: z.number(),
    })
    .nullable(),
  nonBaseCurrencySales: z.number().int(),
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
  'Revenue is EX-TAX: invoice lines minus credit-note lines, attributed by the invoice or credit-note ' +
  'date (not the order date). On sales priced tax-inclusive the line tax is removed. Only AUTHORISED or ' +
  'PAID invoices and AUTHORISED credit notes count. Margin = ex-tax revenue minus line AverageCost x ' +
  'Quantity (Cin7 COGSAmount is not used). Additional charges (freight etc.) are reported separately in ' +
  'totals, not in SKU rows. Amounts are summed as stored. nonBaseCurrencySales counts contributing sales ' +
  'whose customer currency differs from the base currency. Rows carry SKUs and product names only.';

export function registerSalesBySku(
  server: McpServer,
  cin7: Cin7Client,
  store: SnapshotStore,
): void {
  server.registerTool(
    'sales_by_sku',
    {
      title: 'Sales by SKU',
      description:
        'Revenue, quantity and margin by SKU from the local line-level sales cache. Revenue is ex-tax and ' +
        'attributed by invoice or credit-note date. Optional date range (from/to, yyyy-MM-dd); omitting ' +
        '"from" means ALL HISTORY. By default (refresh true) it first refreshes the cache from Cin7 with ' +
        'read-only GETs, so it may warm the cache: the first load for a wide range takes minutes (about ' +
        '1.1 s per sale detail). Calls resume where they stopped, bounded by maxMinutes. Every answer ' +
        'states coverage (complete, remaining, rangeCovered, pendingDetail); when complete is false the ' +
        'totals are PARTIAL and the note says why and how to continue. Set refresh false to answer from ' +
        'the existing cache only.',
      inputSchema,
      outputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ from, to, topN, sortBy, refresh, maxMinutes }, ctx) => {
      try {
        const badFrom = dateProblem('from', from);
        if (badFrom) return errorResult(badFrom);
        const badTo = dateProblem('to', to);
        if (badTo) return errorResult(badTo);
        if (from !== undefined && to !== undefined && from > to) {
          return errorResult(`from (${from}) is after to (${to}).`);
        }

        const loaded = await loadSnapshotForAnswer({
          cin7,
          store,
          ctx,
          refresh,
          maxMinutes,
          from,
          noCacheMessage:
            'No cached sales data yet. Call sales_by_sku with refresh true (or cache_refresh) to build it; the first load takes minutes.',
        });
        if (!loaded.ok) return errorResult(loaded.error);

        const options: SkuRevenueOptions = {
          ...(from !== undefined ? { from } : {}),
          ...(to !== undefined ? { to } : {}),
          topN,
          sortBy,
        };
        const result = revenueBySku(loaded.snapshot, options);
        const { note, ...verdict } = coverageVerdict(refresh, loaded, result.coverage);

        const output = {
          ...result,
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
