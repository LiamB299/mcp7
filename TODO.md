# TODO for the next session (your actions first)

Quick checklist for you. Context: [`docs/handoff/2026-11-06-cin7-mcp-roadmap.md`](docs/handoff/2026-11-06-cin7-mcp-roadmap.md) (open-work register R1 to R24). Delete this file when done.

## Your actions
- [ ] **Rotate the sandbox application key** (R14). The key appeared once in a diff during the earlier session (never pushed to GitHub). In Cin7: API settings, create a new application key, remove the old one. Then update `.env` and `http/http-client.private.env.json` (both gitignored).
- [x] **Approve the project MCP server** (R15). Run `claude` in this repo, accept the `.mcp.json` server prompt, check with `claude mcp list` (expect `cin7-core` connected).
- [x] **Delete stale branches** (R16): the 15 merged feature and docs branches (including `docs/handoff-2026-11-06`), remote and local. Remote: `git push origin --delete <branch>` or the GitHub UI "branches" page; local: `git branch -D <branch>` after `git fetch --prune`. `docs/user-complaints` shows as unmerged by ancestry but holds only a merge commit, so it is safe to delete too. Also delete `docs/todo-next-session` once this PR is merged.
- [x] **Purge local customer data** (R17) when you no longer need it: `eval/out/` (run transcripts, `truth.json` with an order number and customer names) and the old session scratchpad under `/private/tmp/claude-501/` (raw sale details). Optional: `/tmp/s`, `/tmp/run.py`, `/private/tmp/evalcwd`.
- [x] **Decide the next roadmap step** (R18). Recommended: migrate `receivables_overdue` and `sales_summary` to the cache's document basis (R1), then velocity and reorder (R3), then negative-stock explanations (R4). Say yes or pick another.

## Settled in the last session
- "Haiku large" means **large effort**: Haiku subagents run with `effort: high` (now in `CLAUDE.md` and memory).
- Evaluation runs and sandbox writes need your explicit approval each time (about 1.7 US dollars notional spent so far).

## Done 2026-11-06 (second session)
- R15 approved (`.claude/settings.local.json`, gitignored; `cin7-core` connected). R16: 16 stale branches deleted, remote and local. R17: `eval/out/`, old scratchpad data, `/tmp/s`, `/tmp/run.py`, `/private/tmp/evalcwd` removed. R18: R1 chosen and built (ADR 0006, PR `feat/document-basis-reports`).
- Still yours: **R14** (rotate the sandbox key; you chose to skip it for now).
- R2 done on your go-ahead: truth pulls and a one-rep Q1 to Q3 run (about 0.28 US dollars notional): treatment 3 of 3 correct, baseline 0 of 3 (wave 4 in `docs/research/mvp-evaluation.md`). More repetitions need your approval.

## Done 2026-11-06 (third session)
- **No writes to Cin7 this iteration** (your rule, also in memory): no write probes (R9 stays unverified), no write tools (R5).
- R3 done: `reorder_suggestions` (ADR 0007, PR #21). Live gate: join verified, quantity parity exact; `stock_health` counted 3 Service products as below threshold: fixed in the follow-up PR (it now skips Service and deprecated products).
- Open from this: Q12 is deferred (not evaluable on this sparse sandbox; revisit with production-like data); R4 (negative-stock explanations) needs open-order lines in the cache.

## Starter prompt for the new session
> Read `docs/handoff/2026-11-06-cin7-mcp-roadmap.md` (sections 0, 2 and 7; it predates R1 to R3, so also read ADR 0006 and 0007), `README.md` and `CLAUDE.md`. Then plan with me the next step: negative-stock explanations (R4, needs open-order lines in the cache) or something from the deferred list in the handoff. No writes to Cin7 this iteration. Use plan mode, an advisor check, and Haiku agents with high effort. Do not run evaluations without asking.
