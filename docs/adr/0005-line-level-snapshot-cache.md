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
- **Revenue** = authorised or paid invoice lines minus authorised credit-note lines, **excluding tax**, attributed to the **invoice or credit-note date** (not the order date). Line `Total` is ex-tax when the sale's `TaxCalculation` is Exclusive but **tax-inclusive when Inclusive** (verified: invoice `TotalBeforeTax` equals the line sum on all 54 exclusive no-charge invoices and equals the line sum minus line `Tax` on all 58 inclusive ones), so ex-tax line revenue = `Total` minus (`Tax` when Inclusive).
- **Margin** = ex-tax revenue minus line `AverageCost` x `Quantity` (not `COGSAmount`, which is set on only 35 of 162 invoiced sales).
- **Additional charges** (freight and similar, 38 invoiced sales) are not lines and are reported separately.
- **Currency:** 39 of 173 sandbox sales have a customer currency other than the base currency, all at a conversion rate of 1.0, so amounts are summed as stored; each sale keeps its currency and rate, and report tools state how many contributing sales were non-base.
- **Cache keys and time:** per-sale `Updated` from the header list is the version key (fraction digits vary from 2 to 4, so it is parsed, not string-compared); the sync cursor is the maximum server `Updated` seen, not the local clock; documents seen include the header `InvoiceDate`.
- **Partial data is labelled:** report tools return `complete: false` and coverage whenever the window is not fully loaded, and never present partial totals as final.
- **Concurrency:** two Claude sessions must not sync at once (pacing is per process): a lock file with a stale timeout guards the snapshot, and the snapshot is written atomically.

## Consequences
- Line-level tools (revenue and margin by SKU, velocity, explained negatives) become a few seconds after the first load; the first load is minutes and scales linearly (about 18 min per 1,000 sales).
- A cache file holding business names and order lines exists on disk: it is gitignored, allow-listed, and should be deletable by a tool.
- Untested stage changes (pick, pack, ship, invoice, payment) and rollup drift mean incremental refresh needs a reconcile; correctness over cleverness.
- Existing tools using list rollups should state their basis; a document-based basis becomes available with the cache.
- Production size is unknown: the window default and estimate message protect against surprise.
- Follow-on evaluation: "revenue by SKU", where the baseline must fan out by itself.
