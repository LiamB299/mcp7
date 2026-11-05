# Candidate map: complaint evidence → data signal → verdict

Source: [../research/sandbox-findings.md](../research/sandbox-findings.md) and [../research/user-complaints.md](../research/user-complaints.md). Sandbox signals show feasibility and cost, not how common the pain is.

```mermaid
flowchart LR
    subgraph Pain["Public complaint evidence"]
        C9["C9/E3 reporting and export limits"]
        C10["C10/E8 usability, complexity"]
        C4["C4/E2 stock drift, sync breakage"]
        E9["E9/E10 spreadsheets, forecasting"]
        C5["C5 Xero/QBO sync"]
    end

    subgraph Cand["Candidates"]
        K1["1 Reporting on demand"]
        K2["2 Stock / data health"]
        K3["3 Workflow assistant"]
        K4["4 Reorder suggestions"]
        K5["5 Accounting reconciliation"]
    end

    subgraph Data["Sandbox signal"]
        D1["No aggregate endpoints.<br/>Headers 185 KB; details 4-37 KB each.<br/>Valuation is 1 call"]
        D2["1 availability call.<br/>15 negative rows; 2 of 9 explained by backorders.<br/>Explaining the rest needs the line cache"]
        D3["Stage tree with TaskIDs.<br/>Status rollup trap (Advanced vs Simple)"]
        D4["13/100 thresholds set; 2 below, both on order.<br/>ReorderLevels list empty"]
        D5["No sync fields.<br/>Ledger is Cin7 side only"]
    end

    C9 --> K1
    C10 --> K1
    C10 --> K3
    C4 --> K2
    E9 --> K4
    E9 --> K2
    C5 --> K5

    K1 --> D1
    K2 --> D2
    K3 --> D3
    K4 --> D4
    K5 --> D5

    D1 --> V1(["Feasible, lead"])
    D2 --> V2(["Partial, pair with 1"])
    D3 --> V3(["Complex, writes untested, later"])
    D4 --> V4(["Weak alone, fold into 2"])
    D5 --> V5(["Refuted for now"])

    classDef good fill:#d4edda,stroke:#2e7d32,color:#000
    classDef mid fill:#fff3cd,stroke:#b58900,color:#000
    classDef bad fill:#f8d7da,stroke:#c62828,color:#000
    class V1,V2 good
    class V3,V4 mid
    class V5 bad
```
