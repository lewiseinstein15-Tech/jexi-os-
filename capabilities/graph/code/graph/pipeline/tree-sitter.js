// Capability/Code — pipeline/tree-sitter.js — AST extraction stage.
//
// CONTRACT: `extractFile(rel, abs, source)` → { fileNode, functionNodes,
// classNodes, methodNodes, rawCalls, imports, routes, httpCalls } — the same
// contract a tree-sitter-based extractor would expose. The tree-sitter
// grammars themselves are native/wasm build artifacts outside this repo's
// dependency manifests (shared manifests are out of the Phase 11 zone), so
// the internals are a self-contained scanner:
//   - maskSource(): comments + string/template bodies blanked 1:1 by offset,
//     so every scan below runs over structure only, with real line numbers.
//   - brace matching for class/method bodies; enclosing-range resolution for
//     call sites (innermost callable wins; module-level calls attach to File).
// Swapping the internals for web-tree-sitter grammars later is a drop-in
// change — nothing downstream knows how extraction happens.

import { makeNode, NODE_LABELS } from '../nodes/index.js';

const MANIFEST_BASENAMES = /^(Dockerfile.*|docker-compose[^/]*\.ya?ml)$/;
const MAX_FILE_BYTES = 512 * 1024;

const CALL_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'new', 'typeof',
  'await', 'async', 'yield', 'delete', 'void', 'in', 'of', 'do', 'else', 'try',
  'throw', 'const', 'let', 'var', 'class', 'super', 'import', 'export', 'with',
  'case', 'default', 'extends', 'instanceof', 'this', 'true', 'false', 'null',
]);
const CALL_GLOBALS = new Set([
  'console', 'JSON', 'Math', 'Object', 'Array', 'String', 'Number', 'Boolean',
  'Date', 'Promise', 'Map', 'Set', 'Symbol', 'Error', 'TypeError', 'RangeError',
  'process', 'fetch', 'URL', 'URLSearchParams', 'Buffer', 'Intl', 'Reflect',
  'Proxy', 'RegExp', 'localStorage', 'document', 'window', 'globalThis',
]);

export function isIndexableSource(rel) {
  const dot = rel.lastIndexOf('.');
  const ext = dot === -1 ? '' : rel.slice(dot);
  const base = rel.split('/').pop();
  if (MANIFEST_BASENAMES.test(base)) return true;
  return ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'].includes(ext);
}

export function languageOf(rel) {
  const ext = rel.slice(rel.lastIndexOf('.') + 1);
  return { js: 'js', mjs: 'js', cjs: 'js', ts: 'ts', tsx: 'ts', jsx: 'js' }[ext] || ext;
}

/** Blank out comments and string/template CONTENTS, preserving every offset. */
export function maskSource(src) {
  const out = src.split('');
  const comments = [];
  const blank = (s, e) => {
    for (let k = s; k < e && k < out.length; k++) {
      if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
    }
  };
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      let j = src.indexOf('\n', i);
      if (j === -1) j = n;
      comments.push({ s: i, e: j });
      blank(i, j);
      i = j;
    } else if (c === '/' && d === '*') {
      let j = src.indexOf('*/', i + 2);
      j = j === -1 ? n : j + 2;
      comments.push({ s: i, e: j });
      blank(i, j);
      i = j;
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') j++;
        if (src[j] === '\n') break;
        j++;
      }
      blank(i + 1, Math.min(j, n));
      i = Math.min(j + 1, n);
    } else if (c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== '`') {
        if (src[j] === '\\') {
          if (j < n) out[j] = ' ';
          if (j + 1 < n) out[j + 1] = ' ';
          j += 2;
          continue;
        }
        if (src[j] !== '\n' && src[j] !== '\r') out[j] = ' ';
        j++;
      }
      i = j + 1;
    } else {
      i++;
    }
  }
  return { masked: out.join(''), comments };
}

