# docs/ — project knowledge base

Collected information used during development of the Cin7 Core MCP server.

| Path | What | Status |
|---|---|---|
| [research/cin7-core-api.md](research/cin7-core-api.md) | Interpretation of the Cin7 Core API docs; §7 verified against the sandbox | done 2026-11-05 (from API Blueprint; unverified items marked inline) |
| [research/mcp-landscape.md](research/mcp-landscape.md) | MCP spec, SDKs, architectures, existing servers | done 2026-11-05 (agent-researched; spot-check key claims before relying) |
| [research/user-complaints.md](research/user-complaints.md) | ERP-wide and Cin7-specific user complaints, mapped to MCP fit | done 2026-11-05 (thin evidence, see caveats) |
| [research/sandbox-findings.md](research/sandbox-findings.md) | Sandbox investigation: five candidates cross-referenced, decision log, recommendation | done 2026-11-05 |
| [research/prioritisation.md](research/prioritisation.md) | Items ranked by value vs effort, dependency DAG, cut lines, sensitivity | done 2026-11-05 |
| [research/line-cache-spike.md](research/line-cache-spike.md) | Line-cache spike: pre-registered rules, measured cost, verdicts, definitions | done 2026-11-05 |
| [research/mvp-evaluation.md](research/mvp-evaluation.md) | A/B evaluation of the MVP vs Claude Code + Bash (numbers only) | done 2026-11-05 |
| [workflow-guide.md](workflow-guide.md) | How we work with Claude Code: loop, roles, conventions, lessons (living) | created 2026-11-05 |
| [design/](design/README.md) | Mermaid diagrams: candidate map, fan-out sequence, entities, tool architecture | 4 sketches |
| [adr/](adr/) | Architecture decision records | template, ADR 1 (ADRs), ADR 2 (TypeScript + SDK v2), ADR 3 (reports MVP), ADR 4 (PII-safe shaping, stage derivation), ADR 5 (line-level snapshot cache), ADR 6 (document-basis receivables and sales summary); incomplete ADRs end with a progress section |
| [handoff/](handoff/README.md) | Dated handoff documents: ADR summaries, codebase map, conversation ledger, open-work register | 2026-11-06 |
| [glossary.md](glossary.md) | Cin7 + MCP terminology | seeded |
| [justifications.md](justifications.md) | Lightweight "why we did X" log | started |

## Adding to it
- New decision of consequence → copy `adr/0000-template.md` to the next number.
- New term → `glossary.md` (alphabetical).
- Cite sources with URL + date fetched. Mark unverified claims `(unverified)`.

