import { McpServer } from '@modelcontextprotocol/server';
import type { SnapshotStore } from './cache/store.js';
import type { Cin7Client } from './cin7/client.js';
import { registerCacheRefresh } from './tools/cache-refresh.js';
import { registerCacheStatus } from './tools/cache-status.js';
import { registerConnectionCheck } from './tools/connection-check.js';
import { registerOpenOrdersPipeline } from './tools/open-orders-pipeline.js';
import { registerOrderLookup } from './tools/order-lookup.js';
import { registerReceivablesOverdue } from './tools/receivables-overdue.js';
import { registerSalesBySku } from './tools/sales-by-sku.js';
import { registerSalesSummary } from './tools/sales-summary.js';
import { registerStockHealth } from './tools/stock-health.js';
import { registerStockPosition } from './tools/stock-position.js';

export interface ServerDeps {
  cin7: Cin7Client;
  /** Line-level snapshot cache (ADR 0005). */
  store: SnapshotStore;
}

/** Build a server instance. No transport here, so tests can attach an in-memory one. */
export function createServer({ cin7, store }: ServerDeps): McpServer {
  const server = new McpServer(
    { name: 'cin7-core-mcp', version: '0.0.0' },
    { capabilities: { tools: {} } },
  );
  registerConnectionCheck(server, cin7);
  registerReceivablesOverdue(server, cin7, store);
  registerSalesSummary(server, cin7, store);
  registerStockPosition(server, cin7);
  registerOrderLookup(server, cin7);
  registerOpenOrdersPipeline(server, cin7);
  registerStockHealth(server, cin7);
  registerCacheStatus(server, store);
  registerCacheRefresh(server, cin7, store);
  registerSalesBySku(server, cin7, store);
  return server;
}
