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
const truth = JSON.parse(readFileSync(`${root}eval/out/truth.json`));
const qs = JSON.parse(readFileSync(`${root}eval/questions.json`)).questions.filter((q) => !only.length || only.includes(q.id)).map((q) => ({ ...q, text: q.text.replace('{ORDER_NUMBER}', truth.Q10?.orderNumber ?? '') }));
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
    if (id === 'Q2') {
      const vals = (o) => Object.values(o).filter((v) => typeof v === 'number');
      let v = vals(a); const sum = v.reduce((x, y) => x + y, 0);
      if (v.length > 1) { const i = v.findIndex((x) => near(x, sum - x, 0.01)); if (i >= 0) v = v.filter((_, j) => j !== i); } // drop a 'total' entry
      const m = (t) => { const w = vals(t).filter((x) => x !== 0).sort((x, y) => x - y); const g = v.filter((x) => x !== 0).sort((x, y) => x - y); return w.length === g.length && w.every((x, i) => near(g[i], x)); };
      return m(truth.Q2.primary) ? 'correct' : m(truth.Q2.altGrossInvoices) ? 'alt-gross' : 'wrong';
    }
    if (id === 'Q3') { const m = (t) => t.every((x, i) => near(a[i]?.amount, x.invoiced)); return a.length >= 3 && m(truth.Q3.primary) ? 'correct' : a.length >= 3 && m(truth.Q3.altGrossInvoices) ? 'alt-gross' : 'wrong'; }
    if (id === 'Q4') return near(a.totalValue, truth.Q4.totalValue, 1) && near(a.topLocationValue, truth.Q4.topLocationValue, 1) && String(a.topLocation).toLowerCase() === truth.Q4.topLocation.toLowerCase() ? 'correct' : near(a.totalValue, truth.Q4.altIfUnitsMisread, 1) ? 'units-misread' : 'wrong';
    if (id === 'Q5') return near(a.products, truth.Q5.products, 0) ? 'correct' : 'wrong';
    if (id === 'Q6') { if (near(a.count, truth.Q6.primary, 0)) return 'correct'; const hit = Object.entries(truth.Q6.readings).find(([, n]) => near(a.count, n, 0)); return hit ? `alt-reading:${hit[0]}` : 'wrong'; }
    if (id === 'Q7') return near(a.count, truth.Q7.primary, 0) ? 'correct' : near(a.count, truth.Q7.altMasterOrdered, 0) ? 'alt-master-status' : 'wrong';
    if (id === 'Q8') return near(a.count, truth.Q8.primary, 0) ? 'correct' : near(a.count, truth.Q8.altNotShipped, 0) ? 'alt-includes-shipping' : 'wrong';
    if (id === 'Q9') return near(a.count, truth.Q9.primary, 0) ? 'correct' : 'wrong';
    if (id === 'Q10') return near(a.orderTotal, truth.Q10.orderTotal) && a.shipped === truth.Q10.shipped ? 'correct' : a.shipped === false ? 'alt-master-status' : 'wrong';
  } catch { /* fall through */ }
  return 'wrong';
}

function parseAnswer(text) {
  const i = text.lastIndexOf('ANSWER_JSON:');
  if (i < 0) return null;
  const rest = text.slice(i + 12).replace(/```(json)?/gi, '').replace(/`/g, '');
  const start = rest.search(/[\[{]/);
  if (start < 0) return null;
  const open = rest[start], close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false;
  for (let k = start; k < rest.length; k++) {
    const c = rest[k];
    if (inStr) { if (c === '\\') k++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === open) depth++; else if (c === close && --depth === 0) { try { return JSON.parse(rest.slice(start, k + 1)); } catch { return null; } }
  }
  return null;
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
  const ans = parseAnswer(text);
  const raw = r.stdout || '';
  const keyHits = process.env.CIN7_APPLICATION_KEY ? raw.split(process.env.CIN7_APPLICATION_KEY).length - 1 : -1;
  const uses = events.filter((e) => e.type === 'assistant').flatMap((e) => e.message?.content ?? []).filter((c) => c.type === 'tool_use');
  const toolUses = uses.length, mcpToolUses = uses.filter((c) => String(c.name).startsWith('mcp__cin7-core')).length;
  const row = { q: q.id, scope: q.scope, arm, rep, grade: ans ? grade(q.id, ans) : 'no-answer', turns: res.num_turns, toolUses, mcpToolUses, denied: res.permission_denials?.length ?? null, keyAccessibleToModel: arm === 'baseline', costUsd: res.total_cost_usd, durationMs: res.duration_ms ?? Date.now() - t0, keyInTranscript: keyHits };
  rows.push(row); console.log(JSON.stringify(row));
  writeFileSync(`${root}eval/out/runs/${arm}-${q.id}-${rep}.jsonl`, raw);
}
writeFileSync(`${root}eval/out/summary.json`, JSON.stringify(rows, null, 2));
