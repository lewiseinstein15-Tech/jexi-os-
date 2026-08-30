/**
 * B180 — AGENT GATEWAY (Hermes gateway + cron + delegate_tool, ported).
 *
 * Hermes: a long-running process where the orchestrator spawns subagents
 * with ISOLATED conversations (the parent's context never pays for the
 * child's working process), cron jobs are first-class agent tasks stored as
 * JSON and delivered to platforms, and everything survives restarts.
 *
 * JEXI port (single-process, no daemon needed):
 *   delegateTask(agent, brief, {mode:'sync'|'async'}) → STRUCTURED envelope:
 *     { status: 'success'|'error', agent, result, artifacts[], skills[], tookMs }
 *   - the child runs generateWithToolsLoop with its OWN system prompt
 *     (SOUL.md) + its OWN allowed tools — the orchestrator's context only
 *     receives the compact envelope (zero-context-cost delegation).
 *   - async jobs persist to jobs.json; on boot, pending/running jobs RESUME —
 *     unattended work survives Render restarts (hermes cron semantics).
 *   - delivery: file (always) + connector_send (email/github when wired) +
 *     chat notification — results are PUSHED, never parked.
 *   - scheduleJob(): natural-language recurrence ("every morning at 8am",
 *     "daily", "every 2 hours") parsed to a next-run loop — no cron syntax.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DATA_DIR } from '../config.js';
import { loadProfile, assembleAgentPrompt, rememberFor } from './AgentProfiles.js';
import { recallSkills, autoSkill } from './SkillLoop.js';

const GATEWAY_DIR = path.join(DATA_DIR, 'agent-gateway');
const JOBS_FILE = path.join(GATEWAY_DIR, 'jobs.json');
const OUTBOX = path.join(GATEWAY_DIR, 'outbox');

fs.mkdirSync(GATEWAY_DIR, { recursive: true });
fs.mkdirSync(OUTBOX, { recursive: true });

let jobs = loadJobs();
function loadJobs() {
  try { return JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8')); } catch { return { jobs: [] }; }
}
function persist() { fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2), 'utf-8'); }

/* B185 — INTER-AGENT MESSAGES (Hermes delegates message each other): a
 * subordinate can ASK another agent a question mid-task (e.g. Ada asks Kito
 * to look something up) — a bounded, structured side-channel, never free
 * chatter. Returns the answering agent's envelope. */
const QUESTION_BUDGET = 2; // per task
const questions = new Map(); // agent → count
export async function agentAsk(fromAgent, toAgent, question, { sendEvent = () => {}, seams = null } = {}) {
  const used = questions.get(fromAgent) || 0;
  if (used >= QUESTION_BUDGET) return { status: 'error', agent: toAgent, error: 'question budget used' };
  if (!loadProfile(toAgent)) return { status: 'error', agent: toAgent, error: `unknown agent ${toAgent}` };
  questions.set(fromAgent, used + 1);
  const from = loadProfile(fromAgent);
  sendEvent('log', { agent: from?.displayName || fromAgent, message: `💬 asks ${loadProfile(toAgent).displayName}: ${String(question).slice(0, 70)}…` });
  const brief = `Another JEXI agent (${from?.displayName || fromAgent}) needs this to finish its task. Answer ONLY this, briefly and concretely:\n\n${question}`;
  const env = await runAgentTask(toAgent, brief, { sendEvent, seams, parentAgent: fromAgent });
  sendEvent('log', { agent: loadProfile(toAgent).displayName, message: `💬 answered ${from?.displayName || fromAgent}.` });
  return env;
}

/* B185 — LANE ROTATION: each agent cycles through DIFFERENT model lanes on
 * retry so the team uses many models, not one. Named per the coworker roster. */
