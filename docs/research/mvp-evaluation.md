# MVP evaluation: does the MCP beat Claude Code + Bash + the key?

Run 2026-11-05. Protocol pre-registered in [`eval/README.md`](../../eval/README.md) and [`eval/questions.json`](../../eval/questions.json) before any run; decision in [ADR 0003](../adr/0003-read-only-reports-mvp.md). Numbers only: transcripts hold customer data and stay local (`eval/out/`, gitignored).

## Correction (2026-11-06): "correct" meant "agrees with the list rollup", not "agrees with the documents"

The line-cache spike ([line-cache-spike.md](line-cache-spike.md)) loaded every sale detail and showed that Cin7's list rollups (`InvoiceAmount`, `SaleInvoicesTotalAmount`) disagree with the invoice and credit-note documents on about 30% of sandbox sales. The ground truth for Q1-Q3 was computed from the same list rollup the tool reads, so it could not validate the tool. Recomputing on a **document basis** (authorised or paid invoices minus authorised credit notes, from the 173 details):

| Question | Tool (list `InvoiceAmount`) | Baseline (mostly list `SaleInvoicesTotalAmount`) | Document basis |
|---|---|---|---|
| Q1 overdue sales | 29 sales, 26,447 (both arms, all 4 runs) | same | **43 sales**, about 83,700 to 86,600 (two outstanding definitions) |
| Q2 API-channel revenue, Jul-Sep | 10,349 | 16,088 | **14,938** tax-inclusive net (14,195 ex-tax) |
| Q3 top customer's amount | 24,756 | 24,756 (run 1), 57,500 (run 2) | **54,625** tax-inclusive net |

What this changes:
- The two arms agreed with **different list rollups**. `SaleInvoicesTotalAmount` equals authorised invoice totals (gross of credit notes) on 142 of 164 sales, so the baseline's "invoiced revenue" answers were a defensible reading, not a trap. The earlier label "fell into the gross-vs-net trap" is retracted.
- On a document basis **neither arm matched on Q1**; on Q2 and Q3 the baseline's answers were **closer** to the documents than the tool's (Q2: baseline +7.7%, tool -30.7%; Q3 top customer: baseline run 2 +5.3%, tool -54.7%). The list rollup understates the largest customer's revenue.
- The headline "10/10 vs 8/10 correct" therefore measures agreement with a stated list-rollup definition. It does **not** show the tool is more accurate on revenue questions; on those it was less accurate in this sandbox.
- What still stands: speed (about 2.1 to 2.5x), answering the same way every time, the status-based and stock questions (Q6-Q10, whose truth used list statuses and availability, a weaker check than documents but not contradicted by the spike), and key isolation.
- Follow-ups: the tools now state their basis (this PR); the cache (ADR 0005) enables a document basis; the next evaluation question, "revenue by SKU", will use a document-basis truth built from sale details.

## Setup (recap)
- 6 questions (5 in scope, Q6 deliberately outside the MVP tools), 2 runs per question per arm = 24 headless Claude runs, sequential, same model (Sonnet), same permissions, run from an empty directory outside the repo.
- **Baseline:** Bash + `CIN7_*` environment variables + a pointer to the API docs. **Treatment:** the MCP only; the key is not in the environment (the server loads `.env` itself).
- Ground truth from an independent script; refreshed before and after the run, **no drift** (sandbox unchanged during the run).
- Spend: about $0.45 of notional cost across all 24 runs (about $0.02-0.06 per run).

## Results (in-scope questions Q1-Q5, 10 runs per arm)

| Measure | Baseline (Bash + key) | Treatment (MCP) | Ratio |
|---|---|---|---|
| Correct | **8 / 10** | **10 / 10** | |
| Used `SaleInvoicesTotalAmount` instead of `InvoiceAmount` (graded "alt-gross"; see correction above) | 2 (Q2 and Q3, one run each) | 0 | |
| Cost, total | $0.345 | $0.190 | 1.8x |
| Duration, total | 150 s | 61 s | 2.5x |
| Duration, per run | 15.0 s | 6.1 s | |
| Turns, total | 35 | 30 | 1.2x |
| Literal key string in transcript | 0 | 0 | |
| Key accessible to the model | yes (by design) | no | |
| Permission denials | 0 | 0 | |

Per question (grades per run; cost and duration averaged over 2 runs):

| Q | Baseline grades | Treatment grades | Baseline $ / s | Treatment $ / s |
|---|---|---|---|---|
| Q1 overdue receivables | correct, correct | correct, correct | 0.039 / 14.0 | 0.025 / 6.2 |
| Q2 revenue by channel | correct, alt-gross | correct, correct | 0.060 / 16.5 | 0.018 / 7.1 |
| Q3 top customers | correct, alt-gross | correct, correct | 0.036 / 17.5 | 0.019 / 5.6 |
| Q4 stock value | correct, correct | correct, correct | 0.021 / 8.2 | 0.016 / 6.0 |
| Q5 negative-stock products | correct, correct | correct, correct | 0.017 / 19.0 | 0.017 / 5.4 |
| Q6 (out of scope) | wrong*, matches reading 1 | declined, declined | 0.025 / 9.7 | 0.015 / 5.6 |

