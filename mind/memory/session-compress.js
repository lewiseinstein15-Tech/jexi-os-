/**
 * JEXI OS — Phase 22 Scope A — CLAUDE MEM: session memory compression.
 *
 * Pattern (thedotmack/claude-mem): every session turn is captured, the
 * session is compressed into compact "observations", and relevant
 * observations are injected into a later session under a token budget.
 *
 * This scope is the COMPRESSION half. Injection lives in ./session-inject.js.
 * Both are a STANDALONE subsystem: nothing under server/src/memory/** is
 * touched, and no server wiring happens here (that is a zone-owner task).
 *
 * COMPRESSION IS RULE-BASED.
 *   Label: "rule-based - LLM compression NOT VERIFIED".
 *   Upstream claude-mem compresses with an LLM observation generator
 *   (src/server/generation/ProviderObservationGenerator.ts). No LLM calls are
 *   made here, so the LLM path is NOT VERIFIED; the observation schema is
 *   modeled on upstream `observations` (type/title/narrative/facts/concepts/
 *   files_read/files_modified/discovery_tokens).
 *
 * Storage: .jexi/session-mem/<sessionId>.turns.json  (raw captured turns)
 *          .jexi/session-mem/<sessionId>.obs.json    (compressed observations)
 * Every read goes to disk — there is no in-process cache — so a SIGKILLed
 * process loses nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const COMPRESSION_MODE = 'rule-based';
export const LLM_COMPRESSION_LABEL = 'rule-based - LLM compression NOT VERIFIED';
export const CHARS_PER_TOKEN_ESTIMATE = 4;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function storeDir() {
  return process.env.JEXI_SESSION_MEM_DIR || path.join(REPO_ROOT, '.jexi', 'session-mem');
}

/** Filesystem-safe session id (a session id is data, not a path). */
function safeId(sessionId) {
  if (typeof sessionId !== 'string' || sessionId.trim() === '') {
    throw new TypeError('session-compress: sessionId must be a non-empty string');
  }
  return sessionId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 200);
}

function turnsPath(sessionId) { return path.join(storeDir(), `${safeId(sessionId)}.turns.json`); }
function obsPath(sessionId) { return path.join(storeDir(), `${safeId(sessionId)}.obs.json`); }

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file); // atomic: a SIGKILL mid-write cannot truncate the store
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function estimateTokens(text) {
  return Math.ceil(String(text ?? '').length / CHARS_PER_TOKEN_ESTIMATE);
}

/** Capture one session turn. Deterministic: a supplied ts is never overwritten. */
export function captureTurn(sessionId, turn) {
  const turns = readTurns(sessionId);
  const text = String(turn?.text ?? turn?.content ?? '');
  const entry = {
    index: turns.length,
    role: String(turn?.role ?? 'unknown'),
    text,
    tool: turn?.tool ? String(turn.tool) : null,
    ts: String(turn?.ts ?? new Date().toISOString()),
  };
  turns.push(entry);
  writeJson(turnsPath(sessionId), turns);
  return entry;
}

export function captureSession(sessionId, turns) {
  writeJson(turnsPath(sessionId), []);
  return (turns || []).map((t) => captureTurn(sessionId, t));
}

export function readTurns(sessionId) {
  const v = readJson(turnsPath(sessionId), []);
  return Array.isArray(v) ? v : [];
}

export function readObservations(sessionId) {
  const v = readJson(obsPath(sessionId), null);
  if (!v || !Array.isArray(v.observations)) return null;
  return v;
}

/* ------------------------------------------------------------------ *
 * Rule-based observation extraction
 * ------------------------------------------------------------------ */

