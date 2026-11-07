# Handoff: Cin7 Core MCP, MVP closed (2026-11-07)

> Written by the `retire-chat` skill so a fresh session or person can continue without the chat. Repo-derived sections come from `collect.mjs`; the ledger and register come from the conversation. Focus of the next session (as given): the MVP is closed for now; the deferred roadmap is negative-stock explanations (R1), writes (R3, only with new consent), production-scale checks (R4 to R7) and the follow-ups listed in section 7. This document supersedes `docs/handoff/2026-11-06-cin7-mcp-roadmap.md` for state and register; that earlier document stays as history (its register ids R1 to R24 are NOT the ids used here; the mapping is given in each row of section 7).

## 0. How to use this document
Read in this order: this section, section 7 (open-work register), section 2 (ADRs 0006 and 0007 first, then the others' progress), then `README.md` and `CLAUDE.md`. First commands: `git switch master && git pull`, `npm install && npm run build && npm test` (expect 308 tests in 22 files), `claude mcp list` (expect `cin7-core` connected; the project server is approved through the gitignored `.claude/settings.local.json`). The MVP is closed: eleven read-only tools, a line-level snapshot cache, an evaluation harness and seven ADRs are merged on master and there is no open PR apart from this handoff. Do not repeat: the cold sandbox load (use the cache; about 18 minutes per 1,000 invoiced sales, 163 s for the sandbox's 147), the four evaluation waves (rerun only after tool changes and only with the user's approval, they cost real money), or the research in `docs/research/`. Rules that bind every session are in section 5; the most important are: **no writes to Cin7 of any kind in this iteration** (no write tools, no write probes), feature branch per change and one PR into master, no stacked PRs, Haiku agents with high effort for implementation (maximum five), no customer data in the repo, paid evaluation runs need the user's approval.

## 1. Snapshot
- **Branch / HEAD / base:** this handoff is on `docs/handoff-2026-11-07`, cut from `origin/master` at 86617fd (merge of PR #23). Base is `origin/master`. No other PR is open.
- **Checks run now (2026-11-07, throwaway worktree off origin/master):** typecheck clean, lint clean (59 files), 308 tests pass (22 files), build clean, no conflict markers in tracked text.
- **Pull requests:** all merged except this handoff's own PR.

| PR | State | Branch | What it did |
|---|---|---|---|
| #1 | MERGED | docs/knowledge-base to master | Add CLAUDE.md and docs knowledge base |
| #2 | MERGED | feat/typescript-scaffold to docs/knowledge-base | Initialise TypeScript MCP server skeleton (ADR 0002) |
| #3 | MERGED | feat/http-requests to feat/typescript-scaffold | Add read-only HTTP requests for manual data inspection |
| #4 | MERGED | docs/user-complaints to docs/knowledge-base | Add ERP and Cin7 user complaints research |
| #5 | MERGED | docs/data-investigation to docs/user-complaints | Sandbox investigation: cross-reference five candidates, mermaid sketches, findings |
| #6 | MERGED | docs/prioritisation to docs/data-investigation | Prioritisation: value vs implementation effort |
| #7 | MERGED | feat/mvp-reports to feat/typescript-scaffold | MVP: read-only report tools, eval harness, ADR 0003 (proposed) |
| #8 | MERGED | docs/workflow-guide to feat/mvp-reports | Add living workflow guide for new developers |
| #9 | MERGED | feat/typescript-scaffold to master | Feat/typescript scaffold |
| #10 | MERGED | docs/knowledge-base to master | Docs/knowledge base |
| #11 | MERGED | release/mvp to master | Land MVP report tools, eval, ADR 0003, README and workflow guide on master |
| #12 | MERGED | release/research to master | Land research, sandbox findings, prioritisation and design sketches on master |
| #13 | MERGED | feat/wave2-lookup-pipeline-health to master | Wave 2: order lookup, open-orders pipeline, stock health, PII-safe shaping, stage derivation |
| #14 | MERGED | docs/line-cache-spike to master | Line-cache spike: measured cost, verdicts and ADR 0005 (proposed) |
| #15 | MERGED | fix/list-basis-wording to master | State the list-rollup basis in tools; correct the evaluation's correctness claims |
| #16 | MERGED | feat/line-cache to master | Line-level snapshot cache: sales_by_sku, cache_refresh, cache_status (ADR 0005) |
| #17 | MERGED | docs/handoff-2026-11-06 to master | Handoff document and ADR progress (retire-chat), README and CLAUDE.md fixes |
| #18 | MERGED | docs/todo-next-session to master | Checklist file for the next session; Haiku large = large effort |
| #19 | MERGED | feat/document-basis-reports to master | Move receivables_overdue and sales_summary onto the cache document basis (ADR 0006) |
| #20 | MERGED | docs/wave4-eval to master | Grade Q1 to Q3 on the document basis; record wave 4 results |
| #21 | MERGED | feat/reorder-suggestions to master | Add reorder_suggestions: sales velocity and reorder suggestions (ADR 0007) |
| #22 | MERGED | docs/tidy-eval-readme-todo to master | Tidy eval README order; update checklist after R3 |
| #23 | MERGED | fix/stock-health-service-products to master | stock_health: skip Service products; defer Q12 |
| #24 | OPEN | docs/handoff-2026-11-07 to master | Close off the MVP: verified handoff, ADR progress, README status (this handoff) |

(Titles are as opened. History is stacked for #2 to #8: they merged into parent branches, and #9 to #12 were consolidation PRs; read PR numbers as "introduced in" versus "landed on master in".)

- **Branches (remote):** none other than `master`. Every feature and docs branch was deleted after merge: sixteen on 2026-11-06 (R16 of the earlier register) and `feat/document-basis-reports`, `docs/wave4-eval`, `feat/reorder-suggestions`, `docs/tidy-eval-readme-todo` and `fix/stock-health-service-products` on 2026-11-07. Local branches mirror this: only `master` and this handoff branch exist.
- **Uncommitted or local-only on this machine:** `.env` (ignored, holds the sandbox credentials); `http/http-client.private.env.json` (ignored, credentials for the HTTP client); `.claude/settings.local.json` (ignored by the user's global git ignore, approves the `cin7-core` server); `eval/out/` (ignored, recreated by the wave 4 run: `runs/` transcripts, `truth.json` with an order number and customer names, `truth-docs.json` with customer names, `summary-docs.json`, and `cache/Q1`, `cache/Q2`, `cache/Q3`, the treatment arms' snapshot caches holding business names and invoice lines); `/private/tmp/evalcwd/` (recreated by `eval/run.mjs`: MCP config JSON files, paths only, no secrets; safe to delete); no baseline-arm scripts were left in `/tmp` this time; three untracked IDE files under `.idea/` (`mcp7.iml`, `modules.xml`, `vcs.xml`; they were swept into commit c17fb43 of PR #19 by accident and removed in a follow-up commit, so master's tree does not contain them but its history does, because PR #19 was merged with a merge commit; do not commit them without asking); the session scratchpad under `/private/tmp/claude-501/` (gate scripts and counts-only outputs; its scratch cache directories with customer business names were deleted), and the older session folder there whose `tasks/` directory holds this session's subagent transcripts and task outputs (safe to delete only after the chat is cleared; deleting it mid-session already broke one command). `.cache/` does not exist in the repo.
- **Background tasks still running:** none. All Haiku agents (ten: six for R1 and four for R3) finished and were reviewed.

## 2. Architecture decision records
Seven ADRs plus the template (`docs/adr/0000-template.md`). An ADR's "introduced" PR is the first PR that contained it; "landed" is the PR that put it on master.

### ADR 0001: Record architecture decisions
- **Status:** accepted (file: `docs/adr/0001-record-architecture-decisions.md`)
- **Decisions:** Keep numbered architecture decision records in `docs/adr/` using a Nygard-style template (context, options, decision, consequences); minor choices go to `docs/justifications.md`. Design decisions: ADRs are versioned with the code, superseded ones stay in place marked as such, and every decision of consequence gets one.
- **Commits:** 5d4df62 Add CLAUDE.md, docs knowledge base, Cin7 API and MCP landscape research
- **PRs:** introduced in #1, landed on master in #1
- **Code:** None (process decision). Template: `docs/adr/0000-template.md`; small-choices log: `docs/justifications.md`.
- **Progress and where to continue:** Complete and followed: ADRs 0002 to 0007 use the template. Nothing to continue.

### ADR 0002: TypeScript + official MCP SDK v2
- **Status:** accepted (file: `docs/adr/0002-typescript-mcp-sdk-v2.md`)
- **Decisions:** TypeScript on Node 22 or later with the official MCP SDK v2 (`@modelcontextprotocol/server`), Zod v4 schemas, vitest, Biome, npm, native fetch; stdio transport first via `serveStdio` with a server factory. Design decisions: Python/FastMCP and SDK v1 rejected; Streamable HTTP deferred to a later ADR; `src/cin7/client.ts` is the single upstream choke point (pacing, retry); logs go to stderr only because stdout is the protocol channel.
- **Commits:** 4272da0 Handoff document, ADR progress sections, README and CLAUDE.md fixes; 173ae7d Initialise TypeScript MCP server skeleton (ADR 0002)
- **PRs:** introduced in #2, landed on master in #9; later changes in #17
- **Code:** `src/index.ts` (stdio entry, loads the repo-root `.env`), `src/server.ts` (factory), `src/config.ts`, `src/cin7/client.ts`, `package.json`, `tsconfig.json`, `biome.json`.
- **Progress and where to continue:** Built and in daily use; 308 tests pass. Gap: Streamable HTTP (remote or multi-user use, authorization) is not implemented and no adapter is imported anywhere in `src/`. Next: only if remote use is wanted, write a new ADR for HTTP transport and auth; otherwise nothing.

### ADR 0003: Read-only reports MVP for Claude Code (sandbox)
- **Status:** accepted, provisional; the list-rollup basis of two of its tools is amended by ADR 0006 (file: `docs/adr/0003-read-only-reports-mvp.md`)
- **Decisions:** Build a read-only reports MVP for Claude Code against the sandbox: `receivables_overdue`, `sales_summary`, `stock_position` plus the connection check, each returning aggregates with their definitions stated; infrastructure limited to request pacing with 429/503 retry, a list helper that follows `Total`, and tenant-timezone dates. Design decisions: the value is judged by a pre-registered A/B evaluation against Claude Code plus Bash plus the key with a kill criterion; PII masking, size budgets, cache and writes deferred until the MVP was proven; accepted only provisionally.
- **Commits:** dbeeb3b Document ADR 0006 and the document-basis tools; 4272da0 Handoff document, ADR progress sections, README and CLAUDE.md fixes; 0531546 State the list-rollup basis in tools; correct the evaluation's correctness claims; 2de1e05 Record MVP evaluation results; ADR 0003 accepted provisionally; fed95c4 Add read-only report tools, eval harness and ADR 0003 (proposed)
- **PRs:** introduced in #7, landed on master in #11; later changes in #15, #17, #19
- **Code:** `src/tools/receivables-overdue.ts`, `src/tools/sales-summary.ts`, `src/tools/stock-position.ts`, `src/cin7/paginate.ts`, `src/dates.ts`, `eval/` (questions, truth, runner), `docs/research/mvp-evaluation.md`.
- **Progress and where to continue:** Built, evaluated in four waves and corrected twice. The original "correct" grade measured agreement with Cin7 list rollups, not with the invoice and credit-note documents (corrected in #15). Resolved by ADR 0006: both tools now read cache documents and carry the list-rollup figure as a labelled alternative; wave 4 re-graded Q1 to Q3 on a document-basis truth (treatment 3 of 3 correct, baseline 0 of 3, one run per arm). Next: only more repetitions (see register).

### ADR 0004: Allow-list PII shaping and sub-status stage derivation
- **Status:** accepted (file: `docs/adr/0004-pii-safe-shaping-and-stage-derivation.md`)
- **Decisions:** Allow-list shaping of sale data (`src/shape.ts`: named safe fields only, business name kept, lines capped at 20 with a truncation flag, data-as-of stamp) and workflow stage derived from `Type` plus the `Combined*Status` sub-statuses, never the misleading master status (`src/stage.ts`). Design decisions: fulfilment and billing are separate dimensions; service sales skip fulfilment; BACKORDERED is a flag; purchase awaiting-receipt means status ORDERED, RECEIVING or INVOICED with receiving not fully received; row types live in `src/cin7/types.ts` with verified field facts.
- **Commits:** 5ee5240 Skip Service products in stock_health; defer Q12; 4272da0 Handoff document, ADR progress sections, README and CLAUDE.md fixes; b13af8f Wave 2 docs: evaluation results, ADR 0004, README, glossary, API notes, workflow guide
- **PRs:** introduced in #13, landed on master in #13; later changes in #17, #23
- **Code:** `src/shape.ts`, `src/stage.ts`, `src/cin7/types.ts`, `src/tools/order-lookup.ts`, `src/tools/open-orders-pipeline.ts`, `src/tools/stock-health.ts`.
- **Progress and where to continue:** Built and live-verified (52 unpicked, 31 packed not shipped, 65 purchases awaiting receipt, 9 negative-stock products; the reorder-point check was later changed to skip Service and deprecated products, which gives 6 below threshold in the sandbox). Correction: the evaluation's Q9 truth (`eval/truth.mjs`) still counts every product with a threshold, including the Service products the fixed tool now skips (it gives 9, the tool 6), so the wave 2 Q9 "correct" shared that flaw and a rerun would grade the fixed tool wrong (register R22). Gaps verified in code: the evaluation did not measure personal-data protection; aggregate tools still return customer business names (`receivables_overdue`, `sales_summary` by customer, `order_lookup` candidates); there is no global response-size budget. Next: a PII-exposure measure, a decision on business names, per-tool output caps.

### ADR 0005: Line-level snapshot cache (persistent, windowed, incremental)
- **Status:** accepted, provisional (file: `docs/adr/0005-line-level-snapshot-cache.md`)
- **Decisions:** Persistent snapshot cache of sale headers plus allow-listed invoice and credit-note lines in one atomic JSON file (gitignored, `CIN7_CACHE_DIR` overrides), refreshed incrementally by per-sale `Updated`, windowed by default, warmed on demand with progress notifications. Design decisions: revenue is ex-tax invoice lines minus credit-note lines by document date (line `Total` includes tax on tax-inclusive sales, so ex-tax is Total minus Tax); margin uses line `AverageCost` times quantity, not `COGSAmount`; additional charges reported separately; non-base currencies counted; a lock file with a stale timeout guards concurrent sessions; partial data is labelled `complete: false`; the sync is resumable at a time budget (default 4.5 minutes).
- **Commits:** 4272da0 Handoff document, ADR progress sections, README and CLAUDE.md fixes; b8ae83a Cache docs: wave 3 evaluation, ADR 0005 accepted provisionally, README, glossary, guide; 69d8e43 ADR 0005: tax-inclusive line totals, document dates, currency, locking, partial-data rule; f4b1a25 Line-cache spike: measured cost, verdicts, ADR 0005 (proposed)
- **PRs:** introduced in #14, landed on master in #14; later changes in #16, #17
- **Code:** `src/cache/` (`types.ts`, `extract.ts`, `store.ts`, `sync.ts`, `query.ts`, `progress.ts`, and later `receivables.ts`, `sales-summary.ts`, `velocity.ts`), `src/tools/sales-by-sku.ts`, `src/tools/cache-refresh.ts`, `src/tools/cache-status.ts`.
- **Progress and where to continue:** Built and verified. Since the earlier handoff the sync also refetches a sale whose list paid amount, invoice amount or invoice status changed even when `Updated` did not move (visible only to a full header listing, which `receivables_overdue` always requests), and the list `InvoiceDueDate` is cached on headers as an optional field. Open gaps: no scheduled reconcile (only on demand with `full`), no cache-clear tool, `cache_refresh` defaults to a 90-day window but the answer tools load all history when `from` is omitted (a deliberate difference not yet amended in the ADR), whether a payment bumps `Updated` is untested, interactive Claude Code timeouts for a multi-minute first load are unverified, production scale is unknown. Next: see register R4, R5, R9, R12.

### ADR 0006: Document-basis receivables and sales summary
- **Status:** accepted, provisional (file: `docs/adr/0006-document-basis-reports.md`); amends ADR 0003
- **Decisions:** `receivables_overdue` and `sales_summary` read invoices and credit notes from the cache instead of Cin7's list rollups: outstanding is invoice totals minus invoice paid minus authorised credit notes (tax-inclusive), due date is the earliest due date among invoices with an open balance, and `sales_summary` takes `dateBasis` (`document`, default, or `order`) with ex-tax and tax-inclusive revenue; both return the un-netted or old list-rollup figure as a labelled alternative. Design decisions: shared plumbing in `src/tools/cache-answer.ts`; `receivables_overdue` always syncs all history with `full: true` so a changed paid amount is noticed; both tools write only the local cache (`readOnlyHint: false`).
- **Commits:** 1c398f2 Grade Q1 to Q3 on the document basis and record the wave 4 results; f6de0f2 Note that the eval grader does not read truth-docs.json yet; dbeeb3b Document ADR 0006 and the document-basis tools
- **PRs:** introduced in #19, landed on master in #19; later changes in #20
- **Code:** `src/cache/receivables.ts`, `src/cache/sales-summary.ts`, `src/tools/cache-answer.ts`, `src/cache/sync.ts`, `eval/truth-docs.mjs`, `eval/run.mjs`
- **Progress and where to continue:** Built, live-gated (43 overdue sales, 83,735.44 netted, 86,610.44 without credit netting; API-channel revenue for sales ordered July to September 14,195.12 ex-tax and 14,937.56 inc-tax; top customer 54,625 inc-tax; the embedded list rollup reproduced the old 29 sales and 26,447, 10,349 and about 24,756 exactly) and re-evaluated (wave 4: treatment 3 of 3, baseline 0 of 3, n = 1, treatment cold each run so not faster on Q2 and Q3; independent truth in `eval/truth-docs.mjs` matched the tools exactly). Open: more repetitions and a warm-cache timing, payment-bumps-Updated test, whether `paid` already reflects refunded credit notes (hence `withoutCreditNetting`).

### ADR 0007: Sales velocity and reorder suggestions
- **Status:** accepted, provisional (file: `docs/adr/0007-velocity-and-reorder-suggestions.md`); evaluation deferred as not evaluable on the sandbox
- **Decisions:** New read-only tool `reorder_suggestions` on pure modules `src/cache/velocity.ts` (net units per product over a window from the cache), `src/stock/availability.ts` (stock per product and the shared `isStockProduct` rule) and `src/reorder.ts` (join, reasons, ranking). Design decisions: velocity is invoiced units only (open orders are not cached), divided by the full window; the universe is the product list without Service and deprecated products; sale lines join to products by product ID then SKU with unmatched units reported; lead time (default 14 days) and target cover (default 30 days) are inputs stated as assumptions; stock is current and `asOf` moves only the sales window; `stock_health` was changed to skip Service products too.
- **Commits:** 5ee5240 Skip Service products in stock_health; defer Q12; 0e55a19 Record that Q12 cannot discriminate on the sandbox as written; 1bdde08 Document ADR 0007 and the reorder_suggestions tool
- **PRs:** introduced in #21, landed on master in #21; later changes in #23
- **Code:** `src/tools/reorder-suggestions.ts`, `src/cache/velocity.ts`, `src/stock/availability.ts`, `src/reorder.ts`, `eval/questions.json`, `eval/run.mjs`, `eval/truth-reorder.mjs`
- **Progress and where to continue:** Built and live-gated (product-ID join matched every product with sales: 3 of 3 over 90 days, 6 of 6 over 730; velocity totals equal `sales_by_sku` quantity exactly, 31 and 232 units; threshold parity 6 against `stock_health`'s earlier 9, the 3 difference being Service products, now fixed so both give 6). Q12 and `eval/truth-reorder.mjs` are written; Q12 is marked `deferred` because reorder quality is not evaluable on this sparse sandbox (3 products sold in 90 days, none would stock out). Open: open-order demand (R1), supplier lead times (R14), evaluation on production-like data (R2).

## 3. Codebase map
**Tools (eleven, all registered in `src/server.ts`; Cin7 access is GET only):**

| Tool | Source | What it answers |
|---|---|---|
| `cin7_connection_check` | `src/tools/connection-check.ts` | Credentials work; company, currency, time zone |
| `receivables_overdue` | `src/tools/receivables-overdue.ts` | Outstanding and overdue balances, age buckets, largest overdue; document basis from the cache, plus un-netted and list-rollup figures |
| `sales_summary` | `src/tools/sales-summary.ts` | Revenue (ex-tax and inc-tax) and sale counts by month, channel or customer; `dateBasis` document or order; list-rollup figure alongside |
| `sales_by_sku` | `src/tools/sales-by-sku.ts` | Revenue, quantity, cost and margin by SKU from the cache (ex-tax, by document date) |
| `reorder_suggestions` | `src/tools/reorder-suggestions.ts` | What to reorder, days of cover and a suggested quantity under stated lead-time and cover assumptions |
| `stock_position` | `src/tools/stock-position.ts` | Stock value and units by location, top products, negative-available count |
| `stock_health` | `src/tools/stock-health.ts` | Negative stock, on-order-with-nothing-on-hand, products at or below reorder point (stock products only), formula mismatches |
| `order_lookup` | `src/tools/order-lookup.ts` | One sale or purchase with derived stage, PII-shaped, lines capped |
| `open_orders_pipeline` | `src/tools/open-orders-pipeline.ts` | Counts of open sales and purchases by derived stage |
| `cache_refresh` | `src/tools/cache-refresh.ts` | Loads or refreshes the local snapshot (writes only the local cache) |
| `cache_status` | `src/tools/cache-status.ts` | Local cache size, last sync, window, pending details, rollup-drift summary (no Cin7 calls) |

**Modules by directory (every `src/` module):**

| Directory | Files |
|---|---|
| `src/` | `src/index.ts` (stdio entry), `src/server.ts`, `src/config.ts`, `src/dates.ts`, `src/stage.ts`, `src/shape.ts`, `src/reorder.ts` |
| `src/cin7/` | `src/cin7/client.ts`, `src/cin7/paginate.ts`, `src/cin7/types.ts` |
| `src/cache/` | `src/cache/types.ts`, `src/cache/extract.ts`, `src/cache/store.ts`, `src/cache/sync.ts`, `src/cache/query.ts`, `src/cache/progress.ts`, `src/cache/receivables.ts`, `src/cache/sales-summary.ts`, `src/cache/velocity.ts` |
| `src/stock/` | `src/stock/availability.ts` |
| `src/tools/` | the eleven tool files above plus `src/tools/cache-answer.ts` (shared refresh-or-load and coverage verdict) |

**Tests:** 22 files under `test/` (in-memory client and server, synthetic fixtures, stubbed Cin7 fetch), 308 tests. **Eval harness (`eval/`):** `questions.json` (Q1 overdue receivables, Q2 revenue by channel, Q3 top customers, Q4 stock value, Q5 negative-stock products, Q6 purchases awaiting receipt, Q7 sales awaiting pick, Q8 packed not shipped, Q9 products at or below reorder point, Q10 shipped despite master status ORDERED, Q11 revenue by SKU, Q12 reorder suggestions; Q12 deferred), `run.mjs` (headless A/B runner, grades Q1 to Q3 against `truth-docs.json` when present, skips deferred questions unless named in `--only`), `truth.mjs`, `truth-docs.mjs`, `truth-sku.mjs`, `truth-reorder.mjs`, `README.md`; output goes to the ignored `eval/out/`. **Other:** `http/` (read-only HTTP Client requests, private env file ignored), `docs/` (see `docs/README.md`; research files: `docs/research/cin7-core-api.md`, `docs/research/mcp-landscape.md`, `docs/research/user-complaints.md`, `docs/research/sandbox-findings.md`, `docs/research/prioritisation.md`, `docs/research/line-cache-spike.md`, `docs/research/mvp-evaluation.md`; design sketches in `docs/design/`), `.mcp.json` (project server entry `node dist/index.js`), `biome.json`, `tsconfig.json`, `vitest.config.ts`. No build scripts beyond `package.json` scripts: `dev`, `build`, `typecheck`, `lint`, `format`, `test`, `inspect`.

## 4. Conversation summary
1. **Orientation.** After `/clear` the user asked to review the docs folder and pick up where the previous session ended. The handoff and the root checklist file (deleted in this PR) were read; the next step (R1) and the user actions R14 to R18 were summarised.
2. **R15 to R17 housekeeping.** Done on request after a short plan: the project MCP server approved (`.claude/settings.local.json`), sixteen stale branches deleted (a first attempt failed on zsh not splitting a variable; nothing was deleted until it was retried with an array), and local customer data purged (`eval/out/`, the old scratchpad, `/tmp/s`, `/tmp/run.py`, `/private/tmp/evalcwd`).
3. **R1 document-basis reports.** The user confirmed R1. After reading the code and asking three definition questions (date basis, tax basis, credit-note netting), a plan was written, reviewed by the advisor (two blocking points: the paid-amount change detection only works on a full header listing; the list-rollup alternatives must reproduce the old numbers) and approved. Shared helpers were extracted by the main model, six Haiku agents built the query modules, the sync fix, both tool rewrites and a truth script, and a live gate matched expectations (PR #19, ADR 0006). PR #19 merged before the last commit was pushed, so that commit became PR #20.
4. **Wave 4 evaluation.** On request ("run truth-docs.mjs and the grader, keep token usage down") the independent truth was pulled (165 read-only calls) and Q1 to Q3 were run once per arm with a 0.6 US dollar cap per run (about 0.28 US dollars in total): treatment 3 of 3 correct, baseline 0 of 3 (PR #20).
5. **Outstanding review.** The user skipped R14 and asked what else was outstanding; a prioritised list was given.
6. **R3 reorder suggestions under a read-only rule.** The user said no writes this iteration and asked for R3. Two design questions (lead time as an input with default 14 days; a new tool rather than extending `stock_health`) were answered, a plan was written and reviewed by the advisor (two blocking gaps: the sale-line product ID to product ID join was unverified, and the product universe had to come from the product list excluding Service), and four Haiku agents built it (PR #21, ADR 0007). The live gate verified the join and quantity parity and explained a 9 versus 6 threshold difference exactly (3 Service products). The advisor also flagged that Q12 cannot discriminate on this sandbox.
7. **Cleanup after merges.** The user merged #20 and asked to rebase; #21 had already been merged, so there was nothing to rebase. A leftover ordering problem in `eval/README.md` and a stale the root checklist file (deleted in this PR) were fixed in PR #22.
8. **"Do the rest, then close off the MVP".** Scope questions were answered (skip R4; mark Q12 not evaluable, no run). `stock_health` now skips Service products, Q12 is deferred and skipped by default by the runner, and stale branches were deleted (PR #23). This handoff is the close-out.

## 4b. User-request ledger
| ID | Request (user's words, shortened) | Outcome | Pointer |
|---|---|---|---|
| U1 | `/clear` (session start) | Context reset; the previous session's state came from the repo | `docs/handoff/2026-11-06-cin7-mcp-roadmap.md` |
| U2 | "Start by reviewing the docs folder ... a document of where to pick up where I left off" | Handoff and checklist read; next steps and user actions summarised | section 7 |
| U3 | "Do R15 - R17" | Plan approved; server approved, 16 branches deleted, local data purged | the root checklist file (deleted in this PR), section 1 |
| U4 | Approved the R15 to R17 plan | Executed as planned | this section |
| U5 | "Yes, do R1" | Document-basis rebuild of `receivables_overdue` and `sales_summary` | PR #19, ADR 0006 |
| U6 | Answers to three design questions: date basis as a parameter defaulting to document; ex-tax headline with both shown; net credit notes and show the alternative | Implemented as agreed | `src/cache/receivables.ts`, `src/cache/sales-summary.ts` |
| U7 | Approved the R1 plan | Executed in three waves | PR #19 |
| U8 | "run truth-docs.mjs and the grader. Ensure to keep token usage down" | Truth pulled, Q1 to Q3 run once per arm under a cost cap; grader repointed to document truth | PR #20, `docs/research/mvp-evaluation.md` wave 4 |
| U9 | "Skip r14, is there anything outstanding?" | R14 skipped by choice; outstanding list given | the root checklist file (deleted in this PR) |
| U10 | "No writes for this project iteration. Only read only options. Do R3" | Rule saved to memory; R3 planned and built | memory `feedback-read-only-iteration`, PR #21, ADR 0007 |
| U11 | Answers: lead time as an input defaulting to 14 days; new tool `reorder_suggestions` | Implemented as agreed | `src/tools/reorder-suggestions.ts` |
| U12 | Approved the R3 plan | Executed in three waves | PR #21 |
| U13 | "Merged #20, rebase this branch" | #21 was already merged so no rebase was needed; tidy of eval README and checklist opened | PR #22 |
| U14 | "I merged the pr, do the rest and then lets close off the mvp after that for now" | Scope questions asked; fixes and cleanup done | PR #23 |
| U15 | Answers: cleanup and fix, skip R4; mark Q12 not evaluable, no run | `stock_health` fix, Q12 deferred, stale branches deleted | PR #23, ADR 0007 progress |
| U16 | Approved the close-out plan | Executed | this handoff |
| U17 | "Merged #23, go ahead and close off the MVP" | This handoff, ADR progress, README status | this PR |

## 5. Agreements, rules and preferences
- **Cin7 access:** **no writes of any kind this iteration** (stated 2026-11-06; memory `feedback-read-only-iteration`): no write tools, no POST/PUT/DELETE, no write probes (so the stage-bump probe stays undone). Local writes (the snapshot cache, repo files, git) are fine. The original brief allowed sandbox writes and the user once approved a single throwaway-sale probe (2026-11-05); a new write needs a fresh explicit go-ahead.
- **Git:** never commit to master; one feature branch per change; always commit and push; one PR straight into master; never stack PRs; stage by explicit path (a plain `git commit` also commits whatever is staged, which swept three `.idea/` files into a commit once: check `git status` first); the user reviews and merges; the user deletes or approves deletion of stale branches (done on request). zsh does not split an unquoted variable into words: use arrays for multi-argument git commands.
- **Delegation:** implementation work items go to Haiku subagents with `effort: high` ("Haiku large" means large effort), at most five at once; the main model writes shared and privacy-critical pieces, reviews every diff and runs the checks. Memory file: feedback-haiku-implementation.
- **Process:** plan mode for non-trivial work with the plan approved first; the advisor tool before committing to an approach and before declaring done; pre-register evaluation questions and readings before running; update docs when facts change, including corrections; add a row to the workflow guide's update log when tooling or conventions change.
- **Consent and cost:** paid evaluation runs need the user's approval each time (state the estimate first; cumulative spend is about 2.0 US dollars notional: about 1.7 before this session plus about 0.28 for wave 4); read-only sandbox pulls are fine inside an approved plan; keep token usage down when asked.
- **Privacy:** docs and commits carry counts, shapes and distributions only, no customer or supplier names, emails, addresses, order numbers, SKU codes or GUIDs; raw API bodies and transcripts stay in the scratchpad or `eval/out/`; never print or record credential values.
- **Style:** terse caveman replies in chat; code, commits and formal docs are written normally.

## 6. Findings and corrections to remember
- **Document basis versus list rollups (standing correction):** Cin7's list rollups disagree with the invoice and credit-note documents on 49 of 164 sandbox sales (18 credit notes not netted, 10 zero despite an invoice, 21 other). Early evaluation "correct" meant agreement with the list rollup (corrected in #15). On documents: 43 overdue sales (83,735.44 netted, 86,610.44 without credit notes), API-channel revenue for July to September 14,195.12 ex-tax and 14,937.56 inc-tax, top customer 54,625 inc-tax (47,500 ex-tax); the old list figures were 29 sales and 26,447, 10,349 and about 24,756.
- **Wave 4 (one run per arm):** treatment 3 of 3 correct, baseline 0 of 3 (two wrong, one on the list-rollup reading); treatment cheaper in total (about 0.10 against 0.18 US dollars) but not faster on Q2 and Q3 because each treatment run paid a cold cache load of 100 to 170 s. Treat as a sanity check, not a measurement.
- **Correction (Q9 truth):** `eval/truth.mjs` computes Q9 (products at or below their reorder point) from every product with `MinimumBeforeReorder > 0`, with no filter on `Type`. It still gives 9 while the fixed `stock_health` gives 6 (3 Service products with a threshold and no stock rows). The wave 2 "Q9 correct" therefore matched a truth with the same mistake and is not independent evidence; update and pre-register the Q9 definition before any rerun.
- **Tax:** line `Total` is ex-tax on tax-exclusive sales but includes tax on tax-inclusive ones; document totals include additional charges, SKU rows do not.
- **Reorder:** sale-line `productId` equals the product `ID` (verified); only 3 products sold in the last 90 days and 6 in two years, so no stock-out appears; the product list has 17 Service products and 1 gift card of 1,627, and 3 Service products carry a threshold and no stock rows, which the old `stock_health` counted as below threshold (9 reported, 6 real).
- **Sale invoice statuses seen:** INVOICED, INVOICED / CREDITED, NOT INVOICED, NOT AVAILABLE, so `wantsDetail` (status starts with INVOICED) needs no change.
- **Cost shape (unchanged):** list endpoints are header only; each sale detail costs one call; 60 calls per minute per key gives about 1.1 s per detail; first cache load about 18 minutes per 1,000 invoiced sales (163 s for the sandbox's 147; 35 s for a 90-day window, 138 s for 730 days of reorder data); `/product` with `Limit=1000` returns the 1,627 products in 2 pages.
- **Process lessons:** an open PR can merge before a last push (the commit then needs its own PR); verify the interpretation of a parity difference instead of tolerating it; the advisor caught two blocking definition gaps before code on both R1 and R3.
- **Merge hygiene fixed in this PR:** none found beyond the ones fixed in PR #22; docs scanned for conflict markers, duplicated rows and stale tool and test counts.

## 7. Open-work register
Ids are new in this document; "old Rn" refers to the 2026-11-06 handoff. Ordered for the stated focus (the MVP is closed; the deferred roadmap first).

| ID | Item | Type | Next step | Pointer | Blocked by |
|---|---|---|---|---|---|
| R1 | Negative-stock explanations (old R4) | continue | Extend the cache with open-order lines for open sales (schema version bump, about 114 more sale details), add a read-only tool that traces allocations, write ADR 0008, live gate; only 2 of 9 negative products were explained by backorders in the sandbox research | docs/research/sandbox-findings.md, src/cache/types.ts, ADR 0007 progress | user go-ahead |
| R2 | Reorder evaluation on production-like data (Q12 deferred) | todo | When data exists with real sales, un-defer Q12, add grading to `eval/run.mjs`, run `eval/truth-reorder.mjs` and one rep per arm with approval | eval/README.md, ADR 0007 progress | production-like data, user approval for paid runs |
| R3 | Workflow assistant with writes (old R5) | todo | Design confirmation, idempotency and dry-run first; no writes until the user lifts the read-only rule and gives a fresh go-ahead | docs/research/prioritisation.md | user consent |
| R4 | Does a payment bump `Updated`; other stage bumps (old R9) | unverified | A write probe on a throwaway sale advancing pick, pack, ship, invoice and payment; until then rely on the full header listing that `receivables_overdue` uses | docs/research/line-cache-spike.md, ADR 0006 progress | fresh write consent |
| R5 | Interactive Claude Code timeout for the multi-minute first load (old R10) | unverified | Run a cold `receivables_overdue` in an interactive session and record whether it survives | ADR 0005 progress | none |
| R6 | Production scale and appetite (old R11) | unverified | Ask the user about production volume, the Automation add-on (webhooks), write appetite and which pains the team feels | docs/research/sandbox-findings.md | user answers |
| R7 | Behaviour above 60 calls per minute and `Limit` above 1000 (old R12) | unverified | Test carefully or leave documented as unverified | docs/research/cin7-core-api.md | none |
| R8 | HTTP transport (old R8) | todo | Write an ADR only if remote or multi-user use is wanted | ADR 0002 progress | user need |
| R9 | ADR 0005 gaps (old R6) | follow-up | Add a reconcile cadence or document the manual one, add a cache-clear tool, amend the ADR on the `from` default | ADR 0005 progress | none |
| R10 | ADR 0004 gaps (old R7) | follow-up | Measure PII exposure in the evaluation, decide on business names in outputs, add per-tool output caps | ADR 0004 progress | none |
| R11 | Response-size and token budget for tools (old R23) | todo | Add per-tool caps and a global guard | ADR 0004 progress | none |
| R12 | Cache hygiene (old R22) | risk | Add schema-version migration (the optional `listInvoiceDueDate` was added without a bump), size and age limits and a deletion tool before wider use | src/cache/types.ts | R9 |
| R13 | Whether `paid` already reflects refunded credit notes | unverified | Compare invoice paid amounts on a sale with credit notes against its payments; until then `withoutCreditNetting` is shown beside the netted figure | ADR 0006 progress, src/cache/receivables.ts | none |
| R14 | Supplier lead times and reorder demand gaps | follow-up | Read-only spike on product `IncludeSuppliers` for a lead-time field; open-order demand arrives with R1 | ADR 0007 progress | none |
| R15 | Evaluation follow-ups (old R13) | follow-up | Margin question not evaluated; more repetitions and a warm-cache timing for Q1 to Q3; PII not measured | docs/research/mvp-evaluation.md | user approval for paid runs |
| R16 | Rotate the sandbox application key (old R14) | user-action | The key appeared once in a diff in an earlier session (never pushed); the user chose to skip for now; rotate in Cin7 API settings, then update `.env` and `http/http-client.private.env.json` | .env (ignored) | user |
| R17 | Purge local customer data again | user-action | Delete `eval/out/` (wave 4 transcripts, `truth.json` with an order number and customer names, `truth-docs.json`, and the treatment caches under `eval/out/cache/Q1` to `Q3`) and `/private/tmp/evalcwd/` when no longer needed | section 8 | user |
| R18 | Three untracked `.idea/` files | user-action | Decide to ignore them (add to `.gitignore` in a PR) or leave untracked; they must not be committed by accident | git status | user |
| R19 | Biome post-edit hook and a `/preflight` skill (old R20) | todo | Add them when the user says go | docs/workflow-guide.md | user go-ahead |
| R20 | The retire-chat skill is unversioned (old R24) | follow-up | Skill lives at `~/.claude/skills/retire-chat`; run its tests with `node --test`; consider versioning it | docs/handoff/README.md | none |
| R21 | Sandbox side effect (old R21) | risk | One voided throwaway sale remains (reference starts with SPIKE-THROWAWAY); the sale list has 174 rows; non-voided counts are unchanged | docs/research/line-cache-spike.md | none |
| R22 | Q9 truth counts Service products | risk | Change the Q9 definition in `eval/truth.mjs` to use stock products only (not Service, not deprecated) and pre-register it before any rerun; until then Q9 would grade the fixed `stock_health` wrong | eval/truth.mjs, docs/research/mvp-evaluation.md wave 2 | none |

Types: `continue`, `follow-up`, `todo`, `unverified`, `risk`, `user-action`. Done since the earlier handoff: old R1 to R3 (ADR 0006 and 0007), R15 to R19 (server approved, branches deleted, data purged, next step chosen, Haiku meaning).

## 8. Environment and resuming
- **Commands:** `npm install`, `npm run build`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run inspect`; evaluation: `node eval/truth.mjs`, `node eval/truth-docs.mjs`, `node eval/truth-sku.mjs` (needs `truth.json` from `truth.mjs` first), `node eval/run.mjs --only Q1,Q2,Q3 --reps 1` (spends money; ask first); headless runs use an empty directory outside the repo.
- **Secrets:** names only: `CIN7_ACCOUNT_ID`, `CIN7_APPLICATION_KEY`, `CIN7_BASE_URL` in the ignored `.env`; `http/http-client.private.env.json` for the HTTP client. The server loads `.env` itself so the key never enters the model's context; the evaluation baseline arm gets the key in its environment by design.
- **Caches and local-only state:** the snapshot cache defaults to `.cache/cin7` (ignored; business names and invoice lines), `CIN7_CACHE_DIR` overrides; `eval/out/` holds evaluation output with customer data; the session scratchpad is ephemeral.
- **Memory files** (outside the repo, in the Claude project memory folder): the index plus feedback-git-workflow, feedback-haiku-implementation and feedback-read-only-iteration.
- **Sandbox:** ZAR, Africa/Johannesburg; read-only this iteration; one voided throwaway sale (R21); the user's `.http` runs share the key, so keep to about 54 calls per minute.
- **Not recoverable after clearing the chat:** the scratchpad gate scripts (`gate.mjs`, `gate2.mjs`, `gen_handoff.py`) and their outputs; their conclusions are in `docs/adr/0006-*`, `docs/adr/0007-*` and `docs/research/mvp-evaluation.md`.

## 9. Suggested skills and tools for the next session
`superpowers:brainstorming` or plan mode before building; `low-effort-plan` or `adversarial-plan-implement` for Haiku-delegated implementation (maximum five agents, effort high); `superpowers:verification-before-completion` before claiming done; the `advisor` tool at the gates; `caveman` for replies; `retire-chat` again at the end of that session. MCP Inspector (`npm run inspect`) for tool debugging.

## 10. Completeness check
- **verify.mjs:** `node ~/.claude/skills/retire-chat/scripts/verify.mjs docs/handoff/2026-11-07-mvp-closed.md --repo . --readme README.md --secrets .env,eval/out/truth.json,eval/out/truth-docs.json,http/http-client.private.env.json --ledger-min 17 --register-min 22` exited 0 with 385 checks passed (ADRs and their commits and PRs, every PR, tool, module, evaluation question, research file and remote branch, ledger and register structure, placeholders, GUID/email/token scan, literal values from the four secrets files, README tool and ADR coverage). It does not check conversation-only state.
- **Reviewer outcome:** the advisor reviewed the transcript against this document and listed these fixes, all applied: the evaluation's Q9 truth still counts Service products (recorded as a correction and register row R22); a stale "evaluation re-run pending approval" phrase in `CLAUDE.md` and a missing wave 4 row in the README evaluation table; missing local-only state (`/private/tmp/evalcwd/`, the treatment caches under `eval/out/cache/`, the older session folder holding subagent transcripts); the agent count (ten, not nine); the `.idea` wording (absent from master's tree, present in its history); and `eval/out/truth-docs.json` added to the secrets check. It confirmed the 17-row ledger, the old-to-new register mapping and the ADR claims re-checked against code.
- **Known gaps:** scratchpad scripts are not preserved (conclusions are in ADRs 0006 and 0007 and `docs/research/mvp-evaluation.md`); the retire-chat skill is unversioned (R20); the verifier cannot detect conversation-only facts nobody wrote down; items needing the user are R16 to R18.
