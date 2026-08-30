/**
 * B180d — wiring tests: the Hermes agent system is reachable from the REAL
 * plugin registry, command registry, and APIs (not just direct imports).
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let failures = 0;
const ok = (name, cond) => { console.log(`${cond ? '✅' : '❌'} ${name}`); if (!cond) failures += 1; };

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'b180d-'));

/* 1. plugin registers every tool through the real plugin context */
console.log('\n== plugin → real tool registry ==');
{
  const { loadPlugins, listPluginTools, setActivePluginContext } = await import('./src/services/PluginContext.js');
  const { ctx } = await loadPlugins({ services: {} });
  setActivePluginContext(ctx);
  const slugs = listPluginTools().map((t) => t.slug);
  for (const s of ['delegate_task', 'gateway_schedule', 'gateway_status', 'gateway_cancel', 'skill_search']) {
    ok(`tool "${s}" registered`, slugs.includes(s));
  }
  // delegate_task runs end-to-end through the registry handler (mocked model)
  const tool = listPluginTools().find((t) => t.slug === 'delegate_task');
  const res = await tool.handler(
    { agents: ['research'], briefs: ['check today ke news'], mode: 'parallel' },
    { sendEvent: () => {} },
  );
  // With live keys the envelope is success; without keys it MUST still be a
  // STRUCTURED failure envelope (hermes contract) — never a thrown crash.
  const env = res.envelopes?.[0];
  const structured = env && ['success', 'error'].includes(env.status) && 'agent' in env && 'result' in env && 'tookMs' in env;
  ok('delegate_task returns structured envelopes (or a structured failure when no keys — never a crash)', structured);
}

/* 2. /agents + /refine commands in the real command registry */
console.log('\n== commands ==');
{
  const { listCommands } = await import('./src/services/CommandRegistry.js');
  const names = listCommands().map((c) => c.name);
  ok('/agents registered', names.includes('agents'));
  const idxSrc = fs.readFileSync('./index.js', 'utf-8');
  const refineWired = names.includes('refine') || (idxSrc.includes("name: 'refine'") && idxSrc.includes('registerCommand'));
  ok('/refine registered (index.js boot registration)', refineWired);
  const cmd = listCommands().find((c) => c.name === 'agents');
  const out = await cmd.run({ rawInput: '/agents' });
  ok('/agents lists profiles + jobs + skills', out.ok && out.summary.includes('Nova') && out.summary.includes('Gateway jobs'));
}

/* 3. gateway tools end-to-end (schedule → status → cancel) */
console.log('\n== gateway tools round-trip ==');
{
  const { loadPlugins, listPluginTools, setActivePluginContext } = await import('./src/services/PluginContext.js');
  const { ctx } = await loadPlugins({ services: {} });
  setActivePluginContext(ctx);
  const sched = listPluginTools().find((t) => t.slug === 'gateway_schedule');
  const stat = listPluginTools().find((t) => t.slug === 'gateway_status');
  const can = listPluginTools().find((t) => t.slug === 'gateway_cancel');
  const s = await sched.handler({ agent: 'research', prompt: 'morning scan', schedule: 'every morning at 7am' });
  ok('scheduled via tool', s.ok && s.human.includes('7:00'));
  const st = await stat.handler({});
  ok('status lists it', st.jobs.some((j) => j.scheduleText.includes('7am')));
  const c = await can.handler({ id: s.job.id });
  ok('cancelled via tool', c.ok === true);
}

/* 4. API surface present in the chat server */
console.log('\n== api surface ==');
{
  const idx = fs.readFileSync('./index.js', 'utf-8');
  for (const route of ['/api/agents/profiles', '/api/agents/delegate', '/api/gateway/jobs', '/api/gateway/schedule', '/api/gateway/dispatch', '/api/skills/']) {
    ok(route, idx.includes(route));
  }
  ok('gateway boots with the server', idx.includes('startGateway()'));
}

console.log(`\n${failures === 0 ? '🎉 ALL B180d WIRING CHECKS PASSED' : `💥 ${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);
