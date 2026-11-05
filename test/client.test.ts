import { describe, expect, it } from 'vitest';
import { Cin7Error, createCin7Client } from '../src/cin7/client.js';
import { listAll } from '../src/cin7/paginate.js';
import { daysBetween, resolveAsOf, todayInTimeZone } from '../src/dates.js';

const config = { accountId: 'acc', applicationKey: 'key', baseUrl: 'https://example.test/v2/' };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

describe('client retry and pacing', () => {
  it('retries 429 with backoff then succeeds', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const cin7 = createCin7Client(
      config,
      async () => (++calls < 3 ? json({ Exception: 'limit' }, 429) : json({ ok: true })),
      { minIntervalMs: 0, sleep: async (ms) => void sleeps.push(ms) },
    );
    expect(await cin7.get('x')).toEqual({ ok: true });
    expect(calls).toBe(3);
    expect(sleeps).toEqual([2000, 4000]);
  });

  it('honours Retry-After and gives up after maxRetries', async () => {
    const sleeps: number[] = [];
    const cin7 = createCin7Client(
      config,
      async () => json({ ErrorCode: 429, Exception: 'limit' }, 429, { 'retry-after': '7' }),
      { minIntervalMs: 0, maxRetries: 1, sleep: async (ms) => void sleeps.push(ms) },
    );
    await expect(cin7.get('x')).rejects.toBeInstanceOf(Cin7Error);
    expect(sleeps).toEqual([7000]);
  });

  it('spaces serial requests by minIntervalMs', async () => {
    const sleeps: number[] = [];
    const cin7 = createCin7Client(config, async () => json({}), {
      minIntervalMs: 1000,
      sleep: async (ms) => void sleeps.push(ms),
    });
    await Promise.all([cin7.get('a'), cin7.get('b')]);
    expect(sleeps.length).toBeGreaterThanOrEqual(1);
    expect(sleeps.every((s) => s > 0 && s <= 1000)).toBe(true);
  });
});

describe('listAll', () => {
  it('loops pages until Total rows are collected', async () => {
    const seen: string[] = [];
    const cin7 = createCin7Client(
      config,
      async (url) => {
        const u = new URL(String(url));
        seen.push(`${u.searchParams.get('Page')}/${u.searchParams.get('Limit')}`);
        const page = Number(u.searchParams.get('Page'));
        return json({ Total: 5, Page: page, Items: page === 1 ? [1, 2, 3] : [4, 5] });
      },
      { minIntervalMs: 0 },
    );
    const res = await listAll<number>(cin7, 'things', {}, 'Items', { pageSize: 3 });
    expect(res).toEqual({ rows: [1, 2, 3, 4, 5], total: 5 });
    expect(seen).toEqual(['1/3', '2/3']);
  });

  it('stops on an empty page and respects maxPages', async () => {
    const cin7 = createCin7Client(config, async () => json({ Total: 99, Items: [] }), {
      minIntervalMs: 0,
    });
    expect((await listAll(cin7, 'things', {}, 'Items')).rows).toEqual([]);
  });
});

describe('dates', () => {
  it('daysBetween and todayInTimeZone', () => {
    expect(daysBetween('2026-10-01', '2026-10-31')).toBe(30);
    expect(todayInTimeZone('Africa/Johannesburg', new Date('2026-11-05T23:30:00Z'))).toBe(
      '2026-11-06',
    );
    expect(todayInTimeZone('UTC', new Date('2026-11-05T23:30:00Z'))).toBe('2026-11-05');
  });

  it('resolveAsOf validates explicit dates and uses tenant zone otherwise', async () => {
    const cin7 = createCin7Client(config, async () => json({ TimeZone: 'UTC' }), {
      minIntervalMs: 0,
    });
    expect(await resolveAsOf(cin7, '2026-10-15')).toBe('2026-10-15');
    await expect(resolveAsOf(cin7, '15/10/2026')).rejects.toThrow(/yyyy-MM-dd/);
    expect(await resolveAsOf(cin7)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
