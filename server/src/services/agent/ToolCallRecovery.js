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
export function recoverToolCallsFromText(text, offeredNames = [], hint = {}) {
  const offered = (offeredNames || []).map((n) => String(n || '')).filter(Boolean);
  if (!offered.length) return [];
  const found = [];
  const seen = new Set();
  const push = (call) => {
    const key = `${call.name}:${JSON.stringify(call.arguments)}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push(call);
  };
  for (const chunk of candidateStrings(text)) {
    for (const objText of balancedObjects(chunk)) {
      const obj = parseJsonLoose(objText);
      if (!obj) continue;
      const call = callFromObject(obj, offered);
      if (!call) continue;
      push(call);
    }
  }
  /* M21 — a bash-style pseudo-command (`fs_write <path> <<EOF … EOF`) is the
     other dominant prose shape; the JSON scan above finds nothing in it. */
  for (const call of recoverBashPseudoCommands(text, offered)) push(call);
  /* M21 — prose plus a fenced ```python block holding the complete
     implementation, with a bare `fs_write <path>` naming the target. */
  for (const call of recoverFencedCodeWrite(text, offered, hint)) push(call);
  return collapseDuplicateWrites(found);
}

/**
 * M21 — when several recovered calls of the SAME tool write the SAME path (a
 * fenced block plus a heredoc, say), keep only the most complete body. Writing
 * both would let the shorter emission overwrite the better one; the loop
 * executes recovered calls in order, so last-writer-wins would silently pick
 * the wrong body. Different tools (a write plus an append) are left alone —
 * that is the deliberate split-write pattern, not a duplicate.
 */
function collapseDuplicateWrites(calls) {
  const byKey = new Map();
  const out = [];
  for (const c of calls) {
    const p = c.arguments && (c.arguments.path || c.arguments.file || c.arguments.filename);
    const content = c.arguments && (c.arguments.content ?? c.arguments.text ?? c.arguments.code);
    if (typeof p !== 'string' || typeof content !== 'string') { out.push(c); continue; }
    const key = `${c.name}:${p}`;
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, c); out.push(c); continue; }
    if (content.length > prev.content.length) {
      out[out.indexOf(prev)] = c;
      byKey.set(key, c);
    }
  }
  return out;
}

