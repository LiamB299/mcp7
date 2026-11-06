import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { type RollupDrift, rollupDrift } from '../cache/query.js';
import type { SnapshotStore } from '../cache/store.js';
import type { Snapshot } from '../cache/types.js';
import { dataAsOf } from '../shape.js';

const inputSchema = z.object({});

const outputSchema = z.object({
  exists: z.boolean(),
  location: z.string(),
  sizeBytes: z.number().nullable(),
  createdAt: z.string().nullable(),
  lastSyncAt: z.string().nullable(),
  windowFrom: z
    .string()
    .nullable()
    .describe('Detail coverage start (yyyy-MM-dd). Null with exists true means all history.'),
  sales: z.object({
    total: z.number().int(),
    withDocuments: z.number().int(),
    pendingDetail: z.number().int(),
    voided: z.number().int(),
  }),
  estimatedMinutesToLoadPending: z.number(),
  rollupDrift: z
    .object({
      compared: z.number().int(),
      differing: z.number().int(),
      creditNotesNotNetted: z.number().int(),
      zeroDespiteInvoice: z.number().int(),
      other: z.number().int(),
    })
    .nullable(),
  dataAsOf: z.string(),
  note: z.string(),
});

const CALL_SECONDS = 1.1;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Rollup drift is computed by another module; a failure here must not break the status read. */
function safeDrift(snapshot: Snapshot): RollupDrift | null {
  try {
    return rollupDrift(snapshot);
  } catch {
    return null;
  }
}

export function registerCacheStatus(server: McpServer, store: SnapshotStore): void {
  server.registerTool(
    'cache_status',
    {
      title: 'Cache status',
      description:
        'Status of the local line-level sales cache: whether it exists, where it lives, size, last sync, ' +
        'detail window, how many sales have document detail or are still pending, voided count, an estimate ' +
        'of minutes to load the pending detail, and a rollup-drift check. Reads the local cache file only; ' +
        'makes NO Cin7 calls. Read-only. Use cache_refresh to build or update the cache.',
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const snapshot = await store.load();
      const sizeBytes = await store.sizeBytes();
      const location = store.label;

      if (snapshot === null) {
        const output = {
          exists: false,
          location,
          sizeBytes,
          createdAt: null,
          lastSyncAt: null,
          windowFrom: null,
          sales: { total: 0, withDocuments: 0, pendingDetail: 0, voided: 0 },
          estimatedMinutesToLoadPending: 0,
          rollupDrift: null,
          dataAsOf: dataAsOf(),
          note:
            'No local snapshot yet. Build it with cache_refresh (it lists headers, then loads invoice ' +
            'detail within the time budget; call it again until complete). sales_by_sku also uses the cache.',
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(output) }],
          structuredContent: output,
        };
      }

      const sales = Object.values(snapshot.sales);
      const pending = sales.filter((s) => s.pendingDetail).length;
      const voided = sales.filter((s) => (s.status ?? '').trim().toUpperCase() === 'VOIDED').length;
      const drift = safeDrift(snapshot);
      const minutes = round1((pending * CALL_SECONDS) / 60);

      const output = {
        exists: true,
        location,
        sizeBytes,
        createdAt: snapshot.createdAt,
        lastSyncAt: snapshot.lastSyncAt,
        windowFrom: snapshot.windowFrom,
        sales: {
          total: sales.length,
          withDocuments: sales.filter((s) => s.docs.length > 0).length,
          pendingDetail: pending,
          voided,
        },
        estimatedMinutesToLoadPending: minutes,
        rollupDrift: drift
          ? {
              compared: drift.compared,
              differing: drift.differing,
              creditNotesNotNetted: drift.creditNotesNotNetted,
              zeroDespiteInvoice: drift.zeroDespiteInvoice,
              other: drift.other,
            }
          : null,
        dataAsOf: dataAsOf(),
        note:
          'Local cache only; this call made no Cin7 calls. ' +
          (pending > 0
            ? `${pending} sales are still waiting for document detail (about ${minutes} min); call cache_refresh to continue. `
            : 'No sales are waiting for detail. ') +
          'rollupDrift compares list invoice totals with the stored documents; differences are a heads-up, not an error.',
      };
      return {
        content: [{ type: 'text', text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );
}
