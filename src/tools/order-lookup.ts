import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { type Cin7Client, Cin7Error } from '../cin7/client.js';
import type { SaleListRow } from '../cin7/types.js';
import { dataAsOf, maskSale } from '../shape.js';
import { deriveSaleStage } from '../stage.js';

/** Max candidates returned when the lookup does not resolve to one sale. */
const CANDIDATE_LIMIT = 10;

const NOTE =
  'Personal contact details (contact person, email, phone, addresses) and free-text notes are ' +
  'deliberately omitted. Stage is derived from sub-statuses, not the master status.';

const nullableStr = z.string().nullable();
const nullableNum = z.number().nullable();

const candidateSchema = z.object({
  orderNumber: nullableStr,
  customer: nullableStr,
  status: nullableStr,
});

const saleSchema = z.object({
  saleId: nullableStr,
  orderNumber: nullableStr,
  customer: nullableStr,
  type: nullableStr,
  status: nullableStr,
  sourceChannel: nullableStr,
  orderDate: nullableStr,
  shipBy: nullableStr,
  location: nullableStr,
  currency: nullableStr,
  cogsAmount: nullableNum,
  subStatuses: z.object({
    picking: nullableStr,
    packing: nullableStr,
    shipping: nullableStr,
    invoice: nullableStr,
    payment: nullableStr,
  }),
  order: z.object({
    total: nullableNum,
    tax: nullableNum,
    totalBeforeTax: nullableNum,
  }),
  lines: z.array(
    z.object({
      sku: nullableStr,
      name: nullableStr,
      quantity: nullableNum,
      backorderQuantity: nullableNum,
      price: nullableNum,
      discount: nullableNum,
      total: nullableNum,
    }),
  ),
  totalLines: z.number().int(),
  truncated: z.boolean(),
  fulfilments: z.array(
    z.object({
      number: nullableStr,
      status: nullableStr,
      pick: nullableStr,
      pack: nullableStr,
      ship: nullableStr,
    }),
  ),
  invoices: z.array(
    z.object({
      number: nullableStr,
      status: nullableStr,
      dueDate: nullableStr,
      total: nullableNum,
      paid: nullableNum,
    }),
  ),
  creditNotes: z.array(
    z.object({
      number: nullableStr,
      status: nullableStr,
      total: nullableNum,
    }),
  ),
});

/**
 * One output schema for every outcome. `found: true` fills stage, sale, dataAsOf and note;
 * `found: false` fills reason and candidates. Fields that only exist on one shape are optional.
 */
const outputSchema = z.object({
  found: z.boolean(),
  orderNumber: z.string().optional(),
  stage: z
    .object({
      stage: z.string(),
      fulfilment: z.string(),
      billing: z.string(),
      backordered: z.boolean(),
    })
    .optional(),
  sale: saleSchema.optional(),
  dataAsOf: z.string().optional(),
  note: z.string().optional(),
  reason: z.string().optional(),
  candidates: z.array(candidateSchema).optional(),
});

type Output = z.infer<typeof outputSchema>;

/** Cin7 comparison key: trimmed, case-insensitive. */
const key = (s: string | null | undefined) => (s ?? '').trim().toUpperCase();

const toCandidate = (row: SaleListRow) => ({
  orderNumber: row.OrderNumber ?? null,
  customer: row.Customer ?? null,
  status: row.Status ?? null,
});

function asResult(output: Output) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(output) }],
    structuredContent: output,
  };
}

export function registerOrderLookup(server: McpServer, cin7: Cin7Client): void {
  server.registerTool(
    'order_lookup',
    {
      title: 'Order lookup',
      description:
        'Look up one sale by exact order number in Cin7 Core. Returns the workflow stage ' +
        '(derived from sub-statuses, not the misleading master status), lines (capped), ' +
        'fulfilment, invoices and payments. Personal contact details are deliberately omitted. ' +
        'Matching is an exact, case-insensitive order-number match; if no sale or more than one ' +
        'sale matches, returns candidates instead of a sale.',
      inputSchema: z.object({
        orderNumber: z
          .string()
          .trim()
          .min(1)
          .max(64)
          .describe('Exact order number of the sale (for example SO-1234), 1-64 characters.'),
      }),
      outputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const orderNumber = args.orderNumber;
        // The API Search also matches customer names, invoice and credit note numbers and
        // references, so only exact order-number matches are kept below.
        const search = await cin7.get<{ SaleList?: SaleListRow[] }>('saleList', {
          Search: orderNumber,
          Page: 1,
          Limit: 50,
        });
        const rows = search.SaleList ?? [];
        const wanted = key(orderNumber);
        const exact = rows.filter((row) => key(row.OrderNumber) === wanted);

        if (exact.length === 0) {
          return asResult({
            found: false,
            reason: 'no exact match',
            candidates: rows.slice(0, CANDIDATE_LIMIT).map(toCandidate),
          });
        }
        if (exact.length > 1) {
          return asResult({
            found: false,
            reason: 'ambiguous: multiple sales share this order number',
            candidates: exact.slice(0, CANDIDATE_LIMIT).map(toCandidate),
          });
        }

        const row = exact[0] as SaleListRow;
        if (!row.SaleID) {
          throw new Error('Cin7 saleList row for this order has no SaleID');
        }
        const detail = await cin7.get<unknown>('sale', { ID: row.SaleID });
        return asResult({
          found: true,
          orderNumber: row.OrderNumber ?? orderNumber,
          stage: deriveSaleStage(row),
          sale: maskSale(detail),
          dataAsOf: dataAsOf(),
          note: NOTE,
        });
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
