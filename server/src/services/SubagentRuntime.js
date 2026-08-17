/**
 * JEXI OS — Subagent Runtime (roadmap stage 14: spawn, parallel, cancel, aggregate).
 *
 * Grok Build lesson #6: spawn_subagent runs child tasks with their own turns
 * and a native view; detailed spawning policy caps parallelism. This module is
 * JEXI's version: each subagent is an independent tool-calling AgentLoop with
 * its own plan and events, several run concurrently (bounded), any can be
 * cancelled, and the results are aggregated into one final answer.
 *
 * B50 P4 — ISOLATION: a task (or a skill whose frontmatter declares
 * `context: fork`) runs in its OWN context window and the parent receives ONLY
 * a short summary + status (PASS/FAIL) + key artifacts — never the full
 * intermediate transcript. Reusable agent definition files (server/agents/*.md)
 * can be loaded to drive isolated runs.
 *
 * Events streamed via sendEvent:
 *   subagent.plan  → { name, query }
 *   subagent.start → { name }
 *   subagent.done  → { name, status, toolCalls, durationMs, preview }
 *   subagent.aggregate → { answer, counts }
 */

import { runAgentLoop } from './AgentLoop.js';
import { loadAgentDefinition, wantsIsolation } from './AgentDefinitions.js';
import { skillWantsIsolation } from './SkillChain.js';

const MAX_PARALLEL = 3;   // bounded concurrency (Grok Build: never unlimited)
const MAX_SUBAGENTS = 8;
const MAX_SUMMARY_CHARS = 350; // what the parent is allowed to see for forked runs

/** Deterministic mission decomposition: split on 'and/then/also', ';' or newlines. */
export function decomposeQuery(query) {
  const parts = String(query || '')
    .split(/\s+(?:and|then|also|plus)\s+|;\s*|\n+/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 8);
  return parts.length >= 2 ? parts.slice(0, MAX_SUBAGENTS) : [];
}

/**
 * Summarize a subagent's full transcript for the parent (isolation boundary).
 * Prefers an LLM one-liner; falls back to a deterministic head truncation so
 * the isolation contract holds even with no keys.
 */
async function summarizeForParent(fullAnswer, name) {
  const text = String(fullAnswer || '');
  if (text.length <= MAX_SUMMARY_CHARS) return text;
  try {
    const { generateContent } = await import('./LLMClient.js');
    const s = await generateContent(
      `Summarize this ${name} report for a parent agent in at most 3 sentences — the key conclusion and the strongest evidence only. No preamble.\n\n${text.slice(0, 8000)}`,
      'You write tight 3-sentence summaries.',
      null,
      { temperature: 0.2 }
    );
    if (String(s || '').trim()) return String(s).trim().slice(0, MAX_SUMMARY_CHARS * 2);
  } catch (e) { /* fall through */ }
  return text.slice(0, MAX_SUMMARY_CHARS) + '…';
}

