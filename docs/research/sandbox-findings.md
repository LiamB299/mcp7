# Sandbox findings: cross-referencing the five candidate pain points

Investigated 2026-11-05 against the Cin7 Core sandbox with the user's consent. **Read-only GETs, 22 calls total** (6 orientation + 16 logged in the ledger), about 1 call per 1.2 s, **0 × 429**, latency 0.35-1.9 s. Raw responses stayed in the session scratchpad; this document contains only counts, distributions, field names and sizes. No customer, supplier, product or order identifiers.

Companion docs: [user-complaints.md](user-complaints.md) (pain evidence), [cin7-core-api.md](cin7-core-api.md) (API reference; §7 updated with sandbox-verified corrections), diagrams in [../design/](../design/README.md).

## 1. How to read this

- **The sandbox is synthetic.** Sale `OrderDate` reaches back to 2023 but `Updated` starts 2026-03; orders arrive in bursts (62 in 2026-07); all 29 unpaid invoices are overdue. So ages, "stalled" counts and anomaly counts below are artefacts of how the data was made. **They show what the API can return and what it costs, not how common a pain is.**
- Therefore the matrix keeps two things apart: **pain evidence** (from public complaints, [user-complaints.md](user-complaints.md)) and **feasibility / cost / payload shape** (from the sandbox). A candidate is not "confirmed" because seeded data contains oddities.
- Gaps: the workflow assistant needs writes, which were not consented to and not tested. Velocity-based reorder needs the line-level fan-out, which was only sampled (9 of 173 sale details).

## 2. Sandbox profile

| Thing | Value |
|---|---|
| Company settings | Base currency ZAR, timezone Africa/Johannesburg, `LockDate` null |
| Sales | 173 (99 Advanced, 71 Simple, 3 Service); order dates 2023-01 to 2026-10; 12 distinct customers, top customer 34% of sales |
| Sale source channel | Shopify 79, API 41, none 53 |
| Sale master status | ORDERED 85, COMPLETED 50, INVOICED 15, VOIDED 9, BACKORDERED 7, ORDERING 2, PICKING 2, PACKED 1, ESTIMATING 1, INVOICING 1 |
| Purchases | 112 (68 Advanced, 41 Simple, 3 Service); ORDERED 60, RECEIVED 15, VOIDED 14, COMPLETED 7, ORDERING 7, other 9; 28 blind receipts |
| Products | 1,559 active (default filter); first 100: 99 Stock + 1 Service, 99 FIFO, 1 with a BOM |
| Availability rows | 483 (one per product × location × bin × batch) covering 141 products and 7 locations; one location holds 434 rows; 307 rows carry a batch, 1 an expiry, 0 a bin; `InTransit` is 0 everywhere |
| Production orders | 10 (not examined further) |

## 3. Candidates as hypotheses (tested against pre-set kill criteria)

| # | Hypothesis | Kill criterion | Met? | Result |
|---|---|---|---|---|
| 1 | Common questions need list+detail fan-out and raw payloads are too big for an LLM | Lists alone answer typical questions and details are small | Not met | Survives: lines only in detail, 4-37 KB each, headers 185 KB |
| 2 | Availability shows anomalies an agent should surface | No anomalies and no stuck/backordered documents | Not met | Survives, **with the synthetic-data caveat** (counts are seeded, not prevalence) |
| 3 | Statuses show documents stalled mid-chain; chain complexity is real | Nearly all documents complete/void, no mid-chain stalls | Not met | Survives structurally, **with the synthetic-data caveat**; writes untested |
| 4 | Reorder levels are set and some SKUs sit below them | Levels mostly empty AND no velocity data | Half met | 87% of sampled products have no threshold; velocity data exists in sale lines but was not fetched. Weak alone |
| 5 | Cin7 exposes sync/status fields usable for reconciliation | No sync fields and no accounting-side access | Met | Killed for now |

## 4. Findings per candidate

### 3.1 Reporting / answers on demand: feasible, and the cost shape is the real finding

