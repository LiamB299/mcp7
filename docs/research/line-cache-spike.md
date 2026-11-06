# Line-level cache spike

Status: **complete (2026-11-05).** The sections up to "Method guardrails" were written and committed **before any measurement** (commit "Spike: pre-register line-cache decision rules"), so the verdicts below cannot have been fitted to the data. Raw bodies and the throwaway scripts stayed in the session scratchpad; this document holds numbers and shapes only.

## Why a spike
The line-level items (revenue and margin by SKU, velocity, explaining negative stock) need sale *lines*, which only the per-sale detail call returns, under a 60 calls/min limit. The prioritisation ([prioritisation.md](prioritisation.md)) rated the snapshot cache the riskiest item: first load takes minutes, production scale is unknown, and incremental refresh was only half-verified (`saleList?UpdatedSince` filters; whether child-stage changes bump `Updated` was not). This spike settles four unknowns with throwaway code kept outside `src/`. It builds nothing into the tools.

## Pre-registered decision rules (written before measuring)

| # | Unknown | How measured | If yes | If no |
|---|---|---|---|---|
| U1 | Does a stage change on a sale bump the list's `Updated` (so `UpdatedSince` refresh is safe)? | Read-only: list `Updated` vs detail `LastModifiedOn` for every sale; then one write probe on a throwaway sale (needs fresh user consent) | Incremental refresh by `UpdatedSince` is safe | Add a periodic full reconcile or a short TTL; incremental alone is unsafe. If the write probe is declined: verdict "unverified", design includes a reconcile |
| U2 | Does Claude Code survive a multi-minute blocking tool call, and do progress notifications extend it? | Throwaway sleep-tool server, headless runs at about 90 s and 240 s, with and without progress | Warm the cache on demand inside the tool call | Warm in the background at server start, reply "warming N of M" and expose a status tool |
| U3 | Is an in-memory cache enough? | First-load time measured below; each Claude Code session and headless run starts a fresh server process | In-memory is fine if first load is under about 60 s for the default scope | Persistent local cache (gitignored, allow-listed fields only) |
| U4 | Does full history scale? | Measured per-sale detail time and payload size, extrapolated to 1k / 10k / 50k sales | Full history viable if first load is under about 10 min | Default to a time window (headers are cheap: 1 call per 1000 sales; details are the expensive part), full history opt-in |

Also measured, to fix definitions before building: revenue basis for SKU reports (invoice lines minus credit-note lines vs `InvoiceAmount` / `SaleInvoicesTotalAmount`, tax in or out, additional charges, service lines); margin basis (sum of line `AverageCost` x `Quantity` vs `COGSAmount`); storage size of an allow-listed line table (JSON and `node:sqlite`).

## Method guardrails
Read-only GETs unless the write probe is approved. Pacing at about 1.1 s between request starts (about 54 per minute); two-in-flight test keeps the start spacing. Ledger of every call. Raw bodies stay in the session scratchpad, never the repo. The doc holds counts, sizes, timings and shapes only. Out of scope: an A/B evaluation (noted as the follow-on: "revenue by SKU" is where a Bash baseline must do the whole fan-out itself).

## Results

About 220 Cin7 calls in total: 1 list + 173 sale details (serial, paced), 30 sale details (two in flight), 16 for the approved write probe (one failed create plus the 15-call run). No 429 or 503 at any point. Sandbox: 173 sales (174 now, see "Sandbox side effects").

### Cost of loading line data
| Measure | Value |
|---|---|
| 173 details, serial, start spacing 1.1 s | **190.6 s** (1,102 ms per call); 0 rate-limit responses |
| 30 details, two requests in flight, start spacing held at 1.1 s | 32.3 s (1,075 ms per call): **no gain**, because per-call latency (median 395 ms, p90 630 ms, max 912 ms) is below the spacing; throughput is spacing-bound at about 54 calls/min |
| Detail payload (`HideInventoryMovements=true`) | median 6.6 KB, mean 6.8 KB, p90 8.1 KB, max 36.8 KB; 1.17 MB for all 173 |
| Lines | 218 order lines over 173 sales (median 1, max 23; 21 sales have none) |
| Allow-listed cache (header + authorised invoice and credit-note lines) | **654 bytes per sale** as JSON (113 KB for 173 sales); 734 bytes per sale in `node:sqlite` (127 KB) |
| Query on the cache (revenue by SKU, 35 SKUs) | 0.4 ms (JSON load + aggregate), 0.3 ms (SQLite open + query) |

Cost is entirely the fetch; storage and query time are negligible at this scale.

### Verdicts against the pre-registered rules

