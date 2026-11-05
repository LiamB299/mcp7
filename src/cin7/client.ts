import type { Config } from '../config.js';

/** Error returned by Cin7 (`{ErrorCode, Exception}` body) or a transport-level failure. */
export class Cin7Error extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errorCode?: number,
  ) {
    super(message);
    this.name = 'Cin7Error';
  }
}

export type FetchLike = typeof fetch;

export interface Cin7Client {
  get<T>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T>;
}

/**
 * Thin Cin7 Core HTTP client. Single choke point for all upstream calls, so rate limiting
 * (60 calls/min per key), retries and caching can be added here later.
 */
export function createCin7Client(config: Config, fetchImpl: FetchLike = fetch): Cin7Client {
  return {
    async get<T>(path: string, query: Record<string, string | number | boolean | undefined> = {}) {
      const url = new URL(path.replace(/^\//, ''), config.baseUrl);
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
      const res = await fetchImpl(url, {
        headers: {
          'api-auth-accountid': config.accountId,
          'api-auth-applicationkey': config.applicationKey,
          'Content-Type': 'application/json',
        },
      });
      const text = await res.text();
      let body: unknown;
      try {
        body = text ? JSON.parse(text) : undefined;
      } catch {
        body = undefined;
      }
      if (!res.ok) {
        const err = body as { ErrorCode?: number; Exception?: string } | undefined;
        throw new Cin7Error(
          err?.Exception ?? `Cin7 request failed: HTTP ${res.status}`,
          res.status,
          err?.ErrorCode,
        );
      }
      return body as T;
    },
  };
}
