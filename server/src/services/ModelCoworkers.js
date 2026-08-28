/**
 * B162 — MODEL COWORKERS: every AI model JEXI can call has a PEOPLE NAME.
 *
 * User-verified roster (2026-08-28). In every streaming surface (step feed,
 * top-bar status, writing indicator, coworker log lines) JEXI shows ONLY the
 * coworker name — never the raw model ID or the provider's model branding.
 *
 *   coworkerName(provider, model)  → 'Maya' (same model = same name everywhere)
 *   sanitizeStreamText(text)       → masks raw model IDs in log/stream text
 *   TEAM_ROSTER                    → the full named roster (Models screen)
 *
 * Unknown/unlisted models still NEVER leak their ID: a stable hash assigns
 * one of the reserve names (Zola, Kai, Ivy, Nova, Eli, Tessa).
 */

const ROSTER = [
  { name: 'Leonardo', models: ['llama-3.3-70b-versatile', 'llama-3.3-70b', 'Meta-Llama-3.3-70B-Instruct', 'Meta-Llama-3.3-70B'], hint: 'the big veteran thinker — research lead' },
  { name: 'Luna', models: ['llama-3.1-8b-instant', 'llama-3.1-8b', 'Meta-Llama-3.1-8B'], hint: 'quick & light — fast replies' },
  { name: 'Maya', models: ['gemini-2.5-flash'], hint: "JEXI's main chat voice — memory & continuity" },
  { name: 'Mira', models: ['gemini-3.6-flash'], hint: 'Maya’s faster sibling' },
  { name: 'Mila', models: ['gemini-3.5-flash'], hint: 'Maya’s sibling' },
  { name: 'Gigi', models: ['gemini-1.5-flash'], hint: 'the experienced elder — last fallback' },
  { name: 'Rex', models: ['grok-4.6'], hint: 'bold & blunt' },
  { name: 'Rocco', models: ['grok-4'], hint: '' },
  { name: 'Roy', models: ['grok-3'], hint: '' },
  { name: 'Wei', models: ['deepseek-v4-flash-0731', 'deepseek-v4-flash'], hint: 'fast DeepSeek mind — coder lead' },
  { name: 'Ming', models: ['DeepSeek-V3.1'], hint: 'DeepSeek family' },
  { name: 'Mei', models: ['DeepSeek-V3.2'], hint: 'DeepSeek family' },
  { name: 'Chen', models: ['deepseek-chat'], hint: 'DeepSeek house' },
  { name: 'Li', models: ['deepseek-reasoner'], hint: 'the deep thinker' },
  { name: 'Lin', models: ['deepseek-coder-6.7b'], hint: 'coder of the family' },
  { name: 'Quinn', models: ['DeepSeek-R1-Distill-Qwen-7B'], hint: 'distilled reasoner' },
  { name: 'Sasha', models: ['seed-2.0-mini'], hint: 'reliable all-rounder — the workhorse' },
  { name: 'Sena', models: ['seed-1.6-flash'], hint: 'the eyes — vision' },
  { name: 'Nemo', models: ['nemotron-3-super-120b'], hint: '120B general brain' },
  { name: 'Cody', models: ['north-mini-code'], hint: 'the coder' },
  { name: 'Gemma', models: ['gemma-4-26b'], hint: 'already had a people name' },
  { name: 'Oscar', models: ['gpt-oss-120b'], hint: 'open-weight star' },
  { name: 'Georgia', models: ['gemma-4-31b'], hint: "Gemma's cousin" },
  { name: 'Milo', models: ['open-mistral-7b'], hint: 'the French house' },
  { name: 'Marcel', models: ['open-mixtral-8x7b'], hint: 'the French house' },
  { name: 'Nora', models: ['nomic-embed-text-v1.5'], hint: 'files memories in the cabinet (embeddings)' },
  { name: 'Otto', models: ['default', 'local'], hint: 'the one who lives at home (Ollama / vLLM)' },
];

/** Reserve names for unknown models — stable per model id (hash), never leaks the ID. */
const RESERVE = ['Zola', 'Kai', 'Ivy', 'Nova', 'Eli', 'Tessa'];

/* Build lookup: lowercase substring keys → entry. Longest/most-specific ids
 * are matched first at sanitize time. */
const KEYLESS = new Map(); // lowercase model fragment → name
for (const entry of ROSTER) {
  for (const m of entry.models) KEYLESS.set(m.toLowerCase(), entry.name);
}
const ALL_IDS = [...KEYLESS.keys()].sort((a, b) => b.length - a.length); // longest first

