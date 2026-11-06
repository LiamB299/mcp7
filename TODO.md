# TODO for the next session (your actions first)

Quick checklist for you. Context: [`docs/handoff/2026-11-06-cin7-mcp-roadmap.md`](docs/handoff/2026-11-06-cin7-mcp-roadmap.md) (open-work register R1 to R24). Delete this file when done.

## Your actions
- [ ] **Rotate the sandbox application key** (R14). The key appeared once in a diff during the earlier session (never pushed to GitHub). In Cin7: API settings, create a new application key, remove the old one. Then update `.env` and `http/http-client.private.env.json` (both gitignored).
- [ ] **Approve the project MCP server** (R15). Run `claude` in this repo, accept the `.mcp.json` server prompt, check with `claude mcp list` (expect `cin7-core` connected).
- [ ] **Delete stale branches** (R16): the 15 merged feature and docs branches (including `docs/handoff-2026-11-06`), remote and local. Remote: `git push origin --delete <branch>` or the GitHub UI "branches" page; local: `git branch -D <branch>` after `git fetch --prune`. `docs/user-complaints` shows as unmerged by ancestry but holds only a merge commit, so it is safe to delete too. Also delete `docs/todo-next-session` once this PR is merged.
- [ ] **Purge local customer data** (R17) when you no longer need it: `eval/out/` (run transcripts, `truth.json` with an order number and customer names) and the old session scratchpad under `/private/tmp/claude-501/` (raw sale details). Optional: `/tmp/s`, `/tmp/run.py`, `/private/tmp/evalcwd`.
- [ ] **Decide the next roadmap step** (R18). Recommended: migrate `receivables_overdue` and `sales_summary` to the cache's document basis (R1), then velocity and reorder (R3), then negative-stock explanations (R4). Say yes or pick another.

## Settled in the last session
- "Haiku large" means **large effort**: Haiku subagents run with `effort: high` (now in `CLAUDE.md` and memory).
- Evaluation runs and sandbox writes need your explicit approval each time (about 1.7 US dollars notional spent so far).

## Starter prompt for the new session
Paste this:

> Read `docs/handoff/2026-11-06-cin7-mcp-roadmap.md` (sections 0, 2 and 7), `README.md` and `CLAUDE.md`. Then plan with me how to migrate `receivables_overdue` and `sales_summary` onto the cache's document basis (register R1), using plan mode, an advisor check, and Haiku agents with high effort for implementation. Do not run evaluations or write to the sandbox without asking.
