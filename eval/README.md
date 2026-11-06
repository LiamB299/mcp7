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

## Document-basis truth (Q1-Q3)
- `truth-docs.mjs` recomputes Q1 (overdue receivables), Q2 (revenue by channel) and Q3 (top customers) from invoice and credit-note documents, not the list rollups (see the correction in `docs/research/mvp-evaluation.md`). Output: `eval/out/truth-docs.json` (gitignored, separate from `truth.json`).
- Read-only, about 170 paced calls (one sale list pass plus one `sale` detail per non-voided sale), about 3.5 minutes. Needs `.env` (`CIN7_BASE_URL`, `CIN7_ACCOUNT_ID`, `CIN7_APPLICATION_KEY`).
- `truth-sku.mjs` merges Q11 into `eval/out/truth.json`, so on a fresh checkout run `node eval/truth.mjs` first, then `node eval/truth-sku.mjs`.
- **Not wired into grading yet.** `run.mjs` grades Q1 to Q3 against `eval/out/truth.json` (list basis). Before the document-basis re-evaluation (register R2) point the Q1 to Q3 grading at `truth-docs.json` and pre-register the readings: the script's primaries differ in tax basis (Q2 ex-tax including additional charges, Q3 tax-inclusive billed), and that must be settled before any paid run.

## Reorder truth (Q12)
- `truth-reorder.mjs` recomputes Q12 (reorder suggestions: 14-day lead time, 30 days of cover) from invoice and credit-note lines (90-day primary; 365-day, SKU-keyed, credit-notes-ignored and threshold-only readings under `alt`), joined to `ref/productavailability` and `product`. Output: `eval/out/truth-reorder.json` (gitignored, separate file).
- Read-only (GET only), about 170 paced calls (about 3.5 minutes). Needs `.env` (`CIN7_BASE_URL`, `CIN7_ACCOUNT_ID`, `CIN7_APPLICATION_KEY`). The maintainer runs it.
- **`run.mjs` does not grade Q12 yet.** Grading for Q12 is added when the evaluation is approved.