| # | Unknown | Result | Verdict | Decision |
|---|---|---|---|---|
| U1 | Does a stage change bump the list's `Updated`? | Read-only: list `Updated` equals detail `LastModifiedOn` on **173 of 173** sales. Write probe on one throwaway sale: every change (create, order draft, order authorised, void) advanced `Updated`; it always equalled `LastModifiedOn`; `UpdatedSince` (previous value plus 1 s) returned the sale each time | **Yes**, for the stages tested | Incremental refresh by `UpdatedSince` is safe on the main path. Not tested: pick, pack, ship, invoice, payment stage changes. Keep a periodic full reconcile anyway (see rollup drift below) |
| U2 | Does Claude Code survive multi-minute blocking calls? | Headless `claude -p`: blocking tool calls of 90 s, 240 s and **700 s (11.7 min)** all returned normally; 240 s with progress notifications (token delivered) also fine | **Yes** (headless) | Warm the cache on demand inside the tool call; send progress notifications anyway (cheap). Interactive Claude Code was not tested |
| U3 | Is in-memory enough? | First load of 173 sales takes 190 s, above the 60 s bar; every session starts a fresh server process | **No** | Persistent local cache (gitignored, allow-listed fields only) so a new session loads from disk and refreshes incrementally |
| U4 | Does full history scale? | 1.1 s per sale; the 10-minute bar is about **545 sales** | **No at production scale** (unknown); yes for this sandbox | Default to a time window; full history opt-in. Headers are cheap (1 call per 1,000 sales); only details cost |

### Scale table (measured 1.1 s per detail call, 654 B per sale cached)
| Sales | First load | Details transferred | Cache file |
|---|---|---|---|
| 173 (sandbox) | 3.2 min | 1.2 MB | 0.11 MB |
| 1,000 | 18 min | 6.8 MB | 0.65 MB |
| 10,000 | 3.1 h | 68 MB | 6.5 MB |
| 50,000 | 15.3 h | 340 MB | 33 MB |

Incremental refresh costs 1.1 s per changed sale plus one list call. Trimming scope cuts the first load: skipping voided sales and sales that were never invoiced removes about 17% here (29 of 173).

### Definitions fixed by the data
- **Revenue basis for SKU reports:** sum of **authorised or paid** invoice line `Total` minus authorised credit-note line `Total`, which is **tax-exclusive** (invoice `TotalBeforeTax` equals the line sum on 100 of 164 non-voided sales; the rest involve additional charges). Draft and voided documents must be excluded (14 draft invoices and 15 voided ones exist). Additional charges (38 invoiced sales) are not lines: report them separately.
- **Margin basis:** line `AverageCost` x `Quantity` (215 of 218 order lines have a cost). **Do not use `COGSAmount`**: it is non-zero on only 35 of 162 invoiced sales (zero on 114 where line cost exists) and matches line cost on 29 of those 35.
- **List money fields are unreliable as a revenue basis:** the list `InvoiceAmount` equals authorised invoices minus authorised credit notes (tax-inclusive) on only **115 of 164** non-voided sales. The 49 differences: 18 where authorised credit notes exist but the list says "no credit note" and `InvoiceAmount` is not reduced; 10 where `InvoiceAmount` is 0 despite an authorised invoice; 21 other (13 equal the paid amount, 8 unexplained). This looks like stale rollup data (the sandbox was probably seeded by editing documents after creation), but production is unknown.

### Sandbox side effects
The write probe left **one voided sale** (customer reference starting `SPIKE-THROWAWAY`) with one 1-unit order line. The sandbox sale list now has 174 rows; counts of non-voided sales are unchanged. Voiding was verified (status VOIDED, `Updated` advanced).

## Recommendation (design, for ADR 0005)
1. **Persistent snapshot cache**, one JSON file written atomically under a gitignored directory (contains business names and order lines, so never committed). SQLite is unnecessary until volume is far larger (JSON at 10k sales is about 6.5 MB).
2. **Allow-listed fields only**: header (id, order number, customer id and business name, type, status, dates, currency, channel, tax mode, `Updated`) plus authorised/paid invoice lines and authorised credit-note lines (sku, product id, name, quantity, price, discount, tax, total, average cost). No contacts, addresses or notes (reuse the allow-list approach of `src/shape.ts`).
3. **Refresh:** list headers with `UpdatedSince` = last sync; fetch details only for changed or new sales; voided sales are flagged, not deleted. Full reconcile on demand and about daily, because pick/pack/ship/invoice/payment bumps are untested and list rollups can drift.
4. **Default window** (for example sales from the last 90 days, tunable), full history opt-in, with the first-load estimate stated in the tool reply ("about N sales, about M minutes").
5. **Warm on demand** inside the tool call with progress notifications, plus a `cache_status` tool; tools state "data as of" and basis.
6. **Report definitions as above** (ex-tax invoice lines minus credit notes; margin from line cost) and state them in tool output.

## Follow-ups outside this spike
- **Existing tools:** `receivables_overdue` and `sales_summary` use list `InvoiceAmount`/`PaidAmount`, whose "net of credit notes" description is only partly true in the sandbox (above). Their descriptions should say "Cin7 list rollup" and the tools could offer a cache-backed document basis once the cache exists. The evaluation truth used the same list basis, so the arm comparison is unaffected, but the "net" label is approximate.
- **Rollup drift as a data-health check:** list vs detail disagreement (49 of 164) is itself a candidate `stock_health`-style tool.
- **Next evaluation question:** "revenue by SKU": the baseline must do the whole fan-out itself, so it is the strongest test of MCP value.
- **Unverified:** interactive Claude Code timeouts; stage changes for fulfilment, invoice and payment; behaviour above 60 calls/min; production data volume.
