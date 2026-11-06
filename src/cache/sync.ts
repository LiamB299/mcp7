import type { Cin7Client } from '../cin7/client.js';
import { Cin7Error } from '../cin7/client.js';
import { listAll } from '../cin7/paginate.js';
import type { SaleListRow } from '../cin7/types.js';
import { dateOnly, resolveAsOf } from '../dates.js';
import { applyDetail, headerFromListRow, toUpdatedSince } from './extract.js';
import type { SnapshotStore } from './store.js';
import {
  type CachedSale,
  DEFAULT_WINDOW_DAYS,
  emptySnapshot,
  type Snapshot,
  type SyncProgress,
} from './types.js';

export interface SyncOptions {
  /** Days of history to load details for. null = all history. Default 90. */
  windowDays?: number | null;
  /** Re-list every header (reconcile) instead of only those updated since the cursor. */
  full?: boolean;
  /** Time budget; the sync stops cleanly and a later call resumes. Default 270 s. */
  maxMs?: number;
  /** Save the snapshot every N fetched details so an interrupted load resumes. Default 25. */
  checkpointEvery?: number;
  /** Re-list this far before the cursor to absorb clock fuzz. Default 1 day. */
  overlapMs?: number;
  /** yyyy-MM-dd used to compute the window (default: today in the tenant time zone). */
  asOf?: string;
  now?: () => number;
  onProgress?: (p: SyncProgress) => void;
}

export interface SyncResult {
  complete: boolean;
  snapshot: Snapshot;
  windowFrom: string | null;
  headersListed: number;
  fetchedDetails: number;
  /** Wanted details not loaded yet (time budget or error). */
  remaining: number;
  cin7Calls: number;
  elapsedMs: number;
  mode: 'full' | 'incremental';
  error?: string;
}

const up = (s: string | null | undefined) => (s ?? '').trim().toUpperCase();