\* Q6 baseline run 1 answered 64 (ordered + invoiced-without-stock, excluding "receiving"), a defensible reading outside the three recorded ones (truth: 61 / 65 / 68 by reading); graded "wrong" by the strict grader, so Q6 is reported but excluded from the kill criterion, as pre-registered.

## Kill criterion
Pre-registered: *if the baseline is at least as correct and within about 1.5x of the treatment's cost and time on in-scope questions, report-tool value is unproven.*
**Not triggered.** The baseline was less correct (8/10 vs 10/10) and exceeded 1.5x on both cost (1.8x) and time (2.5x).

## What this supports, and what it does not
Supported (on this sample):
1. **Definitional consistency.** The baseline sometimes chose a different list rollup (`SaleInvoicesTotalAmount`) than the tool's `InvoiceAmount` (2 of 4 runs on Q2/Q3). The tool states and applies one definition every time. **Correction:** against invoice and credit-note documents the tool was not more accurate on the revenue questions (see above).
2. **Speed.** About 2.5x faster per question; the baseline writes and runs curl/aggregation code each time.
3. **Key isolation, structurally.** The treatment arm had no access to the key. The baseline never printed it (0 literal hits in both arms), so this is an exposure difference, not an observed leak.
4. **Repeatability.** The treatment answered identically across the 2 runs of every in-scope question; the baseline varied on 2 of 5.

Not supported / caveats:
- **Cost savings are cents.** About $0.015 per question. The cost ratio exists but is not material in absolute terms.
- **The baseline is good.** 8/10 correct with almost no guidance, and it handled the out-of-scope question by calling the API itself. The MCP adds reliability and speed on covered questions, not new capability.
- **Out-of-scope behaviour.** With no tool and no key, the treatment arm declined to guess (`count: null`) and asked for a purchase-order tool or credentials. That is honest, but it means a narrow MCP *reduces* flexibility versus Bash unless the key is also available. Tool coverage is the product.
- **Tool-search overhead.** Treatment runs used 2 tool calls each (a tool-discovery step, then the tool). Deferred tool loading adds a round trip; part of the efficiency work deferred by decision.
- **Bias and size.** The same author wrote tools and questions; n = 2 per cell, 20 in-scope runs total; one model; a small synthetic sandbox; the baseline was handed the header names and docs link (generous). Treat percentages as indicative, not statistical.
- Questions were concrete and answerable from the three tools. Open-ended exploration was not tested.

## Findings for the roadmap
- `sales_summary` requires `from` and `to`; for "all time" the model must choose a wide range. Make both optional (design improvement; the treatment handled it in this run).
- Highest-value next tools follow the prioritisation order: order lookup, open-orders pipeline, stock health (see [prioritisation](prioritisation.md)), since out-of-scope questions currently get no answer from the MCP arm.
- Consider keeping Bash + MCP together in real use: the MCP for covered, correct-by-definition answers, Bash as the escape hatch (with key exposure as the trade-off).

---

# Wave 2 evaluation (2026-11-06)

Same protocol and kill criterion; questions Q7-Q10 and Q6's move into scope were pre-registered in `eval/questions.json` before the first run. 30 headless runs (20 on the new questions at 2 runs per arm, plus Q1-Q5 once per arm as regression), about $0.74 notional. Sandbox truth refreshed before and after: **no drift**. The treatment arm now has 7 tools; the baseline is unchanged.

New in scope: **Q6** purchase orders awaiting receipt (was out of scope), **Q7** open sales not yet picked (the master-status trap: 85 sales say ORDERED, 52 are actually unpicked), **Q8** open sales packed but not shipped, **Q9** products at or below their reorder point, **Q10** the total and shipped state of one named order (an Advanced sale whose master status says ORDERED but has shipped; the order number is substituted at run time and never committed).

## Results

| Measure | Baseline | Treatment | Ratio |
|---|---|---|---|
| Correct, all 15 runs | 12 / 15 | **15 / 15** | |
| Correct, new questions (10 runs) | 8 / 10 | 10 / 10 | |
| Correct, Q1-Q5 regression (5 runs) | 4 / 5 | 5 / 5 | |
| Cost, all | $0.429 | $0.310 | 1.38x |
| Duration, all | 204 s | 97 s | 2.1x |
| Turns, all | 47 | 46 | 1.0x |
| New questions: cost / duration | $0.244 / 126 s | $0.191 / 64 s | 1.28x / 2.0x |
| Regression: cost / duration | $0.185 / 78 s | $0.119 / 32 s | 1.55x / 2.4x |
| Literal key string in transcript | 0 | 0 | |

