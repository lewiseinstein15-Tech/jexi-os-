// Phase 11 Scope I — graph-first structural code questions.
//
// Answers structural questions about this codebase from the Scope A knowledge
// graph (nodes + edges, already indexed) instead of reading files, and measures
// the token cost of BOTH paths:
//   answerStructuralQuery(question) — graph path  → { answer, source:'graph', tokens }
//   answerViaFileRead(question)     — files path  → { answer, source:'files', tokens }
//   compare(question)               — both + ratio (+ consistency check + NOT_IN_GRAPH fallback)
//
// TOKEN COUNTING (stated per the scope contract): deterministic APPROXIMATION —
// bytes/4 (Buffer.byteLength / 4, ceiling). Every result carries
// `tokenizer: 'bytes/4 (approximation, deterministic)'`. No provider tokenizer
// exists in this runtime; nothing is inflated.
// SEMANTICS — tokens = what the model CONSUMES to obtain the answer on each path:
//   graph path → the graph query result payload (small, structured).
//   files path → EVERY byte of file content read to derive the answer (that is
//   the honest reading cost). The distilled answer payload is reported too
//   (`answerTokens`) for transparency. Baseline is a NAIVE reader; a grep-
//   assisted agent would still scan the same bytes (CPU) but inject only
//   matches — the graph's residual advantages are no per-question repo scan,
//   function-level attribution (text search cannot attribute calls to their
//   enclosing function without an AST), exact definition lines, and a
//   deterministic bounded payload.
//
// The files path is REAL: it walks the same source set the indexer walks
// (tools/domains/lsp/_graph.js walkSourceFiles) and fs-reads file contents,
// byte-accounting every read. It is deliberately naive — that is the point
// being measured (raw reading vs indexed lookup).
//
// SCOPED to capability/. It does NOT import anything from server/src/context/**
// (the wiring there is a recorded zone-owner task, never actioned here).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TOKENIZER = 'bytes/4 (approximation, deterministic)';

const approxTokens = (s) => Math.ceil(Buffer.byteLength(String(s ?? ''), 'utf8') / 4);
const bytesOf = (s) => Buffer.byteLength(String(s ?? ''), 'utf8');

/* ── question parsing (deterministic regex routes) ── */
export function parseQuestion(question) {
  const q = String(question || '');
  let m;
  if ((m = /where\s+is\s+([A-Za-z_$][\w$]*)\s+defined/i.exec(q))) return { kind: 'definition', symbol: m[1] };
  if ((m = /what\s+does\s+([A-Za-z_$][\w$]*)\s+call/i.exec(q))) return { kind: 'callees', symbol: m[1] };
  if ((m = /what\s+(?:files?|modules?)\s+import(?:s)?\s+([A-Za-z_$][\w$]*)/i.exec(q))) return { kind: 'importers', symbol: m[1] };
  if ((m = /(?:who|what[\w\s]*?)\s+calls?\s+([A-Za-z_$][\w$]*)/i.exec(q))) return { kind: 'callers', symbol: m[1] };
  return null;
}

/* ── graph access ── */
async function withStore(fn) {
  const { getStore, closeStore } = await import('../../tools/domains/lsp/_graph.js');
  const store = await getStore();
  try {
    return await fn(store);
  } finally {
    await closeStore(); // probe-friendly; the doctor/tools reopen lazily
  }
}

function findSymbolNodes(nodes, symbol) {
  const hits = nodes.filter((n) => n.name === symbol || n.qualname.endsWith(`.${symbol}`) || n.qualname.endsWith(`::${symbol}`));
  hits.sort((a, b) => String(a.qualname).localeCompare(String(b.qualname)));
  return hits;
}

