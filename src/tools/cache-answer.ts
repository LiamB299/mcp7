import type { ServerContext } from '@modelcontextprotocol/server';
import { progressReporter } from '../cache/progress.js';
import { CacheLockedError, type SnapshotStore } from '../cache/store.js';
import { type SyncResult, syncSnapshot } from '../cache/sync.js';
import type { Snapshot } from '../cache/types.js';
import type { Cin7Client } from '../cin7/client.js';
import { daysBetween, resolveAsOf } from '../dates.js';

/**
 * Shared plumbing for tools that answer from the line-level cache (ADR 0005): refresh or load the
 * snapshot, then state how complete the answer is. Used by sales_by_sku, receivables_overdue and
 * sales_summary so all three report coverage the same way.
 */

/** Observed cost of one sale detail call (about 1.1 s). Used only for the time estimate. */
export const SECONDS_PER_DETAIL = 1.1;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date in yyyy-MM-dd (rejects 2026-02-30 and 2026-13-01). */
export function isRealDate(v: string): boolean {
  if (!DATE_RE.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
}

export function dateProblem(name: string, v: string | undefined): string | null {
  if (v === undefined) return null;
  return isRealDate(v) ? null : `${name} must be a real calendar date in yyyy-MM-dd, got "${v}".`;
}

export const errorResult = (message: string) => ({
  isError: true,
  content: [{ type: 'text' as const, text: message }],
});

export type SnapshotForAnswer =
  | { ok: true; snapshot: Snapshot; sync: SyncResult | undefined; refreshSkipped: boolean }
  | { ok: false; error: string };

export interface LoadOptions {
  cin7: Cin7Client;
  store: SnapshotStore;
  ctx: ServerContext | undefined;
  /** Refresh from Cin7 first (true) or answer from the existing cache only (false). */
  refresh: boolean;
  maxMinutes: number;
  /**
   * Detail window start. undefined = all history. When set, only details from this date are loaded.
   * Matches sales_by_sku: `from` omitted means all history.
   */
  from: string | undefined;
  /** Re-list every header (reconcile) so changed rollups are noticed even when `Updated` did not move. */
  full?: boolean;
  /** Message when there is no cache and refresh is false. */
  noCacheMessage: string;
}

/** Refresh (read-only GETs, resumable) or load the snapshot. Never throws for a lock conflict. */
export async function loadSnapshotForAnswer(opts: LoadOptions): Promise<SnapshotForAnswer> {
  const { cin7, store, ctx, refresh, maxMinutes, from, full, noCacheMessage } = opts;
  if (!refresh) {
    const snapshot = await store.load();
    if (snapshot === null) return { ok: false, error: noCacheMessage };
    return { ok: true, snapshot, sync: undefined, refreshSkipped: false };
  }

  const asOf = from === undefined ? undefined : await resolveAsOf(cin7);
  const windowDays = from === undefined ? null : Math.max(1, daysBetween(from, asOf as string) + 1);
  const onProgress = progressReporter(ctx);
  try {
    const sync = await syncSnapshot(
      { cin7, store },
      {
        windowDays,
        maxMs: maxMinutes * 60_000,
        ...(full ? { full: true } : {}),
        ...(asOf !== undefined ? { asOf } : {}),
        ...(onProgress ? { onProgress } : {}),
      },
    );
    return { ok: true, snapshot: sync.snapshot, sync, refreshSkipped: false };
  } catch (e) {
    if (!(e instanceof CacheLockedError)) throw e;
    const cached = await store.load();
    if (cached === null) {
      return {
        ok: false,
        error:
          'The cache is being built by another process and nothing is cached yet; retry shortly.',
      };
    }
    return { ok: true, snapshot: cached, sync: undefined, refreshSkipped: true };
  }
}

export interface CoverageInput {
  windowFrom: string | null;
  pendingDetail: number;
  rangeCovered: boolean;
}

export interface CoverageVerdict {
  complete: boolean;
  remaining: number;
  estimatedMinutesRemaining: number;
  refreshed: boolean;
  note?: string;
}

/** Say whether an answer is complete, and if not, why and how to continue. */
export function coverageVerdict(
  refresh: boolean,
  loaded: Extract<SnapshotForAnswer, { ok: true }>,
  coverage: CoverageInput,
): CoverageVerdict {
  const { sync, refreshSkipped } = loaded;
  const syncComplete = refresh ? (sync?.complete ?? false) : true;
  const complete = syncComplete && coverage.rangeCovered && coverage.pendingDetail === 0;
  const remaining = refresh ? (sync?.remaining ?? coverage.pendingDetail) : coverage.pendingDetail;

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

  return {
    complete,
    remaining,
    estimatedMinutesRemaining: Math.round(((remaining * SECONDS_PER_DETAIL) / 60) * 10) / 10,
    refreshed: sync !== undefined,
    ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
  };
}
