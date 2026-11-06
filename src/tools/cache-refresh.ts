import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { progressReporter } from '../cache/progress.js';
import { CacheLockedError, type SnapshotStore } from '../cache/store.js';
import { syncSnapshot } from '../cache/sync.js';
import { type Cin7Client, Cin7Error } from '../cin7/client.js';
import { dataAsOf } from '../shape.js';

const inputSchema = z.object({
  windowDays: z
    .union([z.number().int().min(1).max(3650), z.literal('all')])
    .optional()
    .describe(
      'Days of history whose invoice detail is loaded (1-3650), or "all" for all history. ' +
        'Omit for the default (90 days).',
    ),
  full: z
    .boolean()
    .default(false)
    .describe(
      'Re-list every sale header to reconcile the cache, instead of only sales updated since the last sync. Default false.',
    ),
  maxMinutes: z
    .number()
    .min(0.5)
    .max(15)
    .default(4.5)
    .describe(
      'Time budget for this call, in minutes (0.5-15, default 4.5). The sync is resumable: when complete is false, call again to continue.',
    ),
});

const outputSchema = z.object({
  complete: z.boolean(),
  mode: z.enum(['full', 'incremental']),
  windowFrom: z.string().nullable(),
  headersListed: z.number().int(),
  fetchedDetails: z.number().int(),
  remaining: z.number().int(),
  cin7Calls: z.number().int(),
  elapsedSeconds: z.number(),
  estimatedMinutesRemaining: z.number(),
  salesInSnapshot: z.number().int(),
  error: z.string().optional(),
  dataAsOf: z.string(),
  note: z.string(),
});

const CALL_SECONDS = 1.1;
const round1 = (n: number) => Math.round(n * 10) / 10;

export function registerCacheRefresh(
  server: McpServer,
  cin7: Cin7Client,
  store: SnapshotStore,
): void {
  server.registerTool(
    'cache_refresh',
    {
      title: 'Refresh sales cache',
      description:
        'Build or update the local line-level sales cache from Cin7 Core. Lists sale headers (incremental ' +
        'unless full is true), then loads invoice detail for invoiced, non-voided sales in the window, within ' +
        'a time budget. Resumable: if complete is false, call again. Writes only the local cache file; it never ' +
        'writes to Cin7. Holds a local lock, so a concurrent refresh is refused.',
      inputSchema,
      outputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ windowDays, full, maxMinutes }, ctx) => {
      try {
        const onProgress = progressReporter(ctx);
        const result = await syncSnapshot(
          { cin7, store },
          {
            ...(windowDays !== undefined
              ? { windowDays: windowDays === 'all' ? null : windowDays }
              : {}),
            full,
            maxMs: maxMinutes * 60_000,
            ...(onProgress !== undefined ? { onProgress } : {}),
          },
        );
        const remainingMinutes = round1((result.remaining * CALL_SECONDS) / 60);
        const output = {
          complete: result.complete,
          mode: result.mode,
          windowFrom: result.windowFrom,
          headersListed: result.headersListed,
          fetchedDetails: result.fetchedDetails,
          remaining: result.remaining,
          cin7Calls: result.cin7Calls,
          elapsedSeconds: round1(result.elapsedMs / 1000),
          estimatedMinutesRemaining: remainingMinutes,
          salesInSnapshot: Object.keys(result.snapshot.sales).length,
          ...(result.error !== undefined ? { error: result.error } : {}),
          dataAsOf: dataAsOf(),
          note:
            'The cache holds business names and order lines locally (gitignored) and no contact data. ' +
            (result.complete
              ? 'Load complete.'
              : `Incomplete: ${result.remaining} sales still need detail (about ${remainingMinutes} min). Call cache_refresh again to continue.`) +
            (result.error !== undefined ? ` Stopped on an error: ${result.error}` : ''),
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(output) }],
          structuredContent: output,
        };
      } catch (e) {
        if (e instanceof CacheLockedError) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: 'Another process is refreshing the cache (lock held). Try again shortly.',
              },
            ],
          };
        }
        const message =
          e instanceof Cin7Error
            ? `Cin7 error (HTTP ${e.status}): ${e.message}`
            : `Unexpected error: ${(e as Error).message}`;
        return { isError: true, content: [{ type: 'text', text: message }] };
      }
    },
  );
}