| Q | Baseline grades | Treatment grades |
|---|---|---|
| Q1 | correct | correct |
| Q2 | alt-gross (used `SaleInvoicesTotalAmount`; see correction) | correct (list rollup) |
| Q3, Q4, Q5 | correct | correct |
| Q6 awaiting receipt | wrong, wrong (both answered 60) | correct, correct |
| Q7 unpicked open sales | correct, correct | correct, correct |
| Q8 packed not shipped | correct, correct | correct, correct |
| Q9 at or below reorder point | correct, correct | correct, correct |
| Q10 order total and shipped | correct, correct | correct, correct |

## Reading the result honestly

- **Kill criterion not triggered.** The baseline was less correct (12/15 vs 15/15). On this wave the cost ratio (1.38x) is *below* the 1.5x line, so cost no longer separates the arms; correctness and speed (2.1x) carry the case.
- **Q6 is a definition ambiguity, not a hard error.** Both baseline runs counted status ORDERED only (60) and said so; the pre-registered primary reading is ORDERED, RECEIVING or INVOICED with goods not fully received (65). 60 was not among the three recorded readings, so the strict grade is "wrong". Counting it as an accepted reading makes the baseline 14/15. The treatment's advantage here is a stated, consistent definition, not superior reasoning.
- **The stage normaliser's headline trap did not separate the arms.** Q7 (master status ORDERED vs sub-statuses) and Q10 (shipped despite ORDERED) were answered correctly by the baseline in all four runs: Sonnet reads the sub-statuses when the question says "picked" or "shipped". The only baseline miss against the list-rollup definitions was the choice of rollup on Q2 (see the correction above). The normaliser is verified against independent truth (52 / 31 / 65 exact) and still removes a real hazard for broader questions, but this evaluation does not demonstrate its value on its own.
- **Personal-data protection is not measured by this eval.** The questions needed only totals and shipped state. It is verified by unit tests (no email, phone, address, contact or note text leaves `maskSale`) and by the live gate (no such keys in `order_lookup` output).
- Treatment runs always show 2 tool calls (a tool-discovery step, then the tool); one run (Q5) used 4 turns because it called two tools.
- Same caveats as before: same author for tools and questions, n of 1-2 per cell, one model, small synthetic sandbox, generous baseline context.
- Spend per run stays at a few cents; cost is not a reason for or against the MCP at this scale.

---

# Wave 3 evaluation (2026-11-06): revenue by SKU on a document basis

Q11 ("Which 3 SKUs have the highest invoiced revenue excluding tax, and how much did each bring in? Ignore voided sales.") was pre-registered in `eval/questions.json` with three alternative readings (draft invoices included; credit notes ignored; tax-inclusive) before any run. This is the first question whose truth is **document-based** (see the correction above): `eval/truth-sku.mjs` fetched all 164 non-voided sale details independently of `src/` (165 paced calls) and computed authorised or paid invoice lines minus authorised credit-note lines, ex-tax (line `Total` minus line `Tax` on tax-inclusive sales). All three alternative readings produce a different top 3, so the question discriminates. The sandbox fingerprint (174 sales, latest `Updated`, sum of list invoice amounts) was identical before and after the runs.

Four runs, sequential, same protocol: baseline twice; treatment with a fresh cache directory on run 1 (**cold**) and the same directory on run 2 (**warm**). About $0.16 notional.

| Arm | Grade | Duration | Cost | Turns |
|---|---|---|---|---|
| Baseline run 1 | wrong | 380 s | $0.070 | 7 |
| Baseline run 2 | wrong | 299 s | $0.036 | 4 |
| Treatment, cold cache | **correct** (exact top 3) | 169 s | $0.033 | 3 |
| Treatment, warm cache | **correct** (exact top 3) | 7 s | $0.019 | 3 |

- **Kill criterion not triggered:** the baseline was less correct and slower (1.8x to 2.2x slower than the cold treatment run, about 43x to 54x slower than the warm one) and no cheaper.
- **Why the baseline was wrong:** it gave the same top 3 both times, which matches none of the registered readings and omits the largest SKU (document-basis revenue about 47,500). Its own caveats say it summed invoice line totals for every non-voided sale with an invoice, assumed line totals exclude tax without checking, and did not net credit notes. In this sandbox 67 of 173 sales are tax-inclusive (line totals include tax) and 24 authorised credit notes exist. The cause of the missing top SKU was not investigated.
- **What the cache bought:** the first load (about 160 s here, 1.1 s per invoiced sale) is paid once; later questions take seconds. At production scale the first load grows linearly (about 18 min per 1,000 sales), which is why the default is a time window.
- **Caveats:** two runs per cell; the same author wrote tools, question and truth; the baseline might do better with explicit definitions or more effort; the sandbox is small and synthetic; the warm figure assumes the cache directory persists between sessions.
- **Consistency with the correction above:** on this document-basis question the cache-backed tool is correct, while the older list-rollup tools (`receivables_overdue`, `sales_summary`) understate on the revenue questions. Moving them onto the cache's document basis is the next follow-up.
