import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { type Cin7Client, Cin7Error } from '../cin7/client.js';
import { listAll } from '../cin7/paginate.js';
import type { PurchaseListRow, SaleListRow } from '../cin7/types.js';
import { dataAsOf } from '../shape.js';
import {
  derivePurchaseStage,
  deriveSaleStage,
  isAwaitingReceipt,
  isOpenSale,
  type PurchaseStage,
  type SaleStage,
} from '../stage.js';

/** Open sale stages in pipeline order. */
const SALE_PIPELINE = [
  'quote',
  'order_draft',
  'awaiting_pick',
  'picking',
  'awaiting_pack',
  'packing',
  'awaiting_ship',
  'shipping',
  'awaiting_invoice',
  'awaiting_payment',
  'paid_not_completed',
] as const satisfies readonly SaleStage[];

/** Open purchase stages in pipeline order. */
const PURCHASE_PIPELINE = [
  'order_draft',
  'awaiting_receipt',
  'receiving',
  'awaiting_invoice',
  'other',
] as const satisfies readonly PurchaseStage[];

const PURCHASE_CLOSED: ReadonlySet<PurchaseStage> = new Set(['voided', 'completed', 'credited']);

const DEFINITION = [
  'Stages are derived from Type and the Combined*Status sub-statuses, not the master Status',
  '(the master Status is a rollup that misleads: an Advanced sale can read ORDERED after it has shipped).',
  'Open sales are every stage except voided and completed.',
  'stuck: awaitingPick = stage awaiting_pick; awaitingShip = stage awaiting_ship;',
  'shippedNotInvoiced = stage awaiting_invoice with fulfilment shipped; unpaidInvoiced = stage awaiting_payment.',
  'backordered = open sales with master Status BACKORDERED.',
  'masterStatusMisleading = rows whose master Status is ORDERED but whose derived stage is not awaiting_pick.',
  'Purchases: open = every stage except voided, completed and credited.',
  'awaitingReceipt = master Status ORDERED, RECEIVING or INVOICED with receiving sub-status not FULLY RECEIVED;',
  'partially received orders count as awaiting.',
].join(' ');

const stageCount = z.object({ stage: z.string(), count: z.number().int() });

const outputSchema = z.object({
  sales: z.object({
    scanned: z.number().int(),
    open: z.number().int(),
    byStage: z.array(stageCount),
    backordered: z.number().int(),
    stuck: z.object({
      awaitingPick: z.number().int(),
      awaitingShip: z.number().int(),
      shippedNotInvoiced: z.number().int(),
      unpaidInvoiced: z.number().int(),
    }),
    masterStatusMisleading: z.number().int(),
  }),
  purchases: z
    .object({
      scanned: z.number().int(),
      open: z.number().int(),
      byStage: z.array(stageCount),
      awaitingReceipt: z.number().int(),
    })
    .nullable(),
  dataAsOf: z.string(),
  definition: z.string(),
});

/** Counts per key, keeping only keys with a non-zero count, in the given order. */
function orderedCounts<T extends string>(keys: T[], order: readonly T[]) {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return order
    .map((stage) => ({ stage, count: counts.get(stage) ?? 0 }))
    .filter((entry) => entry.count > 0);
}

export function registerOpenOrdersPipeline(server: McpServer, cin7: Cin7Client): void {
  server.registerTool(
    'open_orders_pipeline',
    {
      title: 'Open orders pipeline',
      description:
        'Summarise where open sales and purchase orders sit in the workflow: counts by stage ' +
        '(quote to paid, not completed), backordered sales, stuck-counters (awaiting pick or ship, ' +
        'shipped but not invoiced, invoiced but unpaid), and how often the master Status misleads. ' +
        'Purchases: counts by stage and orders awaiting receipt. Returns counts only, no per-order rows. ' +
        `Definitions: ${DEFINITION}`,
      inputSchema: z.object({
        includePurchases: z
          .boolean()
          .default(true)
          .describe('Also summarise purchase orders (one extra list request). Default true.'),
      }),
      outputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ includePurchases }) => {
      try {
        const { rows: saleRows } = await listAll<SaleListRow>(cin7, 'saleList', {}, 'SaleList');
        const infos = saleRows.map((row) => ({ row, info: deriveSaleStage(row) }));
        const openSales = infos.filter(({ info }) => isOpenSale(info.stage));

        const openStages = openSales.map(({ info }) => info.stage);
        const sales = {
          scanned: saleRows.length,
          open: openSales.length,
          byStage: orderedCounts(openStages, SALE_PIPELINE),
          backordered: openSales.filter(({ info }) => info.backordered).length,
          stuck: {
            awaitingPick: openStages.filter((s) => s === 'awaiting_pick').length,
            awaitingShip: openStages.filter((s) => s === 'awaiting_ship').length,
            shippedNotInvoiced: openSales.filter(
              ({ info }) => info.stage === 'awaiting_invoice' && info.fulfilment === 'shipped',
            ).length,
            unpaidInvoiced: openStages.filter((s) => s === 'awaiting_payment').length,
          },
          masterStatusMisleading: infos.filter(
            ({ row, info }) =>
              (row.Status ?? '').trim().toUpperCase() === 'ORDERED' &&
              info.stage !== 'awaiting_pick',
          ).length,
        };

        let purchases: {
          scanned: number;
          open: number;
          byStage: { stage: string; count: number }[];
          awaitingReceipt: number;
        } | null = null;
        if (includePurchases) {
          const { rows: purchaseRows } = await listAll<PurchaseListRow>(
            cin7,
            'purchaseList',
            {},
            'PurchaseList',
          );
          const openPurchases = purchaseRows
            .map((row) => ({ row, stage: derivePurchaseStage(row) }))
            .filter(({ stage }) => !PURCHASE_CLOSED.has(stage));
          purchases = {
            scanned: purchaseRows.length,
            open: openPurchases.length,
            byStage: orderedCounts(
              openPurchases.map(({ stage }) => stage),
              PURCHASE_PIPELINE,
            ),
            awaitingReceipt: purchaseRows.filter((row) => isAwaitingReceipt(row)).length,
          };
        }

        const output = { sales, purchases, dataAsOf: dataAsOf(), definition: DEFINITION };
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
