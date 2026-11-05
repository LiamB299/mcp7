import type { Cin7Client } from './cin7/client.js';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** First 10 chars of a Cin7 date/datetime string (`yyyy-MM-dd`), or undefined. */
export function dateOnly(value: string | null | undefined): string | undefined {
  return value && DATE_ONLY.test(value.slice(0, 10)) ? value.slice(0, 10) : undefined;
}

/** Whole days from `from` to `to` (both `yyyy-MM-dd`); positive when `to` is later. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Today's date (`yyyy-MM-dd`) in an IANA time zone. */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

const tenantZones = new WeakMap<Cin7Client, Promise<string>>();

/** Tenant time zone from `/me` (cached per client). */
export function tenantTimeZone(cin7: Cin7Client): Promise<string> {
  let zone = tenantZones.get(cin7);
  if (!zone) {
    zone = cin7.get<{ TimeZone?: string }>('me').then((me) => me.TimeZone ?? 'UTC');
    tenantZones.set(cin7, zone);
  }
  return zone;
}

/**
 * Resolve the "as of" date a report is computed for. An explicit `asOf` must be `yyyy-MM-dd`;
 * otherwise it is today in the tenant's time zone (so "overdue" does not drift by a day).
 */
export async function resolveAsOf(cin7: Cin7Client, asOf?: string): Promise<string> {
  if (asOf !== undefined) {
    if (!DATE_ONLY.test(asOf)) throw new Error(`asOf must be yyyy-MM-dd, got "${asOf}"`);
    return asOf;
  }
  return todayInTimeZone(await tenantTimeZone(cin7));
}
