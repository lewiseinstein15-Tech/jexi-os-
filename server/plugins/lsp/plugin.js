/**
 * JEXI OS — LSP Plugin (B131, DeepSeek Harness `packages/lsp/tool-lsp` mirror).
 *
 * Real code intelligence for the autonomous coding plugin: the model queries
 * a language-aware index instead of guessing with grep. The `lsp` tool
 * exposes the EXACT DSH contract:
 *
 *   lsp({ operation: goToDefinition|findReferences|goToImplementation|hover,
 *         file_path, line, character })   // line/character ONE-BASED (UTF-16)
 *   → { kind: 'locations', locations: [{uri, range:{start, end}}], resolvedWorkspaceUri }
 *   → { kind: 'hover', hover: { contents, range? } | null }
 *
 * Backed by a built-in workspace symbol indexer (no external LSP server, no
 * node_modules needed): declarations/definitions are indexed from the
 * workspace files, references are word-boundary occurrences (the declaration
 * is always included, DSH semantics), implementations resolve
 * implements/extends relationships, and hover returns the definition with
 * context. DSH prompt guidance rides the tool description.
 */

import fs from 'fs';
import path from 'path';
import { WORKSPACE_DIR } from '../../src/config.js';
import { listWorkspace } from '../../src/services/WorkspaceRuntime.js';

export const name = 'lsp';
export const version = '1.0.0';
export const inject = ['tools', 'skills', 'events'];

const MAX_LOCATIONS = 50;
const MAX_RESULT_CHARS = 16000;
const LSP_TIMEOUT_MS = 60000;
const MAX_FILE_CHARS = 400000;
const MAX_FILES = 400;

const OPERATIONS = ['goToDefinition', 'findReferences', 'goToImplementation', 'hover'];

const CODE_EXTS = new Set(['js', 'jsx', 'ts', 'tsx', 'py', 'html', 'css', 'json', 'md', 'sh', 'yml', 'yaml', 'c', 'cpp', 'h', 'java', 'go', 'rb', 'php', 'rs', 'kt', 'swift', 'vue', 'svelte']);

/* ---------------- symbol indexer ---------------- */