export function braceMatch(masked, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < masked.length; i++) {
    const c = masked[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function lineIndex(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  return starts;
}
function lineOf(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}
function inComments(comments, pos) {
  for (const c of comments) if (pos >= c.s && pos < c.e) return true;
  return false;
}

function moduleFunctions(masked, rel, starts, classRanges, language) {
  const fns = [];
  const inClass = (pos) => classRanges.some((r) => pos >= r.s && pos < r.e);
  const re = /\b(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)[^{]*\{/g;
  let m;
  while ((m = re.exec(masked)) !== null) {
    if (inClass(m.index)) continue;
    const braceIdx = masked.indexOf('{', m.index + m[0].length - 1);
    const end = braceIdx === -1 ? -1 : braceMatch(masked, braceIdx);
    if (end === -1) continue;
    fns.push({
      node: makeNode(NODE_LABELS.FUNCTION, {
        name: m[1], file: rel, line: lineOf(starts, m.index),
        endLine: lineOf(starts, end), language, kind: 'function',
        params: m[2].trim() || null,
      }),
      range: { s: m.index, e: end },
    });
  }
  // arrows + assigned function expressions: const/let/var X = (…) => / X = function
  const ar = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:\(([^)]*)\)\s*(?::[^=]*)?=>|([A-Za-z_$][\w$]*)\s*=>|function\b)/g;
  while ((m = ar.exec(masked)) !== null) {
    if (inClass(m.index)) continue;
    let end = masked.indexOf('\n', m.index);
    end = end === -1 ? m.index + 80 : end;
    fns.push({
      node: makeNode(NODE_LABELS.FUNCTION, {
        name: m[1], file: rel, line: lineOf(starts, m.index),
        endLine: lineOf(starts, end), language, kind: 'arrow',
        params: (m[2] || m[3] || '').trim() || null,
      }),
      range: { s: m.index, e: end },
    });
  }
  return fns;
}

function collectCalls(masked, starts, callableRanges, classRanges) {
  const rawCalls = [];
  const ranges = [
    ...callableRanges.map((r) => ({ ...r })),
    ...classRanges.map((r) => ({ s: r.s, e: r.e, isClassBody: true, ref: r.ref })),
  ].sort((a, b) => a.s - b.s);

  const enclosing = (off) => {
    let best = null;
    for (const r of ranges) {
      if (r.s > off) break;
      if (r.s <= off && off <= r.e) {
        if (!best || r.e - r.s <= best.e - best.s) best = r;
      }
    }
    return best;
  };

  let m;
  const re = /([A-Za-z_$][\w$]*)\s*\(/g;
  while ((m = re.exec(masked)) !== null) {
    const name = m[1];
    if (CALL_KEYWORDS.has(name) || CALL_GLOBALS.has(name) || name === 'require') continue;
    const off = m.index;
    const ctx = enclosing(off);
    const srcRef = ctx ? (ctx.isClassBody ? ctx.ref : ctx.node) : null; // null → File node
    const viaClass = ctx && !ctx.isClassBody && ctx.classRec ? ctx.classRec.name : null;
    rawCalls.push({ name, srcRef, viaClass, isNew: false, line: lineOf(starts, off) });
  }
  const nr = /\bnew\s+([A-Za-z_$][\w$]*)\s*\(/g;
  while ((m = nr.exec(masked)) !== null) {
    const ctx = enclosing(m.index);
    rawCalls.push({
      name: m[1], srcRef: ctx ? (ctx.isClassBody ? ctx.ref : ctx.node) : null,
      viaClass: null, isNew: true, line: lineOf(starts, m.index),
    });
  }
  const tr = /this\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g;
  while ((m = tr.exec(masked)) !== null) {
    const ctx = enclosing(m.index);
    if (!ctx || ctx.isClassBody || !ctx.classRec) continue;
    rawCalls.push({
      name: m[1], srcRef: ctx.node, viaClass: ctx.classRec.name,
      isNew: false, line: lineOf(starts, m.index), thisMethod: true,
    });
  }
  return rawCalls;
}

function collectImports(original, comments, starts) {
  const imports = [];
  const push = (specifier, off) => {
    if (!inComments(comments, off)) imports.push({ specifier, line: lineOf(starts, off) });
  };
  let re = /import\s+(?:[\w*\s{},$]+\s+from\s+)?['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(original)) !== null) push(m[1], m.index);
  re = /export\s+(?:[\w*\s{},$]+\s+from\s+)?['"]([^'"]+)['"]/g;
  while ((m = re.exec(original)) !== null) push(m[1], m.index);
  re = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = re.exec(original)) !== null) push(m[1], m.index);
  return imports;
}

function collectRoutes(original, comments, starts) {
  const routes = [];
  const re = /\b(?:app|router|server|route|api)\.(get|post|put|patch|delete|options|all)\(\s*['"`](\/[^'"`\s]*)['"`]/g;
  let m;
  while ((m = re.exec(original)) !== null) {
    if (inComments(comments, m.index)) continue;
    routes.push({ method: m[1], path: m[2], line: lineOf(starts, m.index) });
  }
  return routes;
}

function collectHttpCalls(original, comments, starts) {
  const calls = [];
  let re = /(?:fetch|axios(?:\.(?:get|post|put|patch|delete))?)\(\s*[`'"]([^'"`]+)['"`]/g;
  let m;
  while ((m = re.exec(original)) !== null) {
    if (inComments(comments, m.index)) continue;
    calls.push({ target: m[1], line: lineOf(starts, m.index), internal: false });
  }
  re = /['"`](\/api\/[A-Za-z0-9\-/._$]*)['"`]/g;
  while ((m = re.exec(original)) !== null) {
    if (inComments(comments, m.index)) continue;
    calls.push({ target: m[1], line: lineOf(starts, m.index), internal: true });
  }
  return calls;
}

/** Extract everything from one JS/TS source file. */
export function extractFile(rel, abs, src) {
  if (!src || src.length > MAX_FILE_BYTES) return null;
  const language = languageOf(rel);
  const { masked, comments } = maskSource(src);
  const starts = lineIndex(src);

  const fileNode = makeNode(NODE_LABELS.FILE, { file: rel, language, bytes: Buffer.byteLength(src) });

  // classes (+ body ranges)
  const classNodes = [];
  const classRanges = [];
  const classRe = /\bclass\s+([A-Za-z_$][\w$]*)(\s+extends\s+([\w$.]+))?\s*\{/g;
  let m;
  while ((m = classRe.exec(masked)) !== null) {
    const openIdx = m.index + m[0].length - 1;
    const end = braceMatch(masked, openIdx);
    if (end === -1) continue;
    const rec = makeNode(NODE_LABELS.CLASS, {
      name: m[1], file: rel, line: lineOf(starts, m.index),
      endLine: lineOf(starts, end), language, superclass: m[3] || null,
    });
    classNodes.push(rec);
    classRanges.push({ s: m.index, e: end, ref: rec });
  }

  // methods inside class bodies
  const methodNodes = [];
  const callableRanges = [];
  for (const cr of classRanges) {
    const bodyText = masked.slice(cr.s, cr.e);
    const mre = /(?:^|[;{}]\s*|\n\s*)((?:(?:static|async|get|set)\s+)*)([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g;
    let mm;
    while ((mm = mre.exec(bodyText)) !== null) {
      const name = mm[2];
      if (!name || CALL_KEYWORDS.has(name)) continue;
      const braceOff = cr.s + mm.index + mm[0].length - 1;
      const end = braceMatch(masked, braceOff);
      if (end === -1) continue;
      const cls = cr.ref;
      const rec = makeNode(NODE_LABELS.FUNCTION, {
        name, file: rel, line: lineOf(starts, cr.s + mm.index),
        endLine: lineOf(starts, end), language, kind: 'method',
        owner: cls.name, params: mm[3].trim() || null,
      });
      methodNodes.push(rec);
      callableRanges.push({ s: cr.s + mm.index, e: end, node: rec, classRec: cls });
    }
  }

  // module-level functions + arrows
  const fnWraps = moduleFunctions(masked, rel, starts, classRanges, language);
  for (const f of fnWraps) callableRanges.push({ s: f.range.s, e: f.range.e, node: f.node, classRec: null });
  const functionNodes = fnWraps.map((f) => f.node);

  const rawCalls = collectCalls(masked, starts, callableRanges, classRanges);
  const imports = collectImports(src, comments, starts);
  const routes = collectRoutes(src, comments, starts);
  const httpCalls = collectHttpCalls(src, comments, starts);

  return {
    fileNode, functionNodes, classNodes, methodNodes,
    rawCalls, imports, routes, httpCalls,
    lineCount: starts.length,
  };
}

/** Extract Resource nodes from Docker/K8s/compose manifests. */
export function extractResources(rel, src) {
  const resources = [];
  if (/^Dockerfile/.test(rel.split('/').pop())) {
    resources.push(makeNode(NODE_LABELS.RESOURCE, { name: rel, kind: 'dockerfile', file: rel }));
    return resources;
  }
  const kindRe = /^\s*kind:\s*([A-Za-z]+)\s*$/gm;
  let k;
  while ((k = kindRe.exec(src)) !== null) {
    const after = src.slice(k.index);
    const nm = /^\s*name:\s*([\w.\-]+)\s*$/m.exec(after);
    if (nm) {
      resources.push(makeNode(NODE_LABELS.RESOURCE, {
        name: nm[1], kind: `k8s:${k[1]}`, file: rel, line: src.slice(0, k.index).split('\n').length,
      }));
    }
  }
  if (/^services:/m.test(src)) {
    const svcRe = /^ {2}([A-Za-z0-9_\-]+):\s*$/gm;
    let s;
    while ((s = svcRe.exec(src)) !== null) {
      resources.push(makeNode(NODE_LABELS.RESOURCE, {
        name: s[1], kind: 'compose-service', file: rel, line: src.slice(0, s.index).split('\n').length,
      }));
    }
  }
  return resources;
}