function hashOf(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

/** The coworker name for a provider+model. Unknown ids get a stable reserve name. */
export function coworkerName(provider, model) {
  const m = String(model || '').toLowerCase();
  if (m) {
    for (const id of ALL_IDS) {
      if (m.includes(id)) return KEYLESS.get(id);
    }
  }
  // Provider-only hint (no model): the house lead.
  const byProvider = String(provider || '').toLowerCase();
  const houseLead = { groq: 'Leonardo', gemini: 'Maya', openrouter: 'Sasha', nvidia: 'Wei', sambanova: 'Ming', deepseek: 'Chen', xai: 'Rex', cerebras: 'Oscar', deepinfra: 'Luna', mistral: 'Milo', hf: 'Quinn', huggingface: 'Quinn', ollama: 'Otto', vllm: 'Otto' };
  if (!m && houseLead[byProvider]) return houseLead[byProvider];
  const key = `${byProvider}/${m || 'unknown'}`;
  return RESERVE[hashOf(key) % RESERVE.length];
}

/**
 * Mask raw model IDs in text streamed to the UI. Replaces every known id
 * (and unknown `org/model-ish` tokens) with the coworker name. Provider
 * org words are left alone EXCEPT the composite role labels that used to
 * name model families ("Qwen/Gemini" style) — those become the house names.
 */
const COMPOSITE_LABELS = [
  [/\(?\bQwen\s*\/\s*Gemini\b\)?/gi, 'Maya'],
  [/\(?\bDeepSeek\s*\/\s*Qwen\b\)?/gi, 'Wei'],
  [/\(?\bGrok\s*\/\s*Groq\s*\/\s*OpenRouter\b\)?/gi, 'Leonardo'],
  [/\bQwen\b/g, 'Quinn'],
];

export function sanitizeStreamText(text) {
  let out = String(text || '');
  if (!out) return out;
  // Protect URLs first so their host/path tokens are never masked.
  const urls = [];
  out = out.replace(/https?:\/\/[^\s)]+/gi, (u) => { urls.push(u); return `\u0000U${urls.length - 1}\u0000`; });
  for (const id of ALL_IDS) {
    if (out.toLowerCase().includes(id)) {
      const re = new RegExp(id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      out = out.replace(re, KEYLESS.get(id));
    }
  }
  // Unknown org/model-style ids — tokens with INTERNAL '.' or '/' separators
  // ("vendorx/mystery-model", "app.axml"). Plain English words never match
  // (a trailing sentence period is NOT part of a token), filenames and URLs
  // are kept, everything else gets a stable reserve name.
  out = out.replace(/[A-Za-z0-9][A-Za-z0-9_-]*(?:[.\/][A-Za-z0-9_-]+)+/g, (tok) => {
    if (/\.(js|jsx|ts|tsx|mjs|cjs|json|md|markdown|css|scss|html|htm|py|rb|go|rs|java|kt|swift|c|cpp|h|sh|bash|yml|yaml|toml|xml|txt|csv|pdf|jpg|jpeg|png|gif|svg|webp|ico|env|lock|apk)\b/i.test(tok)) return tok; // filenames/configs stay
    const known = ALL_IDS.some((id) => tok.toLowerCase().includes(id));
    if (known) return tok; // already replaced above (names contain no / or .)
    return RESERVE[hashOf(tok.toLowerCase()) % RESERVE.length];
  });
  for (const [re, name] of COMPOSITE_LABELS) out = out.replace(re, name);
  // Org-prefix remnants before an already-named coworker ("deepseek-ai/Wei",
  // "bytedance-seed/Sasha") → just the name.
  out = out.replace(/\b[a-z0-9][a-z0-9.-]*\/([A-Z][a-z]+)\b/g, '$1');
  // Restore the protected URLs.
  out = out.replace(/\u0000U(\d+)\u0000/g, (_, i) => urls[Number(i)] ?? '');
  return out;
}

/** The named roster for the Models screen: [{ name, hint, models }] */
export function teamRoster() {
  return ROSTER.map(({ name, hint, models }) => ({ name, hint, models }));
}

/** Role → the named lead for the SIMPLE-path coworker lines. */
export function coworkerLeadName(role, chain) {
  const first = Array.isArray(chain) && chain[0];
  return coworkerName(first ? first.key : '', first ? first.model : '');
}