/** Did this text look like an attempt to call a tool at all (for honest logs)? */
export function looksLikeToolAttempt(text) {
  return /\{\s*"(?:name|tool|tool_name|slug|function)"\s*:/.test(String(text ?? ''));
}

/* ── M21 — FENCED-CODE-BLOCK WRITE ────────────────────────────────────────
 *
 * Live measurement (2026-11-04, HumanEval slice) found the dominant "no-call"
 * shape is not a JSON object and not a heredoc — it is PROSE plus a fenced
 * ```python block holding the COMPLETE implementation, followed by a bare
 * `fs_write <path>` reference (often inside a ```bash block) that names the
 * target but carries no body:
 *
 *     Here is the complete implementation of the function in a file:
 *     ```python
 *     from typing import List
 *     def longest(strings: List[str]) -> Optional[str]:
 *         ...
 *     ```
 *     To write this to the file and run the test, use the following commands:
 *     ```bash
 *     fs_write /sandbox/solution.py
 *     ```
 *
 * The model has the capability; the loop dropped the bytes because no parser
 * looked at the fence. The bounded malformed retry does not fire either —
 * `looksLikeToolAttempt` only detects a JSON-shaped attempt.
 *
 * The pairing is deliberately narrow and never fabricates:
 *   - a write tool must be in the OFFERED menu;
 *   - the fenced block must contain a real `def` (a fenced block of prose or a
 *     shell transcript is not a file body);
 *   - the target path must be known — either a `fs_write <path>` reference in
 *     the same text, or a caller-supplied hint from the turn's own instruction;
 *   - it is used ONLY when the round produced no calls, so a native call is
 *     never overridden, and it runs through the SAME gated executeToolCalls.
 */

const PY_FENCE_RE = /```(?:python|py)\s*\n([\s\S]*?)```/gi;
/* A truncated emission — the model hit its token cap before writing the closing
   fence — still holds a complete file body. Captured only up to the next fence
   opener or end of text, so a body is never fabricated past what was written. */
const PY_FENCE_OPEN_RE = /```(?:python|py)\s*\n([\s\S]*?)(?=```|$)/gi;
const BARE_WRITE_REF_RE = /(?:^|[\s`])(?:fs_write|fs_append|code_write|code-write|write_file)\s+([^\s`'"]+\.(?:py|js|ts|txt|json|md|sh|yaml|yml|toml))\b/g;
/* A turn that means to WRITE a file says so in its INSTRUCTION. This gates the
   instruction-derived path hint: a task that names a file without asking for it
   to be written (e.g. "here is /app/foo.py — explain this function") must never
   have the model's quoted snippet written back over the user's file. */
const WRITE_INSTRUCTION_RE = /\b(?:write|save|create|put|implement)\b/i;

/** The bodies of fenced ```python blocks that look like real code. */
export function extractFencedCodeBlocks(text) {
  const s = String(text ?? '');
  const out = [];
  for (const m of s.matchAll(PY_FENCE_RE)) {
    const body = String(m[1] ?? '');
    if (body.trim()) out.push(body.replace(/\n$/, ''));
  }
  /* A fence the model never closed (truncated at the token cap) still carries a
     body; only the missing closing delimiter is absent. */
  const closedCount = (s.match(/```/g) || []).length;
  if (closedCount % 2 === 1) {
    for (const m of s.matchAll(PY_FENCE_OPEN_RE)) {
      const body = String(m[1] ?? '').replace(/\n$/, '');
      if (body.trim()) out.push(body);
    }
  }
  return out;
}

/**
 * M21 — the target path a turn is writing to, read from the instruction text.
 *
 * The task text names the file ("write the complete implementation … to the
 * file /sandbox/solution.py"), and that is the path the recovered write must
 * land on when the answer itself carries no `fs_write <path>` reference. Only
 * a path token with a known source extension is accepted, so a sentence that
 * merely mentions `python` cannot be mistaken for a target.
 */
export function extractTargetPath(text) {
  const m = String(text ?? '').match(/(?:^|[\s`'"(])(\/?(?:[\w.@-]+\/)*[\w.@-]+\.(?:py|js|mjs|ts|txt|json|md|sh|yaml|yml|toml))\b/);
  return m ? m[1] : null;
}

/** M21 — does this INSTRUCTION ask for a file to be written? Gates the
 *  instruction-derived path hint (see `recoverFencedCodeWrite`). */
export function isWriteInstruction(text) {
  return WRITE_INSTRUCTION_RE.test(String(text ?? ''));
}

/**
 * Recover a whole-file write the model wrote as a fenced code block plus a
 * bare path reference. See the block comment above for the exact contract.
 *
 * @param {string} text
 * @param {string[]} offeredNames
 * @param {{ targetPath?: string|null, writeInstruction?: boolean }} [hint]
 * @returns {{name:string, arguments:object, aliasedFrom?:string}[]}
 */
export function recoverFencedCodeWrite(text, offeredNames = [], hint = {}) {
  const offered = (offeredNames || []).map((n) => String(n || '')).filter(Boolean);
  if (!offered.length) return [];
  const resolved = resolveToolName('fs_write', offered);
  if (!resolved) return [];

  const s = String(text ?? '');
  /* A block that DEFINES something is a candidate file body; the longest one
     is the most complete emission (a short illustrative snippet may precede
     the real file). */
  const implBlocks = extractFencedCodeBlocks(s).filter((b) => /\b(?:def|class)\s+\w+/.test(b));
  if (!implBlocks.length) return [];
  const body = implBlocks.slice().sort((a, b) => b.length - a.length)[0];

  const refs = [...s.matchAll(BARE_WRITE_REF_RE)].map((m) => m[1]).filter((p) => p && !p.includes('<<'));
  /* M22 — RESOLUTION ORDER. The turn's own INSTRUCTION is authoritative when it
     asks for a write: the task named the file to write, and the model's answer
     sometimes names a DIFFERENT one (measured: the instruction said
     `…/HumanEval_10/solution.py`, the answer's `fs_write` ref said
     `longest.py`, and the write landed on the wrong file so the grader saw an
     unmodified stub). The instruction hint therefore WINS whenever the
     instruction asks for a write; the answer's own ref is the fallback for a
     turn whose instruction names no file. With no hint, the ref must be
     intent enough on its own. */
  const hintPath = hint && hint.writeInstruction && hint.targetPath ? hint.targetPath : null;
  const targetPath = hintPath || (refs.length ? refs[refs.length - 1] : null);
  if (!targetPath) return [];

  const args = remapWriteArgs(resolved.name, { path: targetPath, content: `${body}\n` });
  return [{ name: resolved.name, arguments: args, aliasedFrom: resolved.aliased ? 'fs_write' : undefined }];
}

/* ── M21 — BASH-STYLE PSEUDO-COMMANDS ─────────────────────────────────────
 *
 * Live measurement (2026-11-03, HumanEval slice) found the dominant prose shape
 * is not a JSON object at all but a HEREDOC the model believes it is running:
 *
 *     ```bash
 *     fs_write /sandbox/solution.py <<EOF
 *     from typing import List
 *     def f(...): ...
 *     EOF
 *     ```
 *
 * It names the RIGHT tool and carries the COMPLETE file body, but the JSON
 * recovery finds nothing, so the turn ends with zero tool calls and the task
 * dies unwritten. Recovering the write from this shape is the single largest
 * remaining lever on the write rate.
 *
 * The parser is narrow and mirrors the JSON path's rules: the tool name must
 * resolve into the OFFERED menu, the heredoc must be CLOSED (an unterminated
 * body is a truncated emission, left to the bounded malformed-call retry), and
 * a command form is only accepted for tools that take one.
 */

const FENCE_BLOCK_RE = /```(?:bash|sh|shell|console|zsh)\s*\n([\s\S]*?)```/gi;
const WRITE_LINE_RE = /^\s*(fs_write|fs_append)\s+(\S+)\s*(?:<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\3)?\s*$/;
const RUN_LINE_RE = /^\s*(term_execute|pytest_run|run_tests|test_run|code_run)\s*\(?\s*['"]?([^\s'")]+)['"]?\s*\)?\s*$/;

/** Fenced bash/shell blocks, plus the raw text (an unfenced heredoc also counts). */
function* bashBlocks(text) {
  const s = String(text ?? '');
  let any = false;
  for (const m of s.matchAll(FENCE_BLOCK_RE)) { any = true; yield m[1]; }
  if (!any) yield s;
}

/**
 * Recover `fs_write <path> <<EOF … EOF` and `term_execute <file>` pseudo-commands.
 *
 * @param {string} text
 * @param {string[]} offeredNames
 * @returns {{name:string, arguments:object, aliasedFrom?:string}[]}
 */
export function recoverBashPseudoCommands(text, offeredNames = []) {
  const offered = (offeredNames || []).map((n) => String(n || '')).filter(Boolean);
  if (!offered.length) return [];
  const found = [];
  const seen = new Set();
  const push = (rawName, args) => {
    const resolved = resolveToolName(rawName, offered);
    if (!resolved) return;
    const key = `${resolved.name}:${JSON.stringify(args)}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ name: resolved.name, arguments: remapWriteArgs(resolved.name, args), aliasedFrom: resolved.aliased ? String(rawName).trim() : undefined });
  };

  for (const block of bashBlocks(text)) {
    const lines = String(block).split('\n');
    for (let i = 0; i < lines.length; i++) {
      const w = lines[i].match(WRITE_LINE_RE);
      if (w) {
        const [, tool, filePath, , delim] = w;
        if (!delim) continue;   // no heredoc body -> nothing to write
        const body = [];
        let closed = false;
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].trim() === delim) { closed = true; i = j; break; }
          body.push(lines[j]);
        }
        if (!closed) continue;   // truncated emission — let the bounded retry handle it
        push(tool, { path: filePath, content: body.join('\n') });
        continue;
      }
      const r = lines[i].match(RUN_LINE_RE);
      if (r) {
        const [, tool, target] = r;
        push(tool, tool === 'term_execute' ? { command: target } : { path: target });
      }
    }
  }
  return found;
}
