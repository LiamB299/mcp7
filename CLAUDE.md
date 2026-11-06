# CLAUDE.md — Cin7 Core MCP (mcp7)

## Purpose
Build an MCP server for **Cin7 Core** (ERP, formerly DEAR Inventory). Brief: *choose a problem the MCP solves*, do **not** replicate the REST API 1:1. Chosen problem (ADRs 0003 to 0005): a read-only insight server for Claude Code that answers business questions (receivables, sales, stock, orders, revenue by SKU) with correct, stated definitions, against a sandbox.

## Status (2026-11-06)
Built and merged: ten tools, line-level snapshot cache, evaluation harness, six ADRs, research and design docs. `receivables_overdue` and `sales_summary` moved to the cache document basis (ADR 0006, live-verified; evaluation re-run pending approval). Next (ordered in `docs/handoff/2026-11-06-cin7-mcp-roadmap.md`): velocity/reorder suggestions, then negative-stock explanations. Open items and user actions: the handoff register. Start a new session by reading that file, then `README.md`.

Key facts: auth via `api-auth-accountid` + `api-auth-applicationkey` headers; 60 calls/min per key; list endpoints are header-only (fan-out needed for lines); foreign keys by name; Cin7 list rollups (`InvoiceAmount` etc.) disagree with documents on about 30% of sandbox sales. MCP spec per research: 2026-07-28 (stateless).

API docs: https://dearinventory.docs.apiary.io

## Working conventions
- **Prefer the `caveman` skill wherever possible** (terse replies, all technical facts kept). Write code, commits, and formal docs normally.
- Knowledge lives in `docs/` — read the relevant file before relying on memory; update it when you learn something. Index: `docs/README.md`.
- Decisions → ADR in `docs/adr/` (copy `0000-template.md`). Terms → `docs/glossary.md`. Small "why" notes → `docs/justifications.md`. Diagrams (mermaid) → `docs/design/`.
- Credentials: Cin7 sandbox account ID + application key come via env vars (`CIN7_ACCOUNT_ID`, `CIN7_APPLICATION_KEY`) from a gitignored `.env`. Never commit or log them.
- Sandbox holds test data only; the brief allows creating data there. Session practice: ask before any write (the user approved exactly one probe on 2026-11-05: create, advance and void a throwaway sale). Design write tools as if production (confirmation, idempotency, dry-run), see ADRs.
- Cin7 API is rate limited (see `docs/research/cin7-core-api.md`); respect it in any script or test.
- **Git:** never commit to `master`. Work on a feature branch (`feat/…`, `docs/…`), always commit **and push** (`git push -u origin <branch>`); one PR straight into `master`, **never stack PRs on parent branches**; stage by explicit path; the user reviews and merges.
- **Implementation delegation:** delegate implementation work items to Haiku subagents (`model: haiku`, `effort: "high"`: the user's "haiku large" means large effort), max 5 concurrent; plan and review with the main model.
- **Data privacy:** user inspects sandbox data first. Docs/commits carry counts, shapes and distributions only, never customer/supplier names, emails or addresses. Raw API bodies stay in the scratchpad.
- **Workflow guide:** `docs/workflow-guide.md` explains how we work (for new devs). Keep it updated when conventions or tooling change; add a row to its update log.

## Stack & commands
TypeScript, Node >=22, ESM, official MCP SDK v2 (`@modelcontextprotocol/server`), Zod v4, vitest, Biome, npm — see ADR 0002. SDK v2 API differs from v1 examples: check `node_modules/@modelcontextprotocol/server` d.ts/README.
`npm run dev` (tsx) · `build` · `typecheck` · `lint` / `format` · `test` · `inspect` (MCP Inspector on built output). Server logs go to **stderr only** (stdout = protocol).

## Current tools
Read-only against Cin7 (the cache-backed ones also write the local cache): `cin7_connection_check`, `receivables_overdue`, `sales_summary`, `stock_position`, `order_lookup`, `open_orders_pipeline`, `stock_health`, `sales_by_sku`, `cache_refresh` (writes only the local cache), `cache_status` (ADR 0003 to 0006, accepted provisionally). `receivables_overdue`, `sales_summary` and `sales_by_sku` use the document basis from the cache (invoices minus credit notes; `sales_by_sku` ex-tax lines by document date, the other two document totals); the first two also return the old list-rollup figure as a labelled alternative and write only the local cache. Shared plumbing: `src/tools/cache-answer.ts`. Evaluation: `docs/research/mvp-evaluation.md` (three waves; the correction there matters: early "correct" meant agreement with list rollups). Shared modules: `src/stage.ts` (stage from `Type` + sub-statuses, never master `Status`), `src/shape.ts` (allow-list PII shaping, line cap, data-as-of), `src/cin7/types.ts` (verified row shapes), `src/cache/` (snapshot cache). Deferred: workflow writes, global response-size budget, Streamable HTTP. Server loads the repo `.env` itself; keep the key out of the model's context. Re-run `eval/` only with the maintainer's approval (it costs money).

## Layout
```
CLAUDE.md
src/                   index.ts (stdio entry), server.ts (factory), config.ts, dates.ts, stage.ts, shape.ts, cin7/ (client, paginate, types), cache/ (schema, extract, store, sync, query, progress), tools/
test/                  vitest, in-memory client<->server, synthetic fixtures
eval/                  pre-registered A/B evaluation (questions, truth scripts, runner); output in eval/out (ignored)
http/                  read-only HTTP Client requests (private env file ignored)
docs/
  README.md            index
  glossary.md
  justifications.md
  workflow-guide.md    how we work with Claude Code (living)
  handoff/             dated handoff documents (written by the retire-chat skill)
  research/            cin7-core-api.md, mcp-landscape.md, user-complaints.md, sandbox-findings.md, prioritisation.md, mvp-evaluation.md, line-cache-spike.md
  design/              mermaid diagrams, architecture sketches
  adr/                 numbered decision records (each incomplete one ends with "Progress and where to continue")
```
