/**
 * JEXI OS — AGENT — ToolCallRecovery.
 *
 * M15 — a model that describes a tool call in PROSE instead of emitting a
 * native `tool_calls` array is not a provider bug, it is a capability gap that
 * small/local models hit constantly. Measured on the exact request JEXI sends
 * (a ~25k system prompt plus nine tool schemas): `llama3.2:3b` via Ollama
 * emits a real `tool_calls` array roughly 40% of the time and the other 60%
 * writes the call as text, e.g.
 *
 *     {"name": "fs_write", "parameters": {"path": "hello.py", "content": "..."}}
 *
 * The native loop then sees `toolCalls.length === 0`, treats the turn as a
 * direct answer, and the task dies with zero tool calls. The tool was offered
 * the whole time.
 *
 * This module is the recovery seam. It is deliberately narrow:
 *
 *   1. It only ever returns a call for a tool that is in the OFFERED menu
 *      (case-insensitive). An invented name is not recovered — the model must
 *      not be able to reach a tool that was never disclosed.
 *   2. The arguments must be a JSON object. Anything else is not a call.
 *   3. It is used ONLY when the round produced no native calls, so a real
 *      provider tool call is always preferred and never overridden.
 *   4. The recovered call is executed through the SAME gated `executeToolCalls`
 *      path — permission profile, RiskGuard, ring and approval all still run.
 *      Recovery changes WHICH calls are seen, never what they are allowed to do.
 *
 * It does not invent a call for every coding prompt, and it never fabricates a
 * result: a recovered call that fails is fed back as a real error.
 */

/** Fenced ```json blocks, plus bare top-level JSON objects. */
const FENCE_RE = /```(?:json|javascript|js|tool|tool_call)?\s*([\s\S]*?)```/gi;

function* candidateStrings(text) {
  const s = String(text ?? '');
  for (const m of s.matchAll(FENCE_RE)) if (m[1]) yield m[1];
  yield s; // also scan the raw text for a bare object
}

/** Every balanced {...} substring, so nested argument objects survive. */
function* balancedObjects(s) {
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '{') continue;
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) { yield s.slice(i, j + 1); i = j; break; }
      }
    }
  }
}

/**
 * Parse JSON the way a model actually writes it.
 *
 * The dominant prose shape for a file write is
 *     {"name":"fs_write","parameters":{"path":"hello.py","content":"print("hello world")"}}
 * — the inner quotes of the code being written are UNESCAPED, so `JSON.parse`
 * rejects it. That is not an edge case; it was the exact text of the failing
 * round. Repair the single most common break — a string value containing raw
 * `"` — by re-escaping quotes that appear inside a value, then parse again.
 * Only a genuine parse of the repaired text is accepted; nothing is guessed.
 */
function parseJsonLoose(text) {
  try { return JSON.parse(text); } catch { /* try repair */ }
  let out = '';
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') { out += c + (text[i + 1] ?? ''); i++; continue; }
    if (c === '"') {
      if (!inStr) { inStr = true; out += c; continue; }
      // Closing the string only if what follows is structural (or end).
      const rest = text.slice(i + 1).match(/^\s*(.)/);
      const next = rest ? rest[1] : '';
      if (next === '' || next === ':' || next === ',' || next === '}' || next === ']') { inStr = false; out += c; continue; }
      out += '\\"'; // a quote INSIDE a value — escape it
      continue;
    }
    out += c;
  }
  try { return JSON.parse(out); } catch { return null; }
}

/** Pull a name/arguments pair out of one parsed object, or null. */
function callFromObject(obj, allowedLower) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  // OpenAI-shaped: { function: { name, arguments } }
  const fn = obj.function && typeof obj.function === 'object' ? obj.function : null;
  const rawName = obj.name ?? obj.tool ?? obj.tool_name ?? obj.slug ?? (fn ? fn.name : undefined);
  if (typeof rawName !== 'string' || !rawName.trim()) return null;
  const name = rawName.trim();
  if (!allowedLower.has(name.toLowerCase())) return null;

  let args = obj.parameters ?? obj.arguments ?? obj.args ?? obj.input ?? (fn ? fn.arguments : undefined);
  if (typeof args === 'string') {
    try { args = JSON.parse(args); } catch { return null; }
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
  return { name, arguments: args };
}

/**
 * Recover tool calls the model wrote as text.
 *
 * @param {string} text            the round's assistant text
 * @param {string[]} offeredNames  the tool names currently in the menu
 * @returns {{name:string, arguments:object}[]}  may be empty; never throws
 */
export function recoverToolCallsFromText(text, offeredNames = []) {
  const allowedLower = new Set((offeredNames || []).map((n) => String(n || '').toLowerCase()).filter(Boolean));
  if (!allowedLower.size) return [];
  const found = [];
  const seen = new Set();
  for (const chunk of candidateStrings(text)) {
    for (const objText of balancedObjects(chunk)) {
      const obj = parseJsonLoose(objText);
      if (!obj) continue;
      const call = callFromObject(obj, allowedLower);
      if (!call) continue;
      const key = `${call.name}:${JSON.stringify(call.arguments)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(call);
    }
  }
  return found;
}

/** Did this text look like an attempt to call a tool at all (for honest logs)? */
export function looksLikeToolAttempt(text) {
  return /\{\s*"(?:name|tool|tool_name|slug|function)"\s*:/.test(String(text ?? ''));
}
