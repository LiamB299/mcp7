import type { ServerContext } from '@modelcontextprotocol/server';
import type { SyncProgress } from './types.js';

/** Turn a tool-call context into a progress callback, or undefined when the client sent no progress token. */
export function progressReporter(
  ctx: ServerContext | undefined,
): ((p: SyncProgress) => void) | undefined {
  const token = ctx?.mcpReq._meta?.progressToken;
  if (ctx === undefined || token === undefined) return undefined;
  return (p) => {
    if (p.phase !== 'details') return;
    void ctx.mcpReq
      .notify({
        method: 'notifications/progress',
        params: {
          progressToken: token,
          progress: p.done,
          total: p.total,
          message: `loading sale details ${p.done} of ${p.total}`,
        },
      })
      .catch(() => undefined);
  };
}
