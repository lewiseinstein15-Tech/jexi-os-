/**
 * B162 — NAMED MODEL COWORKERS (user-verified roster, 2026-08-28).
 *
 * In every streaming surface JEXI shows ONLY the coworker's people name —
 * never the raw model ID or the provider's model branding.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let failures = 0;
const ok = (name, cond) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) failures += 1;
};

/* ══════════════ 1. THE REGISTRY ══════════════ */
console.log('\n== 1. Registry: every worker-chain model has a people name ==');
{
  const { coworkerName, teamRoster } = await import('./src/services/ModelCoworkers.js');
  const { coworkerChain } = await import('./src/services/WorkerRouter.js');

  const chains = ['coder', 'memory', 'researcher', 'fallback'];
  const seen = new Set();
  for (const role of chains) {
    for (const step of coworkerChain(role)) {
      const name = coworkerName(step.key, step.model);
      ok(`${role}: ${step.key} → “${name}”`, typeof name === 'string' && name.length >= 3 && !/\d/.test(name));
      seen.add(`${step.model}=${name}`);
    }
  }
  // spot-check the user-verified assignments
  ok('gemini-2.5-flash → Maya', coworkerName('gemini', 'gemini-2.5-flash') === 'Maya');
  ok('llama-3.3-70b-versatile → Leonardo', coworkerName('groq', 'llama-3.3-70b-versatile') === 'Leonardo');
  ok('deepseek-v4-flash → Wei', coworkerName('nvidia', 'deepseek-ai/deepseek-v4-flash-0731') === 'Wei');
  ok('seed-2.0-mini → Sasha', coworkerName('openrouter', 'bytedance-seed/seed-2.0-mini') === 'Sasha');
  ok('grok-4.6 → Rex', coworkerName('xai', 'grok-4.6') === 'Rex');
  ok('embed model → Nora', coworkerName('groq', 'nomic-embed-text-v1.5') === 'Nora');
  // same model on another provider = SAME name
  ok('same model, same name across providers', coworkerName('deepinfra', 'meta-llama/Meta-Llama-3.3-70B-Instruct-Turbo') === coworkerName('groq', 'llama-3.3-70b-versatile'));
  // unknown models NEVER leak their id — stable reserve name
  const unk1 = coworkerName('weirdprov', 'vendorx/mystery-model-9b');
  const unk2 = coworkerName('weirdprov', 'vendorx/mystery-model-9b');
  ok(`unknown model → stable reserve name “${unk1}”`, /^[A-Z][a-z]+$/.test(unk1) && unk1 === unk2);
  // roster shape (Models/Team surface)
  const roster = teamRoster();
  ok(`roster has ${roster.length} named coworkers`, roster.length >= 25 && roster.every((r) => r.name && !/\d/.test(r.name)));
}

/* ══════════════ 2. SANITIZER — no raw model ID survives a log line ══════════════ */
console.log('\n== 2. Sanitizer: raw model IDs never reach the UI ==');
{
  const { sanitizeStreamText } = await import('./src/services/ModelCoworkers.js');
  const samples = [
    'Coworker assigned: Memory (Qwen/Gemini) (memory)',
    'falling back to openrouter / bytedance-seed/seed-2.0-mini after error',
    'coder will use deepseek-ai/deepseek-v4-flash-0731 on nvidia',
    'provider groq model llama-3.3-70b-versatile answered',
    'trying weirdvendor/super-model-9b next',
  ];
  for (const s of samples) {
    const out = sanitizeStreamText(s);
    const leaks = /(seed-|deepseek-ai\/|deepseek-v[0-9]|llama-3|gemini-|grok-[0-9]|nemotron|gpt-oss|mistral-7b|mixtral|nomic-embed|Qwen\/Gemini|[a-z0-9-]+\/[a-z0-9][a-z0-9._-]{6,})/i.test(out);
    ok(`sanitized: “${s.slice(0, 44)}…” → “${out.slice(0, 60)}”`, !leaks);
  }
  // urls and filenames must survive
  ok('urls survive', sanitizeStreamText('read https://api.example.com/v1/models for docs').includes('https://api.example.com/v1/models'));
  ok('filenames survive (incl. .jsx)', sanitizeStreamText('wrote server/index.js and App.jsx') === 'wrote server/index.js and App.jsx');
  // plain English at a sentence end must NEVER be masked (the trailing '.' is
  // punctuation, not part of a token)
  ok('sentence-final words survive', sanitizeStreamText('the task finished and everything was loaded.') === 'the task finished and everything was loaded.');
  ok('the real join line survives verbatim', sanitizeStreamText('🧑‍💻 Maya joined the task — Memory & continuity · mandate loaded.') === '🧑‍💻 Maya joined the task — Memory & continuity · mandate loaded.');
}

