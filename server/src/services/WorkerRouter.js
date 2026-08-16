/**
 * JEXI OS — Worker Router (B66, Orchestrator-Workers architecture).
 *
 * The orchestrator selects COWORKERS by task type — not by reordering a
 * global preference list. Each coworker owns an exact provider→model chain:
 * its PRIMARY model, a fallback, and finally the general last-resort tier
 * (HuggingFace → DeepInfra → Mistral).
 *
 *   coder       → DeepSeek first (deepseek-chat), Qwen via OpenRouter as fallback
 *   memory      → Qwen (summarization/cross-check) + Gemini (large context)
 *   researcher  → Grok (xAI) first, Groq, then OpenRouter free models
 *   fallback    → HuggingFace → DeepInfra → Mistral (last resort only)
 *
 * runWorker() executes one coworker: it walks the coworker's chain with the
 * provider pinned via generateContent(opts.provider/opts.model). When the
 * task supplies native tool schemas (opts.tools) and the provider supports
 * function-calling, runWorker uses generateWithTools instead — real native
 * tool calls, not JSON-in-prose parsing.
 */

import { generateWithToolsLoop, generateContentSafe } from './LLMClient.js';
import { executeTool } from './ToolRuntime.js';

/** Coworker assignments — exact models per task type (B66 3b). */
export const COWORKERS = {
  coder: {
    role: 'Coding / GitHub operations',
    providers: [
      { key: 'deepseek', model: 'deepseek-chat' },
      // B72 — qwen/qwen3-8b:free was REMOVED from OpenRouter (live-verified:
      // zero free Qwen models remain). Replaced with seed-2.0-mini, the
      // codebase's own established OpenRouter model that the live provider
      // probe proves works with this account's key.
      { key: 'openrouter', model: 'bytedance-seed/seed-2.0-mini' },
    ],
  },
  memory: {
    role: 'Memory / conversation continuity',
    providers: [
      // B72 — was qwen/qwen3-8b:free (deleted from OpenRouter). Every
      // conversation task died on this dead model before Gemini was tried.
      { key: 'openrouter', model: 'bytedance-seed/seed-2.0-mini' },
      { key: 'gemini', model: 'gemini-2.5-flash' },         // Gemini: large-context handling
    ],
  },
  researcher: {
    role: 'Research / realtime information',
    providers: [
      { key: 'xai', model: 'grok-4.6' },
      { key: 'groq', model: 'llama-3.1-8b-instant' },
      { key: 'openrouter', model: 'bytedance-seed/seed-2.0-mini' },
    ],
  },
  fallback: {
    role: 'General fallback (last resort)',
    providers: [
      { key: 'huggingface' },
      { key: 'deepinfra' },
      { key: 'mistral' },
    ],
  },
};

/** Task type → coworker. Unknown/general → memory worker (conversation-aware). */
export function coworkerFor(taskType) {
  const t = String(taskType || '');
  if (/code|github|file|build|app|bug|fix|math_solve/.test(t)) return 'coder';
  if (/research|news|search|study|link|current|latest/.test(t)) return 'researcher';
  if (/memory|summary|summarize|remember|context/.test(t)) return 'memory';
  return 'memory';
}

/** Ordered provider list for a coworker, including the last-resort tier. */
export function coworkerChain(role) {
  const primary = COWORKERS[role] || COWORKERS.memory;
  return [...primary.providers, ...COWORKERS.fallback.providers];
}

/** Exposed for the Models/status screen — the REAL running roster (B66 honesty). */
export function workerRoster() {
  return Object.entries(COWORKERS).map(([slug, w]) => ({
    slug,
    role: w.role,
    providers: w.providers.map((p) => (p.model ? `${p.key}:${p.model}` : p.key)),
    fallback: COWORKERS.fallback.providers.map((p) => p.key),
  }));
}

/**
 * B67 — execute the model's native tool calls through the REAL gated tool
 * runtime (ToolRuntime.executeTool: permission profile → risk guard → arg
 * validation → engine), and return the OpenAI-shaped [{ tool_call_id, content }]
 * results the tool loop feeds back to the model. Blocked / approval-required /
 * failed calls return their honest error text — the model never sees a fake
 * success, and an external-tier tool without a confirm callback reports that
 * it needs approval (truthful failure, B66 3a).
 */
