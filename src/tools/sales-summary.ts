import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { type SalesSummaryOptions, salesSummaryFromDocs } from '../cache/sales-summary.js';
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
  groupBy: z
    .enum(['month', 'channel', 'customer'])
    .describe('How to group the sales: month (yyyy-MM), channel (SourceChannel) or customer.'),
  topN: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe(
      'For channel and customer: how many groups to list (1-50, default 10). The rest roll up into "other".',
    ),
  dateBasis: z
    .enum(['document', 'order'])
    .default('document')
    .describe(
      'document (default): revenue is attributed by invoice or credit-note date. order: counts sales whose ORDER date is in range, all their documents included (use for "sales ordered between X and Y").',
    ),
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

const groupSchema = z.object({
  key: z.string(),
  customerId: z.string().optional(),
  saleCount: z.number().int(),
  revenueExTax: z.number(),
  revenueIncTax: z.number(),
});

const outputSchema = z.object({
  from: z.string().nullable(),
  to: z.string().nullable(),
  groupBy: z.enum(['month', 'channel', 'customer']),
  dateBasis: z.enum(['document', 'order']),
  currency: z.string().nullable(),
  saleCount: z.number().int(),
  documents: z.object({ invoices: z.number().int(), creditNotes: z.number().int() }),
  revenueExTax: z.number(),
  revenueIncTax: z.number(),
  groups: z.array(groupSchema),
  other: z
    .object({
      groups: z.number().int(),
      saleCount: z.number().int(),
      revenueExTax: z.number(),
      revenueIncTax: z.number(),
    })
    .nullable(),
  nonBaseCurrencySales: z.number().int(),
  listRollup: z.object({
    saleCount: z.number().int(),
    invoicedTotal: z.number(),
    groups: z.array(
      z.object({
        key: z.string(),
        customerId: z.string().optional(),
        saleCount: z.number().int(),
        invoicedTotal: z.number(),
      }),
    ),
    other: z
      .object({
        groups: z.number().int(),
        saleCount: z.number().int(),
        invoicedTotal: z.number(),
      })
      .nullable(),
  }),
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
  'Basis is the invoice and credit-note DOCUMENTS in the local cache (authorised or paid invoices add, ' +
  'authorised credit notes subtract), not Cin7 list rollups. revenueExTax = document total before tax; ' +
  'revenueIncTax = document total. BOTH INCLUDE additional charges such as freight (unlike sales_by_sku ' +
  'SKU rows, which are line-only). dateBasis document: each document counts in the period of its own ' +
  'date (invoice or credit-note date); a sale counts once in each group it has documents in; saleCount = ' +
  'sales with at least one document in range. dateBasis order: sales whose order date is in range, all ' +
  'their documents counted, uninvoiced sales counted in saleCount with zero revenue. Voided sales are ' +
  'excluded. from/to are inclusive; omitted = open-ended. Omitting from loads all history (the first load ' +
  'takes minutes, about 1.1 s per invoiced sale; calls resume). month = yyyy-MM ascending, (no date) last; ' +
  'channel = SourceChannel, (none) when blank; customer = grouped by customer id, with the business name ' +
  'shown. Channel and customer groups are sorted by revenueExTax then saleCount, descending; the top topN ' +
  'are kept and the rest roll into other. listRollup is the previous basis (Cin7 list InvoiceAmount by ' +
  'order date; it differs from documents on about 30% of sandbox sales), kept for comparison. Amounts are ' +
  'summed as stored. nonBaseCurrencySales counts contributing sales whose customer currency differs from ' +
  'the base currency. Coverage fields say whether the answer is complete; when complete is false the ' +
  'totals are PARTIAL.';

export function registerSalesSummary(
  server: McpServer,
  cin7: Cin7Client,
  store: SnapshotStore,
): void {
  server.registerTool(
    'sales_summary',
    {
      title: 'Sales summary',
      description:
        'Sales count and revenue (ex-tax and inc-tax) from the local line-level sales cache, grouped by ' +
        'month, channel or customer, for an optional date range. Revenue comes from invoice and credit-note ' +
        'documents, attributed by document date (dateBasis document, the default) or by order date ' +
        '(dateBasis order). Optional date range (from/to, yyyy-MM-dd); omitting "from" means ALL HISTORY. ' +
        'By default (refresh true) it first refreshes the cache from Cin7 with read-only GETs, so it may warm ' +
        'the cache: the first load for a wide range takes minutes. Calls resume where they stopped, bounded ' +
        'by maxMinutes. Every answer states coverage (complete, remaining, rangeCovered, pendingDetail); when ' +
        'complete is false the totals are PARTIAL and the note says why and how to continue. Set refresh false ' +
        'to answer from the existing cache only. ' +
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
    async ({ from, to, groupBy, topN, dateBasis, refresh, maxMinutes }, ctx) => {
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
            'No cached sales data yet. Call sales_summary with refresh true (or cache_refresh) to build it; the first load takes minutes.',
        });
        if (!loaded.ok) return errorResult(loaded.error);

        const options: SalesSummaryOptions = {
          ...(from !== undefined ? { from } : {}),
          ...(to !== undefined ? { to } : {}),
          groupBy,
          topN,
          dateBasis,
        };
        const result = salesSummaryFromDocs(loaded.snapshot, options);
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