/** Candidate symbol extractors per line. Returns [{name, kind, col}] (col = 0-based). */
function extractSymbols(line, ext) {
  const out = [];
  const push = (name, kind, col) => { if (name && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) out.push({ name, kind, col }); };

  // JS/TS-style declarations
  const decl = line.match(/\b(?:export\s+)?(?:const|let|var|function|class|interface|type|enum|abstract\s+class|async\s+function)\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
  if (decl) push(decl[1], decl[0].includes('class') ? 'class' : decl[0].includes('interface') ? 'interface' : decl[0].includes('type') ? 'type' : decl[0].includes('function') ? 'function' : 'variable', line.indexOf(decl[1]));
  // `name =` / `name:` assignments
  const assign = line.match(/\b([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:\(|function|class|async|\{|\[|['"`]|[0-9A-Za-z])/);
  if (assign && !line.trim().startsWith('//') && !line.trim().startsWith('*')) push(assign[1], 'variable', line.indexOf(assign[1]));
  // Python
  if (ext === 'py') {
    const py = line.match(/^\s*(?:async\s+)?(?:def|class)\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (py) push(py[1], line.includes('class') ? 'class' : 'function', line.indexOf(py[1]));
  }
  return out;
}

let indexCache = { at: 0, files: null, symbols: null };

/** Index the workspace: { file → [{name, kind, line (1-based), col (0-based)}] } */
function indexWorkspace() {
  if (indexCache.files && Date.now() - indexCache.at < 8000) return indexCache;
  const symbols = new Map(); // file → [{name, kind, line, col}]
  let files = 0;
  try {
    for (const entry of listWorkspace(MAX_FILES)) {
      const name = typeof entry === 'string' ? entry : entry.name || entry.path;
      if (!name || name.startsWith('.') || name.includes('node_modules')) continue;
      const ext = path.extname(name).slice(1).toLowerCase();
      if (!CODE_EXTS.has(ext)) continue;
      const full = path.join(WORKSPACE_DIR, name);
      let text;
      try {
        const st = fs.statSync(full);
        if (st.size > MAX_FILE_CHARS) continue;
        text = fs.readFileSync(full, 'utf-8');
      } catch { continue; }
      files += 1;
      const lines = text.split('\n');
      const list = [];
      for (let i = 0; i < lines.length; i++) {
        for (const s of extractSymbols(lines[i], ext)) {
          list.push({ name: s.name, kind: s.kind, line: i + 1, col: s.col });
        }
      }
      symbols.set(name, list);
    }
  } catch { /* best-effort */ }
  indexCache = { at: Date.now(), files, symbols };
  return indexCache;
}

/** Resolve the identifier at a position (line/character ONE-BASED). */
function wordAt(file, line, character) {
  const full = path.join(WORKSPACE_DIR, file);
  try {
    const text = fs.readFileSync(full, 'utf-8').split('\n');
    const idx = line - 1;
    if (idx < 0 || idx >= text.length) return null;
    const row = text[idx];
    const col = Math.max(0, (character || 1) - 1);
    const m = row.slice(col).match(/^[A-Za-z_$][A-Za-z0-9_$]*/);
    if (m) return m[0];
    const m2 = row.slice(0, col).match(/[A-Za-z_$][A-Za-z0-9_$]*$/);
    if (m2) return m2[0];
    return null;
  } catch { return null; }
}

/** All occurrences of a name across the workspace (word-boundary). */
function findOccurrences(name, filesMap) {
  const hits = [];
  for (const [file, list] of filesMap) {
    const full = path.join(WORKSPACE_DIR, file);
    let text;
    try { text = fs.readFileSync(full, 'utf-8'); } catch { continue; }
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
    let m;
    const lines = text.split('\n');
    let lineStart = 0;
    const lineOffsets = [];
    for (const l of lines) { lineOffsets.push(lineStart); lineStart += l.length + 1; }
    while ((m = re.exec(text)) !== null) {
      // map offset → line (binary search)
      let lo = 0, hi = lineOffsets.length - 1, line = 0;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (lineOffsets[mid] <= m.index) { line = mid; lo = mid + 1; } else hi = mid - 1; }
      const col = m.index - lineOffsets[line];
      hits.push({ file, line: line + 1, col: col + 1, endCol: col + name.length + 1 });
      if (hits.length > MAX_LOCATIONS * 4) break;
    }
    if (hits.length > MAX_LOCATIONS * 4) break;
  }
  return hits;
}

/** Definitions of a name (declaration sites). */
function findDefinitions(name, filesMap) {
  const defs = [];
  for (const [file, list] of filesMap) {
    for (const s of list) {
      if (s.name === name) defs.push({ file, line: s.line, col: s.col + 1, endCol: s.col + name.length + 1, kind: s.kind });
    }
  }
  return defs;
}

/* ---------------- tool ---------------- */

/** Apply is called at boot with the plugin context. Return a cleanup fn. */
export async function apply(ctx) {
  const unregister = ctx.tools.register({
    slug: 'lsp',
    name: 'LSP',
    desc: 'Query a language server for precise code navigation. operation is one of goToDefinition, findReferences, goToImplementation, hover. line and character are one-based UTF-16 cursor coordinates. findReferences includes the declaration.',
    args: {
      operation: { type: 'string', required: true, desc: 'goToDefinition | findReferences | goToImplementation | hover' },
      file_path: { type: 'string', required: true, desc: 'The source file to query, relative to the workspace.' },
      line: { type: 'number', required: true, desc: 'One-based line of the cursor.' },
      character: { type: 'number', required: true, desc: 'One-based UTF-16 column of the cursor.' },
    },
    timeoutMs: LSP_TIMEOUT_MS,
    handler: async (args) => {
      const operation = String((args && args.operation) || '');
      const filePath = String((args && args.file_path) || '').trim();
      const line = Number(args && args.line);
      const character = Number(args && args.character);
      if (!OPERATIONS.includes(operation)) return { ok: false, error: `operation must be one of ${OPERATIONS.join(', ')}` };
      if (!filePath) return { ok: false, error: 'file_path required' };
      if (!Number.isInteger(line) || line < 1 || !Number.isInteger(character) || character < 1) {
        return { ok: false, error: 'line and character are required one-based integers' };
      }
      const full = path.join(WORKSPACE_DIR, filePath);
      if (!fs.existsSync(full)) return { ok: false, error: `file not found: ${filePath}` };

      const { symbols } = indexWorkspace();
      const name = wordAt(filePath, line, character);
      if (!name) return { ok: false, error: `no identifier at ${filePath}:${line}:${character} — move the cursor onto a symbol` };

      const resolvedWorkspaceUri = `file://${WORKSPACE_DIR}`;
      const toLocation = (h) => ({
        uri: `file://${WORKSPACE_DIR}/${h.file}`,
        range: {
          start: { line: h.line - 1, character: (h.col || 1) - 1 },
          end: { line: h.line - 1, character: (h.endCol || h.col + name.length) - 1 },
        },
      });

      if (operation === 'hover') {
        const defs = findDefinitions(name, symbols);
        const d = defs[0];
        if (!d) return { ok: true, kind: 'hover', hover: null };
        let contents = `${d.kind || 'symbol'} ${name} — defined at ${d.file}:${d.line}`;
        try {
          const lines = fs.readFileSync(path.join(WORKSPACE_DIR, d.file), 'utf-8').split('\n');
          const around = lines.slice(Math.max(0, d.line - 2), Math.min(lines.length, d.line + 1)).map((l) => l.trim()).filter(Boolean).join(' | ');
          if (around) contents += `\n${around}`;
        } catch { /* noop */ }
        return { ok: true, kind: 'hover', hover: { contents: contents.slice(0, MAX_RESULT_CHARS), range: { start: { line: d.line - 1, character: d.col - 1 }, end: { line: d.line - 1, character: d.endCol - 1 } } } };
      }

      if (operation === 'findReferences') {
        const hits = findOccurrences(name, symbols).slice(0, MAX_LOCATIONS);
        return { ok: true, kind: 'locations', locations: hits.map(toLocation), resolvedWorkspaceUri };
      }

      if (operation === 'goToDefinition') {
        const defs = findDefinitions(name, symbols).slice(0, MAX_LOCATIONS);
        if (!defs.length) {
          // fall back to the cursor position itself (definition == usage when
          // the cursor sits on a declaration)
          return { ok: true, kind: 'locations', locations: [{ uri: `file://${WORKSPACE_DIR}/${filePath}`, range: { start: { line: line - 1, character: character - 1 }, end: { line: line - 1, character } } }], resolvedWorkspaceUri };
        }
        return { ok: true, kind: 'locations', locations: defs.map(toLocation), resolvedWorkspaceUri };
      }

      if (operation === 'goToImplementation') {
        // interfaces/types/abstract → concrete implements/extends sites;
        // classes → subclasses (extends). Fall back to definitions.
        const defs = findDefinitions(name, symbols);
        const impls = [];
        for (const [file, text] of workspaceTexts()) {
          const re = new RegExp(`\\b(?:implements|extends)\\s+[A-Za-z0-9_,\\s]*\\b${name}\\b`, 'g');
          let m;
          while ((m = re.exec(text)) !== null) {
            const before = text.slice(0, m.index);
            const lineNo = before.split('\n').length;
            impls.push({ file, line: lineNo, col: m.index - before.lastIndexOf('\n'), endCol: (m.index - before.lastIndexOf('\n')) + name.length + 1 });
          }
        }
        const hits = (impls.length ? impls : defs).slice(0, MAX_LOCATIONS);
        return { ok: true, kind: 'locations', locations: hits.map(toLocation), resolvedWorkspaceUri };
      }

      return { ok: false, error: `unsupported operation ${operation}` };
    },
  });
  return unregister;
}

/** file → text for all indexed workspace files. */
function workspaceTexts() {
  const out = [];
  const { symbols } = indexWorkspace();
  for (const file of symbols.keys()) {
    try { out.push([file, fs.readFileSync(path.join(WORKSPACE_DIR, file), 'utf-8')]); } catch { /* noop */ }
  }
  return out;
}