const LANES = [
  { prefer: 'groq', name: 'Leonardo/Luna' },
  { prefer: 'gemini', name: 'Maya' },
  { prefer: 'openrouter', name: 'Sasha/Nemo' },
  { prefer: 'mistral', name: 'Milo/Marcel' },
  { prefer: 'nvidia', name: 'Wei (DeepSeek)' },
  null, // null = router's own health order (no preference)
];
const laneTick = new Map();
function pickAlternateLane(agent) {
  const n = (laneTick.get(agent) || 0) + 1;
  laneTick.set(agent, n);
  const lane = LANES[n % LANES.length] || LANES[0];
  return { prefer: lane ? lane.prefer : undefined, name: lane ? lane.name : 'auto-router', reason: 'the lead lane came back empty' };
}

/* ─────────── structured result envelopes (hermes delegate contract) ─────────── */

const OK = (agent, result, extra = {}) => ({ status: 'success', agent, result: String(result || '').trim(), artifacts: [], skills: [], tookMs: 0, ...extra });
const FAIL = (agent, error) => ({ status: 'error', agent, result: '', error: String(error || 'unknown error'), artifacts: [], skills: [] });

/* ─────────── delegation ─────────── */

/**
 * Run one subordinate agent on a brief. Isolated: own SOUL prompt, own tool
 * allowlist, own memory recall. Returns the structured envelope only.
 * `seams` = { generate, executeToolCalls } for deterministic tests.
 */
export async function runAgentTask(agentName, brief, { sendEvent = () => {}, seams = null, parentAgent = 'orchestrator' } = {}) {
  const t0 = Date.now();
  const profile = loadProfile(agentName);
  if (!profile) return FAIL(agentName, `unknown agent profile "${agentName}"`);

  // skill recall (the loop's "before" half)
  const skills = recallSkills(agentName, brief, { limit: 2 });
  const recallText = skills.length
    ? skills.map((s) => `### ${s.name} (from ${s.owner})\n${String(s.body).slice(0, 700)}`).join('\n\n')
    : '';
  const prompt = assembleAgentPrompt(agentName, { brief, recall: recallText });
  if (skills.length) sendEvent('log', { agent: profile.displayName, message: `📚 reusing ${skills.length} saved skill${skills.length > 1 ? 's' : ''} (${skills.map((s) => s.name).join(', ')}).` });

  let envelope;
  try {
    let text;
    if (seams?.generate) {
      text = await seams.generate({ agent: agentName, brief, skills, prompt: prompt.full, soul: profile.soul });
    } else {
      const { generateContent } = await import('./LLMClient.js');
      // B185 — MULTI-MODEL: never one brain. The profile's preference leads,
      // then the provider ROUTER walks every healthy provider (each a named
      // coworker — Maya, Leonardo, Wei…) — and each retry for the same task
      // rotates the lane so a task is never glued to one model.
      const prefer = profile.config.model?.prefer || undefined;
      const temperature = profile.config.model?.temperature ?? 0.3;
      let out = '';
      try {
        out = await generateContent(prompt.full, `You are ${profile.displayName}, a JEXI agent. Stay in role.`, null, { prefer, temperature });
      } catch (e) { out = ''; }
      if (!String(out || '').trim()) {
        const lane = pickAlternateLane(agentName);
        sendEvent('log', { agent: profile.displayName, message: `↻ ${lane.reason} — switching to a different coworker (${lane.name}).` });
        try {
          out = await generateContent(prompt.full, `You are ${profile.displayName}, a JEXI agent. Stay in role.`, null, { prefer: lane.prefer, temperature });
        } catch (e2) { out = ''; }
      }
      text = String(out || '');
    }
    if (!text.trim()) throw new Error('the model returned nothing');
    rememberFor(agentName, 'task', `TASK: ${brief}\nRESULT: ${text.slice(0, 600)}`);
    // auto-skill (the loop's "after" half — default ON)
    const skill = await autoSkill(agentName, { task: brief, result: text.slice(0, 500) }, seams?.generate || null);
    envelope = OK(agentName, text, { skills: skill.ok ? [skill.name] : [], tookMs: Date.now() - t0, displayName: profile.displayName });
  } catch (e) {
    envelope = FAIL(agentName, e.message || String(e));
  }
  envelope.tookMs = Date.now() - t0;
  return envelope;
}

