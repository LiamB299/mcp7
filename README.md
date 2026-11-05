# cin7-core-mcp

A read-only [MCP](https://modelcontextprotocol.io) server that lets Claude Code answer business reporting questions about a [Cin7 Core](https://www.cin7.com/) (formerly DEAR Inventory) account: overdue receivables, sales summaries, stock value. Status: **MVP, sandbox only**.

## The problem

Cin7 Core's REST API is a record store, not a reporting API. Getting an answer out of it is harder than it looks:

- **No aggregate or reporting endpoints.** Totals, margins, valuation and "what is overdue" must be computed client-side.
- **List endpoints return headers only.** Line-level questions need one detail call per record, under a limit of **60 calls/min per key** (173 sales is about 3 minutes; larger accounts far more).
- **Definition traps** that give plausible but wrong numbers: `InvoiceAmount` is *net of credit notes*, `StockOnHand` is a *value* not a unit count, paging defaults to 100 rows, Advanced and Simple sales roll their statuses up differently, "today" depends on the tenant time zone.
- **Reporting limits are a recurring ERP complaint** (see [`docs/research/user-complaints.md`](docs/research/user-complaints.md)).

A capable Claude Code session can already call the API with Bash and the key, but it re-derives these rules each time, sometimes gets them wrong, and needs the API key in its environment.

## Proposed solution

Outcome-oriented tools, not an endpoint wrapper. Each tool answers a business question with a small aggregate, bakes in the correct definitions (stated in the tool description and in every result), paces and retries requests against the rate limit, and keeps the API key out of the model's context.

```mermaid
flowchart LR
    CC["Claude Code"] -->|"stdio (MCP)"| S
    subgraph S["cin7-core-mcp"]
        T["Report tools<br/>receivables_overdue, sales_summary,<br/>stock_position, connection_check"]
        H["list helper<br/>follows Total, all pages"]
        C["client<br/>serial pacing, 429/503 retry"]
        T --> H --> C
    end
    C -->|"HTTPS /ExternalApi/v2"| E[("Cin7 Core")]
    ENV[".env (key stays server-side)"] -.-> C
```

### Does it actually help? (evaluation, 2026-11-05)

A/B test: Claude Code + Bash + the key (baseline) vs the same with this MCP, 5 in-scope questions, 2 runs each, answers graded against an independent ground-truth script.

| | Baseline | MCP |
|---|---|---|
| Correct | 8 / 10 | **10 / 10** |
| Cost | 1.8x | 1x |
| Time | 2.5x | 1x |
| API key reachable by the model | yes | no |

The baseline's misses were the gross-vs-net invoice trap. Savings are small in absolute terms (about a cent and a few seconds per question), the sample is small, and the same author wrote tools and questions. A narrow MCP also cannot answer questions outside its tools (the MCP arm declined an out-of-scope purchase-order question; the baseline queried the API). Full numbers and caveats: [`docs/research/mvp-evaluation.md`](docs/research/mvp-evaluation.md), decision in [ADR 0003](docs/adr/0003-read-only-reports-mvp.md).

## Tools (all read-only)

| Tool | Inputs | Answers |
|---|---|---|
| `cin7_connection_check` | none | Credentials work; company, currency, time zone |
| `receivables_overdue` | `asOf?` (yyyy-MM-dd, default today in tenant zone), `topN?` | Outstanding and overdue invoice balances, age buckets (1-30, 31-60, 61-90, 90+), largest overdue balances |
| `sales_summary` | `from`, `to`, `groupBy` (`month` / `channel` / `customer`), `topN?` | Invoiced revenue and sale counts over a date range, net of credit notes, voided sales excluded |
| `stock_position` | `location?`, `topN?` | Stock value and units by location, top products by value, count of negative-available stock |

Not built yet (prioritised in [`docs/research/prioritisation.md`](docs/research/prioritisation.md)): order lookup, open-orders pipeline, stock-health explanations, a line-level cache for SKU and margin reports, and any write operations.

## Tech

- **TypeScript** on Node 22+, ESM; official **MCP SDK v2** (`@modelcontextprotocol/server`), **Zod v4** schemas for tool input and output ([ADR 0002](docs/adr/0002-typescript-mcp-sdk-v2.md)).
- **stdio** transport (local Claude Code); native `fetch` for Cin7; no database or cache yet.
- Tooling: vitest (unit tests with synthetic fixtures), Biome (lint and format), `tsc`, npm.
- Implementation of individual tools is delegated to Haiku agents and reviewed (see `CLAUDE.md`).

## Setup

```bash
npm install
cp .env.example .env    # CIN7_ACCOUNT_ID, CIN7_APPLICATION_KEY, CIN7_BASE_URL (API root, no /v2)
npm run build
npm test                # typecheck, lint: npm run typecheck && npm run lint
```

The server loads the repo-root `.env` itself (path resolved from the script, so the launch directory does not matter) and appends `/v2` to `CIN7_BASE_URL`.

### Use with Claude Code
`.mcp.json` registers the server for this repo. Project-scoped servers need a one-time approval: run `claude` in the repo and accept it (check with `claude mcp list`). For other clients:

```json
{
  "mcpServers": {
    "cin7-core": { "command": "node", "args": ["/absolute/path/to/mcp7/dist/index.js"] }
  }
}
```
Debug with `npm run inspect`. Re-run the evaluation after changing tools: see [`eval/README.md`](eval/README.md) (about 24 headless Claude runs; real API spend).

## Limitations

- **Sandbox only.** Built and tested against a Cin7 sandbox, which is small and synthetic. Production scale is untested.
- **No PII masking and no response-size budgets yet.** Tool outputs can include customer names. Deliberately deferred until the MVP was proven.
- **No cache.** Each call re-reads the lists (about 2-4 paced calls per tool today).
- **Read-only.** Nothing writes to Cin7.
- **Rate limit.** Requests are serialised at about 1 per 1.1 s; the key is shared with anyone else using it.

## Docs

[`docs/README.md`](docs/README.md) indexes the research (Cin7 API reference, MCP landscape, user complaints, sandbox findings, prioritisation, evaluation), design sketches (mermaid), ADRs and glossary. [`CLAUDE.md`](CLAUDE.md) holds working conventions.

Licensed under Apache-2.0.
