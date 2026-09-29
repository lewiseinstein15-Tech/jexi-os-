/**
 * JEXI OS — tools — filesystem domain.
 *
 * read, write, edit, append, delete, glob, grep, ls.
 *
 * WHERE THE BYTES ACTUALLY LAND (JEXI-012): this domain uses node `fs` and
 * therefore writes the HOST filesystem. The old header claimed "sandbox-bound
 * (runtimeRing 0)" while `fs_write` sat at ring 1 and the engines happily
 * wrote anywhere `startsWith` allowed. That was a claim, not a mechanism.
 *
 * The truth is more useful than the claim, so it is now enforced:
 *   - every path goes through resolveWithin() (src/tools/security/path-confinement.js),
 *     which does a segment-boundary check AND a realpath pass, so neither
 *     `/tmp/ab` beside `/tmp/a` nor a symlink out of the root can escape;
 *   - tools that WRITE are declared ring 1 ("host-adjacent but isolated") —
 *     never ring 0, which means "no host state";
 *   - the confinement is asserted in tests/tickets/jexi-012-fs-ring.test.js.
 *
 * Destructive ops (write/edit/append/delete) are medium/high risk and require
 * grants; delete additionally requires a confirm.
 */

import { defineTool } from '../../interface/ToolDefinition.js';
import { registerToolBatch } from '../../registry/ToolRegistry.js';
import { resolveWithin, PathEscapeError } from '../../security/path-confinement.js';
import fs from 'node:fs';
import path from 'node:path';

/* ── glob ──────────────────────────────────────────────────────
   A dependency-free glob: *, ?, **, [abc], {a,b}. `**` crosses
   directory boundaries; everything else is one segment.        */

function globToRegExp(pattern) {
  let re = '';
  const braceStack = [];
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        // `**/` consumes whole segments, a trailing `**` consumes the rest
        if (pattern[i + 2] === '/') { re += '(?:[^/]+/)*'; i += 2; }
        else { re += '.*'; i += 1; }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') re += '[^/]';
    else if (c === '[') {
      const end = pattern.indexOf(']', i + 1);
      if (end === -1) re += '\\[';
      else {
        let cls = pattern.slice(i + 1, end);
        if (cls[0] === '!') cls = '^' + cls.slice(1);
        re += `[${cls}]`;
        i = end;
      }
    } else if (c === '{') { braceStack.push(true); re += '(?:'; }
    else if (c === '}' && braceStack.length) { braceStack.pop(); re += ')'; }
    else if (c === ',' && braceStack.length) re += '|';
    else re += c.replace(/[.+^${}()|\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}

const DEFAULT_IGNORED = new Set(['node_modules', '.git', 'dist', 'build', '.cache', '__pycache__', '.venv', 'venv', '.next', 'coverage']);

/** Depth- and count-bounded recursive walk. Returns repo-relative POSIX paths. */
function walk(root, { cwd, maxDepth = 12, maxFiles = 20000, ignore = DEFAULT_IGNORED } = {}) {
  const out = [];
  const stack = [{ dir: cwd, rel: '' }];
  while (stack.length && out.length < maxFiles) {
    const { dir, rel } = stack.pop();
    if (rel.split('/').filter(Boolean).length > maxDepth) continue;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (ignore.has(e.name)) continue;
      const abs = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) stack.push({ dir: abs, rel: r });
      else if (e.isFile()) { out.push(r); if (out.length >= maxFiles) break; }
    }
  }
  return out;
}

/* ── engines ──────────────────────────────────────────────────── */

function confineError(e) {
  if (e instanceof PathEscapeError) return e.message;
  return (e && e.message) || String(e);
}

