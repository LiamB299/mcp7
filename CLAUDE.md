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

## Layout
```
CLAUDE.md
docs/
  README.md            index
  glossary.md
  justifications.md
  research/            cin7-core-api.md, mcp-landscape.md
  design/              mermaid diagrams, architecture sketches
  adr/                 numbered decision records
```