const TYPE_RULES = [
  ['bugfix', /\b(fix|fixed|bug|broken|regression|crash|failure|failing|error)\b/i],
  ['decision', /\b(decided|decision|we will|we'll|chose|choose|instead of|trade-?off|agreed|rejected alternative)\b/i],
  ['discovery', /\b(found|discovered|realized|learnt|learned|turns out|root cause|the reason|noticed)\b/i],
  ['refactor', /\b(refactor|rename|renamed|extract|simplif|cleanup|clean up|moved|reorganiz)\b/i],
  ['test', /\b(test|assert|spec|verified|verify|probe|passing|green suite)\b/i],
  ['feature', /\b(add|added|implement|implemented|build|built|create|created|introduce|support)\b/i],
];

const FILE_RE = /(?:^|[\s("'`[])([\w./-]+\.(?:js|mjs|cjs|ts|tsx|json|md|py|yml|yaml|sh|css|html|sql))\b/g;
const WRITE_RE = /\b(write|wrote|edit|edited|create|created|modify|modified|update|updated|touch|patch|apply)\b/i;
const READ_RE = /\b(read|open|opened|view|viewed|cat|inspect|loaded|grep)\b/i;

const CONCEPTS = [
  'memory', 'session', 'compress', 'compression', 'inject', 'injection', 'observation',
  'graph', 'rag', 'entity', 'relation', 'retrieval', 'gate', 'skill', 'workflow', 'n8n',
  'obsidian', 'forge', 'dispatch', 'vendor', 'gsd', 'phase', 'context', 'token', 'budget',
  'determinism', 'deterministic', 'persistence', 'test', 'review', 'plan', 'security',
];

function classify(text) {
  for (const [type, re] of TYPE_RULES) if (re.test(text)) return type;
  return 'note';
}

function extractFiles(text) {
  const files = new Set();
  let m;
  FILE_RE.lastIndex = 0;
  while ((m = FILE_RE.exec(text)) !== null) files.add(m[1]);
  return [...files];
}

function extractConcepts(text) {
  const lower = text.toLowerCase();
  return CONCEPTS.filter((c) => lower.includes(c));
}

function bullets(text) {
  return text.split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[-*]\s+\S/.test(l) || /^\d+[.)]\s+\S/.test(l))
    .map((l) => l.replace(/^[-*]\s+/, '').replace(/^\d+[.)]\s+/, '').trim())
    .filter(Boolean);
}

function firstSentence(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  const m = /^(.{20,140}?[.!?])(\s|$)/.exec(clean);
  return (m ? m[1] : clean.slice(0, 100)).trim();
}

function narrativeOf(text, max = 600) {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/**
 * Turn window size. Upstream compresses a whole session with one LLM pass;
 * the rule-based analogue compresses one WINDOW at a time, so the compression
 * ratio is a documented function of the window size and the per-observation
 * character cap. 10 turns is the working-set unit used by the probe.
 */
export const CHUNK_TURNS = 10;
/** Hard cap on one observation's rendered text — this is what bounds the ratio. */
export const OBSERVATION_MAX_CHARS = 400;

/** Sentences carrying the most signal first, then document order. Stable. */
function signalSentences(text) {
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12);
  const seen = new Set();
  const out = [];
  for (const s of sentences) {
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function isSignal(sentence) {
  return /\b(fix|fixed|bug|decided|decision|found|discovered|root cause|rejected|wrote|writes|created|added|implemented|verified|test|probe|refactor)\b/i.test(sentence);
}

/** Render exactly the fields injection scores against. */
function renderForBudget(obs) {
  return [
    `${obs.type} ${obs.title}`,
    obs.narrative,
    obs.facts,
    obs.concepts,
    obs.files_read || obs.files_modified,
  ].filter(Boolean).join(' ');
}

/**
 * Fit one observation under OBSERVATION_MAX_CHARS deterministically: drop
 * facts from the END first (least preferred), then truncate the narrative.
 * Concepts/files/type are never dropped — they are the retrieval index.
 */
function fitToCap(obs) {
  let facts = obs.facts ? obs.facts.split(' | ') : [];
  while (renderForBudget({ ...obs, facts: facts.length ? facts.join(' | ') : null }).length > OBSERVATION_MAX_CHARS
         && facts.length > 0) {
    facts = facts.slice(0, -1);
  }
  let out = { ...obs, facts: facts.length ? facts.join(' | ') : null };
  let narrative = out.narrative;
  while (renderForBudget({ ...out, narrative }).length > OBSERVATION_MAX_CHARS && narrative.length > 40) {
    narrative = `${narrative.slice(0, Math.max(40, narrative.length - 40) - 1)}…`;
  }
  return { ...out, narrative };
}

/**
 * compress(sessionId, { chunkTurns }) -> { observations, sourceTurnCount, ratio }
 *
 * Rule-based; deterministic (a pure function of the captured turns). Turns are
 * compressed in fixed windows (CHUNK_TURNS, default 10) into one compact
 * observation per window: the window's type, its union of concepts and files,
 * a title, at most a few signal facts, and a narrative — all capped so the
 * rendered observation fits OBSERVATION_MAX_CHARS. Nothing time- or
 * entropy-derived is stored (no UUIDs, no wall-clock in the hashed fields), so
 * the same captured turns always produce byte-identical observations.
 */
export function compress(sessionId, { chunkTurns = CHUNK_TURNS } = {}) {
  const turns = readTurns(sessionId).filter((t) => String(t.text ?? '').trim());
  const windows = [];
  for (let i = 0; i < turns.length; i += chunkTurns) {
    windows.push(turns.slice(i, i + chunkTurns));
  }

  const observations = windows.map((win) => {
    const text = win.map((t) => String(t.text ?? '')).join('\n');
    const type = classify(text);
    const files = extractFiles(text);
    const writing = WRITE_RE.test(text) && !READ_RE.test(text);
    const sentences = signalSentences(text);
    const preferred = sentences.filter(isSignal);
    const title = firstSentence(preferred[0] || sentences[0] || text);
    const facts = (preferred.length ? preferred : sentences)
      .slice(1, 4).map((s) => (s.length > 110 ? `${s.slice(0, 109)}…` : s));
    const ts = win[0].ts;
    const epoch = Date.parse(ts) || 0;
    const id = createHash('sha256')
      .update(`${safeId(sessionId)}|${win[0].index}|${win[win.length - 1].index}|${type}|${text}`)
      .digest('hex').slice(0, 16);
    return fitToCap({
      id,
      session_id: sessionId,
      type,
      title,
      subtitle: `${type} · ${win.length} turn(s) (${win[0].index}–${win[win.length - 1].index})`,
      narrative: narrativeOf(sentences.slice(0, 2).join(' ') || text, 220),
      facts: facts.length ? facts.join(' | ') : null,
      concepts: extractConcepts(text).join(','),
      files_read: writing ? null : (files.join(',') || null),
      files_modified: writing ? (files.join(',') || null) : null,
      turn_range: [win[0].index, win[win.length - 1].index],
      turn_count: win.length,
      discovery_tokens: estimateTokens(text),
      created_at: ts,
      created_at_epoch: epoch,
    });
  });

  const sourceText = turns.map((t) => String(t.text ?? '')).join('\n');
  const observationText = observations.map(renderForBudget).join('\n');
  const sourceTokens = estimateTokens(sourceText);
  const observationTokens = estimateTokens(observationText);
  const ratio = observationTokens === 0 ? 0 : Number((sourceTokens / observationTokens).toFixed(4));

  const payload = {
    session_id: sessionId,
    compression_mode: COMPRESSION_MODE,
    label: LLM_COMPRESSION_LABEL,
    sourceTurnCount: turns.length,
    observationCount: observations.length,
    sourceTokens,
    observationTokens,
    ratio,
    observations,
    compressed_at: new Date().toISOString(),
  };
  writeJson(obsPath(sessionId), payload);
  return {
    observations,
    sourceTurnCount: turns.length,
    ratio,
    observationCount: observations.length,
    sourceTokens,
    observationTokens,
    label: LLM_COMPRESSION_LABEL,
  };
}

export default { compress, captureTurn, captureSession, readTurns, readObservations, estimateTokens };