export function registerFilesystemTools(engines = {}) {
  // Ring 0 means "no host state". Every tool here touches host state, so every
  // ring is 1: host-adjacent but isolated by the root confinement above.
  const confined = { write: false, delete: false };
  const base = {
    read: defineTool({
      name: 'fs_read', description: 'Read a file from the workspace root.', riskLevel: 'low', runtimeRing: 1, idempotent: true,
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      sideEffects: [], failureTypes: ['not_found', 'permission_denied'],
    }),
    write: defineTool({
      name: 'fs_write', description: 'Write a file (creates parents). Overwrites the whole file.', riskLevel: 'medium', runtimeRing: 1,
      parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
      sideEffects: ['write'], idempotent: true,
    }),
    edit: defineTool({
      name: 'fs_edit', description: 'Replace an exact string in a file. Fails if the needle is missing or ambiguous — the minimal-diff alternative to rewriting a whole file.',
      riskLevel: 'medium', runtimeRing: 1,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          find: { type: 'string' },
          replace: { type: 'string' },
          count: { type: 'integer' },          // how many occurrences to replace (default: all)
        },
        required: ['path', 'find', 'replace'],
      },
      sideEffects: ['write'], failureTypes: ['not_found', 'ambiguous', 'no_match'],
    }),
    append: defineTool({
      name: 'fs_append', description: 'Append text to a file (creates it when missing).', riskLevel: 'medium', runtimeRing: 1,
      parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
      sideEffects: ['write'], idempotent: false,
    }),
    delete: defineTool({
      name: 'fs_delete', description: 'Delete a file or empty directory inside the workspace.', riskLevel: 'high', runtimeRing: 1,
      parameters: { type: 'object', properties: { path: { type: 'string' }, recursive: { type: 'boolean' } }, required: ['path'] },
      sideEffects: ['write', 'delete'], idempotent: false, failureTypes: ['not_found', 'refused'],
    }),
    glob: defineTool({
      name: 'fs_glob', description: 'List files matching a glob pattern under a root. Supports *, **, ?, [abc], {a,b}.',
      riskLevel: 'low', runtimeRing: 1, idempotent: true,
      parameters: { type: 'object', properties: { root: { type: 'string' }, pattern: { type: 'string' }, maxDepth: { type: 'integer' } }, required: ['pattern'] },
    }),
    grep: defineTool({
      name: 'fs_grep', description: 'Search file contents for a regex within a root. Returns file, line number and the matching line.',
      riskLevel: 'low', runtimeRing: 1, idempotent: true,
      parameters: {
        type: 'object',
        properties: {
          root: { type: 'string' }, pattern: { type: 'string' },
          glob: { type: 'string' }, maxMatches: { type: 'integer' }, maxDepth: { type: 'integer' },
        },
        required: ['pattern'],
      },
    }),
    ls: defineTool({
      name: 'fs_ls', description: 'List a directory.', riskLevel: 'low', runtimeRing: 1, idempotent: true,
      parameters: { type: 'object', properties: { path: { type: 'string' } } },
    }),
  };

  const defs = Object.values(base);
  // JEXI-012: the declaration and the behaviour must agree. Rather than trust a
  // comment, the engine table below is the source of truth for what writes.
  for (const d of defs) {
    d.sideEffects = Array.isArray(d.sideEffects) ? d.sideEffects : [];
    if (d.sideEffects.includes('write') || d.sideEffects.includes('delete')) {
      if (d.runtimeRing < 1) {
        throw new Error(`tool ${d.name} writes host state but declares runtimeRing ${d.runtimeRing} (ring 0 means "no host state")`);
      }
    }
  }
  const unreg = registerToolBatch(defs);

  const defaultEngines = {
    fs_read: async ({ path: p }, { root = process.cwd() } = {}) => {
      try {
        const full = resolveWithin(root, p);
        return fs.readFileSync(full, 'utf8');
      } catch (e) { throw new Error(confineError(e)); }
    },

    fs_write: async ({ path: p, content }, { root = process.cwd() } = {}) => {
      try {
        const full = resolveWithin(root, p);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        const before = fs.existsSync(full) ? fs.statSync(full).size : 0;
        fs.writeFileSync(full, String(content ?? ''), 'utf8');
        confined.write = true;
        return { ok: true, path: full, bytes: Buffer.byteLength(String(content ?? '')), bytes_changed: Buffer.byteLength(String(content ?? '')) - before };
      } catch (e) { throw new Error(confineError(e)); }
    },

    /* JEXI-003 — minimal diff. The model must not have to rewrite a whole file
       to change one line, and it must not be able to claim an edit landed when
       the needle was never there: missing OR ambiguous both throw, and neither
       writes a byte. */
    fs_edit: async ({ path: p, find, replace, count }, { root = process.cwd() } = {}) => {
      try {
        const full = resolveWithin(root, p, { mustExist: true });
        const before = fs.readFileSync(full, 'utf8');
        const needle = String(find ?? '');
        if (needle === '') throw new Error('fs_edit: `find` must not be empty');

        const occurrences = before.split(needle).length - 1;
        if (occurrences === 0) throw new Error(`fs_edit: needle not found in ${full} (0 occurrences) — nothing written`);

        const requested = count === undefined || count === null ? null : Number(count);
        if (requested !== null && (!Number.isInteger(requested) || requested < 1)) {
          throw new Error(`fs_edit: count must be a positive integer, got ${count}`);
        }
        if (requested === null) {
          // No count given: the needle must be UNIQUE. Guessing which of three
          // identical lines the model meant is how a "minimal diff" edit turns
          // into a wrong-file, wrong-line change nobody notices.
          if (occurrences > 1) {
            throw new Error(`fs_edit: ambiguous — the needle occurs ${occurrences} times in ${full}. Pass count:1..${occurrences} to say which, or make the needle unique. Nothing written.`);
          }
        } else if (requested > occurrences) {
          throw new Error(`fs_edit: cannot replace ${requested} occurrence(s) — only ${occurrences} of the needle exist in ${full}. Nothing written.`);
        }
        const replaceCount = requested === null ? 1 : requested;

        let idx = -1;
        for (let n = 0; n < replaceCount; n++) idx = before.indexOf(needle, idx + 1);
        const head = before.slice(0, idx);
        const tail = before.slice(idx + needle.length);
        const after = head + String(replace ?? '') + tail;

        const beforeLines = before.split('\n').length;
        const afterLines = after.split('\n').length;
        fs.writeFileSync(full, after, 'utf8');
        confined.write = true;
        return {
          ok: true,
          path: full,
          replacements: replaceCount,
          occurrences_found: occurrences,
          bytes_changed: Buffer.byteLength(after) - Buffer.byteLength(before),
          lines_before: beforeLines,
          lines_after: afterLines,
        };
      } catch (e) { throw new Error(confineError(e)); }
    },

    fs_append: async ({ path: p, content }, { root = process.cwd() } = {}) => {
      try {
        const full = resolveWithin(root, p);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        const existed = fs.existsSync(full);
        const before = existed ? fs.statSync(full).size : 0;
        fs.appendFileSync(full, String(content ?? ''), 'utf8');
        confined.write = true;
        return { ok: true, path: full, created: !existed, bytes_changed: Buffer.byteLength(String(content ?? '')), size: before + Buffer.byteLength(String(content ?? '')) };
      } catch (e) { throw new Error(confineError(e)); }
    },

    fs_delete: async ({ path: p, recursive }, { root = process.cwd(), confirm } = {}) => {
      try {
        const full = resolveWithin(root, p, { mustExist: true });
        if (full === path.resolve(root)) throw new Error('fs_delete: refusing to delete the workspace root');
        if (typeof confirm === 'function') {
          const ok = await confirm(['write', 'delete'], { name: 'fs_delete', path: full });
          if (!ok) return { ok: false, refused: true, path: full, reason: 'not approved' };
        }
        const isDir = fs.statSync(full).isDirectory();
        if (isDir) {
          const entries = fs.readdirSync(full);
          if (entries.length && !recursive) throw new Error(`fs_delete: ${full} is not empty (${entries.length} entries) — pass recursive:true`);
          fs.rmSync(full, { recursive: true, force: true });
        } else {
          fs.rmSync(full, { force: true });
        }
        confined.delete = true;
        return { ok: true, path: full, deleted: true, type: isDir ? 'directory' : 'file' };
      } catch (e) { throw new Error(confineError(e)); }
    },

    /* JEXI-004 — these used to throw "requires a glob engine" / "requires a
       search engine" while still being registered and offered to the model. */
    fs_glob: async ({ root: r = '.', pattern, maxDepth }, { root: base = process.cwd() } = {}) => {
      try {
        const start = resolveWithin(base, r);
        if (!fs.existsSync(start)) throw new Error(`fs_glob: no such directory ${start}`);
        const re = globToRegExp(String(pattern));
        const prefixMatch = /^([^/]*\/)?\*\*(?:\/)?(.*)$/.exec(String(pattern));
        const relPrefix = prefixMatch ? prefixMatch[1] || '' : '';
        const tailRe = prefixMatch ? globToRegExp(prefixMatch[2]) : null;
        const files = walk(path.resolve(base), { cwd: start, maxDepth });
        const matched = files.filter((rel) => {
          const scoped = relPrefix && !rel.startsWith(relPrefix) ? rel.slice(relPrefix.length) : rel;
          if (re.test(scoped)) return true;
          return tailRe ? tailRe.test(scoped) : false;
        });
        return { ok: true, root: start, pattern, count: matched.length, files: matched };
      } catch (e) { throw new Error(confineError(e)); }
    },

    fs_grep: async ({ root: r = '.', pattern, glob, maxMatches = 200, maxDepth }, { root: base = process.cwd() } = {}) => {
      try {
        const start = resolveWithin(base, r);
        if (!fs.existsSync(start)) throw new Error(`fs_grep: no such directory ${start}`);
        let re;
        try { re = new RegExp(String(pattern)); }
        catch (e) { throw new Error(`fs_grep: invalid regex ${pattern}: ${e.message}`); }
        const filter = glob ? globToRegExp(String(glob)) : null;
        const files = walk(path.resolve(base), { cwd: start, maxDepth }).filter((f) => !filter || filter.test(f));
        const matches = [];
        for (const rel of files) {
          if (matches.length >= maxMatches) break;
          const abs = resolveWithin(base, path.join(path.relative(path.resolve(base), start), rel));
          let text;
          try { text = fs.readFileSync(abs, 'utf8'); } catch { continue; }
          const lines = text.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (!re.test(lines[i])) continue;
            matches.push({ file: rel, line: i + 1, text: lines[i].slice(0, 400) });
            if (matches.length >= maxMatches) break;
          }
        }
        return { ok: true, root: start, pattern, files_scanned: files.length, count: matches.length, matches };
      } catch (e) { throw new Error(confineError(e)); }
    },

    fs_ls: async ({ path: p = '.' }, { root = process.cwd() } = {}) => {
      try {
        const full = resolveWithin(root, p, { mustExist: true });
        return fs.readdirSync(full, { withFileTypes: true }).map((e) => e.name + (e.isDirectory() ? '/' : ''));
      } catch (e) { throw new Error(confineError(e)); }
    },
  };

  return { unreg, engines: { ...defaultEngines, ...engines } };
}

export { globToRegExp };