/** Extract key artifacts (headings / file-ish lines) from a full answer. */
function keyArtifacts(answer) {
  const lines = String(answer || '').split('\n').filter((l) => /^#{1,3}\s/.test(l.trim()) || /^(`|\*\*)?[A-Z][A-Z -]{3,}/.test(l.trim()));
  return lines.slice(0, 6).map((l) => l.trim().replace(/^#{1,3}\s*/, '').replace(/[*`]/g, '').slice(0, 80));
}

/**
 * Run ONE isolated subagent: own context window, and the parent gets only
 * { name, status, summary, artifacts, toolCalls, durationMs } — the full
 * transcript stays inside the fork.
 */
export async function runIsolatedSubagent({ name, query, image, sendEvent, opts = {} }) {
  if (typeof sendEvent !== 'function') sendEvent = () => {};
  const emit = (type, payload) => { try { sendEvent(type, payload); } catch (e) {} };
  const started = Date.now();
  emit('subagent.start', { name, isolated: true });
  try {
    const res = await runAgentLoop({ query, image, opts: { ...opts, signal: opts.signal }, sendEvent: (t, d) => sendEvent(t, { ...d, subagent: name }) });
    const status = res.cancelled ? 'cancelled' : (res.answer ? 'PASS' : 'FAIL');
    const summary = res.cancelled ? '' : await summarizeForParent(res.answer, name);
    const out = { name, query, status, summary, artifacts: keyArtifacts(res.answer), toolCalls: res.stats?.toolCalls || 0, durationMs: Date.now() - started, isolated: true };
    emit('subagent.done', { name, status, toolCalls: out.toolCalls, durationMs: out.durationMs, preview: String(summary).slice(0, 120) });
    return out;
  } catch (e) {
    const out = { name, query, status: 'FAIL', summary: '', artifacts: [], toolCalls: 0, durationMs: Date.now() - started, isolated: true, error: (e && e.message) || String(e) };
    emit('subagent.done', { name, status: 'FAIL', error: out.error });
    return out;
  }
}

/**
 * Run subagents over the given tasks.
 * tasks: [{ name, query, image, context, agentDef }] — callers decompose the
 * mission. A task with `context: 'fork'` (or whose `agentDef` declares
 * `context: fork`, or whose name matches a forking skill) runs ISOLATED: the
 * parent receives only summary + status + artifacts.
 * Returns { subagents: [...], aggregate }.
 */
/**
 * B96 — single delegated subagent (DSH tool-subagent): runs ONE child task
 * in its own context and returns a plain-text report. Used by the `subagent`
 * tool so the agent loop can delegate.
 */
export async function runSubagent(task, instructions = '', opts = {}) {
  const events = [];
  const sendEvent = (type, data) => { events.push({ type, ...data }); };
  const out = await runSubagents({
    tasks: [{ name: 'sub', query: String(task || ''), instructions: String(instructions || '').slice(0, 1000) }],
    sendEvent,
    opts: { ...opts, depth: Number(opts.depth) || 1 },
  });
  if (out && out.subagents && out.subagents[0]) {
    const r = out.subagents[0];
    return String(r.report || r.summary || r.answer || 'subagent finished').slice(0, 3000);
  }
  return String((out && out.aggregate) || 'subagent finished').slice(0, 3000);
}

export async function runSubagents({ tasks, sendEvent, opts = {} }) {  if (typeof sendEvent !== 'function') sendEvent = () => {};
  const emit = (type, payload) => { try { sendEvent(type, payload); } catch (e) {} };

  const jobs = (tasks || []).slice(0, MAX_SUBAGENTS);
  if (!jobs.length) {
    emit('subagent.aggregate', { answer: 'No subtasks were provided.', counts: { ok: 0, failed: 0 } });
    return { subagents: [], aggregate: 'No subtasks were provided.' };
  }

  // Decide isolation per job: explicit flag, agent definition, or skill frontmatter.
  const decided = jobs.map((job) => {
    const def = job.agentDef ? loadAgentDefinition(job.agentDef) : null;
    const isolated = job.context === 'fork' || wantsIsolation(def) || skillWantsIsolation(job.skillSlug || job.name);
    return { ...job, def, isolated };
  });

  emit('subagent.plan', { total: decided.length, names: decided.map((j) => j.name || 'sub'), isolated: decided.filter((j) => j.isolated).length });

  const results = [];
  const cancelled = () => !!(opts.signal && opts.signal.aborted);

  // Worker pool with bounded concurrency — each subagent gets its own
  // AgentLoop (own plan, own tool calls, own context).
  let cursor = 0;
  async function worker() {
    while (cursor < decided.length && !cancelled()) {
      const job = decided[cursor++];
      const name = job.name || `sub-${cursor}`;
      if (job.isolated) {
        results.push(await runIsolatedSubagent({ name, query: job.query, image: job.image, sendEvent: (t, d) => sendEvent(t, { ...d, subagent: name }), opts: { ...opts, systemPromptOverride: job.def?.systemPrompt } }));
        continue;
      }
      emit('subagent.start', { name });
      const started = Date.now();
      try {
        const res = await runAgentLoop({
          query: job.query,
          image: job.image,
          opts: { ...opts, signal: opts.signal, systemPromptOverride: job.def?.systemPrompt },
          sendEvent: (type, data) => sendEvent(type, { ...data, subagent: name }),
        });
        const status = res.cancelled ? 'cancelled' : 'done';
        results.push({ name, query: job.query, status, toolCalls: res.stats?.toolCalls || 0, durationMs: Date.now() - started, answer: res.answer || '' });
        emit('subagent.done', { name, status, toolCalls: results[results.length - 1].toolCalls, durationMs: results[results.length - 1].durationMs, preview: String(res.answer || '').slice(0, 120) });
      } catch (e) {
        results.push({ name, query: job.query, status: 'failed', durationMs: Date.now() - started, answer: '', error: (e && e.message) || String(e) });
        emit('subagent.done', { name, status: 'failed', error: (e && e.message) || String(e) });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, decided.length) }, () => worker()));

  // Aggregate: pass ONLY the parent-visible parts (full answers for normal,
  // summaries for isolated) to the main model for synthesis.
  const ok = results.filter((r) => (r.status === 'PASS' || r.status === 'done') && (r.answer || r.summary));
  let aggregate = '';
  if (cancelled()) {
    aggregate = '';
  } else if (ok.length === 1) {
    aggregate = ok[0].answer || ok[0].summary; // single subagent — no synthesis needed
  } else if (ok.length > 1) {
    try {
      const { generateContent } = await import('./LLMClient.js');
      const { JEXI_SYSTEM_PROMPT } = await import('./JexiPrompt.js');
      const { preferencesBlock } = await import('./PreferenceLearner.js');
      const parts = ok.map((r) => `## ${r.name}${r.isolated ? ' (isolated summary)' : ''}\n${String(r.isolated ? r.summary : r.answer).slice(0, 4000)}`).join('\n\n');
      aggregate = await generateContent(
        `Combine the sub-reports below into one clear final answer to the user's overall task. Merge overlaps, keep the best evidence, keep headings and LaTeX. Output only the final answer.\n\n${parts.slice(0, 16000)}`,
        JEXI_SYSTEM_PROMPT + preferencesBlock(),
        null,
        { temperature: 0.3 }
      );
    } catch (e) {
      aggregate = ok.map((r) => `### ${r.name}\n\n${r.isolated ? r.summary : r.answer}`).join('\n\n---\n\n');
    }
  }

  const counts = { ok: ok.length, failed: results.length - ok.length, total: results.length, isolated: results.filter((r) => r.isolated).length };
  emit('subagent.aggregate', { answer: aggregate, counts });
  return { subagents: results, aggregate, counts };
}
