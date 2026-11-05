import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { type Cin7Client, Cin7Error } from '../cin7/client.js';

interface MeResponse {
  Company?: string;
  Currency?: string;
  TimeZone?: string;
}

const outputSchema = z.object({
  company: z.string().optional(),
  currency: z.string().optional(),
  timeZone: z.string().optional(),
});

export function registerConnectionCheck(server: McpServer, cin7: Cin7Client): void {
  server.registerTool(
    'cin7_connection_check',
    {
      title: 'Cin7 connection check',
      description:
        'Verify Cin7 Core credentials by calling GET /me. Returns company name, base currency and time zone.',
      inputSchema: z.object({}),
      outputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const me = await cin7.get<MeResponse>('me');
        const output = { company: me.Company, currency: me.Currency, timeZone: me.TimeZone };
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
