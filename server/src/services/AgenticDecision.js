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

/* ════════════════════════════════════════════════════════════════════
 * ROUTE DECISION — the model picks a capability from the catalog
 * ════════════════════════════════════════════════════════════════════ */

/** Render the catalog for the model prompt (Claude Code tool-declaration style). */
function catalogPromptBlock() {
  return CAPABILITY_CATALOG.map((c) => `- ${c.id} (${c.kind}): ${c.description}`).join('\n');
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
 * With a configured provider the MODEL picks (schema-checked); keyless the
 * deterministic catalog matcher decides. Always resolves — never throws.
 *
 * @returns {Promise<{ok:boolean, route:string, via:'model'|'catalog'|'none',
 *   confidence:number, reasoning:string, capability:object|null}>}
 */
export async function routeDecision(query, opts = {}) {
  const q = String(query || '').trim();
  if (!q) {
    return { ok: false, route: 'none', via: 'none', confidence: 0, reasoning: 'empty query', capability: null };
  }
  // PRIMARY — the model picks from the catalog (zero cost when keyless: the
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
          };
        }
      }
    } catch (e) { /* fall through to the catalog matcher — never crash */ }
  }
  // FALLBACK — deterministic catalog evidence matcher (keyless + model-unsure).
  const hit = catalogMatch(q);
  if (hit) {
    const cap = CAPABILITY_CATALOG.find((c) => c.id === hit.id);
    return {
      ok: true, route: hit.id, via: 'catalog',
      confidence: Math.min(1, 0.55 + 0.15 * hit.score),
      reasoning: `catalog evidence matched (score ${hit.score})${hit.hits.length ? `: ${hit.hits[0]}` : ''}`,
      capability: cap,
    };
  }
  // Nothing matched — the generic agent answers directly (no tool pretense).
  const direct = CAPABILITY_CATALOG.find((c) => c.id === 'direct_answer');
  return { ok: true, route: 'direct_answer', via: 'catalog', confidence: 0.5, reasoning: 'no tool evidence — default to direct answer', capability: direct };
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
      '|---|---||',
      '| $P(A|B)$ | posterior — probability of $A$ given evidence $B$ |',
      '| $P(B|A)$ | likelihood — probability of seeing $B$ if $A$ is true |',
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
      const out = await generateContent(q, `Answer the user directly and completely. Use markdown. For math use LaTeX ($inline$, $$block$$).${brainNote}`, null, { temperature: 0.3 });
      if (out && String(out).trim()) {
        return { ok: true, output: String(out).trim(), observation: 'direct answer via model', meta: { writer: 'model' } };
      }
    } catch (e) { /* fall through to keyless paths */ }
  }
  // 2) arithmetic one-liner — deterministic, exact
  const m = q.match(/(?:what\s+is|what's|whats|calculate|compute|solve)?\s*([\d\s+\-*/().^%x×÷]{2,40}?)\s*[=?]?\s*$/i);
  if (m) {
    const val = evalArithmetic(m[1]);
    if (val !== null) {
      const pretty = Number.isInteger(val) ? String(val) : String(Number(val.toFixed(6)));
      return { ok: true, output: `**${m[1].trim()} = ${pretty}**`, observation: `arithmetic evaluated exactly (${m[1].trim()} = ${pretty})`, meta: { writer: 'arithmetic' } };
    }
  }
  // 3) built-in reference notes
  for (const note of REFERENCE_NOTES) {
    if (note.match.test(q)) {
      return { ok: true, output: note.answer, observation: 'answered from the built-in reference notes (keyless mode)', meta: { writer: 'reference' } };
    }
  }
  // 4) honest keyless failure — never a fabricated answer
  return { ok: false, output: '', observation: 'no provider key configured and no deterministic path for this question', meta: { writer: 'none' } };
}

async function runWebSearch(args, opts = {}) {
  const q = String(args.query || '');
  const { aggregateSearch } = await import('./SearchEngine.js');
  const results = await aggregateSearch(q, null, {}) || [];
  const top = results.slice(0, 5);
  if (!top.length) {
    return { ok: false, output: '', observation: `web_search returned 0 results for "${q}"`, meta: { results: 0 } };
  }
  const lines = top.map((r, i) => `${i + 1}. [${r.title || '(untitled)'}](${r.link || r.url})${r.snippet ? ` — ${String(r.snippet).slice(0, 200)}` : ''}`);
  return {
    ok: true,
    output: [`Searched the web (web_search) for **${q}** — top live sources:`, '', ...lines, '', '_Sources fetched live from the web just now._'].join('\n'),
    observation: `web_search returned ${results.length} results; top ${top.length} cited`,
    meta: { results: results.length, urls: top.map((r) => r.link || r.url) },
  };
}

async function runFileRead(args, opts = {}) {
  const p = String(args.path || '');
  const resolved = p.startsWith('~') ? path.join(process.env.HOME || '/home/z', p.slice(1)) : path.resolve(p);
  // ACI precondition: read-only, exists, regular file, size-capped.
  let st;
  try { st = fs.statSync(resolved); } catch {
    return { ok: false, output: '', observation: `file not found: ${resolved}`, meta: { path: resolved } };
  }
  if (!st.isFile()) return { ok: false, output: '', observation: `not a regular file: ${resolved}`, meta: { path: resolved } };
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
      meta: { path: resolved, bytes: buf.length },
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
    meta: { file: fname, lang: composed.lang, writer: composed.writer, exit: success ? 0 : 1 },
  };
}

