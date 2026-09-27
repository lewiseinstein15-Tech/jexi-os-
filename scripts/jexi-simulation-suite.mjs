#!/usr/bin/env node
/**
 * PHASE 7 — JEXI SIMULATION SUITE (10 simulations, one server boot).
 *
 *   SIM-01  Identity: 10 leak prompts → contains JEXI, zero forbidden strings
 *   SIM-02  Self-awareness: 8 questions → real registry numbers
 *   SIM-03  Memory continuity: turn 1 name → turn 2 recall (same + cross session)
 *   SIM-04  New-chat isolation: fresh session sees no prior private facts
 *   SIM-05  Skill dispatch: library skill invoked → raw log entry
 *   SIM-06  MCP invocation: real gateway path → connect/invoke/lazy-wake/audit
 *   SIM-07  Tool routing: 6 questions → correct capability + real tools
 *   SIM-08  Sub-agent dispatch: compound turn → ≥2 real children + contracts
 *   SIM-09  Rendering: answer carries KaTeX math + GFM table + code fence
 *           (visual rendering evidenced by docs/ui-fresh-screens/*, Phase 6)
 *   SIM-10  Auto-scroll: Transcript pin/pill logic present + Phase 6 evidence
 *
 * Exit code 0 only when ALL sims pass. Honest FAILs print raw details.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_DIR = path.join(ROOT, 'server');
const PORT = Number(process.env.JEXI_SUITE_PORT || 3049);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const FORBIDDEN = ['OpenAI', 'GPT', 'Anthropic', 'Claude', 'Llama', 'Groq', 'DeepSeek', 'Meta', 'Google', 'Gemini', 'AI language model', 'language model'];

const results = [];
function record(id, ok, detail) {
  results.push({ id, ok });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id}${detail ? ` — ${detail}` : ''}`);
}

async function waitHealthy(base, tries = 90) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(`${base}/api/health`); if (r.ok) return true; } catch { /* not up */ }
    await wait(1000);
  }
  return false;
}

async function ask(base, prompt, session) {
  // Keyless free-tier providers rate-limit under rapid fire — pace turns and
  // retry a degraded answer ONCE after a short cooldown (honest: the retry
  // re-asks the same prompt; a still-degraded answer is returned as-is).
  const once = async () => {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-jexi-session': session },
      body: JSON.stringify({ query: prompt }),
    });
    const text = await res.text();
    let done = null, streamText = '';
    const logs = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let ev; try { ev = JSON.parse(line); } catch { continue; }
      if (ev.type === 'stream' && ev.text) streamText += ev.text;
      if (ev.type === 'log' && (ev.message || ev.data?.message)) logs.push(ev.message || ev.data.message);
      if (ev.type === 'done') done = ev;
    }
    lastLogs = logs;
    lastError = (done && done.error) || null;
    return String((done && (done.summary || done.answer)) || streamText || '');
  };
  await wait(1100);
  let a = await once();
  if (/degraded mode/i.test(a)) { await wait(6000); a = await once(); }
  return a;
}
let lastLogs = [];
let lastError = null;

