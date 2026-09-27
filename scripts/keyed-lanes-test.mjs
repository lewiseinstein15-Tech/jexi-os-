#!/usr/bin/env node
/**
 * P11 A1 — KEYED-MODEL LANES harness.
 *
 * The L3 routing / child synthesis / LLM-summarize lanes were wired through
 * real seams but are only PROVABLE with a model key. This harness runs SIX
 * keyed scenarios end-to-end when ANY provider key is present:
 *
 *   K1  model-routed turn          — generateContent through the provider
 *                                    ladder answers a real question
 *   K2  model-driven child synthesis — a SubagentRuntime child runs the real
 *                                    model loop (canChat() true) and returns
 *                                    a model-written answer
 *   K3  LLM-summarized long answer — generateContent summarizes a long blob
 *                                    (the summarize lane)
 *   K4  novel-phrasing routing     — routeDecision picks web_search for a
 *                                    phrasing no regex evidence covers
 *                                    (model/semantic layer, not keyword)
 *   K5  multi-step plan            — executePlan runs a bounded think→act→
 *                                    observe plan with model steering
 *   K6  cost-metered run           — RequestMeter reports the real call list
 *                                    for a metered turn
 *
 * When NO key is present (this sandbox): every scenario is marked
 * SKIPPED-KEYLESS with the honest reason and the harness exits 0 — the
 * harness is LEFT READY for a keyed host (set GROQ_API_KEY or any provider
 * key in the environment and re-run).
 *
 * Honest disclosure recorded by the probe: the Pollinations KEYLESS leg now
 * returns 401 UNAUTHORIZED wrapped in HTTP 200 ("A valid API key is
 * required" — the anonymous tier is closed), so there is NO working model
 * provider in this sandbox and the keyed paths cannot be live-verified here.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), `a1-keyed-${Date.now()}-`));

const { resolveKeys } = await import(path.join(ROOT, 'server/src/providers/runtime/LLMClient.js'));
const { canChat } = await import(path.join(ROOT, 'server/src/providers/index.js'));

const keys = resolveKeys();
const keyMap = {
  groq: keys.groqKey, gemini: keys.geminiKey, openrouter: keys.openrouterKey,
  hf: keys.hfKey, cerebras: keys.cerebrasKey, deepinfra: keys.deepinfraKey,
  mistral: keys.mistralKey, xai: keys.xaiKey, deepseek: keys.deepseekKey,
  nvidia: keys.nvidiaKey, sambanova: keys.sambanovaKey, pollinations: keys.pollinationsKey,
  cloudflare: keys.cloudflareKey,
};
const present = Object.entries(keyMap).filter(([, v]) => v && String(v).trim());

if (!present.length || !canChat()) {
  console.log('KEY PRESENCE: none');
  console.log(`provider keys configured: ${present.length ? present.map(([k]) => k).join(', ') : 'NONE'}`);
  console.log(`canChat(): ${canChat()}`);
  // live probe of the keyless leg for the honest record
  let poll = 'unreachable';
  try {
    const r = await fetch('https://gen.pollinations.ai/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'openai-fast', messages: [{ role: 'user', content: 'ping' }], max_tokens: 5 }),
    });
    const body = await r.json().catch(() => ({}));
    poll = `HTTP ${r.status} body.status=${body && body.status} error=${body && body.error && body.error.code}`;
  } catch (e) { poll = `network error: ${String(e && e.message || e).slice(0, 80)}`; }
  console.log(`Pollinations keyless leg probe: ${poll}`);
  console.log('');
  console.log('RESULT: SKIPPED-KEYLESS — no provider key in this sandbox; the anonymous Pollinations tier is CLOSED (401 UNAUTHORIZED), so no model lane can run here.');
  console.log('The harness is READY: on a keyed host run `GROQ_API_KEY=<key> node scripts/keyed-lanes-test.mjs` and the six K-scenarios execute for real.');
  process.exit(0);
}

// ══════════ KEYED PATH — six real scenarios ══════════
console.log(`KEY PRESENCE: ${present.map(([k]) => k).join(', ')} — running six keyed scenarios`);
const { generateContent, noteMeterModelCall } = await import(path.join(ROOT, 'server/src/providers/runtime/LLMClient.js'));
const { routeDecision } = await import(path.join(ROOT, 'server/src/services/AgenticDecision.js'));
const results = [];
const check = (id, ok, detail) => { results.push(ok); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} — ${detail}`); };

// K1 — model-routed turn
{
  const out = await generateContent('What is 21 * 2? Answer with just the number.', 'Answer with just the number.', null, { temperature: 0 });
  check('K1 model-routed turn', String(out).includes('42'), `answer=${JSON.stringify(String(out).slice(0, 40))}`);
}

// K2 — model-driven child synthesis (canChat() true → the model loop runs)
{
  const { runAgentLoop } = await import(path.join(ROOT, 'server/src/services/AgentLoop.js'));
  const r = await runAgentLoop({ query: 'In one short sentence, why is the sky blue?', sendEvent: () => {}, opts: {} });
  const modelRan = r.stats.toolCalls >= 0 && String(r.answer).trim().length > 20 && !/could not produce/i.test(r.answer);
  check('K2 model-driven child synthesis', modelRan, `answer=${JSON.stringify(String(r.answer).slice(0, 90))}`);
}

// K3 — LLM-summarized long answer
{
  const blob = Array.from({ length: 24 }, (_, i) => `Paragraph ${i + 1}: the JEXI runtime keeps narration ${['honest','streamed','verified'][i % 3]} and every block traces to a real event number ${i + 1}.`).join('\n');
  const out = await generateContent(`Summarize in TWO sentences:\n${blob}`, 'You summarize tightly.');
  check('K3 LLM-summarized long answer', String(out).trim().length > 40 && String(out).trim().length < blob.length / 2, `summaryLen=${String(out).trim().length} (input ${blob.length})`);
}

// K4 — novel-phrasing routing (model/semantic lane decides)
{
  const d = await routeDecision('catch me up on the latest space headlines');
  check('K4 novel-phrasing routing', d.route === 'web_search', `route=${d.route} via=${d.via}`);
}

// K5 — multi-step plan (bounded think→act→observe with model steering)
{
  const { executePlan } = await import(path.join(ROOT, 'server/src/services/AgenticDecision.js'));
  const decision = await routeDecision('search the web for the latest JEXI OS release notes');
  const plan = await executePlan(decision, 'search the web for the latest JEXI OS release notes', { maxSteps: 3, thinkBetweenSteps: true });
  check('K5 multi-step plan', plan.trace && plan.trace.steps.length >= 1, `steps=${plan.trace.steps.length} ok=${plan.trace.ok} via=${decision.via}`);
}

// K6 — cost-metered run
{
  const { requestMeterReport, meterEnter } = await import(path.join(ROOT, 'server/src/providers/runtime/LLMClient.js')).then(async (m) => ({ requestMeterReport: m.requestMeterReport, meterEnter: m.meterEnter }));
  meterEnter({ kind: 'chat', query: 'metered probe' });
  await generateContent('Reply with exactly: METERED', 'Reply with exactly one word.', null, { temperature: 0 });
  const rep = requestMeterReport();
  const calls = rep && Array.isArray(rep.calls) ? rep.calls : [];
  check('K6 cost-metered run', calls.length >= 1, `meteredCalls=${JSON.stringify(calls).slice(0, 120)}`);
}

const pass = results.filter(Boolean).length;
console.log('──────────────────────────────────────────────');
console.log(` A1 RESULT: ${pass}/${results.length} keyed scenarios PASS`);
process.exit(pass === results.length ? 0 : 1);
