// Headless A/B evaluation: Claude Code with Bash+key (baseline) vs the same plus the MCP (treatment).
// Usage: node eval/run.mjs [--reps 2] [--model sonnet] [--only Q1,Q2] [--budget 1.5] [--arms baseline,treatment]
// Writes transcripts + summary to eval/out/ (gitignored: transcripts hold customer data). Run truth.mjs first.
import { spawnSync } from 'node:child_process';
import { loadEnvFile } from 'node:process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
loadEnvFile(`${root}.env`);
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const reps = Number(arg('reps', 2)), model = arg('model', 'sonnet'), budget = arg('budget', '1.5');
const only = arg('only', '').split(',').filter(Boolean), arms = arg('arms', 'baseline,treatment').split(',');
const qs = JSON.parse(readFileSync(`${root}eval/questions.json`)).questions.filter((q) => !only.length || only.includes(q.id));
const truth = JSON.parse(readFileSync(`${root}eval/out/truth.json`));
const cwd = '/private/tmp/evalcwd'; // empty dir outside the repo: no CLAUDE.md, docs or src visible
mkdirSync(cwd, { recursive: true }); mkdirSync(`${root}eval/out/runs`, { recursive: true });
writeFileSync(`${cwd}/none.json`, '{"mcpServers":{}}');
writeFileSync(`${cwd}/cin7.json`, JSON.stringify({ mcpServers: { 'cin7-core': { command: 'node', args: [`${root}dist/index.js`] } } }));

const common = 'You are answering a question about a Cin7 Core ERP sandbox account. Be precise. Money is in the account currency. End your reply with one final line: ANSWER_JSON: followed by compact JSON in the format given.';
const baselineCtx = ' The Cin7 Core REST API is available: credentials are in the environment variables CIN7_ACCOUNT_ID, CIN7_APPLICATION_KEY and CIN7_BASE_URL (API root; append /v2). Send them as headers api-auth-accountid and api-auth-applicationkey. Docs: https://dearinventory.docs.apiary.io';
const treatmentCtx = ' Cin7 Core tools are available through MCP.';

const near = (a, b, tol = 0.01) => typeof a === 'number' && Math.abs(a - b) <= tol;
function grade(id, a) {
  try {
    if (id === 'Q1') return near(a.count, truth.Q1.primary.count, 0) && near(a.total, truth.Q1.primary.total) ? 'correct' : near(a.count, truth.Q1.altGrossInvoices.count, 0) && near(a.total, truth.Q1.altGrossInvoices.total) ? 'alt-gross' : 'wrong';
    if (id === 'Q2') { const m = (t) => Object.entries(t).every(([k, v]) => near(Object.entries(a).find(([x]) => x.toLowerCase().replace(/[()]/g, '') === k.toLowerCase().replace(/[()]/g, ''))?.[1], v)) && Object.keys(a).length === Object.keys(t).length; return m(truth.Q2.primary) ? 'correct' : m(truth.Q2.altGrossInvoices) ? 'alt-gross' : 'wrong'; }
    if (id === 'Q3') { const m = (t) => t.every((x, i) => near(a[i]?.amount, x.invoiced)); return a.length >= 3 && m(truth.Q3.primary) ? 'correct' : a.length >= 3 && m(truth.Q3.altGrossInvoices) ? 'alt-gross' : 'wrong'; }
    if (id === 'Q4') return near(a.totalValue, truth.Q4.totalValue, 1) && near(a.topLocationValue, truth.Q4.topLocationValue, 1) && String(a.topLocation).toLowerCase() === truth.Q4.topLocation.toLowerCase() ? 'correct' : near(a.totalValue, truth.Q4.altIfUnitsMisread, 1) ? 'units-misread' : 'wrong';
    if (id === 'Q5') return near(a.products, truth.Q5.products, 0) ? 'correct' : 'wrong';
    if (id === 'Q6') return near(a.count, truth.Q6.count, 0) ? 'correct' : 'wrong';
  } catch { /* fall through */ }
  return 'wrong';
}

const rows = [];
for (const q of qs) for (const arm of arms) for (let rep = 1; rep <= reps; rep++) {
  const env = { ...process.env };
  for (const k of ['CIN7_ACCOUNT_ID', 'CIN7_APPLICATION_KEY', 'CIN7_BASE_URL']) if (arm !== 'baseline') delete env[k]; // treatment: key lives only in the MCP's own .env load
  const args = ['-p', `${q.text}\n\nFinal line format: ANSWER_JSON: ${q.answerFormat}`, '--output-format', 'stream-json', '--verbose', '--model', model,
    '--append-system-prompt', common + (arm === 'baseline' ? baselineCtx : treatmentCtx),
    '--strict-mcp-config', '--mcp-config', `${cwd}/${arm === 'baseline' ? 'none' : 'cin7'}.json`,
    '--allowedTools', 'Bash', 'mcp__cin7-core__*', '--permission-mode', 'dontAsk', '--setting-sources', 'project',
    '--disable-slash-commands', '--no-session-persistence', '--max-budget-usd', budget];
  const t0 = Date.now();
  const r = spawnSync('claude', args, { cwd, env, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 15 * 60_000 });
  const events = (r.stdout || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const res = events.findLast((e) => e.type === 'result') ?? {};
  const text = String(res.result ?? '');
  const m = text.match(/ANSWER_JSON:\s*(.+)\s*$/m);
  let ans; try { ans = JSON.parse(m?.[1] ?? 'null'); } catch { ans = null; }
  const raw = r.stdout || '';
  const keyHits = process.env.CIN7_APPLICATION_KEY ? raw.split(process.env.CIN7_APPLICATION_KEY).length - 1 : -1;
  const toolUses = events.filter((e) => e.type === 'assistant').flatMap((e) => e.message?.content ?? []).filter((c) => c.type === 'tool_use').length;
  const row = { q: q.id, scope: q.scope, arm, rep, grade: ans ? grade(q.id, ans) : 'no-answer', turns: res.num_turns, toolUses, costUsd: res.total_cost_usd, durationMs: res.duration_ms ?? Date.now() - t0, keyInTranscript: keyHits };
  rows.push(row); console.log(JSON.stringify(row));
  writeFileSync(`${root}eval/out/runs/${arm}-${q.id}-${rep}.jsonl`, raw);
}
writeFileSync(`${root}eval/out/summary.json`, JSON.stringify(rows, null, 2));
