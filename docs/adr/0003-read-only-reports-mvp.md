# ADR 0003: Read-only reports MVP for Claude Code (sandbox)

- **Status:** accepted, provisional (the pre-registered kill criterion was not triggered; see [mvp-evaluation.md](../research/mvp-evaluation.md); final acceptance on merge). The list-rollup basis of `receivables_overdue` and `sales_summary` is amended by [ADR 0006](0006-document-basis-reports.md).
- **Date:** 2026-11-05

## Context
Research ([prioritisation](../research/prioritisation.md), [sandbox findings](../research/sandbox-findings.md)) shows the most visible value ships without a cache: three read tools answer from sale headers or availability. The user wants the shortest viable MVP, scoped to a Claude Code MCP against the sandbox, with efficiency and PII work deferred until the MVP is proven.

The honest counterfactual is not "no tool": a fresh Claude Code can already call the Cin7 REST API with Bash and the key. The MCP is only worth building if it beats that.

## Decision
Build three read-only tools plus the connection check: `receivables_overdue`, `sales_summary` (by month, channel or customer), `stock_position` (valuation by location). Each returns aggregates or top-N, states its definitions in the tool description and output, and never writes to Cin7. Supporting infrastructure is limited to what makes them viable: serial request pacing with 429/503 retry, a list helper that follows `Total`, and tenant-timezone date handling.

Deferred on purpose: PII masking, response-size budgets, the snapshot cache, the status normaliser, order lookup, stock-health explanations, workflow writes.

## Why this should add value over Claude Code + Bash (testable claims)
1. **Correctness.** The tools encode traps a naive script falls into (measured on the sandbox):
   - pagination (173 sales, default `Limit` 100);
   - two different list rollups exist: `InvoiceAmount` (documented as net of credit notes) and `SaleInvoicesTotalAmount` (gross invoices); choosing one gives 29 overdue sales or 39, and API-channel revenue of 10,349 or 16,088. **Correction (2026-11-06):** neither equals the invoice and credit-note documents, which give 43 overdue sales and 14,938 (tax-inclusive net) for the API channel; the "trap" measured agreement with the list rollup definition, not document-level truth;
   - `StockOnHand` is a value, not units (misreading it yields 14,808 instead of 2,080,604);
   - tenant timezone for "today".
2. **Cost.** One tool call instead of discovering endpoints, writing paging code and aggregating: fewer turns, tokens and seconds.
3. **Key isolation.** The baseline must put the API key in the shell environment, so it can appear in the transcript. The MCP loads it from `.env` itself and never exposes it to the model.
4. **Repeatability.** The same question yields the same definition every time.

## How it will be judged
Pre-registered in `eval/questions.json` and `eval/README.md`: six questions (one deliberately out of scope), baseline vs treatment arms, two runs each, ground truth from an independent script. **Kill criterion:** if the baseline is at least as correct and within about 1.5x of the MCP's cost and time, the value of report tools is unproven and this ADR is rejected or revised.

## Consequences
- If accepted: grow along the prioritisation order (order lookup, pipeline, stock health, then the line cache).
- If rejected: the evidence points to the workflow assistant (writes) or to a different shape of server.
- Bias: the same author wrote the tools and the questions, and the sample is small. The evaluation reports that plainly.
- Tool outputs currently include customer names and are not size-budgeted; acceptable for a sandbox-only Claude Code server, to be revisited before anything wider.

## Evaluation result (2026-11-05)
In-scope questions: MCP 10/10 correct vs baseline 8/10; baseline cost 1.8x and time 2.5x the MCP's. Kill criterion not triggered. Absolute savings are small (cents, seconds); the clearest advantage is agreement with a stated definition on definition traps and speed. Out-of-scope questions get no answer from a narrow MCP, so tool coverage matters. Details and caveats in [mvp-evaluation.md](../research/mvp-evaluation.md).

<!-- retire-chat:progress:start -->
## Progress and where to continue (as of 2026-11-06)

Built, evaluated in three waves, and corrected in #15: the original "correct" grade meant agreement with Cin7 list rollups, not with the invoice and credit-note documents (Q1: 43 overdue sales on documents versus 29 from the rollup; Q2 API channel 14,938 versus 10,349 or 16,088; Q3 top customer 54,625 versus 24,756). Resolved by [ADR 0006](0006-document-basis-reports.md): both tools now read the cache documents and carry the list-rollup figure as a labelled alternative (live gate reproduced the old 29 / 26,447, 10,349 and 24,756 exactly and gave 43 overdue sales, 14,938 inc-tax API revenue and 54,625 for the top customer). Still open: re-run the evaluation against `eval/truth-docs.mjs` (not yet run; paid runs: ask first), then finalise acceptance or amend the ADR.

Full context, the ledger of what was asked and the open-work register: `docs/handoff/2026-11-06-cin7-mcp-roadmap.md`.
<!-- retire-chat:progress:end -->
