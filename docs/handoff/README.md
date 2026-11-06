# docs/handoff/

Dated handoff documents written when a long Claude Code chat is retired, so a fresh session (or person) can continue without the chat.

| Date | Document | Focus of the next session |
|---|---|---|
| 2026-11-06 | [2026-11-06-cin7-mcp-roadmap.md](2026-11-06-cin7-mcp-roadmap.md) | Move the two list-rollup tools to the cache document basis, then velocity/reorder and negative-stock explanations |

Each document contains: snapshot, a summary of every ADR (decisions, commits, PRs, code, progress and where to continue), the codebase map, the conversation summary with a user-request ledger, agreements and rules, findings and corrections, an open-work register, environment and resuming notes, and a completeness check.

## How these are produced
By the user-level skill `retire-chat` (`~/.claude/skills/retire-chat/`). **It is not versioned in this repo.** It contains `SKILL.md`, a fact collector (`scripts/collect.mjs`), a verifier (`scripts/verify.mjs`), an idempotent ADR progress writer (`scripts/adr-progress.mjs`) and a template. Run it with `/retire-chat [focus of the next session]`. Its tests: `node --test ~/.claude/skills/retire-chat/tests/`.

To re-check a handoff against the repo:

```bash
node ~/.claude/skills/retire-chat/scripts/verify.mjs docs/handoff/<file>.md --repo . --readme README.md --secrets .env,eval/out/truth.json,http/http-client.private.env.json
```

The verifier checks everything the repo knows (ADRs and their commits and PRs, every PR, tool, module, evaluation question, research file and remote branch, plus the ledger and register structure and a secrets/PII scan). Conversation-only state is covered by the ledger, the register and a reviewer pass.
