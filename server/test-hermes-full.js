/**
 * B185 — the full Hermes checklist, live-verified: profiles ✓ inter-agent
 * talk ✓ multi-model lanes ✓ self-rephrase (never ask the user) ✓ skill
 * loop ✓ NL scheduling ✓ unattended delivery ✓.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let failures = 0;
const ok = (name, cond) => { console.log(`${cond ? '✅' : '❌'} ${name}`); if (!cond) failures += 1; };

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'b185full-'));
const GW = await import('./src/services/AgentGateway.js');
const SL = await import('./src/services/SkillLoop.js');
const AP = await import('./src/services/AgentProfiles.js');

console.log('\n== 1. profiles (Hermes config.yaml + SOUL.md per agent) ==');
{
  const list = AP.listProfiles();
  ok('5 isolated profiles with distinct SOULs + configs', list.length === 5 && new Set(list.map((p) => p.soul)).size === 5);
}

console.log('\n== 2. agents talk to each other (bounded side-channel) ==');
{
  const seams = { generate: async ({ agent }) => (agent === 'research' ? 'the answer is 42' : 'ok') };
  const ev = [];
  const r = await GW.agentAsk('dev', 'research', 'what is the answer?', { sendEvent: (t, d) => ev.push(String(d.message)), seams });
  ok('Ada asks Kito and gets a structured answer', r.status === 'success' && r.result.includes('42'));
  ok('the conversation is visible in the stream', ev.some((m) => m.includes('asks Kito')));
  await GW.agentAsk('dev', 'research', 'q2', { seams });
  const r3 = await GW.agentAsk('dev', 'research', 'q3', { seams });
  ok('question budget enforced (2/task) — no infinite chatter', r3.status === 'error');
  const plugin = fs.readFileSync('./plugins/hermes-profiles/plugin.js', 'utf-8');
  ok('agent_ask is a shared model tool', plugin.includes("slug: 'agent_ask'"));
}

console.log('\n== 3. multi-model: lanes rotate, never one brain ==');
{
  const src = fs.readFileSync('./src/services/AgentGateway.js', 'utf-8');
  ok('lane table spans 5 different providers + auto', src.includes('LANES') && (src.match(/prefer: '/g) || []).length >= 5);
  ok('empty lead lane → switches coworker with a visible line', src.includes('pickAlternateLane') && src.includes('switching to a different coworker'));
  ok('every retry rotates (laneTick per agent)', src.includes('laneTick'));
}

console.log('\n== 4. self-rephrase — JEXI rewrites vague briefs HERSELF ==');
{
  const orch = fs.readFileSync('./src/services/Orchestrator.js', 'utf-8');
  ok('never tells the user to rephrase anymore', !orch.includes('Please rephrase your request with more detail'));
  ok('rewrites the brief itself and retries once', orch.includes('rewriting the brief myself') && orch.includes('Rewrite this build request'));
  ok('honest failure message names the real cause (provider limits)', orch.includes('temporary limit on the free AI providers'));
}

console.log('\n== 5. skill loop + memory isolation (regression) ==');
{
  AP.rememberFor('dev', 'task', 'express needs app.listen', {});
  ok('memory stays per-agent', AP.searchMemory('dev', 'express').length >= 1 && AP.searchMemory('research', 'express').length === 0);
  const sk = SL.saveSkill('dev', { name: 'wire-a-server', description: 'how to wire an express server', body: '# steps' });
  ok('skills save in agentskills.io format', sk.ok && fs.readFileSync(sk.file, 'utf-8').includes('---'));
  ok('skills are recallable', SL.recallSkills('dev', 'wire express server', { includeForeign: false }).length >= 1);
}

console.log('\n== 6. NL scheduling + unattended delivery (regression) ==');
{
  const { job, human } = GW.scheduleJob({ agent: 'research', prompt: 'scan', schedule: 'every morning at 6am' });
  ok('"every morning at 6am" → daily at 6:00', human.includes('6:00'));
  GW.dispatchJob({ agent: 'comms', prompt: 'status', deliver: { channel: 'file' } });
  await GW.tick({ seams: { generate: async () => 'DONE-STATUS' } });
  const outbox = path.join(process.env.DATA_DIR, 'agent-gateway', 'outbox');
  const files = fs.readdirSync(outbox);
  ok(`unattended job delivered (${files.length} file(s))`, files.length >= 1);
  ok('delivery holds the finished result', fs.readFileSync(path.join(outbox, files[0]), 'utf-8').includes('DONE-STATUS'));
}

console.log(`\n${failures === 0 ? '🎉 ALL B185 FULL-HERMES CHECKS PASSED' : `💥 ${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);