/* ── GRAPH PATH ── */
export async function answerStructuralQuery(question, { project = 'jexi-os' } = {}) {
  const parsed = parseQuestion(question);
  if (!parsed) {
    const err = new Error(`unparseable structural question: ${question}`);
    err.code = 'UNPARSEABLE';
    throw err;
  }
  const { kind, symbol } = parsed;
  return withStore((store) => {
    const nodes = store.nodes(project);
    const edges = store.edges(project);
    const targets = findSymbolNodes(nodes, symbol);
    if (targets.length === 0) {
      const payload = { question, kind, symbol, summary: `NOT_IN_GRAPH: no node named '${symbol}' in project '${project}'`, items: [] };
      return {
        status: 'NOT_IN_GRAPH', source: 'graph', ...payload,
        bytes: bytesOf(JSON.stringify(payload)), tokens: approxTokens(JSON.stringify(payload)), tokenizer: TOKENIZER,
      };
    }
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const targetIds = new Set(targets.map((t) => t.id));
    const defFiles = [...new Set(targets.map((t) => t.file))];
    const ambiguity = defFiles.length > 1 ? { definitionFiles: defFiles, note: 'name is defined in multiple files — answer unions all of them' } : undefined;
    let items = [];
    if (kind === 'callers') {
      items = edges
        .filter((e) => e.type === 'CALLS' && targetIds.has(e.dst))
        .map((e) => byId.get(e.src))
        .filter(Boolean)
        .map((n) => ({ name: n.name, qualname: n.qualname, file: n.file, line: n.line }))
        .sort((a, b) => (a.file + a.line).localeCompare(b.file + b.line));
    } else if (kind === 'callees') {
      items = edges
        .filter((e) => e.type === 'CALLS' && targetIds.has(e.src))
        .map((e) => byId.get(e.dst))
        .filter(Boolean)
        .map((n) => ({ name: n.name, qualname: n.qualname, file: n.file, line: n.line }))
        .sort((a, b) => (a.file + a.line).localeCompare(b.file + b.line));
    } else if (kind === 'definition') {
      const t = targets[0];
      items = [{ name: t.name, qualname: t.qualname, file: t.file, line: t.line }];
    } else if (kind === 'importers') {
      items = edges
        .filter((e) => e.type === 'IMPORTS' && targetIds.has(e.dst))
        .map((e) => byId.get(e.src))
        .filter(Boolean)
        .map((n) => ({ name: n.name, qualname: n.qualname, file: n.file, line: n.line }))
        .sort((a, b) => String(a.file).localeCompare(String(b.file)));
    }
    const unique = [];
    const seen = new Set();
    for (const it of items) {
      const k = `${it.qualname}|${it.file}|${it.line}`;
      if (!seen.has(k)) { seen.add(k); unique.push(it); }
    }
    const summary =
      kind === 'definition'
        ? `${symbol} is defined at ${unique[0]?.file}:${unique[0]?.line} (${unique[0]?.qualname})`
        : `${unique.length} ${kind === 'callers' ? `functions call ${symbol}` : kind === 'callees' ? `functions are called by ${symbol}` : `files import ${symbol}`}: ${unique.map((i) => i.qualname || i.file).join(', ')}`;
    const payload = { question, kind, symbol, ...(ambiguity ? { ambiguity } : {}), summary, items: unique };
    return {
      status: 'ok', source: 'graph', ...payload,
      bytes: bytesOf(JSON.stringify(payload)), tokens: approxTokens(JSON.stringify(payload)), tokenizer: TOKENIZER,
    };
  });
}

/* ── FILES PATH (real fs reads, byte-accounted) ── */
let _walk = null;
async function sortedSourceFiles() {
  if (!_walk) {
    const m = await import('../../tools/domains/lsp/_graph.js');
    _walk = m.walkSourceFiles;
  }
  return _walk(ROOT).sort();
}

async function scanFiles(symbol, { stopOnDefinition = false } = {}) {
  const files = await sortedSourceFiles();
  const callRe = new RegExp(`\\b${symbol.replace(/\$/g, '\\$')}\\s*\\(`);
  const defRe = new RegExp(`(?:\\b(?:async\\s+)?function\\s+${symbol}\\b)|(?:\\b(?:const|let|var)\\s+${symbol}\\s*=)|(?:\\bclass\\s+${symbol}\\b)|(?:^\\s*(?:async\\s+)?${symbol}\\s*\\([^)]*\\)\\s*\\{)`, 'm');
  const matches = [];
  let bytesRead = 0;
  let filesScanned = 0;
  for (const rel of files) {
    let content;
    try {
      const abs = path.join(ROOT, rel);
      const buf = fs.readFileSync(abs);
      bytesRead += buf.length;
      filesScanned += 1;
      content = buf.toString('utf8');
    } catch {
      continue;
    }
    if (stopOnDefinition) {
      const m = defRe.exec(content);
      if (m) {
        const line = content.slice(0, m.index).split('\n').length;
        matches.push({ file: rel, line });
        break;
      }
    } else {
      const re = new RegExp(callRe.source, 'g');
      let m = re.exec(content);
      const lines = [];
      while (m) {
        lines.push(content.slice(0, m.index).split('\n').length);
        m = re.exec(content);
      }
      if (lines.length) matches.push({ file: rel, lines, count: lines.length });
    }
  }
  return { matches, bytesRead, filesScanned };
}