/* ══════════════ 3. STREAMING WIRES ══════════════ */
console.log('\n== 3. Streaming wires ==');
{
  const st = fs.readFileSync('./src/services/SimpleTask.js', 'utf-8');
  ok('join line uses the named lead (no model parenthetical)', st.includes('joined the task') && !st.includes('(Qwen/Gemini)') && !st.includes('(DeepSeek/Qwen)'));
  ok('writing step emitted once at first token', st.includes('✍️ is writing your answer…') && st.includes('announcedWriter'));
  ok('stream deltas carry the writer (by)', /emit\('stream', \{ text: delta, \.\.\.\(by \? \{ by \} : \{\}\) \}\)/.test(st));

  const al = fs.readFileSync('./src/services/AgentLoop.js', 'utf-8');
  ok('AgentLoop names the writer on deltas', al.includes("coworkerName(meta.provider, meta.model)") && al.includes("✍️ is writing your answer…"));

  const llm = fs.readFileSync('./src/services/LLMClient.js', 'utf-8');
  ok('LLMClient deltas carry provider+model meta', llm.includes('onDelta: (t) => onDelta(t, { provider, model: cfg.models[0] })') && llm.includes('onDelta: (t) => opts.onToken(t, { provider, model })'));

  const idx = fs.readFileSync('./index.js', 'utf-8');
  ok('central sanitizer on every log/agent.log line', idx.includes("data.message = sanitizeStreamText(data.message)"));
  ok('/api/team serves the named roster', idx.includes("app.get('/api/team'"));

  // B162b — the UI actually CONSUMES the events the named lines ride on
  ok("engine consumes 'agent.log' (join/writing lines were dropped before)",
    /data\.type === 'log' \|\| data\.type === 'agent\.log'/.test(fs.readFileSync(path.join(ROOT, 'src/hooks/useJexiEngine.js'), 'utf-8')));
  const llm2 = fs.readFileSync('./src/services/LLMClient.js', 'utf-8');
  ok('Gemini streams natively with name meta (generateContentStream)', llm2.includes('generateContentStream(parts)') && llm2.includes("opts.onToken(piece, { provider: 'gemini', model: modelName })"));
  ok('non-streaming providers still emit once WITH meta (streamedAny fallback)', llm2.includes('streamedAny') && llm2.includes('opts.onToken(text, { provider, model: opts.model || null })'));
  const hook = fs.readFileSync(path.join(ROOT, 'src/hooks/useJexiEngine.js'), 'utf-8');
  ok('engine carries `by` onto the streaming message', hook.includes('by: last.by || data.by') && hook.includes('...(data.by ? { by: data.by } : {})'));
  const chat = fs.readFileSync(path.join(ROOT, 'src/components/ChatWindow.jsx'), 'utf-8');
  ok('chat header shows the writer NAME while streaming (never the model)', chat.includes("msg.streaming && msg.by ? String(msg.by).toUpperCase() : 'JEXI'") && chat.includes('· WRITING…'));
  const settings = fs.readFileSync(path.join(ROOT, 'src/components/SettingsView.jsx'), 'utf-8');
  ok('Settings shows the named team (Meet the team)', settings.includes('Meet the team') && settings.includes('/api/team'));
}

/* ══════════════ 4. LIVE BEHAVIOR (mocked stream meta) ══════════════ */
console.log('\n== 4. Live behavior ==');
{
  const { coworkerName } = await import('./src/services/ModelCoworkers.js');
  // exactly what LLMClient now passes into onToken
  const meta = { provider: 'openrouter', model: 'nvidia/nemotron-3-super-120b-a12b:free' };
  ok(`meta → “${coworkerName(meta.provider, meta.model)}” (Nemo expected)`, coworkerName(meta.provider, meta.model) === 'Nemo');
}

// B201 — fractions/scores/ratios in log lines are never model IDs: the
// completeness log printed "pass: Tessa files" because 5/10 was masked.
{
  const { sanitizeStreamText: sst } = await import('./src/services/ModelCoworkers.js');
  ok('5/10 survives masking', sst('completeness pass: 5/10 files') === 'completeness pass: 5/10 files');
  ok('16/9 survives masking', sst('aspect 16/9 ok') === 'aspect 16/9 ok');
  ok('unknown model ids are still masked', sst('vendorx/mystery-model wrote it') !== 'vendorx/mystery-model wrote it');
  ok('unit numbers still survive', sst('took 26.8s at 12.5%') === 'took 26.8s at 12.5%');
}

console.log(`\n${failures === 0 ? '🎉 ALL B162 COWORKER-NAME CHECKS PASSED' : `💥 ${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);
