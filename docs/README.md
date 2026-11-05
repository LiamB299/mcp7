# docs/ — project knowledge base

Collected information used during development of the Cin7 Core MCP server.

| Path | What | Status |
|---|---|---|
| [research/cin7-core-api.md](research/cin7-core-api.md) | Interpretation of the Cin7 Core API docs | done 2026-11-05 (from API Blueprint; unverified items marked inline) |
| [research/mcp-landscape.md](research/mcp-landscape.md) | MCP spec, SDKs, architectures, existing servers | done 2026-11-05 (agent-researched; spot-check key claims before relying) |
| [design/](design/README.md) | Mermaid diagrams, architecture sketches | empty |
| [adr/](adr/) | Architecture decision records | template, ADR 1 (ADRs), ADR 2 (TypeScript + SDK v2), ADR 3 (reports MVP, proposed) |
| [glossary.md](glossary.md) | Cin7 + MCP terminology | seeded |
| [justifications.md](justifications.md) | Lightweight "why we did X" log | started |

## Adding to it
- New decision of consequence → copy `adr/0000-template.md` to the next number.
- New term → `glossary.md` (alphabetical).
- Cite sources with URL + date fetched. Mark unverified claims `(unverified)`.

| [research/mvp-evaluation.md](research/mvp-evaluation.md) | A/B evaluation of the MVP vs Claude Code + Bash | done 2026-11-05 |
