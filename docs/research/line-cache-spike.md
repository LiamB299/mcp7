# Line-level cache spike

Status: **in progress.** The sections below up to "Pre-registered decision rules" were written and committed **before any measurement**, so the verdicts cannot be fitted to the data afterwards.

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
