# Fan-out sequence: line-level report under the 60 calls/min cap

Why a cache matters for the lead candidate (reporting + stock health). Numbers are from the sandbox (173 sales); production may be larger.

## Without a cache: every question repeats the fan-out

```mermaid
sequenceDiagram
    autonumber
    participant U as User / agent
    participant M as MCP tool
    participant T as Throttle (60/min)
    participant C as Cin7 API

    U->>M: "Top SKUs by revenue this quarter"
    M->>T: saleList?UpdatedSince=...&Limit=100 (2 pages)
    T->>C: GET saleList (page 1, page 2)
    C-->>M: 173 headers, no lines (~185 KB)
    loop each sale in range (up to 173)
        M->>T: sale?ID=...
        T->>C: GET sale detail (4-37 KB each)
        C-->>M: full tree incl. PII and repeated lines
    end
    Note over T,C: 173 calls at 60/min is about 3 minutes minimum
    M-->>U: shaped summary (top-N table, no PII)
    U->>M: "and by customer?"
    Note over M,C: same ~173 calls again
```

## With a snapshot cache: pay once, refresh incrementally

```mermaid
sequenceDiagram
    autonumber
    participant U as User / agent
    participant M as MCP tool
    participant S as Snapshot cache
    participant T as Throttle (60/min)
    participant C as Cin7 API

    U->>M: "Top SKUs by revenue this quarter"
    M->>S: have sales + lines up to date?
    alt cold or stale
        S->>T: saleList filtered by UpdatedSince (time of last refresh)
        T->>C: GET (1-2 calls)
        C-->>S: changed headers only
        loop only changed sales
            S->>T: sale?ID=...
            T->>C: GET detail
            C-->>S: detail (shaped and stored, PII dropped)
        end
    end
    S-->>M: computed aggregate from local rows
    M-->>U: shaped summary + "data as of <timestamp>"
    U->>M: "and by customer?"
    M->>S: answered locally (0 Cin7 calls)
```

Open design questions: cache location (memory vs local file/SQLite), freshness policy (TTL vs `UpdatedSince` only vs webhooks, which need the Automation add-on), and a "refresh in progress" response for the first load (MCP tasks or progress notifications).
