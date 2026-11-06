import { McpServer } from '@modelcontextprotocol/server';
import type { Cin7Client } from './cin7/client.js';
import { registerConnectionCheck } from './tools/connection-check.js';
import { registerOpenOrdersPipeline } from './tools/open-orders-pipeline.js';
import { registerOrderLookup } from './tools/order-lookup.js';
import { registerReceivablesOverdue } from './tools/receivables-overdue.js';
import { registerSalesSummary } from './tools/sales-summary.js';
import { registerStockHealth } from './tools/stock-health.js';
import { registerStockPosition } from './tools/stock-position.js';

export interface ServerDeps {
  cin7: Cin7Client;
}

/** Build a server instance. No transport here, so tests can attach an in-memory one. */
export function createServer({ cin7 }: ServerDeps): McpServer {
  const server = new McpServer(
    { name: 'cin7-core-mcp', version: '0.0.0' },
    { capabilities: { tools: {} } },
  );
  registerConnectionCheck(server, cin7);
  registerReceivablesOverdue(server, cin7);
  registerSalesSummary(server, cin7);
  registerStockPosition(server, cin7);
  registerOrderLookup(server, cin7);
  registerOpenOrdersPipeline(server, cin7);
  registerStockHealth(server, cin7);
  return server;
}
