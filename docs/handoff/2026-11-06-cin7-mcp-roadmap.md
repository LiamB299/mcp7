# Handoff: Cin7 Core MCP, state after the line-level cache (2026-11-06)

> Written by the `retire-chat` skill so a fresh session or person can continue without the chat. Repo-derived sections come from `collect.mjs`; the ledger and register come from the conversation. Next session focus (as given): migrate the two list-rollup tools to the cache's document basis, then velocity and reorder suggestions and negative-stock explanations.

## 0. How to use this document
Read in this order: this section, section 7 (open-work register, ordered for the stated focus), section 2 (ADR progress), then `README.md` and `CLAUDE.md`. First commands: `git switch master && git pull`, `npm install && npm run build && npm test` (expect 194 tests), `claude mcp list` (the project server needs a one-time approval inside `claude`). Do not repeat: the cold sandbox load (use the cache), the three evaluation waves (rerun only after tool changes and only with the user's approval, they cost real money), or the research in `docs/research/`. Rules that bind every session are in section 5; the most important are: feature branch per change and one PR into master, no stacked PRs, Haiku agents for implementation (maximum five), no customer data in the repo, writes to the sandbox need a fresh go-ahead.

## 1. Snapshot
- **Branch / HEAD / base:** this handoff is on `docs/handoff-2026-11-06` cut from `origin/master` at 7be8204 (Merge of #15). Base is `origin/master`. No PR is open apart from the handoff PR itself.
- **Checks run now (2026-11-06, throwaway worktree off origin/master):** typecheck clean, lint clean (47 files), 194 tests pass (17 files), build clean, no conflict markers in tracked text. Skill tests: 12 pass.
- **Pull requests:** all merged. History is stacked: #2 to #8 merged into parent branches, #9 to #12 were consolidation PRs, so read PR numbers as "introduced in" versus "landed on master in" (see section 2).

| PR | State | Branch | What it did |
|---|---|---|---|
| #1 | MERGED | docs/knowledge-base to master | CLAUDE.md, docs knowledge base, Cin7 API reference, MCP landscape research (ADR 0001). |
| #2 | MERGED | feat/typescript-scaffold to docs/knowledge-base | TypeScript MCP server skeleton on SDK v2 (ADR 0002); later carried the base-URL fix. |
| #3 | MERGED | feat/http-requests to feat/typescript-scaffold | Read-only `.http` request files for manual data inspection (credentials in a gitignored private env file). |
| #4 | MERGED | docs/user-complaints to docs/knowledge-base | ERP and Cin7 user-complaints research. |
| #5 | MERGED | docs/data-investigation to docs/user-complaints | Sandbox investigation: five candidates cross-referenced, mermaid sketches, findings. |
| #6 | MERGED | docs/prioritisation to docs/data-investigation | Value-versus-effort prioritisation. |
| #7 | MERGED | feat/mvp-reports to feat/typescript-scaffold | MVP report tools, eval harness, ADR 0003. |
| #8 | MERGED | docs/workflow-guide to feat/mvp-reports | Living workflow guide for new developers. |
| #9 | MERGED | feat/typescript-scaffold to master | Scaffold branch landed on master (stacked history: #2 and #3 had merged into parents). |
| #10 | MERGED | docs/knowledge-base to master | Docs/knowledge-base branch landed on master (same stacking issue). |
| #11 | MERGED | release/mvp to master | Consolidation: MVP tools, eval, ADR 0003, README, guide onto master (conflicts resolved). |
| #12 | MERGED | release/research to master | Consolidation: research, findings, prioritisation, design sketches onto master. |
| #13 | MERGED | feat/wave2-lookup-pipeline-health to master | Wave 2: order lookup, open-orders pipeline, stock health, stage normaliser, PII shaper (ADR 0004). |
| #14 | MERGED | docs/line-cache-spike to master | Line-cache spike: measured cost and verdicts, ADR 0005 proposed. |
| #15 | MERGED | fix/list-basis-wording to master | States the list-rollup basis in tools and corrects the evaluation claims (merged last, after #16). |
| #16 | MERGED | feat/line-cache to master | Line-level snapshot cache and tools `sales_by_sku`, `cache_refresh`, `cache_status`; ADR 0005 accepted provisionally. |
| #17 | OPEN | docs/handoff-2026-11-06 to master | This handoff: verified handoff document, ADR progress sections, README and CLAUDE.md fixes, docs index, workflow-guide rows. |

- **Branches (remote):** 13 of 14 are merged into master and none is needed; the exception is described below. Local branches mirror them.

- docs/data-investigation: merged into master, delete
- docs/knowledge-base: merged into master, delete
- docs/line-cache-spike: merged into master, delete
- docs/prioritisation: merged into master, delete
- docs/user-complaints: unmerged by ancestry (it holds only a merge commit; every file reached master through other PRs), safe to delete
- docs/workflow-guide: merged into master, delete
- feat/http-requests: merged into master, delete
- feat/line-cache: merged into master, delete
- feat/mvp-reports: merged into master, delete
- feat/typescript-scaffold: merged into master, delete
- feat/wave2-lookup-pipeline-health: merged into master, delete
- fix/list-basis-wording: merged into master, delete
- release/mvp: merged into master, delete
- release/research: merged into master, delete

- **Uncommitted or local-only on this machine:** staged and never-committed IDE files under `.idea/` (tracked status: they show as added in the index of the main checkout; do not commit them without asking); `.env` (ignored, holds the sandbox credentials); `http/http-client.private.env.json` (ignored, credentials for the HTTP client); `eval/out/` (ignored: run transcripts with customer data, `truth.json` including one real order number and customer names, caches for the evaluation runs). `.cache/` does not currently exist in the repo.
- **Background tasks still running:** none. All agents (research, tool implementers, cold-start test of this skill) have finished.

## 2. Architecture decision records
Five ADRs plus the template (`docs/adr/0000-template.md`). Stacking note: an ADR's "introduced" PR is the first PR that contained it; "landed" is the PR that put it on master.

### ADR 0001: Record architecture decisions
- **Status:** accepted (file: `docs/adr/0001-record-architecture-decisions.md`)
- **Decisions:** Keep numbered architecture decision records in docs/adr/ using a Nygard-style template (context, options, decision, consequences); minor choices go to docs/justifications.md. Design decisions: ADRs are versioned with the code, superseded ones stay in place marked as such, and every decision of consequence gets one.
- **Commits:** 5d4df62 Add CLAUDE.md, docs knowledge base, Cin7 API and MCP landscape research
- **PRs:** introduced and landed on master in #1
- **Code:** None (process decision). Template: `docs/adr/0000-template.md`; small-choices log: `docs/justifications.md`.
- **Progress and where to continue:** Complete and followed: ADRs 0002 to 0005 use the template. Nothing to continue. Candidate future ADRs are listed in the register (HTTP transport, document-basis migration).

### ADR 0002: TypeScript + official MCP SDK v2
- **Status:** accepted (file: `docs/adr/0002-typescript-mcp-sdk-v2.md`)
- **Decisions:** TypeScript on Node 22 or later with the official MCP SDK v2 (`@modelcontextprotocol/server` 2.4.0), Zod v4 schemas, vitest, Biome, npm, native fetch; stdio transport first via `serveStdio` with a server factory. Design decisions: Python/FastMCP and SDK v1 rejected; Streamable HTTP deferred to a later ADR; `src/cin7/client.ts` is the single upstream choke point (pacing, retry); logs go to stderr only because stdout is the protocol channel.
- **Commits:** 173ae7d Initialise TypeScript MCP server skeleton (ADR 0002)
- **PRs:** introduced in #2, landed on master in #9
- **Code:** `src/index.ts` (stdio entry, loads the repo-root `.env`), `src/server.ts` (factory), `src/config.ts`, `src/cin7/client.ts`, `package.json`, `tsconfig.json`, `biome.json`.
- **Progress and where to continue:** Built and in daily use; 194 tests pass. Gap: Streamable HTTP (remote or multi-user use, authorization) is not implemented and no adapter is imported anywhere in `src/`. Next: only if remote use is wanted, write a new ADR for HTTP transport and auth (SDK adapters exist for Node, Hono and Express); otherwise nothing.

### ADR 0003: Read-only reports MVP for Claude Code (sandbox)
- **Status:** accepted, provisional (file: `docs/adr/0003-read-only-reports-mvp.md`)
- **Decisions:** Build a read-only reports MVP for Claude Code against the sandbox: `receivables_overdue`, `sales_summary`, `stock_position` plus the connection check, each returning aggregates with their definitions stated; infrastructure limited to request pacing with 429/503 retry, a list helper that follows `Total`, and tenant-timezone dates. Design decisions: the value is judged by a pre-registered A/B evaluation against Claude Code plus Bash plus the key with a kill criterion; PII masking, size budgets, cache and writes deferred until the MVP was proven; accepted only provisionally.
- **Commits:** 0531546 State the list-rollup basis in tools; correct the evaluation's correctness claims; 2de1e05 Record MVP evaluation results; ADR 0003 accepted provisionally; fed95c4 Add read-only report tools, eval harness and ADR 0003 (proposed)
- **PRs:** introduced in #7, landed on master in #11; later changes in #15
- **Code:** `src/tools/receivables-overdue.ts`, `src/tools/sales-summary.ts`, `src/tools/stock-position.ts`, `src/cin7/paginate.ts`, `src/dates.ts`, `eval/` (questions, truth, runner), `docs/research/mvp-evaluation.md`.
- **Progress and where to continue:** Built, evaluated in three waves, and corrected in #15: the original "correct" grade meant agreement with Cin7 list rollups, not with the invoice and credit-note documents (Q1: 43 overdue sales on documents versus 29 from the rollup; Q2 API channel 14,938 versus 10,349 or 16,088; Q3 top customer 54,625 versus 24,756). Gap verified in code: `receivables_overdue` and `sales_summary` still read the list rollups `InvoiceAmount` and `PaidAmount`; their descriptions now say so. Next: rebuild both on the cache document basis (`src/cache/query.ts` plus sync), rewrite the Q1 to Q3 truth from documents, re-run the evaluation (paid runs: ask first), then finalise acceptance or amend the ADR.

### ADR 0004: Allow-list PII shaping and sub-status stage derivation
- **Status:** accepted (file: `docs/adr/0004-pii-safe-shaping-and-stage-derivation.md`)
- **Decisions:** Allow-list shaping of sale data (`src/shape.ts`: named safe fields only, business name kept, lines capped at 20 with truncation flag, data-as-of stamp) and workflow stage derived from `Type` plus the `Combined*Status` sub-statuses, never the misleading master status (`src/stage.ts`). Design decisions: fulfilment and billing are separate dimensions; service sales skip fulfilment; BACKORDERED is a flag; purchase awaiting-receipt means status ORDERED, RECEIVING or INVOICED with receiving not fully received; row types live in `src/cin7/types.ts` with verified field facts.
- **Commits:** b13af8f Wave 2 docs: evaluation results, ADR 0004, README, glossary, API notes, workflow guide
- **PRs:** introduced and landed on master in #13
- **Code:** `src/shape.ts`, `src/stage.ts`, `src/cin7/types.ts`, `src/tools/order-lookup.ts`, `src/tools/open-orders-pipeline.ts`, `src/tools/stock-health.ts`.
- **Progress and where to continue:** Built and live-verified against independent truth (52 unpicked, 31 packed not shipped, 65 purchases awaiting receipt, 9 negative-stock products, 9 at or below reorder point). Gaps verified in code and evaluation: the evaluation did not measure personal-data protection (only unit tests and the live gate do); aggregate tools still return customer business names (`receivables_overdue`, `sales_summary` by customer, `order_lookup` candidates); there is no global response-size budget; the master-status trap did not separate the arms, so the normaliser value is verified but not demonstrated by the evaluation. Next: add a reliable PII-exposure measure to the evaluation, decide whether business names may leave the service layer, add per-tool output caps, and revisit stage names if Cin7 adds sub-statuses.

### ADR 0005: Line-level snapshot cache (persistent, windowed, incremental)
- **Status:** accepted, provisional (file: `docs/adr/0005-line-level-snapshot-cache.md`)
- **Decisions:** Persistent snapshot cache of sale headers plus allow-listed invoice and credit-note lines in one atomic JSON file (gitignored, `CIN7_CACHE_DIR` overrides), refreshed incrementally by per-sale `Updated`, windowed by default, warmed on demand with progress notifications. Design decisions: revenue is ex-tax invoice lines minus credit-note lines by document date (line `Total` includes tax on tax-inclusive sales, so ex-tax is Total minus Tax); margin uses line `AverageCost` times quantity, not `COGSAmount`; additional charges reported separately; non-base currencies counted; lock file with stale timeout guards concurrent sessions; partial data is labelled `complete: false`; the sync is resumable at a time budget (default 4.5 minutes).
- **Commits:** b8ae83a Cache docs: wave 3 evaluation, ADR 0005 accepted provisionally, README, glossary, guide; 69d8e43 ADR 0005: tax-inclusive line totals, document dates, currency, locking, partial-data rule; f4b1a25 Line-cache spike: measured cost, verdicts, ADR 0005 (proposed)
- **PRs:** introduced and landed on master in #14; later changes in #16
- **Code:** `src/cache/types.ts`, `src/cache/extract.ts`, `src/cache/store.ts`, `src/cache/sync.ts`, `src/cache/query.ts`, `src/cache/progress.ts`, `src/tools/sales-by-sku.ts`, `src/tools/cache-refresh.ts`, `src/tools/cache-status.ts`, `docs/research/line-cache-spike.md`.
- **Progress and where to continue:** Built and verified (live gate: cold load 162.7 s for 147 invoiced sales, lock refusal in 3 ms, warm status 6 ms, no-change refresh 1 Cin7 call, exact SKU top 3 against independent document-basis truth; evaluation Q11 correct cold and warm, baseline wrong twice). Gaps versus the ADR, verified in code: (1) the "about daily" full reconcile is not scheduled, only on demand via `cache_refresh` with `full`, and `src` contains no timer or scheduler; (2) the ADR says the cache should be deletable by a tool, but there is no cache-clear tool or function; (3) `cache_refresh` defaults to a 90-day window but `sales_by_sku` with no `from` loads all history (windowDays null), a deliberate choice for all-time questions that differs from the ADR default; (4) only create, order draft, order authorised and void were shown to bump `Updated`, pick, pack, ship, invoice and payment are untested; (5) interactive Claude Code timeouts are unverified (headless survived 90, 240 and 700 s); (6) production scale is unknown (first load is about 18 minutes per 1,000 sales); (7) velocity, reorder and negative-stock explanations are not built on the cache. Next: add a reconcile cadence or document the manual one, add a cache-clear tool, amend the ADR on the `from` default, probe the untested stage bumps (needs fresh write consent), test interactive timeouts, then build velocity and explanations.

## 3. Codebase map
**Tools** (ten, all read-only against Cin7; `cache_refresh` writes only the local cache file):

| Tool | File | Answers |
|---|---|---|
| `cache_refresh` | `src/tools/cache-refresh.ts` | load or refresh the local snapshot, resumable, progress notifications |
| `cache_status` | `src/tools/cache-status.ts` | local-only status: size, last sync, window, pending details, rollup-drift summary |
| `cin7_connection_check` | `src/tools/connection-check.ts` | GET /me: credentials, company, currency, time zone |
| `open_orders_pipeline` | `src/tools/open-orders-pipeline.ts` | open sales by derived stage, stuck counts, purchases awaiting receipt, master-status mismatch count |
| `order_lookup` | `src/tools/order-lookup.ts` | one sale by exact order number, stage, capped lines, no contact data |
| `receivables_overdue` | `src/tools/receivables-overdue.ts` | overdue and outstanding balances from the list rollup (basis stated), age buckets |
| `sales_by_sku` | `src/tools/sales-by-sku.ts` | ex-tax revenue, quantity, cost, margin by SKU from the cache; may warm the cache; partial results labelled |
| `sales_summary` | `src/tools/sales-summary.ts` | invoiced revenue by month, channel or customer from the list rollup; dates optional |
| `stock_health` | `src/tools/stock-health.ts` | negative availability, on-order with nothing on hand, at or below reorder point, formula mismatches |
| `stock_position` | `src/tools/stock-position.ts` | stock value (StockOnHand is a value) and units by location, top products |

**Source modules by directory:**

| Directory | Files | Role |
|---|---|---|
| `src/cache/` | `src/cache/extract.ts`, `src/cache/progress.ts`, `src/cache/query.ts`, `src/cache/store.ts`, `src/cache/sync.ts`, `src/cache/types.ts` | snapshot cache: schema, allow-list extractor, atomic locked store, resumable sync, pure queries, progress |
| `src/cin7/` | `src/cin7/client.ts`, `src/cin7/paginate.ts`, `src/cin7/types.ts` | HTTP client with pacing and retry, list pagination helper, verified row types |
| `src/` | `src/config.ts`, `src/dates.ts`, `src/index.ts`, `src/server.ts`, `src/shape.ts`, `src/stage.ts` | entry, server factory, config, dates, stage normaliser, shaper |
| `src/tools/` | `src/tools/cache-refresh.ts`, `src/tools/cache-status.ts`, `src/tools/connection-check.ts`, `src/tools/open-orders-pipeline.ts`, `src/tools/order-lookup.ts`, `src/tools/receivables-overdue.ts`, `src/tools/sales-by-sku.ts`, `src/tools/sales-summary.ts`, `src/tools/stock-health.ts`, `src/tools/stock-position.ts` | one file per MCP tool |

- **Tests:** `test/cache-query.test.ts`, `test/cache-refresh.test.ts`, `test/cache-status.test.ts`, `test/cache-store.test.ts`, `test/cache-sync.test.ts`, `test/client.test.ts`, `test/config.test.ts`, `test/open-orders-pipeline.test.ts`, `test/order-lookup.test.ts`, `test/receivables-overdue.test.ts`, `test/sales-by-sku.test.ts`, `test/sales-summary.test.ts`, `test/server.test.ts`, `test/shape.test.ts`, `test/stage.test.ts`, `test/stock-health.test.ts`, `test/stock-position.test.ts` (194 tests; synthetic fixtures only; in-memory client and server pattern in `test/server.test.ts`).
- **Evaluation harness (`eval/`):** `questions.json` (11 pre-registered questions: Q1, Q2, Q3, Q4, Q5, Q6, Q7, Q8, Q9, Q10, Q11), `truth.mjs` (independent list-based truth for Q1 to Q10), `truth-sku.mjs` (document-basis truth for Q11, about 165 paced calls), `run.mjs` (headless A/B runner: baseline Bash plus key versus the MCP, cold and warm cache handling, grader), `README.md` (protocol and kill criterion). Output lives in `eval/out/` (ignored).
- **HTTP request files (`http/`):** JetBrains HTTP Client GET-only files grouped by domain, using `{{CIN7_BASE_URL}}`, `{{CIN7_ACCOUNT_ID}}`, `{{CIN7_APPLICATION_KEY}}` from the ignored private env file; committed env file has no secrets.
- **Docs:** research files `docs/research/cin7-core-api.md`, `docs/research/line-cache-spike.md`, `docs/research/mcp-landscape.md`, `docs/research/mvp-evaluation.md`, `docs/research/prioritisation.md`, `docs/research/sandbox-findings.md`, `docs/research/user-complaints.md`; design sketches in `docs/design/` (candidate map, fan-out sequence, observed entities, tool architecture); `docs/glossary.md`, `docs/justifications.md`, `docs/workflow-guide.md`, `docs/README.md` (index).
- **Config and env:** `.env` keys `CIN7_ACCOUNT_ID`, `CIN7_APPLICATION_KEY`, `CIN7_BASE_URL` (API root without /v2; the code appends /v2), optional `CIN7_CACHE_DIR`. `.mcp.json` registers the server (node dist/index.js). Stack: Node 22 or later (local 26.10), TypeScript, MCP SDK v2, Zod v4, vitest, Biome, npm.
- **Sandbox facts:** base currency ZAR, time zone Africa/Johannesburg; 174 sale rows (173 seeded plus one voided throwaway), 112 purchases, 1,559 active products, 483 availability rows over 141 products and 7 locations, 10 production orders; 67 of 173 sales priced tax-inclusive; 39 sales with a non-base customer currency at rate 1.0.

## 4. Conversation summary
**Phase 1, setup and research (U1 to U5).** Set effort medium and model opusplan; the brief was to build an MCP server for Cin7 Core that solves a chosen problem rather than mirror the API. Created `CLAUDE.md` (with the instruction to prefer the caveman skill) and a `docs/` knowledge base (ADR template, glossary, justifications, design folder); two research agents wrote the Cin7 API reference (from the raw API Blueprint) and the MCP landscape reference (#1). Chose TypeScript with MCP SDK v2 (ADR 0002) and scaffolded a stdio server with a connection-check tool, tests, lint and build (#2). The user's rule: never commit to master, feature branches, always commit and push, they review and merge; stored as a memory file.

**Phase 2, manual data access and complaints (U6 to U10).** GitHub CLI login by the user. Created read-only `.http` files for the user to inspect data before showing any (#3), later rewritten to use the `CIN7_*` env keys; real credentials had been placed in a tracked file, so they were moved to an ignored private file and never reached GitHub. Fixed the server's base-URL handling (root without /v2). Researched ERP and Cin7 complaints (thin evidence: review sites blocked, competitor-biased sources) (#4).

**Phase 3, sandbox investigation and prioritisation (U11 to U13).** With the user's consent to view sandbox data, tested five candidate problems with about 23 small read-only calls justified by advisor gates, wrote findings, four mermaid sketches and corrected the API reference (#5). Ranked buildable items by value and effort (#6). The user chose: shortest viable, reports as the value to evaluate, Claude Code only, efficiency and PII later.

**Phase 4, MVP and evaluation (U14 to U15).** Three Haiku agents built `receivables_overdue`, `sales_summary`, `stock_position`; an A/B evaluation against Claude Code plus Bash plus the key was pre-registered (ADR 0003) and run after the user's approval: 10/10 versus 8/10, baseline 1.8 times the cost and 2.5 times the time (#7, #11). README rewritten with problem, tools, tech and solution. A workflow guide was written from the user's `/insights` report (#8).

**Phase 5, merging and wave 2 (U16 to U19).** Merge order was explained; stacked PRs had merged into parents so master lacked the work; two consolidation PRs resolved conflicts (#11, #12). Wave 2 built `order_lookup`, `open_orders_pipeline`, `stock_health`, the stage normaliser and the allow-list shaper with four Haiku agents (ADR 0004); live gate exact; evaluation 15/15 versus 12/15 (#13).

**Phase 6, spike and cache (U20 to U24).** The line-cache spike measured 190.6 s for 173 details at 1.1 s per call, verified incremental refresh with an approved write probe (one throwaway sale, voided), and showed Claude Code survives 90, 240 and 700 s blocking tool calls (#14, ADR 0005 proposed). Recomputing the revenue questions on a document basis showed the earlier "correct" grades measured agreement with list rollups, not documents; this was published as a correction (#15). The cache was built (core by the main model, query and tools by three Haiku agents), verified live, and evaluated on revenue by SKU: correct cold and warm, baseline wrong twice (#16). The user merged #13 and #14, then #16 and #15.

**Phase 7, retiring this chat (U25 to U28).** Designed and built the `retire-chat` skill at `~/.claude/skills/retire-chat/` (user-level: collector, verifier, idempotent ADR progress writer, template, 12 tests), after a plan review. It was tested in four ways: its unit tests (one mutation per verifier check, plus a deliberate sabotage showing the tests catch a disabled check); the collector run on this repo (5 ADRs, 16 PRs, 10 tools, correct introduced-versus-landed PR mapping after one fix); a cold-start agent given only SKILL.md, which passed on its second run (221 checks) and exposed defects that were then fixed (a bogus `origin` branch entry that made the branch check pass trivially, filler rows passing, empty ADR decisions passing, the module rule and `--prs-file` format undocumented, branch status unchecked); and this real run, which found one more (the lowercase register type `todo` flagged as a placeholder) and used the new checks. Preflight on master found real merge damage in CLAUDE.md, the README and the docs index, fixed in this PR; the advisor review then caught a memory file still teaching stacked PRs, consent and attribution wording errors, and local-only temp files, all fixed.

## 4b. User-request ledger
| ID | Request | Outcome | Pointer |
|---|---|---|---|
| U1 | /effort med | effort set to medium, saved as default | session setting |
| U2 | /model opusplan | Opus in plan mode, else Sonnet; set again later (U25) | session setting |
| U3 | Pasted brief: build an MCP for Cin7 Core solving a chosen problem; sandbox credentials later; API docs link; tasks: CLAUDE.md plus docs dir (prefer caveman), read the docs into a reference file, research MCP implementations | done: CLAUDE.md, docs/, API reference, MCP landscape | PR #1, ADR 0001 |
| U4 | Commit everything so far; choose the technology and initialise the repo (seeming TypeScript) | TypeScript with SDK v2 chosen; skeleton built; plan approved after a revision | PR #2, ADR 0002 |
| U5 | Commit via feature branches, I review and merge, always commit and push | rule adopted, saved to memory and CLAUDE.md | CLAUDE.md, memory file feedback-git-workflow |
| U6 | User ran gh auth login | gh authenticated as the account owner; PRs opened from then on | README git rules |
| U7 | Add http calls in /http so I can peruse the data before you see any | read-only .http files by domain, private env for credentials | PR #3, http/README.md |
| U8 | Update the .http files from the keys in the env file | switched to CIN7_* keys; secrets moved from a tracked file to an ignored one | PR #3 |
| U9 | Yes, fix the config base URL | CIN7_BASE_URL is the root without /v2; code appends it | PR #2 branch, src/config.ts |
| U10 | Search ERP complaints, then Cin7 complaints, into a document | researched with stated source limits | PR #4, docs/research/user-complaints.md |
| U11 | Consent to use the key and view sandbox data; plan to cross-reference the five pain points; small advisor-justified calls; mermaid sketches and a writeup; Haiku agents max five | investigation done, 4 sketches, findings, verdicts | PR #5, docs/research/sandbox-findings.md |
| U12 | Investigate ranking by value and time to implement | items ranked with cut lines and sensitivity | PR #6, docs/research/prioritisation.md |
| U13 | Shortest to implement and viable; reports interesting, justify the value; Claude Code only; efficiency and PII later | MVP scope and A/B evaluation designed | ADR 0003 |
| U14 | Go ahead and run the full eval | run; later corrected | docs/research/mvp-evaluation.md, PR #7 |
| U15 | Update the README with problem, tools, tech and solution | README rewritten | README.md, PR #7 |
| U16 | /insights output, then generate a usage guide for new devs, kept updated | docs/workflow-guide.md written | PR #8 |
| U17 | Is there a specific order for merging? | explained; stacked-merge problem found | PRs #9 to #12 |
| U18 | All MRs should be merged now | verified: only #9 and #10 reached master; two consolidation PRs proposed | PRs #11, #12 |
| U19 | Yes, open both PRs with conflicts resolved | opened with conflicts resolved | PRs #11, #12 |
| U20 | Continue with the roadmap | wave 2 built and evaluated | PR #13, ADR 0004 |
| U21 | Yes, spike the line cache first | spike done with pre-registered rules | PR #14, docs/research/line-cache-spike.md |
| U22 | Answer to the write-probe question: yes, run it | one throwaway sale created, advanced, voided | docs/research/line-cache-spike.md |
| U23 | Yes to both (build the cache; fix the list-basis wording) | built (#16) and wording plus evaluation correction (#15) | PRs #15, #16, ADR 0005 |
| U24 | I have merged the two MRs (interrupt during planning) | #13 and #14 confirmed on master; build proceeded from master | PRs #13, #14 |
| U25 | /model opusplan again | model set again | session setting |
| U26 | Retire-chat request, first wordings (clear the chat; summarise ADRs, conversation, update README; make it a skill; interrupted twice) | folded into U28 | this document |
| U27 | Answers to my questions: skill user-level; I closed all open PRs (they were merged); dated files in docs/handoff | applied | docs/handoff/README.md |
| U28 | Final retire-chat request: skill named retire-chat, inspired by claude-handoff, ADRs with progress and where to continue, conversation summary, nothing missed, store in the repo, update README, test then run on this chat | skill built, tested, run; this PR | PR for branch docs/handoff-2026-11-06 |

## 5. Agreements, rules and preferences
- **Git:** never commit to master; one feature branch per change; always commit and push; one PR straight into master; never stack PRs (stacked merges cost two consolidation rounds); stage by explicit path; the user reviews and merges; merge commits rather than squash is the practice used (not a stated user rule). gh is authenticated; the remote uses an SSH host alias.
- **Delegation:** implementation work items go to Haiku subagents, at most five at once; the main model writes shared and privacy-critical pieces and reviews every diff. "Haiku large" was never confirmed; the Agent tool only offers haiku, which was used. Memory file: feedback-haiku-implementation.
- **Advisor gates:** call the advisor before committing to an approach, before declaring done, and as the reviewer; pre-register evaluation questions, alternatives and kill criteria before running anything.
- **Consent:** the user gave explicit consent to view sandbox data after inspecting it themselves first. The original brief said creating data in the sandbox is welcome (CLAUDE.md records this); as session practice the main model asks before any write, and the user approved exactly one probe (create, advance and void a throwaway sale). Evaluation runs cost real API spend: state the estimate and ask before running, and run no further evaluations without approval.
- **Privacy:** docs and commits carry counts, shapes and distributions only; no customer or supplier names, emails, addresses, order numbers, SKU codes, GUIDs; raw API bodies and transcripts stay out of the repo; never print or record credential values.
- **Style:** terse caveman replies to the user (code, commits and docs are written normally); the replies drifted from this during the session; keep it.
- **Process:** plan mode for non-trivial work with the plan approved first; update docs when facts change, including corrections; add a row to the workflow guide's update log when tooling or conventions change.

## 6. Findings and corrections to remember
- **Correction (merged in #15):** earlier claims that the tool was more correct on revenue questions were wrong; the ground truth shared the tool's list-rollup basis. On documents: Q1 43 overdue sales (tool and baseline 29), Q2 API channel 14,938 (tool 10,349, baseline 16,088), Q3 top customer 54,625 (tool 24,756, baseline 57,500 in one run). The "gross-versus-net trap" label was retracted.
- **List rollups drift from documents** on 49 of 164 sandbox sales: 18 credit notes not netted, 10 zero despite an authorised invoice, 21 other (13 equal the paid amount, 8 unexplained). `COGSAmount` is non-zero on only 35 of 162 invoiced sales; line cost is present on 215 of 218 lines.
- **Tax:** line `Total` is ex-tax on tax-exclusive sales but includes tax on tax-inclusive ones (ex-tax is Total minus Tax; verified on all 58 inclusive invoices and 54 exclusive no-charge invoices).
- **Cost shape:** list endpoints are headers only; each sale detail costs one call; 60 calls per minute per key gives about 1.1 s per detail; two requests in flight gain nothing; detail payload mean 6.8 KB; cache 654 bytes per sale; first load about 18 minutes per 1,000 sales.
- **Evaluation numbers:** wave 1 (5 in-scope questions): MCP 10/10, baseline 8/10, baseline 1.8 times cost and 2.5 times time (agreement with list rollups). Wave 2 (30 runs): 15/15 versus 12/15, baseline 1.38 times cost and 2.1 times time; the baseline's Q6 answer 60 is a defensible narrower reading (the pre-registered primary is 65); the stage-trap questions did not separate the arms. Wave 3, revenue by SKU on documents: MCP correct cold (169 s) and warm (7 s), baseline wrong twice (380 s and 299 s, it ignored credit notes, did not check tax and missed the largest SKU).
- **Status facts (list-based):** open sales 114: 52 awaiting pick, 31 awaiting ship, 4 shipped not invoiced, 21 invoiced unpaid; 85 sales say ORDERED but 38 of them are further along; 65 of 112 purchases await receipt; stock: 15 negative rows over 9 products, 22 products on order with nothing on hand, 4 formula-mismatch rows, 101 of 1,559 products have a reorder threshold and 9 are at or below it.
- **Claude Code behaviour:** headless tool calls blocked for 90, 240 and 700 s all succeeded, with or without progress notifications; project-scoped MCP servers need a one-time interactive approval; the SDK v2 API differs from v1 examples.
- **Research caveat:** complaints research rests on search snippets and competitor-biased pages (G2, Capterra and Reddit were not reachable); frequency labels are judgement.
- **Merge hygiene found by this skill's preflight and fixed in this PR:** CLAUDE.md carried two contradictory tool paragraphs, a stale "Discovery, problem not chosen" phase and `eval/` mis-nested under `docs/`; the README diagram and tech section predated the cache; the docs index lacked the spike, ADR 0005 and the handoff folder.

## 7. Open-work register
Ordered for the stated focus first, then everything else.

| ID | Item | Type | Next step | Pointer | Blocked by |
|---|---|---|---|---|---|
| R1 | Move `receivables_overdue` and `sales_summary` onto the cache document basis | continue | Reimplement both on `src/cache/query.ts` and the sync, keep the list-rollup figure as a labelled alternative, rewrite the Q1 to Q3 truth from documents, update tests | ADR 0003 progress, docs/research/mvp-evaluation.md | user choice of next step |
| R2 | Evaluate after R1 | follow-up | Estimate cost, ask the user, then run the document-basis questions | eval/README.md | R1, user approval for paid runs |
| R3 | Sales velocity and reorder suggestions (roadmap C3) | continue | Add a velocity query over cached lines plus reorder thresholds (use top-level MinimumBeforeReorder, not ReorderLevels), then a tool | docs/research/prioritisation.md | R1 |
| R4 | Explain negative stock (roadmap C4) | continue | Trace allocations through open-order lines in the cache; only 2 of 9 negative products are explained by backorders today | docs/research/sandbox-findings.md | cache must hold order lines for open sales (it stores invoice and credit lines only), R1 |
| R5 | Workflow assistant with writes (roadmap W1) | todo | Design confirmation and dry-run first; no writes until the user gives a fresh go-ahead | docs/research/prioritisation.md | user consent |
| R6 | ADR 0005 gaps | follow-up | Add a reconcile cadence or document the manual one, add a cache-clear tool, amend the ADR on the `from` default | ADR 0005 progress | none |
| R7 | ADR 0004 gaps | follow-up | Measure PII exposure in the evaluation, decide on business names in outputs, add per-tool output caps | ADR 0004 progress | none |
| R8 | ADR 0002 gap: HTTP transport | todo | Write an ADR only if remote or multi-user use is wanted | ADR 0002 progress | user need |
| R9 | Untested stage bumps of `Updated` (pick, pack, ship, invoice, payment) | unverified | A write probe on a throwaway sale advancing those stages | docs/research/line-cache-spike.md | fresh write consent |
| R10 | Interactive Claude Code timeouts for long tool calls | unverified | Run a long call in an interactive session | docs/research/line-cache-spike.md | none |
| R11 | Production scale, Automation add-on (webhooks), write appetite, persistent-cache preference, which pains the team feels | unverified | Ask the user; these were asked in the findings and never answered | docs/research/sandbox-findings.md | user answers |
| R12 | Behaviour above 60 calls per minute and the Limit above 1000 | unverified | Test carefully or leave documented as unverified | docs/research/cin7-core-api.md | none |
| R13 | Evaluation follow-ups | follow-up | Margin question not evaluated; cause of the baseline missing the largest SKU not investigated; PII not measured; re-run after every tool change | docs/research/mvp-evaluation.md | user approval for paid runs |
| R14 | Rotate the sandbox application key | user-action | Real credentials appeared once in a diff during the session (never pushed); rotate if that matters, then update .env and the private env file | .env (ignored) | user |
| R15 | Approve the project MCP server in Claude Code | user-action | Run claude in the repo and accept the .mcp.json server, check with claude mcp list | README.md | user |
| R16 | Delete stale branches | user-action | Delete the 14 remote branches listed in section 1 and their local copies | section 1 | user |
| R17 | Purge local customer data | user-action | Delete the session scratchpad raw data and eval/out when no longer needed (both hold sandbox customer data; eval/out/truth.json has an order number) | section 8 | user |
| R18 | Decide the next roadmap step | user-action | Confirm R1 as next (it was proposed and not answered) or choose another item | section 7 | user |
| R19 | Confirm "haiku large" | user-action | Say what was meant; plain haiku is used meanwhile | memory file feedback-haiku-implementation | user |
| R20 | Insights suggestions not done | todo | Add a Biome post-edit hook and a /preflight skill wrapping the preflight in the workflow guide | docs/workflow-guide.md | user go-ahead |
| R21 | Sandbox side effect | risk | One voided throwaway sale remains (reference starts with SPIKE-THROWAWAY); the sale list has 174 rows; non-voided counts are unchanged | docs/research/line-cache-spike.md | none |
| R22 | Cache hygiene | risk | Add schema-version migration, size/age limits and a deletion tool before wider use | src/cache/types.ts | R6 |
| R23 | Response-size budget and token budget for tools | todo | Add per-tool caps and a global guard | ADR 0004 progress | none |
| R24 | Keep the skill and its tests in view | follow-up | Skill lives outside the repo at ~/.claude/skills/retire-chat; run its tests with node --test; consider versioning it | docs/handoff/README.md | none |

## 8. Environment and resuming
- **Commands:** `npm install`, `npm run build`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run inspect`; evaluation: `node eval/truth.mjs`, `node eval/truth-sku.mjs`, `node eval/run.mjs --only Q11 --reps 2` (spends money; ask first); headless runs use an empty directory outside the repo.
- **Secrets:** names only: `CIN7_ACCOUNT_ID`, `CIN7_APPLICATION_KEY`, `CIN7_BASE_URL` in the ignored `.env`; `http/http-client.private.env.json` for the HTTP client. The server loads `.env` itself so the key never enters the model's context; the evaluation baseline arm gets the key in its environment by design.
- **Caches and local-only state:** the snapshot cache defaults to `.cache/cin7` (ignored, business names and order lines); evaluation caches are under `eval/out/cache/`; `eval/out/` holds transcripts and truth files with customer data; the session scratchpad (`/private/tmp/claude-501/.../scratchpad`, about 7 MB, includes raw sale details) is ephemeral and holds customer data.
- **Memory files** (outside the repo, in the Claude project memory folder): the index plus feedback-git-workflow (now says one PR into master, no stacking) and feedback-haiku-implementation.
- **Other local-only files outside the repo and scratchpad:** `/tmp/s/a.py` and `/tmp/run.py` (scripts the evaluation baseline arm wrote; they read credentials from environment variables and contain none), `/private/tmp/evalcwd/` (the evaluation's empty working directory with MCP config files: paths only, no secrets). Safe to delete; they are unmanaged and not cleaned automatically.
- **Cumulative evaluation spend:** about 1.7 US dollars notional across all waves, smoke runs and timeout probes (the CLI's cost fields; if you are on a subscription this uses plan quota instead). Use it when asking for approval of further runs.
- **Plan file:** the Claude plan file for this project was overwritten many times; the retire-chat plan is the last content and has no lasting value.
- **Sandbox:** ZAR, Africa/Johannesburg; one voided throwaway sale (R21); the user's `.http` runs share the key, so keep to about 54 calls per minute.
- **Not recoverable after clearing the chat:** the scratchpad scripts (probe, spike loader, gate driver, fingerprint script) and raw data; their conclusions are in docs/research and ADRs.

## 9. Suggested skills and tools for the next session
`retire-chat` (again, at the end of that session); `superpowers:brainstorming` or plan mode before building; `low-effort-plan` or `adversarial-plan-implement` for the Haiku-delegated implementation (maximum five agents); `superpowers:verification-before-completion` before claiming done; the `advisor` tool at the gates; `caveman` for replies. MCP Inspector (`npm run inspect`) for tool debugging.

## 10. Completeness check
- **verify.mjs:** `node ~/.claude/skills/retire-chat/scripts/verify.mjs docs/handoff/2026-11-06-cin7-mcp-roadmap.md --repo . --readme README.md --secrets .env,eval/out/truth.json,http/http-client.private.env.json --ledger-min 28 --register-min 24` exits 0 with 395 checks passed (ADRs and their commits and PRs, every PR, tool, module, evaluation question, research file and remote branch, ledger and register structure, placeholders, GUID/email/token scan, literal values from the three secrets files, README tool and ADR coverage). It does not check conversation-only state.
- **Reviewer outcome:** the advisor reviewed the transcript against this document and listed blocking omissions: a memory file still teaching stacked PRs, stale branch counts, the verifier failing on its own branch, consent and attribution wording, local-only files outside the listed paths, and the skill-test evidence. All were fixed and are reflected above; it confirmed the ledger (U1 to U28) and the rest of the layer-(c) list were complete.
- **Known gaps:** the scratchpad scripts are not preserved; the skill itself is unversioned (R24); items needing the user are R14 to R19; the verifier cannot detect conversation-only facts that nobody wrote down.
