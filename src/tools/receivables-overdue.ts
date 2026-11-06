import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { type ReceivablesOptions, receivablesFromDocs } from '../cache/receivables.js';
import type { SnapshotStore } from '../cache/store.js';
import { type Cin7Client, Cin7Error } from '../cin7/client.js';
import { resolveAsOf } from '../dates.js';
import { dataAsOf } from '../shape.js';
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
      'Date to measure overdue against, yyyy-MM-dd. Defaults to today in the tenant time zone.',
    ),
  topN: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe('How many of the largest overdue balances to list in top (1-50, default 10).'),
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

const money = z.object({ count: z.number().int(), total: z.number() });

const outputSchema = z.object({
  asOf: z.string(),
  currency: z.string().nullable(),
  salesScanned: z.number().int(),
  outstanding: money,
  overdue: money,
  noDueDate: money,
  ageBuckets: z.object({
    '1-30': money,
    '31-60': money,
    '61-90': money,
    '90+': money,
  }),
  top: z.array(
    z.object({
      orderNumber: z.string().nullable(),
      customer: z.string().nullable(),
      customerId: z.string().nullable(),
      dueDate: z.string(),
      daysOverdue: z.number().int(),
      outstanding: z.number(),
    }),
  ),
  nonBaseCurrencySales: z.number().int(),
  withoutCreditNetting: z.object({ outstanding: money, overdue: money }),
  listRollup: z.object({
    salesScanned: z.number().int(),
    outstanding: money,
    overdue: money,
    noDueDate: money,
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
  "Basis is the invoice and credit-note DOCUMENTS from the local cache, not Cin7's list rollups. " +
  'Receivable = a non-voided sale with an authorised or paid invoice whose outstanding balance ' +
  '(invoice totals minus amounts paid on invoices minus authorised credit notes, tax-inclusive, rounded ' +
  '2 dp) is above 0.005. Fully paid, overpaid and fully credited sales are ignored, not netted against ' +
  'other sales. Due date = the earliest due date among invoices that still have an open balance. A sale ' +
  'with no such due date is counted under noDueDate, not overdue. Overdue = due strictly before asOf. ' +
  'daysOverdue = whole days from due date to asOf; age buckets cover overdue sales only. ' +
  'withoutCreditNetting ignores credit notes (a refunded credit note may already be reflected in the ' +
  'paid amount, which is unverified). listRollup is the previous basis (Cin7 saleList InvoiceAmount minus ' +
  'PaidAmount; it differs from the documents on about 30% of sandbox sales), kept for comparison. ' +
  'Amounts are summed as stored. nonBaseCurrencySales counts receivable sales whose customer currency ' +
  'differs from the sale currency. All history is loaded: the first load takes minutes (about 1.1 s per ' +
  'invoiced sale) and calls resume. The coverage fields say whether the answer is complete; when complete ' +
  'is false the totals are PARTIAL. asOf defaults to today in the tenant time zone. Customer business names ' +
  'appear in top.';

export function registerReceivablesOverdue(
  server: McpServer,
  cin7: Cin7Client,
  store: SnapshotStore,
): void {
  server.registerTool(
    'receivables_overdue',
    {
      title: 'Receivables overdue',
      description:
        'Customer receivables (unpaid sales invoices) from the local line-level sales cache, on the ' +
        'document basis: outstanding, overdue and no-due-date totals, overdue age buckets (1-30, 31-60, ' +
        '61-90, 90+ days), the largest overdue balances, and the previous list-rollup figure for ' +
        'comparison. Measured as of asOf (yyyy-MM-dd, default today in the tenant time zone). By default ' +
        '(refresh true) it first refreshes the cache from Cin7 with read-only GETs, so it may warm the ' +
        'cache: the first load covers all history and takes minutes (about 1.1 s per invoiced sale). ' +
        'Calls resume where they stopped, bounded by maxMinutes. Every answer states coverage (complete, ' +
        'remaining, pendingDetail); when complete is false the totals are PARTIAL and the note says how to ' +
        'continue. Set refresh false to answer from the existing cache only. ' +
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
    async ({ asOf: asOfArg, topN, refresh, maxMinutes }, ctx) => {
      try {
        const badAsOf = dateProblem('asOf', asOfArg);
        if (badAsOf) return errorResult(badAsOf);
        const asOf = await resolveAsOf(cin7, asOfArg);

        // All history (from undefined): old unpaid invoices matter. full: true re-lists every header
        // so a changed paid amount is noticed even when Updated did not move.
        const loaded = await loadSnapshotForAnswer({
          cin7,
          store,
          ctx,
          refresh,
          maxMinutes,
          from: undefined,
          full: true,
          noCacheMessage:
            'No cached sales data yet. Call receivables_overdue with refresh true (or cache_refresh) to build it; the first load takes minutes.',
        });
        if (!loaded.ok) return errorResult(loaded.error);

        const options: ReceivablesOptions = { asOf, topN };
        const result = receivablesFromDocs(loaded.snapshot, options);
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