- **Header-level questions are cheap in calls, heavy in tokens.** Overdue receivables, unpaid totals, status mix and counts by channel/month came from 2 `saleList` calls. But 173 headers weigh about 185 KB (about 1.07 KB each), roughly 46k tokens if returned raw (bytes/4).
- **Line-level questions need the fan-out.** The list carries no lines. Detail calls: 9 sampled `sale?ID=` responses ranged 4.4-36.8 KB (median about 5.5 KB, mean about 9 KB; one 23-line order was 36.8 KB because `Order` and `Invoice` each repeat the lines). Fetching all 173 details is **at least 173 calls, about 3 minutes at 60/min**, and roughly **240k-390k tokens raw by bytes/4** from this small sample; real JSON with GUIDs tokenises worse, so treat 0.25-1.7M as the plausible range. Shaping is mandatory, not optional.
- **Stock valuation is one call, not a fan-out.** `StockOnHand` in `/ref/productavailability` is stock **value** (`OnHand × AverageCost`, ratio about 1.0 on the 6 sampled rows; **empirical only**, the blueprint documents it as just "StockOnHand."; sandbox total about 2.08M ZAR, one row 34%), not units. 483 rows fit in one `Limit=500` call (167 KB).
- Products are heavy: 83 fields each, 233 KB per 100 products (about 3.7 MB for all 1,559). Needs field selection.
- `/transactions` for one month returned 58 ledger rows (first 50 all type Sale): usable as a cheap revenue/ledger feed.
- **Verdict: feasible, high leverage.** Split into header-level reports (cheap) and line-level reports (needs cache + throttle + shaping).

### 3.2 Stock and data-health checks: feasible, single data plane with reporting

- One availability call returns everything. In the sandbox: 15 of 483 rows have negative `Available` (9 products net negative, deficit about 34 units); 15 rows have `Allocated > OnHand` (same count, presumably the same rows; not cross-checked); 49 rows have `OnHand = 0` with `OnOrder > 0` (22 products); 4 rows have `Available ≠ OnHand − Allocated` (3 with `OnHand` 0 and `Available` 5, 26, 5; 1 with `OnHand` 150 and `Available` 183; plausibly assembly/BOM availability or other adjustments, **unverified**).
- **Explained vs unexplained:** fetching all 7 BACKORDERED sale details showed their lines cover only 4 products (8 units). **Only 2 of the 9 negative-availability products are explained by a backordered line**, and those two match exactly. The other 7 are unexplained by backorders (likely allocations from other open orders; not traced). This "explain the discrepancy" step is where an agent adds value, but it is **not cheap**: tracing allocations means reading the lines of the open orders, up to about 114 detail calls (the non-terminal sales), i.e. the same line-level data the reporting cache holds. That is an argument for one shared data plane.
- Because the data is synthetic, the counts are not evidence the pain is common. The feasibility is real: one cheap read, plus targeted explanation calls.
- **Verdict: partial and cheap.** Best paired with reporting.

### 3.3 Workflow assistant (multi-step operations): structurally confirmed, untested

- **Complexity is real and visible in reads.** Sale detail exposes the stage tree (Quote → Order → Fulfilments[Pick, Pack, Ship] → Invoices → CreditNotes) with a `TaskID` per stage. 99 Advanced vs 71 Simple vs 3 Service sales means the available paths differ per document.
- **Status vocabulary trap, confirmed.** 9 sales show master status ORDERED while their sub-statuses say shipped; all 9 are Advanced Sales, which matches the API docs (PICKING through SHIPPING roll up only for Simple Sales). So "stalled" must be computed from sub-statuses and `Type`, not master `Status`. For example all 41 Simple ORDERED sales are NOT PICKED, while among 44 Advanced ORDERED, 38 are PICKED and 9 SHIPPED. Of the 114 non-terminal sales, 52 have an authorised order but nothing picked, 31 are packed but not shipped, 4 shipped but not invoiced (counts are artefacts of seeding).
- **Write risk is high** (stage gating, void/undo overload on DELETE, no idempotency keys documented) and no write probe was run. Cannot assess without fresh consent.
- **Verdict: complexity confirmed, feasibility unproven, highest write risk.** A later phase.

### 3.4 Replenishment / reorder suggestions: weak as a standalone

- 13 of 100 sampled products have `MinimumBeforeReorder`/`ReorderQuantity` set; the `ReorderLevels` list is **empty for all 100** (use the top-level fields). Of the 13, all have stock rows, **2 are at or below their reorder point and both already have an open PO**.
- Velocity needs sale lines, i.e. the same fan-out as line-level reporting. Without it only a threshold check is possible.
- **Verdict: weak alone.** Fold a threshold check into stock-health; revisit velocity once the reporting cache exists.

### 3.5 Accounting-sync reconciliation: refuted for this scope

- Sale detail has no sync-status fields (nearest: `DefaultAccount`, `ExternalID`, `SourceChannel`). `/me` gives `LockDate` (null here). `/transactions` is Cin7's ledger only; reconciling against Xero/QBO needs access to the other system, which we do not have.
- 3 calls spent on this. **Verdict: refuted** (revisit only if an accounting-side data source becomes available).

## 5. Cross-reference matrix

Rows are candidates. Pain evidence comes from public complaints; the other columns come from the sandbox and API.

