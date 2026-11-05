#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createCin7Client } from './cin7/client.js';
import { loadConfig } from './config.js';
import { createServer } from './server.js';

// stdout is the protocol channel: log to stderr only.
try {
  // Load the repo-root .env regardless of the working directory the client launches us from
  // (src/index.ts and dist/index.js both sit one level below the root). Already-set env wins.
  const envFile = fileURLToPath(new URL('../.env', import.meta.url));
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const cin7 = createCin7Client(loadConfig());
  serveStdio(() => createServer({ cin7 }), {
    onerror: (e) => console.error('[cin7-core-mcp]', e.message),
  });
  console.error('[cin7-core-mcp] ready on stdio');
} catch (e) {
  console.error(`[cin7-core-mcp] ${(e as Error).message}`);
  process.exit(1);
}
