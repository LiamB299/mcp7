# CLAUDE.md — Cin7 Core MCP (mcp7)

## Purpose
Build an MCP server for **Cin7 Core** (ERP, formerly DEAR Inventory). Brief: *choose a problem the MCP solves* — do **not** replicate the REST API 1:1. Problem not chosen yet.

## Current phase
Discovery. Order of work:
1. ✅ Scaffold CLAUDE.md + `docs/` knowledge base
2. ✅ Cin7 API reference → `docs/research/cin7-core-api.md`
3. ✅ MCP landscape reference → `docs/research/mcp-landscape.md`
4. ⏭ NEXT: brainstorm/choose problem (→ ADR), then stack, design, build

Key facts: auth via `api-auth-accountid` + `api-auth-applicationkey` headers; 60 calls/min per key; list endpoints are header-only (fan-out needed for lines); foreign keys by name. Current MCP spec per research: 2026-07-28 (stateless).

API docs: https://dearinventory.docs.apiary.io

## Working conventions
- **Prefer the `caveman` skill wherever possible** (terse replies, all technical facts kept). Write code, commits, and formal docs normally.
- Knowledge lives in `docs/` — read the relevant file before relying on memory; update it when you learn something. Index: `docs/README.md`.
- Decisions → ADR in `docs/adr/` (copy `0000-template.md`). Terms → `docs/glossary.md`. Small "why" notes → `docs/justifications.md`. Diagrams (mermaid) → `docs/design/`.
- Credentials: Cin7 sandbox account ID + application key come via env vars (`CIN7_ACCOUNT_ID`, `CIN7_APPLICATION_KEY`) from a gitignored `.env`. Never commit or log them.
- Sandbox holds test data only; creating/modifying data there is allowed. Still design write tools as if production (confirmation, idempotency, dry-run) — see ADRs.
- Cin7 API is rate limited (see `docs/research/cin7-core-api.md`); respect it in any script or test.
- **Git:** never commit to `master`. Work on a feature branch (`feat/…`, `docs/…`), always commit **and push** (`git push -u origin <branch>`); the user reviews and merges.
- **Implementation delegation:** delegate implementation work items to Haiku subagents (`model: haiku`), max 5 concurrent; plan and review with the main model.
- **Data privacy:** user inspects sandbox data first. Docs/commits carry counts, shapes and distributions only, never customer/supplier names, emails or addresses. Raw API bodies stay in the scratchpad.
- **Workflow guide:** `docs/workflow-guide.md` explains how we work (for new devs). Keep it updated when conventions or tooling change; add a row to its update log.

## Stack & commands
TypeScript, Node >=22, ESM, official MCP SDK v2 (`@modelcontextprotocol/server`), Zod v4, vitest, Biome, npm — see ADR 0002. SDK v2 API differs from v1 examples: check `node_modules/@modelcontextprotocol/server` d.ts/README.
`npm run dev` (tsx) · `build` · `typecheck` · `lint` / `format` · `test` · `inspect` (MCP Inspector on built output). Server logs go to **stderr only** (stdout = protocol).

## Current MVP
Read-only tools: `cin7_connection_check`, `receivables_overdue`, `sales_summary`, `stock_position`, `order_lookup`, `open_orders_pipeline`, `stock_health` (ADR 0003 + ADR 0004, accepted provisionally: eval result in `docs/research/mvp-evaluation.md` — MCP 10/10 vs baseline 8/10 in scope against list-rollup definitions (not document-level truth: see the correction in that file), 2.5x faster, ~1.8x cheaper; re-run with `eval/` after tool changes). Shared modules: `src/stage.ts` (workflow stage from `Type` + sub-statuses, never master `Status`), `src/shape.ts` (allow-list PII shaping, line cap, data-as-of), `src/cin7/types.ts` (verified row shapes). Deferred: line-level cache, writes, global response-size budget. Server loads repo `.env` itself; keep the key out of the model's context.

## Layout
```
CLAUDE.md
src/                   index.ts (stdio entry), server.ts (factory), config.ts, cin7/client.ts, tools/
test/                  vitest, in-memory client<->server
docs/
  README.md            index
  glossary.md
  justifications.md
  research/            cin7-core-api.md, mcp-landscape.md, user-complaints.md, sandbox-findings.md, prioritisation.md, mvp-evaluation.md
  workflow-guide.md    how we work with Claude Code (living)
  eval/ (repo root)    A/B evaluation harness
  design/              mermaid diagrams, architecture sketches
  adr/                 numbered decision records
```
