/**
 * JEXI OS — Subagent Runtime (roadmap stage 14: spawn, parallel, cancel, aggregate).
 *
 * Grok Build lesson #6: spawn_subagent runs child tasks with their own turns
 * and a native view; detailed spawning policy caps parallelism. This module is
 * JEXI's version: each subagent is an independent tool-calling AgentLoop with
 * its own plan and events, several run concurrently (bounded), any can be
 * cancelled, and the results are aggregated into one final answer.
 *
 * Events streamed via sendEvent:
 *   subagent.plan  → { name, query }
 *   subagent.start → { name }
 *   subagent.done  → { name, status, toolCalls, durationMs, preview }
 *   subagent.aggregate → { answer, counts }
 */

import { runAgentLoop } from './AgentLoop.js';

const MAX_PARALLEL = 3;   // bounded concurrency (Grok Build: never unlimited)
const MAX_SUBAGENTS = 8;

/** Deterministic mission decomposition: split on 'and/then/also', ';' or newlines. */
export function decomposeQuery(query) {
  const parts = String(query || '')
    .split(/\s+(?:and|then|also|plus)\s+|;\s*|\n+/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 8);
  return parts.length >= 2 ? parts.slice(0, MAX_SUBAGENTS) : [];
}

/**
 * Run subagents over the given tasks.
 * tasks: [{ name, query, image }]  — callers decompose the mission.
 * Returns { subagents: [...], aggregate }.
 */
export async function runSubagents({ tasks, sendEvent, opts = {} }) {
  if (typeof sendEvent !== 'function') sendEvent = () => {};
  const emit = (type, payload) => { try { sendEvent(type, payload); } catch (e) {} };

  const jobs = (tasks || []).slice(0, MAX_SUBAGENTS);
  if (!jobs.length) {
    emit('subagent.aggregate', { answer: 'No subtasks were provided.', counts: { ok: 0, failed: 0 } });
    return { subagents: [], aggregate: 'No subtasks were provided.' };
  }

  emit('subagent.plan', { total: jobs.length, names: jobs.map((j) => j.name || 'sub') });

  const results = [];
  const cancelled = () => !!(opts.signal && opts.signal.aborted);

  // Worker pool with bounded concurrency — each subagent gets its own
  // AgentLoop (own plan, own tool calls, own context).
  let cursor = 0;
  async function worker() {
    while (cursor < jobs.length && !cancelled()) {
      const job = jobs[cursor++];
      const name = job.name || `sub-${cursor}`;
      emit('subagent.start', { name });
      const started = Date.now();
      try {
        const res = await runAgentLoop({
          query: job.query,
          image: job.image,
          opts: { ...opts, signal: opts.signal },
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

  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, jobs.length) }, () => worker()));

  // Aggregate: pass the finished subanswers to the main model for synthesis.
  const ok = results.filter((r) => r.status === 'done' && r.answer);
  let aggregate = '';
  if (cancelled()) {
    aggregate = '';
  } else if (ok.length === 1) {
    aggregate = ok[0].answer; // single subagent — no synthesis needed
  } else if (ok.length > 1) {
    try {
      const { generateContent } = await import('./LLMClient.js');
      const { JEXI_SYSTEM_PROMPT } = await import('./JexiPrompt.js');
      const { preferencesBlock } = await import('./PreferenceLearner.js');
      const parts = ok.map((r) => `## ${r.name}\n${String(r.answer).slice(0, 4000)}`).join('\n\n');
      aggregate = await generateContent(
        `Combine the sub-reports below into one clear final answer to the user's overall task. Merge overlaps, keep the best evidence, keep headings and LaTeX. Output only the final answer.\n\n${parts.slice(0, 16000)}`,
        JEXI_SYSTEM_PROMPT + preferencesBlock(),
        null,
        { temperature: 0.3 }
      );
    } catch (e) {
      aggregate = ok.map((r) => `### ${r.name}\n\n${r.answer}`).join('\n\n---\n\n');
    }
  }

  const counts = { ok: ok.length, failed: results.length - ok.length, total: results.length };
  emit('subagent.aggregate', { answer: aggregate, counts });
  return { subagents: results, aggregate, counts };
}
