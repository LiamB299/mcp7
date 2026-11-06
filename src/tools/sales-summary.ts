import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { type Cin7Client, Cin7Error } from '../cin7/client.js';
import { listAll } from '../cin7/paginate.js';
import { dateOnly } from '../dates.js';

/** Row shape of Cin7 `saleList` (only the fields this tool reads). */
interface SaleListRow {
  SaleID?: number | string;
  OrderNumber?: string | null;
  Customer?: string | null;
  CustomerID?: number | string | null;
  Status?: string | null;
  OrderDate?: string | null;
  SourceChannel?: string | null;
  /** Net of credit notes; 0 (or null) when not yet invoiced. */
  InvoiceAmount?: number | null;
  BaseCurrency?: string | null;
}

type GroupBy = 'month' | 'channel' | 'customer';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date in `yyyy-MM-dd` form (rejects e.g. 2026-02-30). */
function isCalendarDate(value: string): boolean {
  if (!DATE_ONLY.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const TOOL_DEFINITION = [
  'Sales with OrderDate (date part) in [from, to], both inclusive; from and to are optional (omitted = open-ended, both omitted = all time). Status VOIDED is excluded.',
  'Undated sales (no parsable OrderDate) are included only when no date bound is given; with groupBy month they group under "(no date)".',
  'saleCount = non-void sales in the group (uninvoiced sales included).',
  'invoicedTotal = sum of InvoiceAmount, net of credit notes; uninvoiced sales (0) add nothing; rounded to 2 dp.',
  'groupBy month = OrderDate yyyy-MM, ascending, all months returned.',
  'groupBy channel = SourceChannel, "(none)" when null or empty; groupBy customer = grouped by CustomerID.',
  'channel and customer are sorted by invoicedTotal then saleCount, descending; the top topN are kept and the rest rolled into `other`.',
  'currency = BaseCurrency of the first fetched row.',
].join(' ');

const groupSchema = z.object({
  key: z.string(),
  customerId: z.string().optional(),
  saleCount: z.number().int(),
  invoicedTotal: z.number(),
});

const outputSchema = z.object({
  from: z.string().nullable(),
  to: z.string().nullable(),
  groupBy: z.enum(['month', 'channel', 'customer']),
  currency: z.string().nullable(),
  salesScanned: z.number().int(),
  saleCount: z.number().int(),
  invoicedTotal: z.number(),
  groups: z.array(groupSchema),
  other: z
    .object({
      groups: z.number().int(),
      saleCount: z.number().int(),
      invoicedTotal: z.number(),
    })
    .optional(),
  definition: z.string(),
});

interface Bucket {
  key: string;
  customerId: string | undefined;
  saleCount: number;
  total: number;
}

/** Group key for a row, plus the display key and customer id. */
function groupFor(
  row: SaleListRow,
  day: string | undefined,
  groupBy: GroupBy,
): { mapKey: string; key: string; customerId: string | undefined } {
  switch (groupBy) {
    case 'month': {
      const month = day ? day.slice(0, 7) : '(no date)';
      return { mapKey: month, key: month, customerId: undefined };
    }
    case 'channel': {
      const channel = row.SourceChannel?.trim() || '(none)';
      return { mapKey: channel, key: channel, customerId: undefined };
    }
    case 'customer': {
      const name = row.Customer?.trim() || '(unknown)';
      const id =
        row.CustomerID === null || row.CustomerID === undefined || row.CustomerID === ''
          ? undefined
          : String(row.CustomerID);
      return { mapKey: id ?? `name:${name}`, key: name, customerId: id };
    }
  }
}

function toGroup(bucket: Bucket) {
  return {
    key: bucket.key,
    ...(bucket.customerId !== undefined ? { customerId: bucket.customerId } : {}),
    saleCount: bucket.saleCount,
    invoicedTotal: round2(bucket.total),
  };
}

export function registerSalesSummary(server: McpServer, cin7: Cin7Client): void {
  server.registerTool(
    'sales_summary',
    {
      title: 'Sales summary',
      description: `Summarise Cin7 sales orders for an optional date range (omit from/to for all time), grouped by month, channel or customer. ${TOOL_DEFINITION}`,
      inputSchema: z.object({
        from: z
          .string()
          .optional()
          .describe('Start date, inclusive, yyyy-MM-dd. Optional; omitted = no lower bound.'),
        to: z
          .string()
          .optional()
          .describe(
            'End date, inclusive, yyyy-MM-dd. Optional; omitted = no upper bound. Must not be before from.',
          ),
        groupBy: z.enum(['month', 'channel', 'customer']).describe('How to group the sales.'),
        topN: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(10)
          .describe(
            'For channel and customer: number of groups to show before rolling up into `other`.',
          ),
      }),
      outputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ from, to, groupBy, topN }) => {
      try {
        if (from !== undefined && !isCalendarDate(from))
          throw new Error(`from must be a valid yyyy-MM-dd date, got "${from}"`);
        if (to !== undefined && !isCalendarDate(to))
          throw new Error(`to must be a valid yyyy-MM-dd date, got "${to}"`);
        if (from !== undefined && to !== undefined && from > to)
          throw new Error(`from (${from}) must not be after to (${to})`);
        const hasBound = from !== undefined || to !== undefined;

        const { rows } = await listAll<SaleListRow>(cin7, 'saleList', {}, 'SaleList');

        const buckets = new Map<string, Bucket>();
        let saleCount = 0;
        let invoicedTotal = 0;
        for (const row of rows) {
          if (row.Status === 'VOIDED') continue;
          const day = dateOnly(row.OrderDate);
          if (day === undefined) {
            if (hasBound) continue;
          } else if ((from !== undefined && day < from) || (to !== undefined && day > to)) {
            continue;
          }

          const { mapKey, key, customerId } = groupFor(row, day, groupBy);
          const amount = row.InvoiceAmount ?? 0;
          let bucket = buckets.get(mapKey);
          if (!bucket) {
            bucket = { key, customerId, saleCount: 0, total: 0 };
            buckets.set(mapKey, bucket);
          }
          bucket.saleCount += 1;
          bucket.total += amount;
          saleCount += 1;
          invoicedTotal += amount;
        }

        const all = [...buckets.values()];
        let groups: Bucket[];
        let other: { groups: number; saleCount: number; invoicedTotal: number } | undefined;
        if (groupBy === 'month') {
          groups = all.sort(
            (a, b) =>
              (a.key === '(no date)' ? 1 : 0) - (b.key === '(no date)' ? 1 : 0) ||
              a.key.localeCompare(b.key),
          );
        } else {
          all.sort(
            (a, b) => b.total - a.total || b.saleCount - a.saleCount || a.key.localeCompare(b.key),
          );
          groups = all.slice(0, topN);
          const rest = all.slice(topN);
          if (rest.length > 0) {
            other = {
              groups: rest.length,
              saleCount: rest.reduce((sum, b) => sum + b.saleCount, 0),
              invoicedTotal: round2(rest.reduce((sum, b) => sum + b.total, 0)),
            };
          }
        }

        const output = {
          from: from ?? null,
          to: to ?? null,
          groupBy,
          currency: rows[0]?.BaseCurrency ?? null,
          salesScanned: rows.length,
          saleCount,
          invoicedTotal: round2(invoicedTotal),
          groups: groups.map(toGroup),
          ...(other ? { other } : {}),
          definition: TOOL_DEFINITION,
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
        return { isError: true, content: [{ type: 'text', text: message }] };
      }
    },
  );
}