async function runMemoryWrite(args, opts = {}) {
  const { rememberUserFact } = await import('./MemoryManager.js');
  const fact = String(args.fact || '').trim();
  if (!fact) return { ok: false, output: '', observation: 'memory_write called with no fact', meta: {} };
  const saved = rememberUserFact(fact, 0.8, args.label || 'fact');
  if (!saved) return { ok: false, output: '', observation: `fact rejected (too short or duplicate): ${fact}`, meta: {} };
  return {
    ok: true,
    // The stored fact is echoed back — the user sees WHAT was kept, and
    // verifyAnswer's term-overlap check has grounded text to verify against.
    output: `Noted — I'll remember that: ${fact} ✓`,
    observation: `stored fact: "${fact}"`,
    meta: { fact, persisted: true },
  };
}

async function runMemoryRead(args, opts = {}) {
  const { searchUserFacts, loadMemory } = await import('./MemoryManager.js');
  const q = String(args.query || '');
  let found = [];
  try { found = await searchUserFacts(q, 5) || []; } catch { /* keyword fallback below */ }
  if (!found.length) {
    // Deterministic keyword fallback over the persisted fact store (the
    // vector layer can be unavailable keyless — the fact file is not).
    try {
      const mem = loadMemory();
      const terms = queryTerms(q).filter((t) => t.length >= 3);
      found = (mem.userFacts || [])
        .filter((f) => terms.some((t) => String(f.fact || '').toLowerCase().includes(t)))
        .slice(0, 5);
    } catch { /* stay empty — honest */ }
  }
  if (!found.length) {
    return { ok: false, output: "I don't have anything stored for that yet.", observation: `no stored facts matched "${q}"`, meta: { matches: 0 } };
  }
  const facts = found.map((f) => String(f.fact || f.text || '')).filter(Boolean);
  // Name-shaped questions get a direct sentence when a name fact exists.
  if (/\b(name|who am i)\b/i.test(q)) {
    const nameFact = facts.find((f) => /name is ["']?([A-Za-z][\w'-]{1,30})/i.test(f));
    if (nameFact) {
      const nm = nameFact.match(/name is ["']?([A-Za-z][\w'-]{1,30})/i)[1];
      return { ok: true, output: `Your name is **${nm}**.`, observation: `recalled name fact: "${nameFact}"`, meta: { matches: facts.length, fact: nameFact } };
    }
  }
  return {
    ok: true,
    output: [`Here's what I remember:`, '', ...facts.slice(0, 5).map((f) => `- ${f}`)].join('\n'),
    observation: `recalled ${facts.length} fact(s) for "${q}"`,
    meta: { matches: facts.length, facts: facts.slice(0, 3) },
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
  const executed = await executePlan(decision, q, { sessionId, brainContext });
  if (!executed.success || !executed.summary) {
    // Honest handoff: this lane could not complete (keyless question with no
    // deterministic path, empty search…) — the legacy pipeline gets the turn.
    emit('log', { agent: 'Decision', message: `↩ ${decision.route} lane could not complete (${String(executed.error || '').slice(0, 100)}) — legacy pipeline takes the turn.` });
    return null;
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
      },
    },
    trace: executed.trace,
    decision,
    verdict,
  };
}
