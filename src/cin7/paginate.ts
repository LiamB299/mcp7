import type { Cin7Client, Query } from './client.js';

export interface ListAllOptions {
  /** Cin7 maximum is 1000. */
  pageSize?: number;
  /** Safety stop so a bad `Total` can never loop forever. */
  maxPages?: number;
}

export interface ListAllResult<T> {
  rows: T[];
  /** `Total` reported by Cin7 (all matching records, not just those fetched). */
  total: number;
}

/**
 * Fetch every page of a Cin7 list endpoint. List responses look like
 * `{ Total, Page, <arrayKey>: [...] }`; the array key differs per endpoint.
 * Stops when `Total` rows are collected, a page comes back empty, or `maxPages` is hit.
 */
export async function listAll<T>(
  cin7: Cin7Client,
  path: string,
  query: Query,
  arrayKey: string,
  options: ListAllOptions = {},
): Promise<ListAllResult<T>> {
  const pageSize = options.pageSize ?? 1000;
  const maxPages = options.maxPages ?? 50;
  const rows: T[] = [];
  let total = 0;
  for (let page = 1; page <= maxPages; page++) {
    const body = await cin7.get<Record<string, unknown>>(path, {
      ...query,
      Page: page,
      Limit: pageSize,
    });
    const pageRows = (body[arrayKey] as T[] | undefined) ?? [];
    total = typeof body.Total === 'number' ? body.Total : total;
    rows.push(...pageRows);
    if (pageRows.length === 0 || rows.length >= total) break;
  }
  return { rows, total };
}
