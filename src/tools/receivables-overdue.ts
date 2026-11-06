import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { type Cin7Client, Cin7Error } from '../cin7/client.js';
import { listAll } from '../cin7/paginate.js';
import { dateOnly, daysBetween, resolveAsOf } from '../dates.js';

/** Fields read from a `saleList` row (Cin7 V2 `SaleList` array). */
interface SaleListRow {
  SaleID?: string;
  OrderNumber?: string | null;
  Customer?: string | null;
  CustomerID?: string | null;
  Status?: string | null;
  InvoiceAmount?: number | null;
  PaidAmount?: number | null;
  InvoiceDueDate?: string | null;
  InvoiceNumber?: string | null;
  BaseCurrency?: string | null;
}

const BUCKETS = ['1-30', '31-60', '61-90', '90+'] as const;
type BucketKey = (typeof BUCKETS)[number];

const money = z.object({ count: z.number().int(), total: z.number() });

const outputSchema = z.object({
  asOf: z.string(),
  currency: z.string().nullable(),
  salesScanned: z.number().int(),
  outstanding: money,
  overdue: money,
  noDueDate: money,
  ageBuckets: z.object({
    '1-30': money,
    '31-60': money,
    '61-90': money,
    '90+': money,
  }),
  top: z.array(
    z.object({
      orderNumber: z.string().nullable(),
      customer: z.string().nullable(),
      customerId: z.string().nullable(),
      dueDate: z.string(),
      daysOverdue: z.number().int(),
      outstanding: z.number(),
    }),
  ),
  definition: z.string(),
});

const DEFINITION = [
  'Basis: Cin7 saleList rollup fields, not a reconciliation of invoice and credit-note documents.',
  'Receivables = saleList rows whose Status is not VOIDED and whose outstanding balance',
  '(InvoiceAmount - PaidAmount, rounded to 2 dp; Cin7 documents InvoiceAmount as net of credit notes',
  'and PaidAmount as net of refunds) is above 0.005.',
  'In the sandbox these rollups differ from the document totals on about 30% of sales, so treat results as the list rollup.',
  'Overpaid or fully credited rows (zero or negative balance) are ignored, not netted against others.',
  'Overdue = receivable whose InvoiceDueDate (date part) is strictly before asOf.',
  'Receivables with no due date are counted under noDueDate, not overdue.',
  'daysOverdue = whole days from due date to asOf. Age buckets cover overdue rows only, by daysOverdue.',
  'top = overdue rows sorted by outstanding, largest first, limited to topN.',
  'asOf defaults to today in the tenant time zone. Money is rounded to 2 dp.',
].join(' ');

const round2 = (n: number) => Math.round(n * 100) / 100;

function bucketFor(days: number): BucketKey {
  if (days <= 30) return '1-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

export function registerReceivablesOverdue(server: McpServer, cin7: Cin7Client): void {
  server.registerTool(
    'receivables_overdue',
    {
      title: 'Receivables overdue',
      description:
        'Summarise customer receivables (unpaid sales invoices) from Cin7 Core as of a date: ' +
        'outstanding, overdue and no-due-date totals, overdue age buckets (1-30, 31-60, 61-90, 90+ days), ' +
        'and the largest overdue balances. ' +
        `Definitions: ${DEFINITION}`,
      inputSchema: z.object({
        asOf: z
          .string()
          .optional()
          .describe(
            'Date to measure overdue against, yyyy-MM-dd. Defaults to today in the tenant time zone.',
          ),
        topN: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe('How many of the largest overdue balances to list (1-50). Default 10.'),
      }),
      outputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const asOf = await resolveAsOf(cin7, args.asOf);
        const topN = args.topN ?? 10;
        const { rows } = await listAll<SaleListRow>(cin7, 'saleList', {}, 'SaleList');

        const outstanding = { count: 0, total: 0 };
        const overdue = { count: 0, total: 0 };
        const noDueDate = { count: 0, total: 0 };
        const buckets = Object.fromEntries(
          BUCKETS.map((key) => [key, { count: 0, total: 0 }]),
        ) as Record<BucketKey, { count: number; total: number }>;
        const overdueRows: {
          orderNumber: string | null;
          customer: string | null;
          customerId: string | null;
          dueDate: string;
          daysOverdue: number;
          outstanding: number;
        }[] = [];

        for (const row of rows) {
          if ((row.Status ?? '').toUpperCase() === 'VOIDED') continue;
          const balance = round2((row.InvoiceAmount ?? 0) - (row.PaidAmount ?? 0));
          if (!(balance > 0.005)) continue;

          outstanding.count += 1;
          outstanding.total += balance;

          const due = dateOnly(row.InvoiceDueDate);
          if (due === undefined) {
            noDueDate.count += 1;
            noDueDate.total += balance;
            continue;
          }
          const days = daysBetween(due, asOf);
          if (days <= 0) continue;

          overdue.count += 1;
          overdue.total += balance;
          const bucket = buckets[bucketFor(days)];
          bucket.count += 1;
          bucket.total += balance;
          overdueRows.push({
            orderNumber: row.OrderNumber ?? null,
            customer: row.Customer ?? null,
            customerId: row.CustomerID ?? null,
            dueDate: due,
            daysOverdue: days,
            outstanding: balance,
          });
        }

        const money2 = (m: { count: number; total: number }) => ({
          count: m.count,
          total: round2(m.total),
        });
        const output = {
          asOf,
          currency: rows[0]?.BaseCurrency ?? null,
          salesScanned: rows.length,
          outstanding: money2(outstanding),
          overdue: money2(overdue),
          noDueDate: money2(noDueDate),
          ageBuckets: Object.fromEntries(
            BUCKETS.map((key) => [key, money2(buckets[key])]),
          ) as Record<BucketKey, { count: number; total: number }>,
          top: overdueRows.sort((a, b) => b.outstanding - a.outstanding).slice(0, topN),
          definition: DEFINITION,
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
