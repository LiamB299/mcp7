# ADR 0007: Sales velocity and reorder suggestions

- **Status:** accepted, provisional (live gate passed; not yet evaluated against an independent truth)
- **Date:** 2026-11-06

## Context
`stock_health` can say a product is at or below its Cin7 reorder threshold, but only 101 of 1,559 sandbox products have a threshold and Cin7 has no sales-rate data, so it cannot say how soon stock runs out or how much to order. The line-level cache (ADR 0005, 0006) holds invoice and credit-note lines per product, so a sales rate is computable. This iteration is read-only against Cin7 (no writes of any kind).

## Options considered
1. Extend `stock_health` with velocity. Rejected: it would then need the cache and a minutes-long first load, and today it answers with two list reads.
2. A new tool `reorder_suggestions` over the cache plus two Cin7 list reads. Chosen.
3. Read supplier lead times from the product list (`IncludeSuppliers`). Not taken: heavier payload and an unverified field; a lead-time input is simpler and its value is visible in the answer.

## Decision
New read-only tool `reorder_suggestions` (`src/tools/reorder-suggestions.ts`) on three pure modules: `src/cache/velocity.ts` (net units per product over a window), `src/stock/availability.ts` (stock per product, shared with `stock_health`) and `src/reorder.ts` (join, reasons, ranking).
- **Velocity** = invoice line quantity minus credit-note line quantity over `[asOf - windowDays + 1, asOf]` by document date (default 90 days), divided by the full window. Invoiced units only: open, uninvoiced orders are not in the cache (that is the missing piece for negative-stock explanations, R4).
- **Universe** = the active product list excluding `Service` and deprecated products; a product with no stock rows has 0 available. Sale lines join to a product by product ID, then SKU, merging entries of one product; unmatched units are reported (`velocityUnmatched`, `noProductUnits`), never hidden.
- **Reasons**: `below_cin7_threshold` (top-level `MinimumBeforeReorder`, not `ReorderLevels`), `stockout_before_delivery` (days of cover shorter than the lead time), `needs_cover`. **Suggested quantity** = `ceil(max(0, daily velocity x (leadTimeDays + targetCoverDays) - available - on order))`. `leadTimeDays` (default 14) and `targetCoverDays` (default 30) are inputs, echoed in the output as assumptions, not supplier data.
- Stock is always current; `asOf` moves only the sales window. The tool writes only the local cache (`readOnlyHint: false`, like the other cache-backed tools) and shares their coverage contract.

## Live gate (2026-11-06, sandbox, read-only GETs, scratch cache)
- **Join:** every product with velocity matched a product (3 of 3 in a 90-day window, 6 of 6 over 730 days; 0 unmatched), so sale-line `productId` equals the product `ID`.
- **Quantity parity:** velocity totals equal `sales_by_sku` quantity exactly for the same window (31 and 232 units).
- **Threshold parity:** the tool finds 6 products below threshold against `stock_health`'s 9. The difference is exactly the 3 `Service` products that have a threshold and no stock rows (the product list has 17 Service products and 1 gift card out of 1,627): `stock_health` counts them as at available 0, which is a false positive for a non-stock item. This tool's exclusion is intended; `stock_health` is unchanged (follow-up below).
- **Sparse sales:** only 3 products sold in the last 90 days and 6 in two years; no product would stock out within a 14-day lead time. The sandbox shows the mechanics but cannot show a real replenishment picture. First load took 35 s (90-day window) and 138 s (730 days).

## Consequences
- Answers "what do I reorder, by when, how many" with stated assumptions; a threshold-only product shows a suggested quantity of 0 (no recent sales) beside its `cin7ReorderQuantity`.
- Demand is understated for businesses that order before invoicing (no open-order lines in the cache) and zero velocity on a short or partial window is not zero demand; the coverage fields say whether the window is loaded.
- Negative available stock counts as a shortfall in the suggested quantity even with no sales.

<!-- retire-chat:progress:start -->
## Progress and where to continue (as of 2026-11-06)

Built and live-gated (above). Not done: (1) `eval/truth-reorder.mjs` and the pre-registered Q12 are written but not run, and `eval/run.mjs` does not grade Q12 yet (a run needs the maintainer's approval). **Q12 cannot discriminate on this sandbox as written**: in the 90-day window no product with sales is a candidate, so the truth's top 3 are threshold-only products with a suggested quantity of 0, and a sensible answer (order up to the minimum, or use the reorder quantity) would be graded wrong. Revise Q12 (for example a window and parameters that surface velocity-driven candidates, or accept the reorder-quantity reading) before any run; nothing has run yet, so revising is still pre-registration; (2) `stock_health` still counts Service products below threshold (3 of its 9 in the sandbox): fix and re-verify its parity figure; (3) open-order lines are not cached, so demand from uninvoiced orders is missing (register R4); (4) supplier lead times are not read; (5) the sandbox is too sparse to show stock-outs, so ranking quality is untested on realistic data.
<!-- retire-chat:progress:end -->
