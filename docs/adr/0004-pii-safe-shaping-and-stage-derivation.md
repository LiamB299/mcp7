# ADR 0004: Allow-list PII shaping and sub-status stage derivation

- **Status:** accepted (provisional; see [mvp-evaluation.md](../research/mvp-evaluation.md) wave 2)
- **Date:** 2026-11-06

## Context
ADR 0003 deferred personal-data handling and response-size work until the MVP was proven. The MVP held up, so wave 2 adds tools that expose individual orders and workflow state: `order_lookup`, `open_orders_pipeline`, `stock_health`. Two hazards surfaced in the sandbox:
1. **Sale detail carries personal data** (contact person, email, phone, billing and shipping addresses, free-text notes, invoice billing lines) and is large (4-37 KB; a 23-line order was 37 KB).
2. **Cin7's master sale `Status` misleads.** For Advanced sales it can read ORDERED while goods have shipped: 38 of 85 master-ORDERED sales are past "awaiting pick".

## Decision
1. **Allow-list shaping** (`src/shape.ts`): output objects are built from named safe fields; nothing is copied wholesale and nothing is blocked by name, so a field Cin7 adds later is dropped by default. The customer's business name is kept. Order lines are capped (default 20) with `totalLines` and `truncated`. Results carry a "data as of" stamp.
2. **Derive workflow stage from `Type` plus the `Combined*Status` sub-statuses** (`src/stage.ts`), never from master `Status`. Fulfilment and billing are separate dimensions (an invoice can precede picking); service sales skip fulfilment; BACKORDERED is a flag. "Awaiting receipt" for purchases is status ORDERED, RECEIVING or INVOICED with the receiving sub-status not FULLY RECEIVED.
3. Row shapes live in `src/cin7/types.ts` with verified field facts (GUID string ids, `OrderDate` vs `SaleOrderDate`, purchase list key `ID`).
4. The line-level cache stays out of scope: it is the high-risk item and needs its own decision.

## Evidence
Live gate against independent truth (re-implemented from raw sub-statuses in `eval/truth.mjs`): 52 awaiting pick, 31 awaiting ship, 65 purchases awaiting receipt, 9 negative-stock products, 9 products at or below reorder point: all exact. Unit tests assert no personal data in `maskSale` output. Evaluation wave 2: treatment 15/15 correct vs baseline 12/15; the stage trap itself did not separate the arms, the net-vs-gross and definition questions did.

## Consequences
- Tool outputs are safe to show the model by default; adding a new field to a shaped output is a deliberate act.
- Stage names are our vocabulary, documented in the glossary; they must be revisited if Cin7 adds sub-statuses.
- Aggregate tools still return customer business names (for example in candidate lists); revisit if the server is used beyond a sandbox.
- No global response-size budget yet; each tool bounds its own output.

<!-- retire-chat:progress:start -->
## Progress and where to continue (as of 2026-11-06)

Built and live-verified against independent truth (52 unpicked, 31 packed not shipped, 65 purchases awaiting receipt, 9 negative-stock products, 9 at or below reorder point). Gaps verified in code and evaluation: the evaluation did not measure personal-data protection (only unit tests and the live gate do); aggregate tools still return customer business names (`receivables_overdue`, `sales_summary` by customer, `order_lookup` candidates); there is no global response-size budget; the master-status trap did not separate the arms, so the normaliser value is verified but not demonstrated by the evaluation. Next: add a reliable PII-exposure measure to the evaluation, decide whether business names may leave the service layer, add per-tool output caps, and revisit stage names if Cin7 adds sub-statuses.

Full context, the ledger of what was asked and the open-work register: `docs/handoff/2026-11-06-cin7-mcp-roadmap.md`.
<!-- retire-chat:progress:end -->
