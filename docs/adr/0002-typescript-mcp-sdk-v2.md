# ADR 0002: TypeScript + official MCP SDK v2

- **Status:** accepted
- **Date:** 2026-11-05

## Context
Need a stack for the Cin7 Core MCP server before the problem is chosen. Research (`docs/research/mcp-landscape.md` §2) found two viable paths; npm checked 2026-11-05.

## Options considered
1. **TypeScript + `@modelcontextprotocol/server` v2 (2.4.0)** — stable line implementing spec 2026-07-28; Zod v4 schemas for tool I/O and validation of Cin7's inconsistent payloads; TS-native Inspector/conformance tooling; Node/Hono/Express adapters if we go remote.
2. **Python + FastMCP / `mcp` v2** — fastest to prototype, nice test client, but version-pairing churn (FastMCP vs `mcp` v2 rename) and user preference for TS.
3. TypeScript on v1 `@modelcontextprotocol/sdk` (1.32) — rejected: maintenance-only.

## Decision
Option 1. Node >=22, ESM, `tsc` build, `tsx` dev, vitest, Biome, npm. Native `fetch` for Cin7. **stdio transport first** via `serveStdio` (server factory); Streamable HTTP deferred to a later ADR once the problem and deployment model are known.

## Consequences
- v2 API differs from v1 examples online: use the installed package's d.ts/README (`McpServer.registerTool` with `z.object` schemas, `InMemoryTransport.createLinkedPair()` for tests, `inputRequired` for multi-round-trip elicitation).
- `@types/node` + `"types": ["node"]` required (SDK d.ts references `Buffer`).
- `src/cin7/client.ts` is the single upstream choke point where rate limiting (60/min/key), retry and caching will live.

<!-- retire-chat:progress:start -->
## Progress and where to continue (as of 2026-11-06)

Built and in daily use; 194 tests pass. Gap: Streamable HTTP (remote or multi-user use, authorization) is not implemented and no adapter is imported anywhere in `src/`. Next: only if remote use is wanted, write a new ADR for HTTP transport and auth (SDK adapters exist for Node, Hono and Express); otherwise nothing.

Full context, the ledger of what was asked and the open-work register: `docs/handoff/2026-11-06-cin7-mcp-roadmap.md`.
<!-- retire-chat:progress:end -->