export async function answerViaFileRead(question) {
  const parsed = parseQuestion(question);
  if (!parsed) {
    const err = new Error(`unparseable structural question: ${question}`);
    err.code = 'UNPARSEABLE';
    throw err;
  }
  const { kind, symbol } = parsed;
  if (kind === 'definition') {
    const { matches, bytesRead, filesScanned } = await scanFiles(symbol, { stopOnDefinition: true });
    const hit = matches[0] || null;
    const summary = hit ? `${symbol} defined at ${hit.file}:${hit.line} (first text match in sorted scan)` : `no text match for '${symbol}' definition`;
    const payload = { question, kind, symbol, summary, items: hit ? [hit] : [] };
    const tokens = Math.ceil(bytesRead / 4);
    return { source: 'files', ...payload, filesScanned, bytesRead, bytes: bytesOf(JSON.stringify(payload)), answerBytes: bytesOf(JSON.stringify(payload)), answerTokens: approxTokens(JSON.stringify(payload)), tokens, tokenizer: TOKENIZER };
  }
  if (kind === 'callees') {
    const def = await scanFiles(symbol, { stopOnDefinition: true });
    const names = new Set();
    if (def.matches[0]) {
      const abs = path.join(ROOT, def.matches[0].file);
      const buf = fs.readFileSync(abs);
      def.bytesRead += buf.length;
      const content = buf.toString('utf8');
      for (const m of content.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
        if (!['function', 'if', 'for', 'while', 'switch', 'catch', 'return'].includes(m[1])) names.add(m[1]);
      }
    }
    const items = [...names].sort().map((name) => ({ name }));
    const summary = `${symbol} (read from ${def.matches[0]?.file}) textually invokes ${items.length} distinct callables: ${items.map((i) => i.name).join(', ')}`;
    const payload = { question, kind, symbol, summary, items };
    const tokens = Math.ceil(def.bytesRead / 4);
    return { source: 'files', ...payload, filesScanned: def.filesScanned, bytesRead: def.bytesRead, bytes: bytesOf(JSON.stringify(payload)), answerBytes: bytesOf(JSON.stringify(payload)), answerTokens: approxTokens(JSON.stringify(payload)), tokens, tokenizer: TOKENIZER };
  }
  // callers / importers → repo-wide text scan
  const { matches, bytesRead, filesScanned } = await scanFiles(symbol);
  const totalHits = matches.reduce((a, m) => a + m.count, 0);
  const summary = `${totalHits} text matches for \\b${symbol}( across ${matches.length} files (of ${filesScanned} scanned)`;
  const payload = { question, kind, symbol, summary, items: matches.map((m) => ({ file: m.file, count: m.count, lines: m.lines.slice(0, 8) })) };
  const tokens = Math.ceil(bytesRead / 4);
  return { source: 'files', ...payload, filesScanned, bytesRead, bytes: bytesOf(JSON.stringify(payload)), answerBytes: bytesOf(JSON.stringify(payload)), answerTokens: approxTokens(JSON.stringify(payload)), tokens, tokenizer: TOKENIZER };
}

/* ── COMPARE (+ consistency + honest fallback) ── */
function checkConsistency(graph, files) {
  if (!graph || graph.status !== 'ok' || !files) return { checked: false, note: 'graph answer unavailable' };
  const gFiles = [...new Set((graph.items || []).map((i) => i.file).filter(Boolean))].sort();
  const fFiles = [...new Set((files.items || []).map((i) => i.file).filter(Boolean))].sort();
  if (graph.kind === 'definition') {
    const g = graph.items[0]?.file;
    const f = files.items[0]?.file;
    return { checked: true, sameFile: g === f, graphFile: g, filesFile: f, note: g === f ? 'same definition file (graph adds the exact line from the AST)' : 'differ (text scan order/ambiguity)' };
  }
  if (graph.kind === 'callees') {
    const gNames = (graph.items || []).map((i) => i.name);
    const defFile = files.items && files.items.length ? null : null;
    const inText = gNames.filter((n) => JSON.stringify(files).includes(`"${n}"`)).length;
    return { checked: true, graphCallees: gNames.length, presentInFilesText: inText, note: 'every graph callee name must appear in the defining file text (files path cannot attribute calls without an AST)' };
  }
  const missing = gFiles.filter((f) => !fFiles.includes(f));
  const extra = fFiles.filter((f) => !gFiles.includes(f));
  return {
    checked: true,
    graphFiles: gFiles.length,
    filesFiles: fFiles.length,
    graphFilesAllFoundByText: missing.length === 0,
    missingFromTextScan: missing,
    extraInTextScan: extra,
    note: 'text search cannot disambiguate same-name methods or exclude definition lines — extra text hits are expected; zero MISSING is the correctness bar',
  };
}

export async function compare(question, opts = {}) {
  const graph = await answerStructuralQuery(question, opts);
  const graphMiss = graph.status === 'NOT_IN_GRAPH';
  const files = await answerViaFileRead(question);
  const consistency = checkConsistency(graphMiss ? null : graph, files);
  const ratio = graph.tokens > 0 ? Number((files.tokens / graph.tokens).toFixed(1)) : null;
  return {
    question,
    graph: graphMiss ? { ...graph, tokens: graph.tokens } : graph,
    files,
    ratio,
    tokenizer: TOKENIZER,
    fallbackToFileRead: graphMiss,
    consistency,
  };
}