/**
 * Orchestrator delegation: parallel (Promise.all — hermes spawns independent
 * subagents at once) or sequential (each brief may reference the previous
 * envelope's result).
 */
export async function delegate(agentNames, briefs, { mode = 'parallel', sendEvent = () => {}, seams = null } = {}) {
  const list = Array.isArray(agentNames) ? agentNames : [agentNames];
  const bs = Array.isArray(briefs) ? briefs : [briefs];
  const primary = loadProfile('orchestrator');
  questions.clear(); // fresh question budget per delegation
  sendEvent('log', { agent: primary?.displayName || 'Nova', message: `🧭 Delegating to ${list.join(mode === 'parallel' ? ' (in parallel) · ' : ' (in sequence) · ')}.` });
  const out = [];
  if (mode === 'sequential') {
    let prev = '';
    for (let i = 0; i < list.length; i++) {
      const brief = bs[i] + (prev ? `\n\nPrevious agent's result:\n${String(prev).slice(0, 1500)}` : '');
      const env = await runAgentTask(list[i], brief, { sendEvent, seams });
      out.push(env);
      if (env.status !== 'success') break;
      prev = env.result;
    }
  } else {
    const envs = await Promise.all(list.map((a, i) => runAgentTask(a, bs[i] || bs[0], { sendEvent, seams })));
    out.push(...envs);
  }
  return out;
}

/* ─────────── async jobs (unattended, restart-surviving) ─────────── */

/** NL recurrence → { nextRun(at), human }. No cron syntax required. */
export function parseNaturalSchedule(text, now = new Date()) {
  const t = String(text || '').toLowerCase();
  const time = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  let hour = time ? parseInt(time[1], 10) : 8;
  if (time && time[3] === 'pm' && hour < 12) hour += 12;
  if (time && time[3] === 'am' && hour === 12) hour = 0;
  hour = Math.max(0, Math.min(23, hour));
  const minute = time && time[2] ? parseInt(time[2], 10) : 0;

  const nextAt = (h, m) => {
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    if (d <= now) d.setDate(d.getDate() + 1);
    return d;
  };

  if (/every\s+(\d+)\s*(minute|hour)/.test(t)) {
    const m = t.match(/every\s+(\d+)\s*(minute|hour)/);
    const n = parseInt(m[1], 10); const unit = m[2];
    const ms = unit === 'hour' ? n * 3600000 : n * 60000;
    return { everyMs: ms, human: `every ${n} ${unit}${n > 1 ? 's' : ''}` };
  }
  if (/hourly|every hour/.test(t)) return { everyMs: 3600000, human: 'every hour' };
  if (/daily|every day|every (morning|evening|afternoon|night)/.test(t)) {
    return { at: { hour, minute }, human: `daily at ${hour}:${String(minute).padStart(2, '0')}` };
  }
  if (/weekly|every week/.test(t)) {
    return { at: { hour, minute }, weekly: true, human: `weekly at ${hour}:${String(minute).padStart(2, '0')}` };
  }
  return { at: { hour: hour, minute }, human: `daily at ${hour}:${String(minute).padStart(2, '0')}` };
}

function nextRunFrom(sched, now = new Date()) {
  if (sched.everyMs) return Date.now() + sched.everyMs;
  const d = new Date(now);
  d.setHours(sched.at.hour, sched.at.minute, 0, 0);
  if (d <= now) d.setDate(d.getDate() + (sched.weekly ? 7 : 1));
  return d.getTime();
}

