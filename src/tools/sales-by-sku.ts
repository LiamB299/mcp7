import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { progressReporter } from '../cache/progress.js';
import { revenueBySku, type SkuRevenueOptions } from '../cache/query.js';
import { CacheLockedError, type SnapshotStore } from '../cache/store.js';
import { type SyncResult, syncSnapshot } from '../cache/sync.js';
import { type Cin7Client, Cin7Error } from '../cin7/client.js';
import { daysBetween, resolveAsOf } from '../dates.js';
import { dataAsOf } from '../shape.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Observed cost of one sale detail call (about 1.1 s). Used only for the time estimate. */
const SECONDS_PER_DETAIL = 1.1;

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

/** True for a real calendar date in yyyy-MM-dd (rejects 2026-02-30 and 2026-13-01). */
function isRealDate(v: string): boolean {
  if (!DATE_RE.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
}

function dateProblem(name: string, v: string | undefined): string | null {
  if (v === undefined) return null;
  return isRealDate(v) ? null : `${name} must be a real calendar date in yyyy-MM-dd, got "${v}".`;
}

const errorResult = (message: string) => ({
  isError: true,
  content: [{ type: 'text' as const, text: message }],
});

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

        let snapshot: Awaited<ReturnType<SnapshotStore['load']>>;
        let sync: SyncResult | undefined;
        let refreshSkipped = false;

        if (refresh) {
          const asOf = from === undefined ? undefined : await resolveAsOf(cin7);
          const windowDays =
            from === undefined ? null : Math.max(1, daysBetween(from, asOf as string) + 1);
          const onProgress = progressReporter(ctx);
          try {
            sync = await syncSnapshot(
              { cin7, store },
              {
                windowDays,
                maxMs: maxMinutes * 60_000,
                ...(asOf !== undefined ? { asOf } : {}),
                ...(onProgress ? { onProgress } : {}),
              },
            );
            snapshot = sync.snapshot;
          } catch (e) {
            if (!(e instanceof CacheLockedError)) throw e;
            const cached = await store.load();
            if (cached === null) {
              return errorResult(
                'The cache is being built by another process and nothing is cached yet; retry shortly.',
              );
            }
            snapshot = cached;
            refreshSkipped = true;
          }
        } else {
          snapshot = await store.load();
          if (snapshot === null) {
            return errorResult(
              'No cached sales data yet. Call sales_by_sku with refresh true (or cache_refresh) to build it; the first load takes minutes.',
            );
          }
        }

        const options: SkuRevenueOptions = {
          ...(from !== undefined ? { from } : {}),
          ...(to !== undefined ? { to } : {}),
          topN,
          sortBy,
        };
        const result = revenueBySku(snapshot, options);
        const { coverage } = result;

        const syncComplete = refresh ? (sync?.complete ?? false) : true;
        const complete = syncComplete && coverage.rangeCovered && coverage.pendingDetail === 0;
        const remaining = refresh
          ? (sync?.remaining ?? coverage.pendingDetail)
          : coverage.pendingDetail;

        const notes: string[] = [];
        if (refreshSkipped) {
          notes.push(
            'refresh skipped: another process is refreshing. Totals come from the existing snapshot and may be older than Cin7.',
          );
        }
        if (!complete) {
          const reasons: string[] = [];
          if (refresh && sync && !sync.complete) {
            reasons.push(
              sync.error !== undefined
                ? `the refresh stopped early on a Cin7 error with ${remaining} sale details still to load`
                : `sale details are still loading (${remaining} left)`,
            );
          }
          if (refreshSkipped) reasons.push('the refresh was skipped');
          if (coverage.pendingDetail > 0) {
            reasons.push(
              `${coverage.pendingDetail} sales in the cache have no line detail yet, so their revenue is missing`,
            );
          }
          if (!coverage.rangeCovered) {
            reasons.push(
              `the loaded window starts ${coverage.windowFrom ?? 'at the beginning'} and does not cover the requested range`,
            );
          }
          const how = refreshSkipped
            ? 'Call again shortly to refresh.'
            : refresh
              ? 'Call again with the same arguments to resume; each call loads more.'
              : 'Call with refresh true to load more.';
          notes.push(`PARTIAL totals: ${reasons.join('; ')}. ${how}`);
        }

        const output = {
          ...result,
          complete,
          remaining,
          estimatedMinutesRemaining: Math.round(((remaining * SECONDS_PER_DETAIL) / 60) * 10) / 10,
          refreshed: sync !== undefined,
          ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
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
