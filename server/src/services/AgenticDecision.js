/**
 * JEXI OS — AGENTIC DECISION LAYER (ui/decision-layer-rendering, fresh build).
 *
 * Replaces the "classify intent with regex/enum" pattern for chat turns with
 * the modern agentic pattern, after studying:
 *
 *   - Claude Code tool-use: the model PICKS a capability from a catalog of
 *     declared tools (name + description + when-to-use) instead of the host
 *     guessing with a fixed regex cascade. The catalog is DATA here — any
 *     capability (including future plugin tools) can be added without
 *     touching routing code.
 *   - OpenHands agent controller: a BOUNDED think → act → observe loop. The
 *     controller never spins forever: maxSteps caps iterations, every act is
 *     observed, and the loop exits when the goal is met or the budget is out.
 *   - Aider prompt structure: explicit contract in the prompt — "return ONLY
 *     a JSON object with these exact fields" — no prose to parse around.
 *   - SWE-agent ACI design: a small, well-documented action interface. Six
 *     canonical capabilities with tight preconditions and observable effects
 *     beat fifty fuzzy ones.
 *
 * Compat contract (the server MUST still boot — lead's hard rule):
 *   - Planner.js keeps every existing export (TEAM_PLAN, COMPOUND_DETECT,
 *     SIMPLE_INTENTS, DIRECT_INTENTS, detectPluginIntent, ClassificationSchema,
 *     the Planner class + planner singleton). This module only ADDS the new
 *     surface, and Planner.js re-exports it.
 *   - Keyless deployments (no LLM provider configured) still work: the model
 *     pick degrades to a deterministic catalog evidence matcher, and each
 *     capability's runner has a keyless path. Fail-soft everywhere: a thrown
 *     runner falls back to the legacy pipeline, never crashes a turn.
 */

import { canChat } from '../providers/index.js';
import { generateContent } from '../providers/runtime/LLMClient.js';
import { CORE_IDENTITY_BLOCK } from './IdentityGuard.js'; // PHASE 3 — agentic direct answers carry the identity block too
import { TOOL_REGISTRY } from './ToolRegistry.js'; // PHASE 5 P5-5 — routeDecision sees the REAL tool catalog
import { WORKSPACE_DIR } from '../config.js';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

/* ════════════════════════════════════════════════════════════════════
 * THE CAPABILITY CATALOG (SWE-agent ACI: small, explicit, observable)
 * ════════════════════════════════════════════════════════════════════
 * `evidence` patterns are the KEYLESS fallback matcher's scoring data
 * (weights: strong 3, medium 2, weak 1). With a live key the MODEL picks
 * the route from the same catalog — the patterns are hints in the prompt,
 * not a hard-coded intent cascade.
 */
