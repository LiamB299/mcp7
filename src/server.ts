import { McpServer } from '@modelcontextprotocol/server';
import type { Cin7Client } from './cin7/client.js';
import { registerConnectionCheck } from './tools/connection-check.js';

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
  return server;
}
