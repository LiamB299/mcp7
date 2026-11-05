# eval/: does the MCP beat Claude Code + Bash + the key?

Pre-registered 2026-11-05, before any run. Results go to `docs/research/mvp-evaluation.md` (numbers only).

## Design
- Questions: `questions.json` (6; Q6 is deliberately out of MVP scope). Fixed as-of date 2026-11-05.
- Ground truth: `truth.mjs` computes answers independently of `src/` from a fresh sandbox pull (definitions recorded in its output; primary = net-of-credit-notes, plus the naive "alt" readings so we can see which trap a wrong answer fell into).
- Arms (same model, same permissions, run from an empty directory outside the repo so CLAUDE.md, docs and `src/` are not visible):
  - **baseline**: Bash + `CIN7_*` env vars + a pointer to the API docs. No MCP.
  - **treatment**: the MCP only for Cin7 access. The key is **not** in the environment; the server reads the repo `.env` itself.
- Each question is asked as written; the model must end with `ANSWER_JSON: {...}` in the given format so grading is automatic. Two runs per question per arm, sequential (shared 60 calls/min key).
- Metrics: grade (correct / alt-gross / units-misread / wrong / no-answer), turns, tool uses, cost, duration, and whether the application key string appears in the transcript.

## Kill criterion (set before running)
If the baseline is at least as correct and within about 1.5x of the treatment's cost and time on in-scope questions, report-tool value is **unproven**.

## Known biases and limits
Same author wrote tools and questions; n is tiny (about 24 runs); the baseline is given the header names and docs link (generous); model non-determinism; the sandbox is small and synthetic. Transcripts hold customer data and stay in `eval/out/` (gitignored).

## Run
```bash
npm run build
node eval/truth.mjs                      # ~3 paced API calls
node eval/run.mjs --reps 2 --model sonnet  # real API spend: ~24 headless Claude runs
```
