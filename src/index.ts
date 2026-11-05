#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createCin7Client } from './cin7/client.js';
import { loadConfig } from './config.js';
import { createServer } from './server.js';

// stdout is the protocol channel: log to stderr only.
try {
  const cin7 = createCin7Client(loadConfig());
  serveStdio(() => createServer({ cin7 }), {
    onerror: (e) => console.error('[cin7-core-mcp]', e.message),
  });
  console.error('[cin7-core-mcp] ready on stdio');
} catch (e) {
  console.error(`[cin7-core-mcp] ${(e as Error).message}`);
  process.exit(1);
}
