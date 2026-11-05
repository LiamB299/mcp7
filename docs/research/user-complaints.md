# User complaints: ERP in general, and Cin7 specifically

Researched 2026-11-05 by two web-research agents. **Evidence is thin and indicative, not statistical.** Read the caveats before using this to pick a problem.

## 1. Method and caveats

- Reached via WebSearch snippets and some WebFetch (Shopify app-store reviews, Cin7 status/help pages, vendor and consultant blogs). **Capterra, Software Advice and G2 page fetches were blocked (403)**; they were seen only as search summaries. **Reddit, community.cin7.com and GitHub issues were not reached**, so their absence here means "not searched successfully", not "no complaints".
- Many sources are **competitor or vendor blogs** (sku.io, Unleashed, Fishbowl, Acumatica, supergood.ai, Cin7's own blog). They are biased and marked *[biased]*.
- Frequency labels (very common / common / occasional) are the researchers' judgement from recurrence, not counts, unless a number is cited.
- Review sites are self-selected. Aggregate Cin7 Core ratings are actually high (Capterra about 4.3 from about 735 reviews; Trustpilot about 4.5 from 220; seen via search summaries, unverified).
- Product mixing: the Shopify "Core" page hosts older DEAR-era reviews, and Trustpilot mixes Core and Omni. **Cin7 Omni** (the other Cin7 product) is rated much worse on Shopify (about 1.8 from 26 reviews, aggregator figure, unverified). Our API target is **Core**.

## 2. Complaints about ERP systems in general (SMB / mid-market inventory & OMS)

| # | Theme | Frequency / evidence | Severity | Example (paraphrased) | Sources |
|---|---|---|---|---|---|
| E1 | Support quality, slow bug fixes | Very common. Capterra's own analysis of about 1,000 ERP reviews found support the most-discussed topic (about 23%) with low satisfaction (not independently verified) | High | Persistent bugs, long resolution times, no real answers | capterra.com/resources/erp-selection-guide/ ; capterra.com/p/133038/Cin7-Core/reviews/ |
| E2 | Inventory sync distrust / integration breakage (ecommerce, marketplaces, accounting) | Common. Katana G2: integration problems and manual entry in 11 reviews. Cin7 claims mostly from competitors *[biased]* | High (oversells, wrong counts) | Stock numbers live in three places and disagree, so users leave | sku.io/cin7-alternative/ *[biased]* ; unleashedsoftware.com/blog/cin7-reviews/ *[biased]* ; g2.com/products/katana-cloud-inventory/reviews |
| E3 | Reporting and analytics limits | Common, recurring across NetSuite, Zoho, Fishbowl, Shopify-app reviews | Medium-high | Capable but not enough for analytics-heavy teams; basics like landed cost by item missing. Fishbowl's real-time data sub-score is its lowest (3.0) | prospeo.io/s/oracle-netsuite-pricing-reviews-pros-and-cons ; capterra.com/p/146241/Zoho-Inventory/reviews/ (many reviews 2019) ; capterra.com/compare/123794-172888/Fishbowl-vs-Katana-MRP |
| E4 | Pricing, renewal uplifts, hidden costs | Very common for NetSuite, common elsewhere | High | Renewals reportedly +5-16%/yr; sandbox and implementation extra; paying for unused modules. A 30-50% uplift claim is competitor-sourced and uncorroborated | costbench.com/software/erp/netsuite/hidden-costs/ ; cin7.com/blog/challenges-of-erp-software *[biased]* |
| E5 | Implementation cost, time, overruns | Very common. Verified older Panorama data (2013): 53% over budget, 61% late, 60% got half or less of expected benefits. A 2025 "73% miss objectives" figure is secondary and unverified | High | A 5-week script taking 5 months after scope became "custom" (Reddit-sourced anecdote) | supplychain247.com (2013) ; concorderp.blogspot.com/2026/04/why-erp-implementations-fail-statistics.html (secondary, unverified) |
| E6 | Customisation rigidity, consultant dependence | Common | Medium-high | Powerful customisation costs consultant hours (rates vendor-sourced, unverified); limited template editing in Zoho; limited customisation in 6 Katana G2 reviews | unanswered.io/guide/netsuite-disadvantages *[biased]* ; g2.com/products/katana-cloud-inventory/reviews |
| E7 | Functional ceiling as business grows | Common (Katana: limited functionality in 25 G2 reviews; Brightpearl: missing features top con) | Medium | Too much product / too pricey, or too basic | g2.com/compare/brightpearl-vs-cin7-core-vs-zoho-inventory |
| E8 | Usability, learning curve, configuration burden | Common | Medium | NetSuite needs heavy training for reporting; Odoo hard to configure; Capterra ease-of-use sentiment 4.11/5, lowest topic | capterra.com/p/124180/Brightpearl/reviews/ ; g2.com/compare/odoo-inventory-vs-zoho-inventory |
| E9 | Spreadsheet workarounds, low trust in system data | Common but weak, mostly opinion and vendor surveys | Medium | Users revert to Excel when the ERP is slower or less trusted | swiftly-business-consulting.com/insights/erp-user-adoption-excel/ ; mrpeasy.com/blog/erp-statistics-manufacturing/ *[biased]* |
| E10 | Forecasting / replenishment gaps | Occasional (one Katana reviewer) | Medium | Asked for forecasting and future production planning | spotsaas.com/product/katana-manufacturing-erp/reviews |
| E11 | Session/UX friction, plan limits | Occasional anecdotes | Low-medium | Brightpearl timeouts; Zoho monthly order limits | capterra.ie/reviews/124180/brightpearl |

**Not found:** performance/slowness, bulk import/operations, multi-warehouse complexity and AI/automation gaps. No Gartner/Forrester/Deloitte 2024-26 surveys were reached.

## 3. Complaints about Cin7 specifically

Product column: **Core** (our target, ex-DEAR), **Omni**, or both.

| # | Theme | Product | Frequency | Severity | Recency | Example (paraphrased) | Sources |
|---|---|---|---|---|---|---|---|
| C1 | Support responsiveness | Both | Very common, recurs on every site | High | Ongoing; DEAR-era reviews say the same (2019-2021) | Slow tickets, no phone line, hard to escalate. A Feb 2026 Core review says $149/month premium support took months. Counterpoint: some reviews praise named staff | apps.shopify.com/dear-inventory/reviews ; apps.shopify.com/cin7-connected-inventory-v2/reviews |
| C2 | Pricing and increases | Core | Very common | High | Post-rebrand, ongoing. Trustpilot Dec 2025 cites over 200% rise in 5 years; Oct 2023 rises reported at 12% and 13.5%; Capterra Nov 2024 "non-stop" hikes | Price creep; quoted price not the real price (Aug 2025); features added that nobody uses | se.trustpilot.com/review/dearsystems.com (search summary) ; apps.shopify.com/dear-inventory/reviews |
| C3 | Cancellation friction | Core | Occasional (2 reviews + vendor reply) | Medium | Feb 2025, Jan 2026 | Needs an exit call and 30 days' notice. Cin7 replied it is not meant as friction | apps.shopify.com/dear-inventory/reviews |
| C4 | Shopify sync and stock drift | Both (Omni worst) | Common | High | Core Feb 2026; Omni Jan 2026, May 2024, 2022 | Core: connection shows "connected" but stock stops updating, orders arrive blank, Shopify order edits do not push (2020). Omni: price updates deleted variants; orders map to a channel not a location. sku.io says this is the top reason people leave *[biased, unverified]* | apps.shopify.com/dear-inventory/reviews ; apps.shopify.com/cin7-connected-inventory-v2/reviews |
| C5 | Accounting sync (Xero/QBO) | Core (Omni too) | Common (vendor FAQ and a status incident, not a mass of reviews) | High (financial) | Jun-Jul 2025 incident of about 6 days with slow or failing Core-to-QBO/Xero sync | Documents edited after sync error out; Xero payments do not sync back; mass remapping can lock the org for hours. 2021: unreliable sales-tax matching | status.cin7.com/cmcdwq0tz00vpnxmhtjnmjbpn ; help.core.cin7.com (Xero Integration FAQs) ; growthpath.com.au/insights/207-... |
| C6 | Other integrations (HubSpot, ShipStation, Etsy, HS codes) | Both | Occasional | Medium | Mostly 2021-2023; Omni Oct 2023 "updates randomly disrupt connections" | Promised HubSpot fix delayed (Dec 2021); HS codes cannot sync (Feb 2023) | apps.shopify.com/dear-inventory/reviews ; community.hubspot.com/t/cin7-core-integration-issues/145250 (title only) |
| C7 | API limits and gaps | Core | Occasional, technical sources only, **no user-voiced complaint found** | Medium for integrators | Oct-Nov 2026, vendor-written *[biased]* | 60 calls/min per application; V2 returns 429 while V1 returns 503; keys are unscoped (full account access); API is a paid add-on; V1 and V2 coexist. **Sources disagree** on limits (supergood: per-second/day unpublished; Coupler: varies by plan) | sku.io/cin7-api-vs-sku-io/ *[biased]* ; supergood.ai/api-report-card/dear-systems-cin7-core *[biased: sells an unofficial API layer]* |
| C8 | Webhooks gated behind paid Automation add-on | Core | Single source | Medium | 2026 | No user complaint found. Our API research also found this in the docs. supergood notes no official Cin7 MCP server exists (Aug 2026) | supergood.ai ; `docs/research/cin7-core-api.md` §2.8 |
| C9 | Reporting/analytics and export controls | Core | Occasional | Medium | Date unknown | G2 snippet lists "limited reporting" (2 reviewers); custom-reporting score 8.0 (20 reviews); Capterra notes limited export controls | g2.com/compare/cin7-core |
| C10 | UI speed, complexity, labour | Both | Common | Medium | Mixed, partly undated | Slow page loads (Core, Capterra); Omni May 2024: too many clicks, needs a full-time data person; DEAR-era 2023: "overly complicated" | apps.shopify.com/cin7-connected-inventory-v2/reviews |
| C11 | Manufacturing / BOM limits | Core | Occasional | Medium | Feb 2026 | BOM stock does not work for assembled products; the workaround breaks WMS functions. G2 BOM score 7.8 (21 reviews) | apps.shopify.com/dear-inventory/reviews |
| C12 | Multi-location and plan gating | Core | Occasional, low confidence | Low-medium | Unknown | Standard plan reportedly one warehouse; multi-site WMS needs Pro/Advanced (unverified) | Capterra (search summary) |
| C13 | Implementation cost and partner dependence | Omni mainly | Common among negative reviews | High | Nov 2024, 2022-2023 | A required implementer failed to deliver, reviewer reports tens of thousands lost (Nov 2024); about $4,000 over 8 months (Feb 2023) | apps.shopify.com/cin7-connected-inventory-v2/reviews |
| C14 | Barcode/scanner compatibility | Omni | Single report | Medium | Feb 2023 | Recommended scanners (about $2,000) incompatible | same as C13 |

**No evidence found** (absence of evidence, not evidence of absence): purchasing/replenishment/forecasting (Capterra says forecasting setup takes extra time), B2B portal, permissions/audit, duplicates/data cleanup, bulk import/export, EDI/3PL.

**Recurring positives** (so we do not solve a non-problem): high aggregate ratings; multi-location tracking valued; some reviews praise named support staff (Capterra Sept 2025: "Cin7 customer support 5 stars"); an integration problem was resolved by the team (Feb 2026).

## 4. Cross-reference: which complaints could an MCP / agent layer touch?

Flags only. This is not a decision. API references are to `docs/research/cin7-core-api.md`.

| Complaint | MCP-addressable? | Why / relevant API facts |
|---|---|---|
| C1 support, C2 pricing, C3 cancellation, C13 implementation cost | **No** | Vendor/commercial issues. (An MCP could lower reliance on paid consultants for reporting, speculative.) |
| C4 Shopify stock drift, E2 integration breakage | **Partly: detection, not repair** | Core exposes `/ref/productavailability` (OnHand, Allocated, Available, OnOrder, InTransit) and `Stock/AvailableStockLevelChanged` webhooks (Automation add-on). An agent could compare Cin7 stock with the other system's, if it can reach it. Cin7 is only one side of the sync. |
| C5 Xero/QBO sync | **Partly: visibility** | Sale/purchase lists and `/transactions` could be reconciled against accounting exports. Docs mention `LockDate` in `/me`. No API visibility into sync status or errors was found (verify). |
| C9 / E3 reporting gaps | **Yes, strong fit** | API has **no aggregate/reporting endpoints** (§4). Lists are header-only, so reports need list + detail fan-out under 60 calls/min. An agent layer with caching, throttling and summarised output could answer "revenue by customer", "margin", "overdue invoices", "stock valuation", "what is on order". |
| C10 / E8 usability, learning curve | **Yes** | Natural-language access to multi-step workflows (sale stage chain is 5-8 calls with SaleID vs TaskID, name-based foreign keys, 16 sale statuses). |
| C7 API limits, no scoped keys | **Constraint, not a fix** | Must throttle to 60/min, handle 429 backoff, and be careful because keys are unscoped, so read-only mode is our own responsibility. |
| C8 webhooks gated | **Constraint** | Cache invalidation via webhooks needs the add-on and a public URL, awkward for a local server. |
| C11 BOM/manufacturing, C12 multi-location | **Unclear** | Needs sandbox exploration (production module endpoints exist). |
| E9 spreadsheet workarounds / E10 forecasting | **Possible** | Reorder levels and availability exist; there is no reorder or forecast report endpoint. |

## 5. Candidate problem areas (unranked, for the brainstorm)

1. **Reporting and answers on demand**: read-only analytics tools (sales, margin, stock position, open orders, overdue invoices) built on cached, throttled, summarised list+detail calls. Maps to C9/E3, the strongest API-gap match.
2. **Stock discrepancy and data-health checks**: surface negative or odd availability, stuck stages, backorders, drift between expected and actual (C4/E2, E9). Cin7 side only unless we get access to the other systems.
3. **Workflow assistant for multi-step operations**: "advance sale to stage X", "receive this PO", guided by stage-gating rules and reference-data validation, with confirmation for writes (C10/E8).
4. **Replenishment / reorder suggestions** from availability, sales velocity and reorder levels (E10, E9).
5. **Reconciliation helper for accounting sync** (C5): compare Cin7 documents with the accounting side for edits after sync. Needs Cin7 data plus accounting data and is more speculative.

## 6. Open questions / follow-ups

- Read G2 "dislikes" panels, Reddit via `site:` searches, community.cin7.com and GitHub issues directly (not reached this round).
- Verify against official Cin7 docs: rate limits (per-second, per-day), V1 vs V2 status codes, API add-on cost, webhook gating.
- Ask the user which of these pains they actually see internally; this research is public and generic.