function subtractDays(yyyyMmDd: string, days: number): string {
  const d = new Date(`${yyyyMmDd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** A sale is worth fetching details for when it is invoiced and not voided. */
const wantsDetail = (row: SaleListRow): boolean =>
  up(row.Status) !== 'VOIDED' && up(row.CombinedInvoiceStatus).startsWith('INVOICED');

/** In the window when its order, invoice or last-update date reaches the window start. */
function inWindow(row: SaleListRow, from: string | null): boolean {
  if (from === null) return true;
  return [row.OrderDate, row.InvoiceDate, row.Updated].some((v) => {
    const d = dateOnly(v);
    return d !== undefined && d >= from;
  });
}

const minFrom = (a: string | null, b: string | null): string | null =>
  a === null || b === null ? null : a < b ? a : b;

/**
 * Refresh the snapshot. Change detection compares the per-sale `Updated` from the header list with the
 * stored value (UpdatedSince only narrows the list). Pending details are persisted, so a stop at the time
 * budget or an error is resumable. Holds the store lock for the duration.
 */
export async function syncSnapshot(
  deps: { cin7: Cin7Client; store: SnapshotStore },
  options: SyncOptions = {},
): Promise<SyncResult> {
  const now = options.now ?? Date.now;
  const started = now();
  const maxMs = options.maxMs ?? 270_000;
  const checkpointEvery = options.checkpointEvery ?? 25;
  const overlapMs = options.overlapMs ?? 86_400_000;
  const windowDays = options.windowDays === undefined ? DEFAULT_WINDOW_DAYS : options.windowDays;

  let calls = 0;
  const cin7: Cin7Client = {
    get: (path, query) => {
      calls++;
      return deps.cin7.get(path, query);
    },
  };

  const release = await deps.store.lock();
  try {
    const snap: Snapshot =
      (await deps.store.load()) ?? emptySnapshot(new Date(started).toISOString());
    // The tenant time zone (one /me call) is only needed to compute a date window.
    const hadSnapshot = snap.lastSyncAt !== null;
    // A snapshot that already covers all history is unaffected by any narrower request: skip the lookup.
    const coversAll = hadSnapshot && snap.windowFrom === null;
    const requestedFrom =
      windowDays === null || coversAll
        ? null
        : subtractDays(options.asOf ?? (await resolveAsOf(cin7)), windowDays);
    const effectiveFrom = hadSnapshot ? minFrom(snap.windowFrom, requestedFrom) : requestedFrom;
    const widened = hadSnapshot && effectiveFrom !== snap.windowFrom;
    const full = Boolean(options.full) || !hadSnapshot || snap.cursorMs === null || widened;

    // 1. Headers (cheap: one call per 1000 sales).
    options.onProgress?.({ phase: 'headers', done: 0, total: 0 });
    const query = full
      ? {}
      : { UpdatedSince: toUpdatedSince((snap.cursorMs as number) - overlapMs) };
    const { rows } = await listAll<SaleListRow>(cin7, 'saleList', query, 'SaleList');

    let maxUpdated = snap.cursorMs ?? 0;
    for (const row of rows) {
      if (!row.SaleID) continue;
      const prior = snap.sales[row.SaleID];
      const header = headerFromListRow(row);
      const unchanged =
        prior !== undefined && prior.updated === header.updated && prior.detailFetched;
      if (header.updatedMs > maxUpdated) maxUpdated = header.updatedMs;
      if (unchanged) continue; // docs (or the header-only verdict) already reflect this version
      const needs = wantsDetail(row) && inWindow(row, effectiveFrom);
      snap.sales[row.SaleID] = needs
        ? { ...header, pendingDetail: true }
        : { ...header, detailFetched: !wantsDetail(row), pendingDetail: false };
    }
    // Window widened or a pending flag carried over: make sure every wanted sale is queued.
    for (const sale of Object.values(snap.sales)) {
      if (sale.pendingDetail || sale.detailFetched) continue;
      if (
        sale.status &&
        up(sale.status) !== 'VOIDED' &&
        up(sale.listInvoiceStatus).startsWith('INVOICED')
      ) {
        const inside =
          effectiveFrom === null ||
          [sale.orderDate, sale.invoiceDate, dateOnly(sale.updated)].some(
            (d) => d !== null && d !== undefined && d >= effectiveFrom,
          );
        if (inside) sale.pendingDetail = true;
      }
    }

    snap.cursorMs = maxUpdated || snap.cursorMs;
    snap.windowFrom = effectiveFrom;
    snap.lastSyncAt = new Date(now()).toISOString();
    await deps.store.save(snap); // headers and pending flags are durable before any detail is fetched

    // 2. Details for pending sales, newest first, within the time budget.
    const pending: CachedSale[] = Object.values(snap.sales)
      .filter((s) => s.pendingDetail)
      .sort((a, b) =>
        (b.invoiceDate ?? b.orderDate ?? '').localeCompare(a.invoiceDate ?? a.orderDate ?? ''),
      );
    const total = pending.length;
    let fetched = 0;
    let error: string | undefined;
    for (const sale of pending) {
      if (now() - started >= maxMs) break;
      try {
        const detail = await cin7.get<unknown>('sale', {
          ID: sale.id,
          HideInventoryMovements: true,
        });
        snap.sales[sale.id] = applyDetail(sale, detail);
        if (snap.sales[sale.id]!.updatedMs > (snap.cursorMs ?? 0))
          snap.cursorMs = snap.sales[sale.id]!.updatedMs;
      } catch (e) {
        if (e instanceof Cin7Error && e.status === 404) {
          delete snap.sales[sale.id]; // vanished
          continue;
        }
        error = e instanceof Error ? e.message : String(e);
        break;
      }
      fetched++;
      options.onProgress?.({ phase: 'details', done: fetched, total });
      if (fetched % checkpointEvery === 0) await deps.store.save(snap);
    }
    snap.lastSyncAt = new Date(now()).toISOString();
    await deps.store.save(snap);

    const remaining = Object.values(snap.sales).filter((s) => s.pendingDetail).length;
    return {
      complete: remaining === 0 && error === undefined,
      snapshot: snap,
      windowFrom: snap.windowFrom,
      headersListed: rows.length,
      fetchedDetails: fetched,
      remaining,
      cin7Calls: calls,
      elapsedMs: now() - started,
      mode: full ? 'full' : 'incremental',
      ...(error !== undefined ? { error } : {}),
    };
  } finally {
    await release();
  }
}