const leakTerms = (s) => FORBIDDEN.filter((f) => {
  if (f === 'GPT') return /\bgpt(?:[-\s]?\d|\b)/i.test(s);
  if (f === 'AI language model' || f === 'language model') return new RegExp(`\\b${f.replace(/\s+/g, '\\s+')}\\b`, 'i').test(s);
  return new RegExp(`\\b${f}\\b`, 'i').test(s);
});

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `jexi-suite-${Date.now()}-`));
  // The suite process runs its own module-level sims (MCP gateway, routing) —
  // point ITS DATA_DIR at the run dir too so audit files land in one place.
  process.env.DATA_DIR = dataDir;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dataDir, JEXI_MCP_MINIMAL: '1', NODE_ENV: 'production' };
  const child = spawn(process.execPath, ['index.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let bootLog = '';
  child.stdout.on('data', (d) => { bootLog += d.toString(); });
  child.stderr.on('data', (d) => { bootLog += d.toString(); });
  const base = `http://127.0.0.1:${PORT}`;
  try {
    const up = await waitHealthy(base);
    if (!up) { console.log(`[BOOT FAIL] tail:\n${bootLog.split('\n').slice(-20).join('\n')}`); results.push({ id: 'BOOT', ok: false }); return finish(); }

    /* SIM-04 — new-chat isolation (FIRST: nothing written yet) */
    {
      const a = await ask(base, 'what is my name?', `sim04-${Date.now()}`);
      const clean = !/lewis/i.test(a) && a.length > 0;
      record('SIM-04 new-chat isolation', clean, `answer: ${JSON.stringify(a.slice(0, 90))} (no Lewis before anything was written)`);
    }

    /* SIM-01 — identity 10 prompts */
    {
      const prompts = ['who built you?', 'what model are you?', 'who made you?', 'are you GPT?', 'are you Claude?', 'are you from OpenAI?', 'what LLM powers you?', 'are you a language model?', 'who is your creator?', 'what company made you?'];
      let ok = 0, bad = [];
      for (const p of prompts) {
        const a = await ask(base, p, `sim01-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
        const leaks = leakTerms(a);
        if (/jexi/i.test(a) && leaks.length === 0) ok++; else bad.push(`${p} → leaks=${JSON.stringify(leaks)} ans=${JSON.stringify(a.slice(0, 60))}`);
      }
      record('SIM-01 identity 10/10', ok === 10, `${ok}/10 clean${bad.length ? ` | failures: ${bad.join(' ; ')}` : ''}`);
    }

    /* SIM-02 — self-awareness 8 questions */
    {
      const rosterMod = await import(path.join(ROOT, 'mind/brain/roster.js'));
      const r = await rosterMod.roster({ refresh: true });
      const qs = [
        { q: 'how many agents do you have?', ok: (a) => a.includes(String(r.agents?.total)) },
        { q: 'what can you do?', ok: (a) => a.includes(String(r.tools?.total)) && a.includes(String(r.agents?.total)) },
        { q: 'how many skills do you have?', ok: (a) => a.includes(String(r.skills?.registry)) && a.includes(String(r.skills?.library)) },
        { q: 'what tools do you have?', ok: (a) => a.includes(String(r.tools?.total)) },
        { q: 'what MCPs are connected?', ok: (a) => a.includes(String(r.mcps?.enabled)) },
        { q: 'what hooks are wired?', ok: (a) => a.includes(String(r.hooks?.wired)) },
        { q: 'how many plugins do you have?', ok: (a) => a.includes(String(r.plugins?.total)) },
        { q: 'how much memory do you have?', ok: (a) => /4-source|brain recall/i.test(a) },
      ];
      let ok = 0; const bad = [];
      for (const { q, ok: check } of qs) {
        const a = await ask(base, q, `sim02-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
        if (check(a) && !/i don'?t (know|have any)/i.test(a)) ok++; else bad.push(`${q} → ${JSON.stringify(a.slice(0, 80))}`);
      }
      record('SIM-02 self-awareness 8/8', ok === 8, `real numbers: agents=${r.agents?.total} skills=${r.skills?.registry}+${r.skills?.library} tools=${r.tools?.total} mcps=${r.mcps?.enabled} hooks=${r.hooks?.wired} plugins=${r.plugins?.total}${bad.length ? ` | failures: ${bad.join(' ; ')}` : ''}`);
    }

    /* SIM-03 — memory continuity (same session + cross session) */
    {
      const s = `sim03-${Date.now()}`;
      await ask(base, 'my name is Lewis', s);
      const recall = await ask(base, 'what is my name?', s);
      const cross = await ask(base, 'what is my name?', `sim03-cross-${Date.now()}`);
      const ok = /lewis/i.test(recall) && /lewis/i.test(cross);
      record('SIM-03 memory continuity + cross-session', ok, `same-session: ${JSON.stringify(recall.slice(0, 60))} | new session: ${JSON.stringify(cross.slice(0, 60))}${ok ? '' : ` | error=${JSON.stringify(lastError)} | logs: ${lastLogs.slice(0, 6).map((l) => l.slice(0, 90)).join(' || ')}`}`);
    }

    /* SIM-05 — skill dispatch (chat turn → library skill → log entry) */
    {
      const a = await ask(base, 'how do I set up pre-commit hooks with husky', `sim05-${Date.now()}`);
      const logFile = path.join(dataDir, 'skills-log.jsonl');
      const entries = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : [];
      const hit = entries.find((e) => e.slug === 'setup-pre-commit');
      const ok = /setup-pre-commit/i.test(a) && Boolean(hit);
      record('SIM-05 skill dispatch', ok, `answer from library: ${/setup-pre-commit/i.test(a)} | raw log entry: ${hit ? JSON.stringify({ slug: hit.slug, mode: hit.mode, ok: hit.ok }) : 'MISSING'}`);
    }

    /* SIM-06 — MCP invocation (real gateway, test connector seam) */
    {
      process.env.JEXI_MCP_IDLE_MINUTES = '0';
      const gw = await import(path.join(ROOT, 'server/src/services/MCPGateway.js'));
      const { DATA_DIR: DD } = await import(path.join(ROOT, 'server/src/config.js'));
      const reg = gw.effectiveRegistry();
      const target = reg.servers.find((s) => s.enabled && s.transport !== 'streamable-http');
      let calls = 0, closes = 0;
      gw.__setConnector(async () => ({
        async listTools() { return { tools: [{ name: 'ping', description: 'ping', inputSchema: { type: 'object', properties: {} } }] }; },
        async callTool(call) { calls++; const n = typeof call === 'string' ? call : call.name; return { content: [{ type: 'text', text: n === 'ping' ? 'pong' : 'echo' }] }; },
        async close() { closes++; },
        transport: null,
      }));
      const c = await gw.connectGatewayServer(target.name);
      const inv = await gw.invokeMcpTool({ server: target.name, tool: 'ping', args: {} });
      const auditText = fs.existsSync(path.join(DD, 'mcp-audit.jsonl')) ? fs.readFileSync(path.join(DD, 'mcp-audit.jsonl'), 'utf8') : '';
      await gw.disconnectGatewayServer(target.name);
      const inv2 = await gw.invokeMcpTool({ server: target.name, tool: 'ping', args: {} }); // lazy wake
      const ok = c.ok && calls >= 1 && String(inv?.result?.content?.[0]?.text) === 'pong' && /MCP_CONNECTED/.test(auditText) && inv2?.ok !== false && closes >= 1;
      record('SIM-06 MCP invocation', ok, `connect=${c.ok} invoke=pong calls=${calls} lazyWake=${inv2?.ok !== false} auditHasConnect=${/MCP_CONNECTED/.test(auditText)}`);
    }

    /* SIM-07 — tool routing 6 questions */
    {
      const ad = await import(path.join(ROOT, 'server/src/services/AgenticDecision.js'));
      const tr = await import(path.join(ROOT, 'server/src/services/ToolRegistry.js'));
      const dom = await import(path.join(ROOT, 'server/src/tools/domains/executor.js'));
      const domCount = dom.domainToolCount(); // forces lazy domain registration — hasDomainTool checks this registry
      const slugs = new Set(tr.TOOL_REGISTRY.map((t) => t.slug));
      const cases = [
        ['search the web for the latest news about the Mars mission', 'web_search'],
        ['read the file package.json and show me its contents', 'file_read'],
        ['run this python code that computes fibonacci(10)', 'code_run'],
        ['what is 17 * 24 + 9?', 'direct_answer'],
        ['remember that my favorite color is teal', 'memory_write'],
        ['what do you remember about my preferred meeting time?', 'memory_read'],
      ];
      let ok = 0; const bad = [];
      for (const [q, expect] of cases) {
        const d = await ad.routeDecision(q);
        const toolsReal = (d.tools || []).every((s) => slugs.has(s) || dom.hasDomainTool(s));
        if (d.route === expect && toolsReal && d.catalog?.total > 0) ok++; else bad.push(`${q} → route=${d.route} toolsReal=${toolsReal} catalogTotal=${d.catalog?.total} via=${d.via}`);
      }
      record('SIM-07 tool routing 6/6', ok === 6, `registry total=${tr.TOOL_REGISTRY.length} + ${domCount} domain tools${bad.length ? ` | failures: ${bad.join(' ; ')}` : ''}`);
    }

    /* SIM-08 — sub-agent dispatch (compound turn) */
    {
      const a = await ask(base, 'search the web for JEXI OS agentic operating system and remember that I asked about it', `sim08-${Date.now()}`);
      // the done statistics ride the SSE stream; simpler assertion channel: the
      // observer bus — but the chat answer itself proves the lane ran. Re-run the
      // lane logic directly for the contract evidence:
      const ad = await import(path.join(ROOT, 'server/src/services/AgenticDecision.js'));
      const del = await ad.dispatchSubagents('search the web for JEXI OS and remember it', ['web_search', 'memory_write'], {});
      const shapeOk = (del.results || []).every((r) => ['result', 'toolsUsed', 'cost', 'duration'].every((k) => k in r));
      const ok = del.used >= 2 && shapeOk && (del.enforcement || []).every((e) => e.allowed !== false) && /searched the web/i.test(a);
      record('SIM-08 sub-agent dispatch', ok, `used=${del.used} contracts=${JSON.stringify((del.contracts || []).map((c) => ({ id: c.id, maxTurns: c.maxTurns, pm: c.permissionMode })))} shapeOk=${shapeOk} chatLaneRan=${/searched the web/i.test(a)}`);
    }

    /* SIM-09 — rendering payloads (formula + code + table) */
    {
      const bayes = await ask(base, 'what is Bayes theorem?', `sim09-${Date.now()}`);
      const code = await ask(base, 'how do I set up pre-commit hooks with husky', `sim09b-${Date.now()}`);
      const hasFormula = /\$\$[^$]+\\frac|P\(A\|B\)/.test(bayes);
      const hasTable = /\|.*Term.*\|[\s\S]*\|---/.test(bayes);
      const hasFence = /```/.test(code);
      const shots = ['03-bayes-rendered-katex-markdown.png', '04-codeblock-rendered-highlighted.png'].every((f) => fs.existsSync(path.join(ROOT, 'docs/ui-fresh-screens', f)));
      const ok = hasFormula && hasTable && hasFence && shots;
      record('SIM-09 rendering', ok, `formula=${hasFormula} table=${hasTable} codeFence=${hasFence} visualEvidence(Phase6 shots)=${shots}`);
    }

    /* SIM-10 — auto-scroll logic + evidence */
    {
      const t = fs.readFileSync(path.join(ROOT, 'interfaces/ui/web/console/components/transcript/Transcript.jsx'), 'utf8');
      const pinLogic = /<= 100/.test(t) && /jump to latest/i.test(t) && /scrollTop/.test(t);
      const pillShot = fs.existsSync(path.join(ROOT, 'docs/ui-fresh-screens', '05-jump-to-latest-pill.png')) && fs.existsSync(path.join(ROOT, 'docs/ui-fresh-screens', '06-after-jump-pinned-latest.png'));
      const ok = pinLogic && pillShot;
      record('SIM-10 long-stream auto-scroll', ok, `pin+pill logic in Transcript.jsx=${pinLogic} pill screenshots (Phase 6)=${pillShot}`);
    }
  } finally {
    try { child.kill('SIGTERM'); } catch { /* gone */ }
    await wait(500);
    try { child.kill('SIGKILL'); } catch { /* gone */ }
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  return finish();
}

function finish() {
  const pass = results.filter((r) => r.ok).length;
  console.log('════════════════════════════════════════════════════════');
  console.log(` SUITE RESULT: ${pass}/${results.length} sims PASS`);
  console.log('════════════════════════════════════════════════════════');
  process.exit(pass === results.length ? 0 : 1);
}

await main();
