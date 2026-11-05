# Tool architecture sketch (draft, pending the problem-selection ADR)

For the leading direction: a **read-only operations insight server** (candidates 1 + 2). Tool names are placeholders. The workflow assistant (candidate 3) would add a separate, confirmation-gated write module later.

```mermaid
flowchart TB
    Agent["MCP client (Claude)"] -->|stdio first| Server

    subgraph Server["cin7-core-mcp"]
        direction TB
        subgraph Tools["Outcome-oriented tools (read-only annotations)"]
            T1["receivables_overdue"]
            T2["sales_summary<br/>(period, channel, customer, SKU)"]
            T3["stock_position<br/>(valuation, by location)"]
            T4["stock_health<br/>(negatives, on-order-at-zero, below reorder, explanations)"]
            T5["open_orders_pipeline<br/>(stage from sub-statuses + Type)"]
            T6["order_lookup<br/>(shaped detail, PII dropped)"]
            T0["cin7_connection_check"]
        end

        subgraph Svc["Service layer"]
            Norm["Normaliser<br/>field-name drift, status vocabulary"]
            Shape["Response shaper<br/>token budget, PII mask, 'data as of'"]
            Agg["Aggregations<br/>local over cached rows"]
        end

        subgraph Data["Data plane"]
            Cache["Snapshot cache<br/>UpdatedSince incremental refresh"]
            Thr["Throttle + 429 backoff<br/>60 calls/min per key"]
        end

        Client["src/cin7/client.ts<br/>auth headers, error mapping"]

        Tools --> Svc
        Svc --> Cache
        Cache -->|miss or stale| Thr
        Thr --> Client
    end

    Client -->|HTTPS /ExternalApi/v2| Cin7[("Cin7 Core")]
    Cin7 -. "optional: webhooks (Automation add-on)" .-> Cache
```

## Principles carried from the research

- Outcome-oriented tools, few of them, each with a bounded response size ([mcp-landscape.md](../research/mcp-landscape.md) §3).
- Read-only by default; the Cin7 API key is unscoped, so safety is our responsibility, not the key's.
- Every answer states freshness ("data as of ...") because the cache is a snapshot.
- First-load can take minutes at 60/min: surface progress rather than blocking silently.
- PII never leaves the service layer unless a tool explicitly asks for it.