export async function executeNativeToolCalls(calls, opts = {}) {
  const out = [];
  for (const call of calls || []) {
    const res = await executeTool({
      slug: call.name,
      args: call.arguments || {},
      profile: opts.profile,
      intent: opts.intent,
      sendEvent: opts.sendEvent,
      confirm: opts.confirm,
    });
    const content = res && res.ok && res.result
      ? String(res.result).slice(0, 6000)
      : `ERROR: ${(res && res.error) || 'tool returned no output'}`;
    out.push({ tool_call_id: call.id, name: call.name, content });
  }
  return out;
}

/**
 * Run one coworker for a task. Returns
 *   { ok, text, worker, provider, model, toolCalls?, iterations?, degraded?, attempts }
 * Never throws: on total failure the text carries the honest degraded
 * message from generateContentSafe (B66 3e — no raw errors, no pretending).
 *
 * B67 — native tool-calling adoption: when opts.tools (tool defs) is passed,
 * runWorker runs the REAL native loop (generateWithToolsLoop + executeTool
 * executor) — the model declares tool_calls through the provider API, the
 * coworker executes them with full gating, results feed back, and the loop
 * repeats until the model answers directly. No JSON-in-prose anywhere.
 */
export async function runWorker(role, prompt, system = '', opts = {}) {
  const chain = coworkerChain(role);
  const attempts = [];
  const wantsTools = Array.isArray(opts.tools) && opts.tools.length > 0;

  // Pass 1 — native tool calling (B67): walk the chain with real function
  // calls through the gated runtime. NOTE: only TOOL_CAPABLE providers are
  // even attempted here — Gemini/HuggingFace are text-only and get skipped
  // by generateWithToolsLoop, so a tools-first task can fail even when those
  // providers are healthy.
  if (wantsTools) {
    for (const p of chain) {
      const label = p.model ? `${p.key}(${p.model})` : p.key;
      try {
        const res = await generateWithToolsLoop(prompt, system, opts.tools, {
          provider: p.key,
          model: p.model,
          temperature: opts.temperature,
          maxIterations: opts.maxIterations,
          signal: opts.signal,
          __mockCompletions: opts.__mockCompletions, // test seam
          // Execute the model's native tool calls through the gated runtime.
          executeToolCalls: (calls) => executeNativeToolCalls(calls, opts),
        });
        if (res.ok) {
          return { ok: true, text: res.text, toolCalls: res.toolCalls || [], iterations: res.iterations || 0, worker: role, provider: res.provider, model: res.model, attempts };
        }
        attempts.push(`${label}: empty response`);
      } catch (e) {
        attempts.push(`${label}: ${(e && e.message) || e}`);
      }
    }
  }

  // Pass 2 — plain-text fallback (B72): if tools failed for every
  // tool-capable provider (dead model, no balance, tool-call rejected) OR no
  // tools were requested, walk the SAME chain WITHOUT tools. This is what
  // makes Gemini / HuggingFace / Mistral reachable for conversation tasks —
  // they are text-only and were unreachable through the tool path. Tools are
  // a bonus, never a hard requirement: a conversation answer must not die
  // because every tool-capable provider is down.
  for (const p of chain) {
    const label = p.model ? `${p.key}(${p.model})` : p.key;
    try {
      const res = await generateContentSafe(prompt, system, null, { provider: p.key, model: p.model, temperature: opts.temperature });
      if (res.ok && res.text) {
        return { ok: true, text: res.text, degraded: !!res.degraded, local: !!res.local, worker: role, provider: res.provider || p.key, model: res.model || p.model || null, attempts };
      }
      attempts.push(`${label}: ${res.error || 'empty response'}`);
    } catch (e) {
      attempts.push(`${label}: ${(e && e.message) || e}`);
    }
  }

  // Total failure — never throw: hand back the honest degraded message.
  const reason = attempts.join(' | ').slice(0, 400);
  return {
    ok: false,
    degraded: true,
    worker: role,
    text: `### ⚠ JEXI OS — degraded mode\n\nI'm having trouble reaching my usual AI resources right now${reason ? ` (${reason})` : ''}. No coworker completed the request. Please try again in a minute, or check the model keys in **Settings → Models**.`,
    attempts,
  };
}