| Candidate | Complaint IDs ([user-complaints.md](user-complaints.md)) | Pain evidence strength | API feasibility | Sandbox signal | Call cost | Write risk |
|---|---|---|---|---|---|---|
| 1 Reporting on demand | C9, E3, C10, E8 | Moderate (reporting limits recur across ERPs; Cin7-specific evidence is 2 reviewers + G2 scores) | High: no aggregate endpoints, so value is in composing reads | Detail 4-37 KB each; headers 185 KB; valuation one call | Header: 2 calls. Line-level: 173+ calls (~3 min) | None (read-only) |
| 2 Stock / data health | C4, E2, E9 | Moderate (sync/stock-drift is high-severity but Cin7 is only one side) | High: one availability call | 15 negative rows, 49 on-order-at-zero, 2 of 9 negatives explained by backorders | Detection: 1 call. Explanation: up to ~114 detail calls, or the shared line cache | None |
| 3 Workflow assistant | C10, E8 | Moderate (complexity/learning curve, no direct "I can't do X" evidence) | Medium: stage chain 5-8 calls, name-based keys | Stage tree and status trap confirmed | n/a (writes untested) | **High** |
| 4 Reorder suggestions | E10, E9 | Weak (one reviewer) | Medium: thresholds readable; velocity needs fan-out | 13/100 thresholds set, 2 below, both on order | Cheap for thresholds; fan-out for velocity | None |
| 5 Accounting reconciliation | C5 | Moderate-high (financial, incident Jun-Jul 2025) | Low: no sync fields, no accounting-side access | None found | ~3 calls to refute | n/a |

## 6. Design constraints found

1. **Personal data in sale detail.** Top level carries `Customer`, `Contact`, `Phone`, `Email`, billing/shipping addresses; invoices repeat billing address lines. Shaped tool outputs must drop or mask PII by default.
2. **Payload shaping is mandatory.** Detail is 1-9k tokens each; product list 58k tokens per 100; availability whole-account 42k. Return summaries, with an escape hatch for detail.
3. **Field-name drift** (list vs detail, sales vs purchases): see [cin7-core-api.md §7](cin7-core-api.md). Normalise in one mapping layer.
4. **Derived workflow state must use sub-statuses and `Type`**, not master `Status`.
5. **One choke point** (`src/cin7/client.ts`) for throttle (60/min), 429 backoff, caching.
6. **Snapshot cache** with `UpdatedSince` incremental refresh would make line-level reports affordable after the first load (`saleList` supports `UpdatedSince`; detail does not).

## 7. Decision log (advisor gates)

| Gate | When | Input | Outcome |
|---|---|---|---|
| (a) Probe design | Planning, **before** the 6 orientation calls | Task and constraints | Advisor proposed the orientation calls, the hypothesis/probe/kill-criterion structure, main-thread probing, a ledger, privacy-safe docs and read-only guardrails. The written plan was not reviewed separately. |
| (b) Before verdicts | After 16 logged calls | Distributions, payload shapes, reorder join | Treat sandbox as feasibility/cost evidence only, not pain frequency (synthetic dates). Check that "ORDERED but shipped" is not an anomaly (it is documented Advanced Sale rollup), explain `StockOnHand` (it is value), try to explain negative availability (7 of 9 remain unexplained). Ran 6 extra detail calls. |
| (c) Before recommendation | After writing this doc, before commit | Full draft + checks | Lead (1+2) confirmed. Corrections applied: availability formula-mismatch rows (4, not 3), stock-health call cost (explanation is not cheap), `StockOnHand` evidence (6 rows, empirical only), brainstorm table added to the repo, decision-log timing. |

## 8. Recommendation (the user decides)

1. **Lead: a read-only "operations insight" server combining candidates 1 and 2** on one shared data plane: throttled client, snapshot cache with incremental refresh, shaped/PII-safe outputs. Tools are outcome-oriented (receivables and overdue, sales by period/channel/customer, stock position and valuation, stock health with explanations, open-order pipeline), not endpoint wrappers.
2. **Later phase: workflow assistant (3)** once the read layer exists and the user consents to write testing; needs confirmation/dry-run design.
3. **Fold** a reorder-threshold check (4) into stock health; **drop** accounting reconciliation (5) unless an accounting data source appears.

**Core risk of the lead:** the line-level cache. First load takes minutes at 60 calls/min, and production scale is unknown (fan-out grows linearly with sales). The recommendation also depends on which pains the user's team actually feels.

## 9. Open questions

- Which of these pains does the user's own team actually feel? Public complaints are generic, and the sandbox is synthetic.
- Is the user's production account comparable in size (173 sales, 1,559 products) or far larger? Fan-out cost scales with it.
- Appetite for write tools, and for a persistent cache (local file/SQLite) vs in-memory only.
- Does the production account have the Automation add-on (webhooks for cache invalidation)?
