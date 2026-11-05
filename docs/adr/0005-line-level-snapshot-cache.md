# ADR 0005: Line-level snapshot cache (persistent, windowed, incremental)

- **Status:** proposed (measured by the [line-cache spike](../research/line-cache-spike.md); needs the user's go-ahead before building)
- **Date:** 2026-11-05

## Context
SKU revenue, margin, velocity and "explain negative stock" need sale lines, which only the per-sale detail call returns, under a limit of 60 calls/min per key. The spike measured: 1.1 s per detail, 190.6 s to load 173 sales, payloads of 6.8 KB, a 654-byte-per-sale allow-listed cache, sub-millisecond queries, no throughput gain from concurrency, `UpdatedSince` refresh safe for the stage changes tested, Claude Code surviving blocking tool calls up to at least 700 s (headless), and list money rollups disagreeing with document totals on 49 of 164 sandbox sales.

## Options considered
1. **No cache; fan out per question.** Every line-level question costs minutes and about 1.2 MB of raw JSON per 173 sales. Rejected: the A/B evaluation showed speed is a strength, and this would remove it.
2. **In-memory cache per server process.** Rejected by the pre-registered rule: first load (190 s) exceeds 60 s and every session starts a fresh process.
3. **Persistent snapshot (JSON file), incremental refresh, windowed by default.** Chosen.
4. **SQLite.** Equivalent speed at this scale, more machinery; defer until volume demands indexes.

## Decision
Build option 3:
- One JSON snapshot under a gitignored directory; allow-listed fields only (no contacts, addresses or notes); atomic writes.
- Refresh by `saleList?UpdatedSince=<last sync>`, details only for changed or new sales; periodic and on-demand full reconcile.
- Default window (for example the last 90 days, tunable); full history opt-in; first-load estimate stated in the reply.
- Warm on demand in the tool call with progress notifications; a `cache_status` tool; every answer carries "data as of" and its basis.
- **Revenue** = authorised or paid invoice lines minus authorised credit-note lines, tax-exclusive; **margin** = line `AverageCost` x `Quantity` (not `COGSAmount`); additional charges reported separately.

## Consequences
- Line-level tools (revenue and margin by SKU, velocity, explained negatives) become a few seconds after the first load; the first load is minutes and scales linearly (about 18 min per 1,000 sales).
- A cache file holding business names and order lines exists on disk: it is gitignored, allow-listed, and should be deletable by a tool.
- Untested stage changes (pick, pack, ship, invoice, payment) and rollup drift mean incremental refresh needs a reconcile; correctness over cleverness.
- Existing tools using list rollups should state their basis; a document-based basis becomes available with the cache.
- Production size is unknown: the window default and estimate message protect against surprise.
- Follow-on evaluation: "revenue by SKU", where the baseline must fan out by itself.