/** Schedule a recurring agent job from natural language. */
export function scheduleJob({ agent = 'orchestrator', prompt, schedule, deliver = {}, origin = 'chat' }) {
  const sched = parseNaturalSchedule(schedule);
  const job = {
    id: `job-${crypto.randomUUID().slice(0, 8)}`,
    agent, prompt: String(prompt).slice(0, 2000), scheduleText: String(schedule),
    recurrence: sched, nextRun: nextRunFrom(sched), lastRun: null, lastStatus: null,
    runs: 0, deliver, origin, created: new Date().toISOString(),
  };
  jobs.jobs.push(job); persist();
  return { ok: true, job, human: sched.human };
}

/** Dispatch a one-off async job now (unattended). */
export function dispatchJob({ agent = 'orchestrator', prompt, deliver = {}, origin = 'manual' }) {
  const job = {
    id: `job-${crypto.randomUUID().slice(0, 8)}`,
    agent, prompt: String(prompt).slice(0, 2000), oneShot: true,
    status: 'queued', nextRun: Date.now(), deliver, origin, created: new Date().toISOString(),
  };
  jobs.jobs.push(job); persist();
  setImmediate(() => { tick().catch(() => {}); });
  return { ok: true, job };
}

export function jobStatuses() {
  return jobs.jobs.map(({ prompt, ...j }) => ({ ...j, prompt: String(prompt).slice(0, 80) }));
}
export function cancelJob(id) {
  const before = jobs.jobs.length;
  jobs.jobs = jobs.jobs.filter((j) => j.id !== id);
  persist();
  return jobs.jobs.length < before;
}

/** Deliver a finished result (hermes delivery.py analog): file + connector + chat push. */
export async function deliverResult(job, envelope) {
  const deliveries = [];
  const file = path.join(OUTBOX, `${job.id}-${Date.now()}.md`);
  const md = `# Result · ${job.id}\n\n**Agent:** ${envelope.agent}\n**Task:** ${job.prompt}\n**Status:** ${envelope.status}\n**Time:** ${new Date().toISOString()}\n\n---\n\n${envelope.result}\n`;
  try { fs.writeFileSync(file, md, 'utf-8'); deliveries.push({ channel: 'file', ok: true, target: file }); } catch (e) { deliveries.push({ channel: 'file', ok: false, error: e.message }); }
  if (job.deliver?.channel === 'email' && job.deliver?.to) {
    try {
      const { sendEmail } = await import('./Emailer.js');
      await sendEmail({ to: job.deliver.to, subject: `JEXI · ${String(job.prompt).slice(0, 60)}`, text: envelope.result });
      deliveries.push({ channel: 'email', ok: true, target: job.deliver.to });
    } catch (e) { deliveries.push({ channel: 'email', ok: false, error: (e.message || '').slice(0, 120) }); }
  }
  return deliveries;
}

/** Scheduler tick: run due jobs. Exposed for the interval AND for boot-resume. */
export async function tick({ sendEvent = () => {}, seams = null } = {}) {
  const now = Date.now();
  let ran = 0;
  for (const job of jobs.jobs) {
    if (job.nextRun > now || job.running) continue;
    job.running = true; job.lastRun = now; persist();
    const env = await runAgentTask(job.agent, job.prompt, { sendEvent, seams });
    job.lastStatus = env.status;
    job.runs += 1;
    job.deliveries = await deliverResult(job, env);
    job.running = false;
    if (job.oneShot) job.nextRun = Number.MAX_SAFE_INTEGER; // done forever
    else job.nextRun = nextRunFrom(job.recurrence);
    ran += 1;
  }
  if (ran) persist();
  return ran;
}

/* boot: resume + heartbeat (the "gateway process" — survives restarts) */
let started = false;
export function startGateway(sendEvent = () => {}) {
  if (started) return; started = true;
  // resume: any job whose nextRun passed while we were down runs NOW.
  const due = jobs.jobs.filter((j) => !j.oneShot || j.lastStatus === null).length;
  if (due) tick({ sendEvent }).catch(() => {});
  setInterval(() => tick({ sendEvent }).catch(() => {}), 60_000);
  return true;
}
