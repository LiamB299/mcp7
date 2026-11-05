# MVP evaluation: does the MCP beat Claude Code + Bash + the key?

Run 2026-11-05. Protocol pre-registered in [`eval/README.md`](../../eval/README.md) and [`eval/questions.json`](../../eval/questions.json) before any run; decision in [ADR 0003](../adr/0003-read-only-reports-mvp.md). Numbers only: transcripts hold customer data and stay local (`eval/out/`, gitignored).

## Setup (recap)
- 6 questions (5 in scope, Q6 deliberately outside the MVP tools), 2 runs per question per arm = 24 headless Claude runs, sequential, same model (Sonnet), same permissions, run from an empty directory outside the repo.
- **Baseline:** Bash + `CIN7_*` environment variables + a pointer to the API docs. **Treatment:** the MCP only; the key is not in the environment (the server loads `.env` itself).
- Ground truth from an independent script; refreshed before and after the run, **no drift** (sandbox unchanged during the run).
- Spend: about $0.45 of notional cost across all 24 runs (about $0.02-0.06 per run).

## Results (in-scope questions Q1-Q5, 10 runs per arm)

| Measure | Baseline (Bash + key) | Treatment (MCP) | Ratio |
|---|---|---|---|
| Correct | **8 / 10** | **10 / 10** | |
| Fell into the gross-vs-net invoice trap | 2 (Q2 and Q3, one run each) | 0 | |
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
1. **Correctness.** The baseline sometimes read gross invoices instead of net-of-credit-note amounts (2 of 4 runs on Q2/Q3, though it avoided the trap on Q1). The tools encode the definition, so the treatment never differed.
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
