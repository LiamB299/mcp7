# ADR 0006: Document-basis receivables and sales summary

- **Status:** accepted, provisional (live gate passed; wave 4 re-evaluation on documents: treatment 3 of 3 correct, baseline 0 of 3, n = 1)
- **Date:** 2026-11-06
- **Amends:** ADR 0003 (the list-rollup basis of `receivables_overdue` and `sales_summary`)

## Context
ADR 0003 built `receivables_overdue` and `sales_summary` on Cin7's `saleList` rollups (`InvoiceAmount`, `PaidAmount`). The line-cache spike and the correction in [mvp-evaluation.md](../research/mvp-evaluation.md) showed those rollups disagree with the invoice and credit-note documents on 49 of 164 sandbox sales (18 credit notes not netted, 10 zero despite an invoice, 21 other). On documents the old answers were wrong: 29 overdue sales against 43, API-channel revenue 10,349 against 14,938 inc-tax, top customer 24,756 against 54,625. ADR 0005's cache already holds authorised or paid invoices and authorised credit notes per sale with totals, tax, paid amount and due date.

## Options considered
1. Keep the list rollups and only label them (done in #15). Cheap, but the headline numbers stay wrong on about 30% of sales.
2. Rebuild both tools on the cache documents and keep the list figure as a labelled alternative. Costs a cache load (about 1.1 s per invoiced sale, 163 s cold in the sandbox) and ties both tools to the cache.
3. Fetch documents on every call without a cache. Rejected: about 1.1 s per sale on every question.

## Decision
Option 2.
- **`receivables_overdue`** (`src/cache/receivables.ts`): per non-voided sale with an invoice, outstanding = invoice totals minus invoice paid minus authorised credit-note totals (tax-inclusive, billed). Due date = earliest due date among invoices that still have an open balance; no due date is counted under `noDueDate`, not overdue. Also returned: `withoutCreditNetting` (a refunded credit note may already be reflected in `paid`; unverified) and `listRollup` (the previous basis, over every non-voided cached header).
- **`sales_summary`** (`src/cache/sales-summary.ts`): invoices add, credit notes subtract. New input `dateBasis`: `document` (default; each document by its own date, matching `sales_by_sku`) or `order` (sales whose order date is in range, all their documents; for "sales ordered between"). Headline `revenueExTax` (document total before tax); `revenueIncTax` is shown too. Both include additional charges, unlike `sales_by_sku` SKU rows. `listRollup` keeps the old figure.
- **Shared plumbing** (`src/tools/cache-answer.ts`): refresh-or-load and the coverage verdict (`complete`, `remaining`, `rangeCovered`, `pendingDetail`, note) are used by all three cache-backed tools.
- **Sync change detection** (`src/cache/sync.ts`): a sale is also refetched when its list paid amount, invoice amount or invoice status differs from the cached header, because it is unverified whether a payment bumps `Updated`. This is only visible to a full header listing, so `receivables_overdue` always syncs with `full: true` and all history (about 1 extra header call per 1,000 sales). The list `InvoiceDueDate` is now cached on the header (optional, refreshed in place without a detail call).
- Both tools write only the local cache, so they carry `readOnlyHint: false`, `idempotentHint: true`, like `sales_by_sku`. Customer business names stay in outputs (ADR 0004 unchanged).

## Live gate (2026-11-06, sandbox, read-only GETs, cold cache 163 s)
- Receivables as of 2026-11-05: 43 overdue sales, 83,735.44 netted, 86,610.44 without credit netting; 32 sales in the 90+ bucket, 11 in 61-90. The list rollup inside the same output reproduced the old 29 sales and 26,447 exactly.
- Revenue by channel, sales ordered 2026-07-01 to 2026-09-30, API channel: 14,195.12 ex-tax, 14,937.56 inc-tax (list rollup 10,349, reproduced exactly). On the document-date basis the revenue was identical and the sale counts were one lower in the API and no-channel groups (one sale ordered in range had its invoice dated outside it).
- Top customer across all sales: 54,625 inc-tax, 47,500 ex-tax (list rollup about 24,756, reproduced).
- Invoice statuses on non-voided list rows: INVOICED 125, INVOICED / CREDITED 22, NOT INVOICED 14, NOT AVAILABLE 3. No partially-invoiced value exists, so `wantsDetail` needs no change. All 147 cached invoices carry `paid` and a due date.

## Consequences
- The headline answers now match the documents; the old figure is one field away, so a disagreement is visible rather than silent.
- Both tools need the cache: the first call loads details (minutes, resumable, progress notifications), later calls are incremental. `receivables_overdue` always loads all history.
- A tool that was read-only against Cin7 and stateless now writes a local file; annotations changed accordingly.
- Production scale is unknown (about 18 minutes per 1,000 invoiced sales on first load).

<!-- retire-chat:progress:start -->
## Progress and where to continue (as of 2026-11-07)

Built, live-gated and re-evaluated. Gate (sandbox, read-only): 43 overdue sales, 83,735.44 netted and 86,610.44 without credit netting; API-channel revenue for sales ordered July to September 14,195.12 ex-tax and 14,937.56 inc-tax; top customer 54,625 inc-tax; the embedded list rollup reproduced the old 29 sales and 26,447, 10,349 and about 24,756 exactly. Wave 4: `eval/truth-docs.mjs` matched the tools exactly; Q1 to Q3 treatment 3 of 3 correct, baseline 0 of 3, one run per arm, treatment cold each run (so not faster on Q2 and Q3). Open: more repetitions and a warm-cache timing (R15); whether a payment bumps `Updated` is untested, so the full header listing is the safeguard (R4); whether invoice `paid` already reflects refunded credit notes is unverified, which is why `withoutCreditNetting` is shown (R13); the first load of all history takes minutes and its interactive timeout is untested (R5).

Full context, the ledger of what was asked and the open-work register: `docs/handoff/2026-11-07-mvp-closed.md`.
<!-- retire-chat:progress:end -->
