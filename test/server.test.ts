import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { createCin7Client } from '../src/cin7/client.js';
import { createServer } from '../src/server.js';

const config = { accountId: 'acc', applicationKey: 'key', baseUrl: 'https://example.test/v2/' };

async function connect(fetchImpl: typeof fetch) {
  const server = createServer({ cin7: createCin7Client(config, fetchImpl, { minIntervalMs: 0 }) });
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

describe('cin7_connection_check', () => {
  it('is listed as read-only', async () => {
    const client = await connect(async () => new Response('{}'));
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'cin7_connection_check');
    expect(tool?.annotations?.readOnlyHint).toBe(true);
  });

  it('returns company info and sends auth headers', async () => {
    let seen: Headers | undefined;
    const client = await connect(async (url, init) => {
      seen = new Headers(init?.headers);
      expect(String(url)).toBe('https://example.test/v2/me');
      return new Response(JSON.stringify({ Company: 'Acme', Currency: 'USD', TimeZone: 'UTC' }));
    });
    const res = await client.callTool({ name: 'cin7_connection_check', arguments: {} });
    expect(res.structuredContent).toEqual({ company: 'Acme', currency: 'USD', timeZone: 'UTC' });
    expect(seen?.get('api-auth-accountid')).toBe('acc');
    expect(seen?.get('api-auth-applicationkey')).toBe('key');
  });

  it('surfaces Cin7 errors as tool errors', async () => {
    const client = await connect(
      async () =>
        new Response(JSON.stringify({ ErrorCode: 403, Exception: 'Auth failed' }), { status: 403 }),
    );
    const res = await client.callTool({ name: 'cin7_connection_check', arguments: {} });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain('Auth failed');
  });
});
