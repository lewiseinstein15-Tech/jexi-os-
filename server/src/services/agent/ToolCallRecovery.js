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
 * M19 — ALIAS RESOLUTION. The M18 investigation found the dominant remaining
 * failure is not a missing call but a call under the WRONG NAME: the model
 * answers `{"name":"code_write",…}` — a real JEXI tool name (the registry
 * slug is `code-write`), and the one the task text asks for — while the menu
 * offers the domain implementation `fs_write`. Recovery rejected it as "not
 * offered" and the turn died with zero calls. JEXI advertises the registry
 * name and implements the domain name, with no bridge between them; this is
 * the bridge. It maps a small, explicit set of known aliases to the canonical
 * domain tool, and ONLY when that canonical tool is actually in the offered
 * menu — an alias can never disclose a tool the session did not offer.
 *
 * This module is deliberately narrow:
 *
 *   1. It only ever returns a call for a tool that is in the OFFERED menu
 *      (case-insensitive, after alias resolution). An invented name is not
 *      recovered — the model must not be able to reach a tool that was never
 *      disclosed.
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

/**
 * M19 — alias table. Maps a name a model plausibly emits to the canonical
 * DOMAIN tool that implements it. Every target is a registered domain tool
 * slug; resolution is still gated on the target being in the offered menu.
 * Names are matched case-insensitively after hyphen/underscore/dot folding,
 * so `code_write`, `code-write` and `CodeWrite` all land on the same key.
 */
export const TOOL_ALIASES = Object.freeze({
  // whole-file write
  'code-write': 'fs_write',
  'code_write': 'fs_write',
  'write-file': 'fs_write',
  'write_file': 'fs_write',
  'writefile': 'fs_write',
  'file-write': 'fs_write',
  'fs-create': 'fs_write',
  // read
  'code-read': 'fs_read',
  'code_read': 'fs_read',
  'read-file': 'fs_read',
  'read_file': 'fs_read',
  'readfile': 'fs_read',
  'file-read': 'fs_read',
  // edit / patch
  'code-edit': 'fs_edit',
  'code_edit': 'fs_edit',
  'edit-file': 'fs_edit',
  'edit_file': 'fs_edit',
  'apply-patch': 'fs_edit',
  'apply_patch': 'fs_edit',
  'str-replace': 'fs_edit',
  'str_replace': 'fs_edit',
  // append
  'code-append': 'fs_append',
  'code_append': 'fs_append',
  'append-file': 'fs_append',
  'append_file': 'fs_append',
  // run
  'code-run': 'term_execute',
  'code_run': 'term_execute',
  'run-code': 'term_execute',
  'run_code': 'term_execute',
  'run-command': 'term_execute',
  'run_command': 'term_execute',
  'execute': 'term_execute',
  'exec': 'term_execute',
  'shell': 'term_execute',
  'bash': 'term_execute',
  'run-in-sandbox': 'term_execute',
  'run_in_sandbox': 'term_execute',
  // tests
  'run-tests': 'pytest_run',
  'run_tests': 'pytest_run',
  'test-run': 'pytest_run',
  'test_run': 'pytest_run',
  'pytest': 'pytest_run',
  // listing / search
  'list-files': 'fs_ls',
  'list_files': 'fs_ls',
  'ls': 'fs_ls',
  'find-files': 'fs_glob',
  'find_files': 'fs_glob',
  'glob': 'fs_glob',
  'search-files': 'fs_grep',
  'search_files': 'fs_grep',
  'grep': 'fs_grep',
});

/** Fold a name to its alias key: lowercase, separators unified, no extension. */
function foldName(name) {
  return String(name || '').trim().toLowerCase().replace(/[\s.]+/g, '-').replace(/_/g, '-');
}

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

/**
 * Resolve a model-emitted tool name to a canonical name in the offered menu.
 *
 * Returns `{ name, aliased }` where `name` is a name actually present in
 * `offeredNames`, or null when nothing in the menu matches. Resolution order:
 *   1. exact (case-insensitive) match on the offered menu;
 *   2. alias-table lookup, accepted only when the TARGET is offered.
 * An alias whose target is not offered resolves to null — never a disclosure.
 */
export function resolveToolName(rawName, offeredNames = []) {
  const offered = (offeredNames || []).map((n) => String(n || '')).filter(Boolean);
  if (!offered.length) return null;
  const byLower = new Map(offered.map((n) => [n.toLowerCase(), n]));
  const direct = byLower.get(String(rawName || '').trim().toLowerCase());
  if (direct) return { name: direct, aliased: false };
  const target = TOOL_ALIASES[foldName(rawName)];
  if (target && byLower.has(target.toLowerCase())) return { name: byLower.get(target.toLowerCase()), aliased: true };
  return null;
}

/**
 * M19 — argument-key bridge for write tools.
 *
 * JEXI's registry slug `code-write` documents `filename`, while the domain
 * tool it resolves to (`fs_write`) takes `path`. A model that read the
 * registry name may therefore send `filename`; remap the known synonyms onto
 * the canonical key, but ONLY when the canonical key is absent, so a call that
 * already carries `path` is never disturbed.
 */
const PATH_KEY_SYNONYMS = ['filename', 'file_name', 'filepath', 'file_path', 'file'];
function remapWriteArgs(name, args) {
  if (name !== 'fs_write' && name !== 'fs_append' && name !== 'fs_read' && name !== 'fs_edit' && name !== 'fs_delete') return args;
  if (args.path !== undefined) return args;
  for (const k of PATH_KEY_SYNONYMS) {
    if (typeof args[k] === 'string' && args[k]) {
      const { [k]: v, ...rest } = args;
      return { ...rest, path: v };
    }
  }
  return args;
}

/** Pull a name/arguments pair out of one parsed object, or null. */
function callFromObject(obj, offeredNames) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  // OpenAI-shaped: { function: { name, arguments } }
  const fn = obj.function && typeof obj.function === 'object' ? obj.function : null;
  const rawName = obj.name ?? obj.tool ?? obj.tool_name ?? obj.slug ?? (fn ? fn.name : undefined);
  if (typeof rawName !== 'string' || !rawName.trim()) return null;
  const resolved = resolveToolName(rawName, offeredNames);
  if (!resolved) return null;

  let args = obj.parameters ?? obj.arguments ?? obj.args ?? obj.input ?? (fn ? fn.arguments : undefined);
  if (typeof args === 'string') {
    try { args = JSON.parse(args); } catch { return null; }
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
  return { name: resolved.name, arguments: remapWriteArgs(resolved.name, args), aliasedFrom: resolved.aliased ? rawName.trim() : undefined };
}

/**
 * Recover tool calls the model wrote as text.
 *
 * @param {string} text            the round's assistant text
 * @param {string[]} offeredNames  the tool names currently in the menu
 * @returns {{name:string, arguments:object}[]}  may be empty; never throws
 */
export function recoverToolCallsFromText(text, offeredNames = []) {
  const offered = (offeredNames || []).map((n) => String(n || '')).filter(Boolean);
  if (!offered.length) return [];
  const found = [];
  const seen = new Set();
  for (const chunk of candidateStrings(text)) {
    for (const objText of balancedObjects(chunk)) {
      const obj = parseJsonLoose(objText);
      if (!obj) continue;
      const call = callFromObject(obj, offered);
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
