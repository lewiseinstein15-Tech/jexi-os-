/**
 * JEXI OS — Hermes Profiles Plugin (B180d).
 * Wires the B180 agent system into the REAL runtime:
 *   - delegate_task  : the orchestrator tool — run any subordinate profile
 *                      (Ada/Kito/Zuri/Tari) and get a structured envelope
 *   - gateway_schedule / gateway_status / gateway_cancel : NL job control
 *   - skill_search   : recall saved precedents across agents
 *   - /agents        : see the team, jobs and recent skills in chat
 */

import { delegate, scheduleJob, jobStatuses, cancelJob, agentAsk } from '../../src/services/AgentGateway.js';
import { listProfiles } from '../../src/services/AgentProfiles.js';
import { recallSkills } from '../../src/services/SkillLoop.js';
import { registerCommand } from '../../src/services/CommandRegistry.js';

export const name = 'hermes-profiles';
export const version = '1.0.0';
export const inject = ['tools'];

export async function apply(ctx) {
  const un = [];
  const reg = (d) => un.push(ctx.tools.register(d));

  reg({
    slug: 'delegate_task',
    name: 'Delegate Task',
    desc: 'Run a named JEXI agent on a brief and get a structured result {status, result, artifacts, skills}. Agents: dev (Ada, code+run), research (Kito, web+sources), comms (Zuri, delivery), scheduler (Tari, recurring jobs). Use for parallel/sequential specialist work.',
    args: {
      agents: { type: 'array', required: true, desc: 'agent names, e.g. ["research"] or ["research","dev"]' },
      briefs: { type: 'array', required: true, desc: 'one task brief per agent (same order)' },
      mode: { type: 'string', required: false, desc: '"parallel" (default) or "sequential" (agent N sees agent N-1 result)' },
    },
    handler: async (a, o = {}) => {
      const envs = await delegate(a.agents, a.briefs, { mode: a.mode || 'parallel', sendEvent: o.sendEvent || (() => {}) });
      return { ok: envs.every((e) => e.status === 'success'), envelopes: envs };
    },
  });

  reg({
    slug: 'gateway_schedule',
    name: 'Schedule Agent Job',
    desc: 'Schedule recurring agent work in natural language — "every morning at 8am", "daily", "every 2 hours". The job runs unattended (survives restarts) and the result is delivered to a file + chat. No cron syntax.',
    args: {
      agent: { type: 'string', required: false, desc: 'profile name (default orchestrator)' },
      prompt: { type: 'string', required: true, desc: 'what the agent should do each run' },
      schedule: { type: 'string', required: true, desc: 'natural-language recurrence' },
    },
    handler: async (a) => scheduleJob({ agent: a.agent || 'orchestrator', prompt: a.prompt, schedule: a.schedule }),
  });

  reg({
    slug: 'gateway_status',
    name: 'Gateway Job Status',
    desc: 'List running/scheduled agent jobs with last result, next run and deliveries.',
    handler: async () => ({ ok: true, jobs: jobStatuses() }),
  });

  reg({
    slug: 'gateway_cancel',
    name: 'Cancel Agent Job',
    desc: 'Cancel a scheduled agent job by id.',
    args: { id: { type: 'string', required: true } },
    handler: async (a) => ({ ok: cancelJob(a.id) }),
  });

  reg({
    slug: 'agent_ask',
    name: 'Ask Another Agent',
    desc: 'Ask a fellow JEXI agent a specific question mid-task (bounded to 2 per task). Agents: dev (Ada), research (Kito), comms (Zuri), scheduler (Tari). Use when you need another specialist input to finish your work.',
    args: {
      from: { type: 'string', required: true, desc: 'your agent name' },
      to: { type: 'string', required: true, desc: 'agent to ask' },
      question: { type: 'string', required: true, desc: 'the specific question' },
    },
    handler: async (a, o = {}) => agentAsk(a.from, a.to, a.question, { sendEvent: o.sendEvent || (() => {}) }),
  });

  reg({
    slug: 'skill_search',
    name: 'Search Skills',
    desc: 'Search saved reusable skills (precedents) across all agent profiles.',
    args: { query: { type: 'string', required: true } },
    handler: async (a) => ({ ok: true, skills: recallSkills('orchestrator', a.query, { limit: 5 }).map((s) => ({ name: s.name, owner: s.owner, when: s.when, body: String(s.body).slice(0, 500) })) }),
  });

  // /agents — visibility in chat
  try {
    un.push(registerCommand({
      name: 'agents',
      description: 'show JEXI agent profiles, gateway jobs and latest skills',
      async run(invocation) {
        const profiles = listProfiles().map((p) => `- **${p.displayName}** (${p.name}, ${p.role}) — ${String(p.soul.match(/^# (.+)$/m)?.[1] || p.role)}`);
        const jobs = jobStatuses().slice(0, 6).map((j) => `- \`${j.id}\` ${j.agent} · ${j.oneShot ? 'one-shot' : j.scheduleText} · ${j.lastStatus || 'pending'}${j.nextRun < Number.MAX_SAFE_INTEGER ? ` · next ${new Date(j.nextRun).toLocaleString()}` : ''}`);
        const skills = recallSkills('orchestrator', '', { limit: 5, includeForeign: true });
        return {
          ok: true,
          summary: `### 🧬 JEXI Agents (Hermes profiles)\n\n${profiles.join('\n')}\n\n**Gateway jobs**\n${jobs.length ? jobs.join('\n') : '_none scheduled — ask me to run something daily._'}\n\n**Recent skills**\n${skills.length ? skills.map((s) => `- \`${s.name}\` (${s.owner})`).join('\n') : '_none yet — they save automatically after tasks._`'}`,
        };
      },
    }));
  } catch { /* already registered */ }

  return () => un.forEach((u) => { try { u(); } catch { /* noop */ } });
}