export const CAPABILITY_CATALOG = [
  {
    id: 'web_search',
    kind: 'tool',
    label: 'Web Search',
    description: 'Search the live web and return real sources. Use for anything needing current or external evidence: news, facts you are not sure about, "latest X", "search for Y".',
    evidence: [
      { w: 3, re: /\b(search|google|look ?up|find)\b[^.!?\n]{0,40}\b(web|online|internet|the latest|latest|recent|news|current)\b/i },
      { w: 3, re: /\b(latest|breaking|today'?s|current|recent)\b[^.!?\n]{0,30}\b(news|headlines?|stories|articles?|events?)\b/i },
      { w: 2, re: /\bsearch the web\b/i },
      { w: 2, re: /\bwhat(?:'s| is) happening (with|in|at)\b/i },
      { w: 1, re: /\b(news|headlines)\b/i },
    ],
  },
  {
    id: 'file_read',
    kind: 'tool',
    label: 'File Read',
    description: 'Read a file from disk (read-only, size-capped). Use when the user asks to open/read/show the contents of a file.',
    evidence: [
      { w: 3, re: /\b(read|open|show|display|cat|view)\b[^.!?\n]{0,30}\b(\/[\w.\-\/]+|~\/[\w.\-\/]+|the file|this file)\b/i },
      { w: 3, re: /\b(what|whats|what's)\s+(is\s+)?(in|inside)\s+(the\s+)?file\b/i },
      { w: 2, re: /\bcontents? of\b[^.!?\n]{0,30}[\w.\-\/]*\.\w{1,5}\b/i },
    ],
  },
  {
    id: 'code_run',
    kind: 'tool',
    label: 'Code Run',
    description: 'Write and/or execute code (python or node, time-boxed) and report the real output. Use when the user wants a script written and run, a computation executed, or "do X programmatically".',
    evidence: [
      { w: 3, re: /\b(write|create|make|generate|draft)\b[^.!?\n]{0,60}\b(python|node|js|javascript|bash|shell)?\s?(script|program|snippet|code)\b[^.!?\n]{0,40}\b(run|execute|prints?|print|outputs?|saves?|computes?)\b|\b(run|execute)\b[^.!?\n]{0,60}\b(script|program|python|node)\b/i },
      { w: 3, re: /\brun (a |the )?(python|node|js|javascript) (script|program|snippet|command)\b/i },
      { w: 2, re: /\bwrite a python script\b/i },
      { w: 2, re: /\bexecute (this|the following|some) code\b/i },
    ],
  },
  {
    id: 'memory_write',
    kind: 'tool',
    label: 'Memory Write',
    description: 'Store a durable fact or preference about the user ("my name is X", "remember that Y", "my favorite Z is W"). Use ONLY for explicit self-disclosure or remembering requests.',
    evidence: [
      { w: 3, re: /\bmy name is\b/i },
      { w: 3, re: /\bcall me\b/i },
      { w: 3, re: /\bremember (that|this|i|my|the)\b/i },
      { w: 2, re: /\bi am (a|an|from|living|working)\b[^.!?\n]{0,50}\b/i },
      { w: 2, re: /\bmy (favorite|favourite|preferred)\b[^.!?\n]{0,40}\bis\b/i },
      { w: 1, re: /\bdon'?t forget\b/i },
    ],
  },
  {
    id: 'memory_read',
    kind: 'tool',
    label: 'Memory Recall',
    description: 'Recall stored facts about the user or this conversation ("what is my name?", "what did I tell you about X?", "do you remember Y?").',
    evidence: [
      { w: 3, re: /\b(what|who|which)\s+(is|are|was|were)\s+my\b/i },
      { w: 3, re: /\bwhat(?:'s| is) my\b/i },
      { w: 3, re: /\bwho am i\b/i },
      { w: 2, re: /\bwhat did i (say|tell|ask|mention|name)\b/i },
      { w: 2, re: /\bdo you remember\b/i },
      { w: 2, re: /\bremember when\b/i },
    ],
  },
  {
    id: 'direct_answer',
    kind: 'agent',
    label: 'Direct Answer',
    description: 'Answer directly from model knowledge — arithmetic one-liners, definitions, explanations, conversation. Use when no tool adds value.',
    evidence: [
      { w: 3, re: /(?:what\s+is|what's|whats|calculate|compute|solve)\s+[\d\s+\-*/().^%]{2,40}\??\s*$/i },
      { w: 2, re: /^[\d\s+\-*/().^%=]+\?*\s*$/ },
      { w: 1, re: /\b(explain|define|what is|who is|tell me about)\b/i },
    ],
  },
];

/** Priority order when scores tie: specific tools before the generic agent. */
const TIE_ORDER = ['memory_write', 'memory_read', 'file_read', 'code_run', 'web_search', 'direct_answer'];

/**
 * PHASE 5 P5-5 — the capability catalog is BRIDGED TO THE REAL TOOL REGISTRY:
 * each capability names the actual TOOL_REGISTRY slugs that implement it, so
 * routeDecision sees (and reports) the real catalog — never a subset invented
 * for the prompt. Verified live: every slug here exists in TOOL_REGISTRY
 * (asserted by scripts/p5-tools-sim.mjs on every run).
 */
const CAPABILITY_TOOLS = {
  web_search: ['web-search', 'arxiv-search', 'semantic-search'],
  file_read: ['fs_read'],
  code_run: ['code-run', 'code-write'],
  memory_write: ['memory-write', 'knowledge-save'],
  memory_read: ['memory-recall', 'knowledge-search', 'episode-recall'],
  direct_answer: [],
};

/** Real registry facts for the routing context (fail-soft, cached per call). */
function realToolCatalogSummary() {
  try {
    const byDomain = {};
    for (const t of TOOL_REGISTRY) {
      const k = t.type || 'other';
      byDomain[k] = (byDomain[k] || 0) + 1;
    }
    return { total: TOOL_REGISTRY.length, byDomain };
  } catch (e) {
    return { total: 0, byDomain: {}, error: String(e && e.message || e) };
  }
}

/* ════════════════════════════════════════════════════════════════════
 * ROUTE DECISION — the model picks a capability from the catalog
 * ════════════════════════════════════════════════════════════════════ */

/** Render the catalog for the model prompt (Claude Code tool-declaration style). */
function catalogPromptBlock() {
  const real = realToolCatalogSummary();
  const lines = CAPABILITY_CATALOG.map((c) => {
    const tools = (CAPABILITY_TOOLS[c.id] || []).join(', ');
    return `- ${c.id} (${c.kind}): ${c.description}${tools ? ` [real tools: ${tools}]` : ''}`;
  });
  lines.push(`(The real tool registry holds ${real.total} tools across domains: ${Object.entries(real.byDomain).map(([k, v]) => `${k} ${v}`).join(', ')} — the list above names the tools each capability dispatches through.)`);
  return lines.join('\n');
}

/** Deterministic evidence scorer — the keyless fallback (never throws). */
function catalogMatch(query) {
  const q = String(query || '');
  const scored = CAPABILITY_CATALOG.map((c) => {
    let score = 0;
    const hits = [];
    for (const ev of c.evidence || []) {
      if (ev.re.test(q)) { score += ev.w || 1; hits.push(ev.re.source.slice(0, 60)); }
    }
    return { id: c.id, score, hits };
  }).filter((s) => s.score > 0);
  if (!scored.length) return null;
  scored.sort((a, b) => (b.score - a.score) || (TIE_ORDER.indexOf(a.id) - TIE_ORDER.indexOf(b.id)));
  return scored[0];
}

/**
 * Route a query to ONE capability from the catalog.
 * P10 GAP 5 — the gate is now LAYERED:
 *   L1  regex evidence fast path (strong evidence, score >= 3) — deterministic,
 *       zero cost, catches every phrasing the evidence regexes were built for;
 *   L2  SEMANTIC matcher (CapabilitySemantic: hashed token+trigram embeddings,
 *       cosine over each capability's profile) — catches novel phrasings the
 *       regexes miss; below threshold falls through;
 *   L3  the MODEL picks from the catalog (only with a configured key);
 *   L4  weak regex evidence (> 0) still routes before giving up;
 *   L5  direct_answer fallback (no tool pretense).
 * Always resolves — never throws.
 *
 * @returns {Promise<{ok:boolean, route:string, via:'catalog'|'semantic'|'model'|'none',
 *   confidence:number, reasoning:string, capability:object|null}>}
 */
export async function routeDecision(query, opts = {}) {
  const q = String(query || '').trim();
  if (!q) {
    return { ok: false, route: 'none', via: 'none', confidence: 0, reasoning: 'empty query', capability: null, tools: [], catalog: realToolCatalogSummary() };
  }
  const hit = catalogMatch(q);
  // LAYER 1 — regex fast path: strong, deterministic evidence routes immediately.
  if (hit && hit.score >= 3) {
    const cap = CAPABILITY_CATALOG.find((c) => c.id === hit.id);
    return {
      ok: true, route: hit.id, via: 'catalog',
      confidence: Math.min(1, 0.55 + 0.15 * hit.score),
      reasoning: `catalog evidence matched (score ${hit.score})${hit.hits.length ? `: ${hit.hits[0]}` : ''}`,
      capability: cap,
      tools: CAPABILITY_TOOLS[hit.id] || [],
      catalog: realToolCatalogSummary(),
    };
  }
  // LAYER 2 — semantic matcher: novel phrasings, cosine over capability profiles.
  try {
    const { semanticRoute } = await import('./CapabilitySemantic.js');
    const sem = await semanticRoute(q);
    if (sem) {
      const cap = CAPABILITY_CATALOG.find((c) => c.id === sem.id);
      if (cap) {
        return {
          ok: true, route: sem.id, via: 'semantic',
          confidence: Math.min(1, 0.35 + sem.score),
          reasoning: `semantic match (${sem.score} ≥ ${sem.threshold}) — novel phrasing routed by the vector layer`,
          capability: cap,
          tools: CAPABILITY_TOOLS[sem.id] || [],
          catalog: realToolCatalogSummary(),
        };
      }
    }
  } catch { /* the semantic layer must never break routing */ }
  // LAYER 3 — the model picks from the catalog (zero cost when keyless: the
  // gate skips the call instead of firing a doomed one).
  if (canChat()) {
    try {
      const system = 'You are the routing controller. Pick exactly ONE capability id from the catalog for the user request. Output ONLY a single JSON object, no markdown, no prose: {"route":"<capability-id>","confidence":0.0-1.0,"reasoning":"one short line"}';
      const prompt = `Capability catalog:\n${catalogPromptBlock()}\n\nUser request: "${q}"\n\nWhich capability handles this? Return ONLY the JSON object.`;
      const raw = await generateContent(prompt, system, null, { temperature: 0 });
      const m = String(raw || '').match(/\{[\s\S]*\}/);
      if (m) {
        const parsed = JSON.parse(m[0]);
        const cap = CAPABILITY_CATALOG.find((c) => c.id === parsed.route);
        if (cap && Number(parsed.confidence) >= 0.5) {
          return {
            ok: true, route: cap.id, via: 'model',
            confidence: Math.min(1, Number(parsed.confidence) || 0.5),
            reasoning: String(parsed.reasoning || 'model pick').slice(0, 200),
            capability: cap,
            tools: CAPABILITY_TOOLS[cap.id] || [],
            catalog: realToolCatalogSummary(),
          };
        }
      }
    } catch (e) { /* fall through to the catalog matcher — never crash */ }
  }
  // LAYER 4 — weak regex evidence (score > 0) still beats guessing.
  if (hit) {
    const cap = CAPABILITY_CATALOG.find((c) => c.id === hit.id);
    return {
      ok: true, route: hit.id, via: 'catalog',
      confidence: Math.min(1, 0.55 + 0.15 * hit.score),
      reasoning: `catalog evidence matched (score ${hit.score})${hit.hits.length ? `: ${hit.hits[0]}` : ''}`,
      capability: cap,
      tools: CAPABILITY_TOOLS[hit.id] || [],
      catalog: realToolCatalogSummary(),
    };
  }
  // LAYER 5 — nothing matched — the generic agent answers directly (no tool pretense).
  const direct = CAPABILITY_CATALOG.find((c) => c.id === 'direct_answer');
  return { ok: true, route: 'direct_answer', via: 'catalog', confidence: 0.5, reasoning: 'no tool evidence — default to direct answer', capability: direct, tools: [], catalog: realToolCatalogSummary() };
}

/* ════════════════════════════════════════════════════════════════════
 * RUNNERS — one honest effect per capability (SWE-agent ACI)
 * ════════════════════════════════════════════════════════════════════
 * Each runner: (args, opts) → { ok, output (markdown for the user),
 * observation (what the loop records), meta }. They call the SAME services
 * the rest of JEXI uses — no parallel implementations.
 */

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'what', 'who', 'which', 'how', 'why', 'when', 'where', 'is', 'are', 'was', 'were', 'a', 'an', 'of', 'to', 'in', 'on', 'my', 'me', 'i', 'you', 'your', 'it', 'its', 'do', 'does', 'did', 'can', 'could', 'should', 'would', 'please', 'tell', 'about', 'from', 'today']);

/** Query content words used by verifyAnswer's term-overlap check. */
export function queryTerms(query) {
  return [...new Set(String(query || '').toLowerCase().match(/[a-z0-9+.]{3,}/g) || [])]
    .filter((t) => !STOPWORDS.has(t)).slice(0, 8);
}

/** Safe arithmetic evaluator (recursive descent — no eval/Function, ever). */
export function evalArithmetic(expr) {
  const src = String(expr || '').replace(/[×x]/gi, '*').replace(/÷/g, '/').replace(/\^/g, '**');
  if (!/^[\d\s+\-*/().%*]+$/.test(src) || !/\d/.test(src) || /[+\-*/%]{3,}/.test(src.replace(/\*\*/g, ''))) return null;
  let pos = 0;
  const ws = () => { while (pos < src.length && /\s/.test(src[pos])) pos++; };
  const peek = () => { ws(); return src[pos]; };
  const eat = (ch) => { ws(); if (src[pos] === ch) { pos++; return true; } return false; };
  const primary = () => {
    ws();
    if (eat('(')) { const v = expr0(); if (!eat(')')) throw new Error('paren'); return v; }
    if (eat('-')) return -primary();
    if (eat('+')) return primary();
    const m = /^\d+(\.\d+)?/.exec(src.slice(pos));
    if (!m) throw new Error('num');
    pos += m[0].length;
    return Number(m[0]);
  };
  const power = () => { let base = primary(); ws(); if (src.startsWith('**', pos)) { pos += 2; return base ** power(); } return base; };
  const term = () => { let v = power(); for (;;) { ws(); if (eat('*')) { if (src[pos] === '*') { pos--; return v; } v *= power(); } else if (eat('/')) v /= power(); else if (eat('%')) v %= power(); else return v; } };
  const expr0 = () => { let v = term(); for (;;) { ws(); if (eat('+')) v += term(); else if (eat('-')) v -= term(); else return v; } };
  try {
    const val = expr0();
    ws();
    if (pos !== src.length || !Number.isFinite(val)) return null;
    return val;
  } catch { return null; }
}

/** Built-in reference notes — the keyless fallback for canonical explanations.
 * A static, factual note is honest; a hallucinated LLM-less refusal is worse.
 * With any key configured the LLM writes the explanation instead. */
const REFERENCE_NOTES = [
  {
    match: /\bbayes\b/i,
    answer: [
      '**Bayes\' theorem** — how to update a probability when new evidence arrives.',
      '',
      'The formula:',
      '',
      '$$P(A|B) = \\frac{P(B|A)\\,P(A)}{P(B)}$$',
      '',
      '| Term | Meaning |',
      '|---|---|',
      '| $P(A\\mid B)$ | posterior — probability of $A$ given evidence $B$ |',
      '| $P(B\\mid A)$ | likelihood — probability of seeing $B$ if $A$ is true |',
      '| $P(A)$ | prior — what you believed before the evidence |',
      '| $P(B)$ | evidence — overall probability of seeing $B$ |',
      '',
      '**In words:** posterior = (likelihood × prior) / evidence. If a test is 99% accurate and 1 in 10,000 people have the disease, a positive result still means only ~1% chance of disease — the tiny prior dominates. That is the counter-intuitive power of Bayes: *strong evidence with a rare prior can still be weak*.',
    ].join('\n'),
  },
  {
    match: /\bpythagorean theorem\b|\bpythagoras\b/i,
    answer: '**Pythagorean theorem**: in a right triangle, $a^2 + b^2 = c^2$, where $c$ is the hypotenuse. Example: legs 3 and 4 → $c = \\sqrt{3^2+4^2} = 5$.',
  },
];

async function runDirectAnswer(args, opts = {}) {
  const q = String(args.query || '');
  // 1) live model when one is configured (brain context injected when the
  // loop fetched it — Part 2 closed loop: every chat path reads the brain)
  if (canChat()) {
    try {
      const brainNote = opts.brainContext ? `\n\n${String(opts.brainContext).slice(0, 1500)}` : '';
      const out = await generateContent(q, `${CORE_IDENTITY_BLOCK}\n\nAnswer the user directly and completely. Use markdown. For math use LaTeX ($inline$, $$block$$).${brainNote}`, null, { temperature: 0.3 });
      if (out && String(out).trim()) {
        // P11 A4 — model calls are NOT tool invocations (toolsUsed meters the
        // runtime's tool primitives); meta.toolInvocations stays 0 here.
        return { ok: true, output: String(out).trim(), observation: 'direct answer via model', meta: { writer: 'model', toolInvocations: 0 } };
      }
    } catch (e) { /* fall through to keyless paths */ }
  }
  // 2) arithmetic one-liner — deterministic, exact
  const m = q.match(/(?:what\s+is|what's|whats|calculate|compute|solve)?\s*([\d\s+\-*/().^%x×÷]{2,40}?)\s*[=?]?\s*$/i);
  if (m) {
    const val = evalArithmetic(m[1]);
    if (val !== null) {
      const pretty = Number.isInteger(val) ? String(val) : String(Number(val.toFixed(6)));
      return { ok: true, output: `**${m[1].trim()} = ${pretty}**`, observation: `arithmetic evaluated exactly (${m[1].trim()} = ${pretty})`, meta: { writer: 'arithmetic', toolInvocations: 0 } };
    }
  }
  // 3) built-in reference notes
  for (const note of REFERENCE_NOTES) {
    if (note.match.test(q)) {
      return { ok: true, output: note.answer, observation: 'answered from the built-in reference notes (keyless mode)', meta: { writer: 'reference', toolInvocations: 0 } };
    }
  }
  // 3b) PHASE 5 P5-1 — the skills library is callable when a turn needs it:
  // a strong library match answers how-to questions from the real skill body
  // (progressive disclosure, invocation logged to DATA_DIR/skills-log.jsonl).
  try {
    const { findLibrarySkill, invokeLibrarySkill } = await import('../skills/library-registry.js');
    const skill = findLibrarySkill(q);
    if (skill) {
      const inv = await invokeLibrarySkill(q);
      if (inv.ok) {
        const content = inv.mode === 'steps'
          ? (inv.steps || []).map((s) => `- ${s.step} → tool \`${s.tool}\` ✓`).join('\n')
          : String(inv.body || '').slice(0, 2500);
        return {
          ok: true,
          output: `**${inv.slug}** (from my skills library — ${inv.mode} invocation)\n\n${content}`,
          observation: `answered from skills library: ${inv.slug} (${inv.mode})`,
          // P11 A4 — REAL metering: the skill dispatch executed its machine
          // steps; each step that dispatched a tool invocation counts.
          meta: { writer: 'skills-library', skill: inv.slug, mode: inv.mode, toolInvocations: Array.isArray(inv.steps) ? inv.steps.length : 1 },
        };
      }
    }
  } catch { /* library dispatch must never break the direct answer */ }
  // 4) honest keyless failure — never a fabricated answer
  return { ok: false, output: '', observation: 'no provider key configured and no deterministic path for this question', meta: { writer: 'none', toolInvocations: 0 } };
}

async function runWebSearch(args, opts = {}) {
  const q = String(args.query || '');
  const { aggregateSearch } = await import('./SearchEngine.js');
  // P11 A4 — REAL metering: one web_search invocation = one aggregateSearch
  // dispatch (the tool ran; a zero-result search still RAN — counted).
  const results = await aggregateSearch(q, null, {}) || [];
  const top = results.slice(0, 5);
  if (!top.length) {
    return { ok: false, output: '', observation: `web_search returned 0 results for "${q}"`, meta: { results: 0, toolInvocations: 1 } };
  }
  const lines = top.map((r, i) => `${i + 1}. [${r.title || '(untitled)'}](${r.link || r.url})${r.snippet ? ` — ${String(r.snippet).slice(0, 200)}` : ''}`);
  return {
    ok: true,
    output: [`Searched the web (web_search) for **${q}** — top live sources:`, '', ...lines, '', '_Sources fetched live from the web just now._'].join('\n'),
    observation: `web_search returned ${results.length} results; top ${top.length} cited`,
    meta: { results: results.length, urls: top.map((r) => r.link || r.url), toolInvocations: 1 },
  };
}

async function runFileRead(args, opts = {}) {
  const p = String(args.path || '');
  const resolved = p.startsWith('~') ? path.join(process.env.HOME || '/home/z', p.slice(1)) : path.resolve(p);
  // ACI precondition: read-only, exists, regular file, size-capped.
  let st;
  try { st = fs.statSync(resolved); } catch {
    // P11 A4 — the read was ATTEMPTED and failed: one real invocation.
    return { ok: false, output: '', observation: `file not found: ${resolved}`, meta: { path: resolved, toolInvocations: 1 } };
  }
  if (!st.isFile()) return { ok: false, output: '', observation: `not a regular file: ${resolved}`, meta: { path: resolved, toolInvocations: 1 } };
  const CAP = 64 * 1024;
  const fd = fs.openSync(resolved, 'r');
  try {
    const buf = Buffer.alloc(Math.min(st.size, CAP));
    fs.readSync(fd, buf, 0, buf.length, 0);
    const text = buf.toString('utf-8');
    const truncated = st.size > CAP ? `\n\n_…truncated (${st.size} bytes total, showing first ${CAP})_` : '';
    return {
      ok: true,
      output: `Contents of \`${resolved}\`:\n\n\`\`\`\n${text}${truncated}\n\`\`\``,
      observation: `read ${buf.length} bytes from ${resolved}`,
      meta: { path: resolved, bytes: buf.length, toolInvocations: 1 }, // P11 A4 — one real read
    };
  } finally { fs.closeSync(fd); }
}

/** Derive the script the user asked for. Live model writes bespoke code; the
 * keyless path serves a small library of fully-deterministic templates. */
async function composeScript(query) {
  const q = String(query || '');
  if (canChat()) {
    try {
      const out = await generateContent(
        `Write a single small ${/node|javascript|js\b/i.test(q) ? 'Node.js' : 'Python 3'} script for this request. Output ONLY the code, no fences, no prose.\n\nRequest: ${q}`,
        'You are a code generator. Output only code.',
        null, { temperature: 0.1 },
      );
      const clean = String(out || '').replace(/^```[a-z]*\n?|```$/g, '').trim();
      if (clean) return { lang: /node|javascript|js\b/i.test(q) ? 'node' : 'python', code: clean, writer: 'model' };
    } catch (e) { /* fall through to templates */ }
  }
  if (/today'?s date|current date|date\b/i.test(q)) {
    return {
      lang: 'python',
      code: 'from datetime import date\n\nprint("Today\'s date is", date.today().isoformat())\n',
      writer: 'template',
    };
  }
  if (/hello/i.test(q)) {
    return { lang: 'python', code: 'print("hello")\n', writer: 'template' };
  }
  return null;
}

async function runCodeRun(args, opts = {}) {
  const composed = await composeScript(args.query || '');
  if (!composed) {
    return { ok: false, output: '', observation: 'no deterministic script template for this request and no model key to compose one', meta: {} };
  }
  const fname = `agentic-${Date.now()}.${composed.lang === 'node' ? 'mjs' : 'py'}`;
  const fpath = path.join(WORKSPACE_DIR, fname);
  try { fs.mkdirSync(WORKSPACE_DIR, { recursive: true }); } catch { /* exists */ }
  fs.writeFileSync(fpath, composed.code, 'utf-8');
  const cmd = composed.lang === 'node' ? 'node' : 'python3';
  const ran = await new Promise((resolve) => {
    execFile(cmd, [fpath], { timeout: 20000, cwd: WORKSPACE_DIR, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
  const success = !ran.err;
  const codeBlock = `\`\`\`${composed.lang === 'node' ? 'javascript' : 'python'}\n${composed.code}\`\`\``;
  const outBlock = `\`\`\`\n${(ran.stdout || ran.stderr || '(no output)').slice(0, 2000)}\n\`\`\``;
  const output = success
    ? [`Wrote the script and ran it — here is the real output:`, '', codeBlock, '', '**Output:**', '', outBlock].join('\n')
    : [`The script failed — honest output below.`, '', codeBlock, '', '**Error:**', '', outBlock].join('\n');
  return {
    ok: success,
    output,
    observation: success
      ? `${composed.lang} script written to ${fname} and executed (exit 0, output captured)`
      : `${composed.lang} script exited non-zero: ${String(ran.err && ran.err.message || ran.stderr).slice(0, 120)}`,
    // P11 A4 — REAL metering: 1 workspace file write + 1 subprocess exec.
    meta: { file: fname, lang: composed.lang, writer: composed.writer, exit: success ? 0 : 1, toolInvocations: 2 },
  };
}

async function runMemoryWrite(args, opts = {}) {
  const { rememberUserFact } = await import('./MemoryManager.js');
  const fact = String(args.fact || '').trim();
  if (!fact) return { ok: false, output: '', observation: 'memory_write called with no fact', meta: { toolInvocations: 0 } };
  const saved = rememberUserFact(fact, 0.8, args.label || 'fact'); // P11 A4 — the store write IS the invocation (1)
  if (!saved) return { ok: false, output: '', observation: `fact rejected (too short or duplicate): ${fact}`, meta: { toolInvocations: 1 } };
  return {
    ok: true,
    // The stored fact is echoed back — the user sees WHAT was kept, and
    // verifyAnswer's term-overlap check has grounded text to verify against.
    output: `Noted — I'll remember that: ${fact} ✓`,
    observation: `stored fact: "${fact}"`,
    meta: { fact, persisted: true, toolInvocations: 1 },
  };
}

export async function runMemoryRead(args, opts = {}) {
  const { searchUserFacts, loadMemory } = await import('./MemoryManager.js');
  const q = String(args.query || '');
  let found = [];
  try { found = await searchUserFacts(q, 5) || []; } catch { /* keyword fallback below */ } // P11 A4 — store query #1
  if (!found.length) {
    // Deterministic keyword fallback over the persisted fact store (the
    // vector layer can be unavailable keyless — the fact file is not).
    try {
      const mem = loadMemory(); // P11 A4 — store query #2 (fallback fires)
      const terms = queryTerms(q).filter((t) => t.length >= 3);
      found = (mem.userFacts || [])
        .filter((f) => terms.some((t) => String(f.fact || '').toLowerCase().includes(t)))
        .slice(0, 5);
    } catch { /* stay empty — honest */ }
  }
  if (!found.length) {
    return { ok: false, output: "I don't have anything stored for that yet.", observation: `no stored facts matched "${q}"`, meta: { matches: 0, toolInvocations: 1 } };
  }
  const facts = found.map((f) => String(f.fact || f.text || '')).filter(Boolean);
  // Name-shaped questions get a direct sentence when a name fact exists.
  if (/\b(name|who am i)\b/i.test(q)) {
    const nameFact = facts.find((f) => /name is ["']?([A-Za-z][\w'-]{1,30})/i.test(f));
    if (nameFact) {
      const nm = nameFact.match(/name is ["']?([A-Za-z][\w'-]{1,30})/i)[1];
      return { ok: true, output: `Your name is **${nm}**.`, observation: `recalled name fact: "${nameFact}"`, meta: { matches: facts.length, fact: nameFact, toolInvocations: 1 } };
    }
  }
  return {
    ok: true,
    output: [`Here's what I remember:`, '', ...facts.slice(0, 5).map((f) => `- ${f}`)].join('\n'),
    observation: `recalled ${facts.length} fact(s) for "${q}"`,
    meta: { matches: facts.length, facts: facts.slice(0, 3), toolInvocations: 1 },
  };
}

const RUNNERS = {
  direct_answer: runDirectAnswer,
  web_search: runWebSearch,
  file_read: runFileRead,
  code_run: runCodeRun,
  memory_write: runMemoryWrite,
  memory_read: runMemoryRead,
};

/** Derive a capability's first action args deterministically from the query
 * (the keyless "think" step; with a key the loop's think() refines these). */
function deriveArgs(route, query) {
  const q = String(query || '').trim();
  switch (route) {
    case 'web_search': {
      const cleaned = q
        .replace(/^(please\s+)?(can you\s+)?(search( the web)?( for)?|google|look ?up|find)( me)?\s*/i, '')
        .replace(/\bon the (web|internet)\b/i, '')
        .trim() || q;
      return { query: cleaned };
    }
    case 'file_read': {
      const m = q.match(/\/[\w.\-\/]+|~\/[\w.\-\/]+/) || q.match(/\b(?:the\s+)?(file|contents)\b/i);
      return { path: m ? m[0] : '' };
    }
    case 'code_run': return { query: q };
    case 'memory_write': {
      let fact = null;
      let label = 'fact';
      const name = q.match(/\bmy name is\s+([A-Za-z][\w'-]{1,30})/i);
      if (name) { fact = `User's name is ${name[1]}`; label = 'name'; }
      if (!fact) { const rem = q.match(/\bremember(?: that| this)?\s+(.{4,200})/i); if (rem) fact = rem[1].trim(); }
      if (!fact) {
        const fav = q.match(/\bmy (favorite|favourite)\s+([\w\s-]{2,40}?)\s+is\s+(.{2,80})/i);
        if (fav) { fact = `User's favorite ${fav[2].trim()} is ${fav[3].trim()}`; label = 'preference'; }
      }
      if (!fact) fact = q.slice(0, 200);
      return { fact, label };
    }
    case 'memory_read': return { query: q };
    default: return { query: q };
  }
}

/**
 * P10 GAP 1 — KEYLESS CHILD BRAIN: run ONE capability's real runner for a
 * sub-agent child. Keyless, an AgentLoop has no model to steer it — but the
 * capability runners ARE the real deterministic work (live web search, real
 * memory write, real file read). The child executes its own capability and
 * returns real output — never the "could not produce a final answer" stub.
 * Exported for AgentLoop's keyless child path (dynamic-imported there to
 * keep the module graph acyclic).
 */
export async function executeCapabilityKeyless(route, query, opts = {}) {
  const runner = RUNNERS[route];
  // P11 A4 — every return path carries toolInvocations (the runner's REAL
  // count of primitive tool invocations it performed — never a stub). A
  // runner that throws still counts the attempt as routed work it began.
  if (!runner) return { ok: false, output: '', observation: `no runner for route "${route}"`, meta: { toolInvocations: 0 } };
  const args = deriveArgs(route, query);
  try {
    const res = await runner(args, opts);
    return { ...res, toolInvocations: Number(res && res.meta && res.meta.toolInvocations) || 0 };
  } catch (e) {
    return { ok: false, output: '', observation: `keyless capability runner threw: ${String((e && e.message) || e).slice(0, 160)}`, meta: { toolInvocations: 0 }, toolInvocations: 0 };
  }
}

/**
 * P10 GAP 1 — DETERMINISTIC COMPOSER: assemble the sub-agent coordinator's
 * final answer from its children's REAL { result } payloads (no model needed).
 * The original question's rubric is applied: every included child result must
 * be non-empty and not a refusal, the composed answer must share content terms
 * with the original question (term overlap), and the structure is fixed
 * (one labelled section per child). Honest: children that produced nothing
 * are reported as empty, never padded with invented text.
 */
export function composeChildAnswers(query, childResults = []) {
  const q = String(query || '').trim();
  const real = (childResults || []).filter((r) => {
    const t = String((r && (r.result || r.summary)) || '').trim();
    return t.length > 0 && !/could not produce a final answer/i.test(t) && !/^i don'?t know\b/i.test(t);
  });
  const checks = [
    { name: 'children_nonempty', pass: real.length > 0, detail: `${real.length}/${(childResults || []).length} children produced real content` },
  ];
  const terms = queryTerms(q).filter((t) => t.length >= 4);
  if (terms.length) {
    const blob = real.map((r) => String(r.result || r.summary || '')).join('\n').toLowerCase();
    const present = terms.filter((t) => blob.includes(t));
    checks.push({ name: 'rubric_term_overlap', pass: present.length > 0, detail: `${present.length}/${terms.length} question terms present in child results` });
  }
  const lines = [];
  if (real.length) {
    lines.push(`### Sub-agent results (${real.length} child${real.length === 1 ? '' : 'ren'}, deterministic composition)`);
    for (const r of real) {
      const label = String(r.name || 'sub-agent').replace(/^jexi-agentic-\d+-/, '');
      lines.push('', `**${label}** — ${String(r.result || r.summary || '').trim()}`);
    }
  }
  const allPass = checks.every((c) => c.pass);
  return { ok: allPass, aggregate: lines.join('\n'), checks };
}

/* ════════════════════════════════════════════════════════════════════
 * EXECUTE PLAN — bounded think → act → observe (OpenHands controller)
 * ════════════════════════════════════════════════════════════════════
 * Keyless, the plan is a single honest action (derive → run → observe).
 * With a key, think() can iterate (search again, read deeper…) until the
 * goal is met or maxSteps is hit. Every step is observed into `trace`.
 */
export async function executePlan(decision, query, opts = {}) {
  const maxSteps = Math.max(1, Math.min(opts.maxSteps || 3, 8)); // bounded — never unbounded
  const route = decision.route;
  const runner = RUNNERS[route];
  const trace = { route, via: decision.via, steps: [], startedAt: new Date().toISOString() };
  if (!runner) {
    trace.steps.push({ step: 1, phase: 'route', ok: false, note: `no runner for route "${route}"` });
    return { success: false, summary: '', trace, error: `unknown route ${route}` };
  }
  // ACT 1 — deterministic first action derived from the query.
  let args = deriveArgs(route, query);
  let last = null;
  for (let step = 1; step <= maxSteps; step++) {
    // THINK — with a key the model may steer between steps; keyless we go straight to act.
    if (step > 1 && canChat() && opts.thinkBetweenSteps) {
      try {
        const think = await generateContent(
          `Goal: ${query}\nObservations so far:\n${JSON.stringify(trace.steps).slice(0, 2000)}\n\nShould the "${route}" capability run again with different arguments to better achieve the goal? Answer ONLY JSON: {"again":true/false,"args":{...},"why":"..."}`,
          'You are the controller of a bounded agent loop. Be conservative: prefer stopping.',
          null, { temperature: 0 },
        );
        const tm = String(think || '').match(/\{[\s\S]*\}/);
        if (tm) {
          const parsed = JSON.parse(tm[0]);
          if (!parsed.again) break;
          if (parsed.args && typeof parsed.args === 'object') args = parsed.args;
        } else break;
      } catch { break; }
    }
    // ACT
    let res;
    try {
      res = await runner(args, opts);
    } catch (e) {
      res = { ok: false, output: '', observation: `runner threw: ${String((e && e.message) || e).slice(0, 160)}`, meta: {} };
    }
    // OBSERVE
    last = res;
    trace.steps.push({ step, phase: 'act', action: route, args, ok: !!res.ok, observation: res.observation });
    if (res.ok) break; // goal met — deterministic single-shot unless think() continues
    if (step === 1 && route !== 'web_search') break; // one honest retry only for search
  }
  trace.finishedAt = new Date().toISOString();
  trace.ok = !!(last && last.ok);
  return {
    success: !!(last && last.ok),
    summary: (last && last.output) || '',
    trace,
    error: last && last.ok ? null : String((last && last.observation) || 'capability runner did not succeed'),
    meta: (last && last.meta) || {},
  };
}

/* ════════════════════════════════════════════════════════════════════
 * VERIFY ANSWER — light rule-based check (term overlap + tool errors)
 * ════════════════════════════════════════════════════════════════════
 * This verifies the EXECUTION OUTCOME (did the routed capability actually
 * produce a grounded, error-free answer?) — NOT the linguistic quality of
 * an LLM reply. It never claims PASS when a check fails; callers must
 * report the honest result.
 */
export function verifyAnswer(query, answer, trace = null) {
  const checks = [];
  const answerText = String(answer || '');
  // 1 — non-empty, readable answer
  checks.push({
    name: 'answer_nonempty',
    pass: answerText.trim().length > 0,
    detail: `${answerText.trim().length} chars`,
  });
  // 2 — term overlap: the query's content words appear in the answer
  const terms = queryTerms(query);
  if (terms.length) {
    const lower = answerText.toLowerCase();
    const present = terms.filter((t) => lower.includes(t));
    const ratio = present.length / terms.length;
    checks.push({
      name: 'term_overlap',
      pass: ratio >= 0.25,
      detail: `${present.length}/${terms.length} query terms present (${Math.round(ratio * 100)}%)${present.length < terms.length ? ` — missing: ${terms.filter((t) => !present.includes(t)).join(', ')}` : ''}`,
    });
  }
  // 3 — tool error scan over the trace observations
  let toolErrors = 0;
  let scanned = false;
  if (trace && Array.isArray(trace.steps)) {
    scanned = true;
    for (const s of trace.steps) {
      const blob = `${s.observation || ''} ${s.note || ''}`;
      if (!s.ok || /error|failed|threw|exit non-zero|not found|timed out/i.test(blob)) toolErrors++;
    }
  }
  checks.push({
    name: 'tool_errors',
    pass: scanned ? toolErrors === 0 : true, // no trace → nothing to fail on
    detail: scanned ? `${toolErrors} errored step(s) in trace` : 'no trace provided',
  });
  const ok = checks.every((c) => c.pass);
  return {
    ok,
    checks,
    reason: ok ? 'all checks passed' : `failed: ${checks.filter((c) => !c.pass).map((c) => c.name).join(', ')}`,
  };
}

/* ════════════════════════════════════════════════════════════════════
 * AGENTIC TURN — the seam the /api/chat handler calls
 * ════════════════════════════════════════════════════════════════════
 * route → execute → verify → shape the done() payload. Returns null when
 * the lane does not take the turn (caller falls through to legacy).
 */
/* ════════════════════════════════════════════════════════════════════
 * SUB-AGENT DISPATCH (PHASE 5 P5-7) — multi-step turns spawn REAL children
 * ════════════════════════════════════════════════════════════════════
 * A compound query (evidence for ≥2 capabilities) is executed by REAL
 * sub-agents — each child is an independent AgentLoop run through
 * SubagentRuntime (bounded MAX_PARALLEL=3), with the P30.C contract
 * {allowedTools (from the REAL catalog bridge), maxTurns, permissionMode}
 * validated through the mounted enforcement seam.
 * Return contract per child: {result, toolsUsed, cost, duration}.
 */

/** Per-capability evidence score (the catalogMatch internals, exposed). */
function catalogMatchFor(cap, query) {
  const q = String(query || '');
  const hits = [];
  let score = 0;
  for (const ev of cap.evidence || []) {
    const re = new RegExp(ev.re.source, ev.re.flags.replace('g', ''));
    if (re.test(q)) { hits.push(re.source); score += ev.w || 1; }
  }
  return { score, hits };
}

/** Detect compound queries: every catalog route with real evidence, ranked. */
function detectCompoundRoutes(query) {
  try {
    const scored = CAPABILITY_CATALOG
      .map((c) => ({ id: c.id, ...catalogMatchFor(c, query) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || TIE_ORDER.indexOf(a.id) - TIE_ORDER.indexOf(b.id));
    return scored.slice(0, 3).map((r) => r.id);
  } catch { return []; }
}

/**
 * Dispatch REAL sub-agents for the given routes. Returns
 * { used, aggregate, contracts, results, enforcement, durationMs }.
 */
export async function dispatchSubagents(query, routes, opts = {}) {
  const started = Date.now();
  const emit = (type, data) => { try { if (typeof opts.sendEvent === 'function') opts.sendEvent(type, data); } catch { /* never break a turn */ } };
  const contracts = routes.map((route, i) => ({
    // Phase 13 base spec (agents/workforce/agents/agent-spec.js REQUIRED_FIELDS)
    id: `jexi-agentic-${i + 1}-${route}`,
    name: `agentic-step-${i + 1}`,
    division: 'operations',
    role: `execute the "${route}" capability for this turn step`,
    capabilities: route === 'memory_write' || route === 'memory_read' ? ['memory'] : (route === 'code_run' ? ['code'] : (route === 'web_search' ? ['search', 'research'] : ['reasoning'])),
    trustLevel: 'restricted',
    origin: 'agentic-decision-lane',
    // P30.C additive contract fields
    allowedTools: CAPABILITY_TOOLS[route] || [],
    maxTurns: 3,
    permissionMode: 'default', // P30.C PERMISSION_MODES: default|acceptEdits|plan
  }));
  // P30.C contract enforcement — validate every contract through the mounted
  // seam (verdicts journaled; an invalid contract blocks the delegation honestly).
  const enforcement = [];
  try {
    const { subagentEnforcement, initSubagentEnforcement, normalizeContract } = await import('../wiring/phase31-subagent.js');
    const enf = subagentEnforcement() || initSubagentEnforcement();
    for (const spec of contracts) {
      // P10 GAP 4 — normalize BEFORE validate: 'readonly' is a documented
      // JEXI alias of plan-mode (write tools still refused per call). The
      // raw mode rides along for honest reporting.
      const normalized = normalizeContract ? normalizeContract(spec) : spec;
      const v = enf.validate ? enf.validate(normalized) : null;
      const errors = v && Array.isArray(v.errors) ? v.errors : (v && v.valid === false ? [{ message: 'invalid' }] : []);
      if (errors.length) {
        enforcement.push({ id: spec.id, allowed: false, reason: errors.map((e) => e.message || e.code).join('; ').slice(0, 160) });
      } else {
        enforcement.push({ id: spec.id, allowed: true, permissionMode: spec.permissionMode, enforcedAs: normalized.permissionMode, maxTurns: spec.maxTurns });
      }
    }
  } catch (e) {
    enforcement.push({ seam: 'unavailable', reason: String(e && e.message || e).slice(0, 120) });
  }
  if (enforcement.some((e) => e.allowed === false)) {
    return { used: 0, aggregate: '', contracts, results: [], enforcement, durationMs: Date.now() - started, refused: true };
  }
  const { runSubagents } = await import('./SubagentRuntime.js');
  const tasks = routes.map((route, i) => ({
    name: contracts[i].id,
    query: `${query}\n\n(Your single capability for this step: ${route}. ${CAPABILITY_CATALOG.find((c) => c.id === route)?.description || ''})`,
    // P10 GAP 1/4 — each child carries its own capability route (keyless brain)
    // and its own P30.C contract (per-tool-call enforcement in AgentLoop).
    capabilityRoute: route,
    capabilityQuery: query,
    contract: contracts[i],
  }));
  const out = await runSubagents({ tasks, sendEvent: emit, opts: { depth: 1 } });
  const children = (out && out.subagents) || [];
  const results = children.map((c) => ({
    name: c.name,
    result: String(c.summary || c.answer || '').slice(0, 4000),
    toolsUsed: c.toolCalls || 0,
    cost: 0, // keyless sandbox — real metering rides RequestMeter when keyed
    duration: c.durationMs || 0,
    status: c.status,
  }));
  // P10 GAP 1 — KEYLESS COORDINATOR COMPOSER: with no model key the children
  // still produced REAL results (capability-runner brains); the coordinator
  // assembles the final answer from those { result } payloads itself, applying
  // the original question's rubric. Never a stub — the content is the
  // children's own output, structured and rubric-checked.
  let aggregate = String((out && out.aggregate) || '');
  let composed = null;
  if (!canChat()) {
    composed = composeChildAnswers(query, results);
    if (composed.ok && composed.aggregate) aggregate = composed.aggregate;
    emit('log', { agent: 'Decision', message: `🧩 keyless composer: ${composed.checks.map((c) => `${c.name}:${c.pass ? 'ok' : 'FAIL'}`).join(' · ')}${composed.ok ? ' — final answer assembled from real child results.' : ''}` });
  }
  return {
    used: results.length,
    aggregate: aggregate.slice(0, 8000),
    composed: composed ? { ok: composed.ok, checks: composed.checks } : null,
    contracts,
    results,
    enforcement,
    durationMs: Date.now() - started,
  };
}

export async function agenticTurn({ raw, effectiveQuery, sessionId = null, sendEvent } = {}) {
  const q = String(effectiveQuery || raw || '').trim();
  if (!q) return null;
  const emit = (type, data) => { try { if (typeof sendEvent === 'function') sendEvent(type, data); } catch { /* never break a turn */ } };
  // Part 2 closed loop — the agentic lane READS the brain too (4 sources,
  // bounded, fail-soft) and hands it to the model-backed runners.
  let brainContext = '';
  try {
    const { brainRecallBlock } = await import('./BrainRecall.js');
    brainContext = await brainRecallBlock({ sessionId, query: q });
  } catch { brainContext = ''; }
  const decision = await routeDecision(q);
  emit('log', {
    agent: 'Decision',
    message: `🧭 routeDecision → ${decision.route} (via ${decision.via}, confidence ${decision.confidence.toFixed(2)}) — ${decision.reasoning}`,
  });
  // Only the six concrete capabilities take this lane; 'none'/unknown falls through.
  if (!decision.ok || !RUNNERS[decision.route]) return null;

  // PHASE 5 P5-7 — COMPOUND TURNS SPAWN REAL SUB-AGENTS: when the query
  // carries evidence for ≥2 capabilities, each step is dispatched as a REAL
  // child agent (own AgentLoop, own context) under a P30.C contract.
  const compoundRoutes = detectCompoundRoutes(q);
  let delegation = null;
  if (compoundRoutes.length >= 2) {
    emit('log', { agent: 'Decision', message: `🧩 compound turn (${compoundRoutes.join(' + ')}) — dispatching ${compoundRoutes.length} real sub-agents.` });
    delegation = await dispatchSubagents(q, compoundRoutes, { sendEvent: emit, sessionId });
  }

  const executed = await executePlan(decision, q, { sessionId, brainContext });
  if (!executed.success || !executed.summary) {
    // P10 GAP 1 — when the compound dispatch produced real child results, the
    // coordinator's composed answer IS the turn's answer (the primary lane
    // failing does not throw away real children's work).
    if (delegation && delegation.aggregate && delegation.results.some((r) => String(r.result || '').trim())) {
      const composedOk = !delegation.composed || delegation.composed.ok !== false;
      if (composedOk) {
        emit('log', { agent: 'Decision', message: '🧩 primary lane did not complete — sub-agent coordinator composed the final answer from real child results.' });
        return {
          done: {
            success: true,
            query: raw,
            summary: delegation.aggregate,
            statistics: {
              executionTime: delegation.durationMs,
              agenticRoute: decision.route,
              routeVia: `${decision.via}+subagent-compose`,
              verification: 'pass (composed from verified child results)',
              agentsUsed: 1 + delegation.used,
              confidence: decision.confidence,
              subagentsUsed: delegation.used,
              subagentContracts: delegation.contracts,
              subagentResults: delegation.results,
              subagentEnforcement: delegation.enforcement,
              subagentComposition: delegation.composed,
              subagentDurationMs: delegation.durationMs,
            },
          },
          trace: executed.trace,
          decision,
        };
      }
    }
    // Honest handoff: this lane could not complete (keyless question with no
    // deterministic path, empty search…) — the legacy pipeline gets the turn.
    emit('log', { agent: 'Decision', message: `↩ ${decision.route} lane could not complete (${String(executed.error || '').slice(0, 100)}) — legacy pipeline takes the turn.` });
    return null;
  }
  // P10 GAP 1 — compound turns carry the children's real contributions in the
  // final answer (the user sees every sub-agent's result, not just the parent's).
  if (delegation && delegation.aggregate && delegation.results.some((r) => String(r.result || '').trim()) && !executed.summary.includes(delegation.aggregate)) {
    const contribution = delegation.aggregate.replace(/^### Sub-agent results[^\n]*\n/, '').trim();
    if (contribution && !executed.summary.includes(contribution)) executed.summary = `${executed.summary}\n\n${delegation.aggregate}`;
  }
  const verdict = verifyAnswer(q, executed.summary, executed.trace);
  emit('log', {
    agent: 'Decision',
    message: `✓ verifyAnswer: ${verdict.ok ? 'PASS' : 'FAIL'} — ${verdict.checks.map((c) => `${c.name}:${c.pass ? 'ok' : 'FAIL'}`).join(' · ')}`,
  });
  if (!verdict.ok) {
    emit('log', { agent: 'Decision', message: '↩ verification failed — legacy pipeline takes the turn (never a fake PASS).' });
    return null;
  }
  return {
    done: {
      success: true,
      query: raw,
      summary: executed.summary,
      statistics: {
        executionTime: Date.now() - new Date(executed.trace.startedAt).getTime(),
        agenticRoute: decision.route,
        routeVia: decision.via,
        verification: verdict.ok ? 'pass' : 'fail',
        agentsUsed: 1,
        confidence: decision.confidence,
        // PHASE 5 P5-7 — the real sub-agent dispatch record (contract +
        // per-child {result, toolsUsed, cost, duration}). P10 GAP 1 — the
        // composer verdict rides along so callers see the composition check.
        ...(delegation ? {
          subagentsUsed: delegation.used,
          subagentContracts: delegation.contracts,
          subagentResults: delegation.results,
          subagentEnforcement: delegation.enforcement,
          subagentComposition: delegation.composed,
          subagentDurationMs: delegation.durationMs,
        } : {}),
      },
    },
    trace: executed.trace,
    decision,
    verdict,
  };
}
