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
export type Query = Record<string, string | number | boolean | undefined>;

export interface Cin7Client {
  get<T>(path: string, query?: Query): Promise<T>;
}

export interface Cin7ClientOptions {
  /** Minimum gap between request starts. Cin7 allows 60 calls/min per key; default 1100 ms. */
  minIntervalMs?: number;
  /** Retries after a 429/503 before giving up. Default 3. */
  maxRetries?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Cin7 Core HTTP client. Single choke point for all upstream calls: requests are paced
 * serially (the key is shared with other users/scripts) and 429/503 responses are retried
 * with backoff (V2 returns 429 when over the limit, V1 returns 503). No caching yet.
 */
export function createCin7Client(
  config: Config,
  fetchImpl: FetchLike = fetch,
  options: Cin7ClientOptions = {},
): Cin7Client {
  const minIntervalMs = options.minIntervalMs ?? 1100;
  const maxRetries = options.maxRetries ?? 3;
  const sleep = options.sleep ?? defaultSleep;

  let chain: Promise<unknown> = Promise.resolve();
  let lastStart = 0;

  /** Run `fn` after earlier requests, at least `minIntervalMs` after the previous start. */
  function schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(async () => {
      const wait = lastStart + minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      lastStart = Date.now();
      return fn();
    });
    chain = run.catch(() => undefined);
    return run;
  }

  async function request<T>(path: string, query: Query): Promise<T> {
    const url = new URL(path.replace(/^\//, ''), config.baseUrl);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(url, {
        headers: {
          'api-auth-accountid': config.accountId,
          'api-auth-applicationkey': config.applicationKey,
          'Content-Type': 'application/json',
        },
      });
      if ((res.status === 429 || res.status === 503) && attempt < maxRetries) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt);
        lastStart = Date.now();
        continue;
      }
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
    }
  }

  return {
    get<T>(path: string, query: Query = {}) {
      return schedule(() => request<T>(path, query));
    },
  };
}
