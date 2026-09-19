// Capability/Code — code knowledge graph indexer.
//
// Two-phase pipeline:
//   Phase 1 (per file): tree-sitter.js extraction → defs (files, functions,
//     methods, classes, routes) + raw call/import/http records.
//   Phase 1.5: upsert all definition nodes → ids; build resolution indexes.
//   Phase 2 (per file): hybrid-lsp.js member-call harvest + edge resolution
//     (CALLS, IMPORTS, INHERITS, HTTP_CALLS), then CROSS_SERVICE derivation.
// Storage via the store facade (node:sqlite when available, durable file
// store otherwise).

import fs from 'node:fs';
import path from 'node:path';
import { extractFile, extractResources, isIndexableSource, maskSource } from './pipeline/tree-sitter.js';
import { collectTypeBindings, harvestMemberCalls } from './pipeline/hybrid-lsp.js';
import { makeEdge, EDGE_TYPES } from './edges/index.js';
import { makeNode, NODE_LABELS } from './nodes/index.js';

const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', '.venv', 'coverage',
  '__pycache__', '.next', '.cache', 'target', '.turbo', '.pytest_cache',
]);
const MAX_FILE_BYTES = 512 * 1024;
// Member-style method names: a bare-name call with one of these only ever
// resolves to a same-file definition (they overwhelmingly come from `x.name(`
// receiver calls whose receiver the bare scan cannot see).
const COMMON_MEMBER = new Set([
  'split', 'join', 'trim', 'push', 'pop', 'shift', 'unshift', 'map', 'filter',
  'reduce', 'forEach', 'slice', 'splice', 'concat', 'replace', 'replaceAll',
  'includes', 'indexOf', 'find', 'findIndex', 'some', 'every', 'keys', 'values',
  'entries', 'startsWith', 'endsWith', 'toLowerCase', 'toUpperCase', 'match',
  'test', 'exec', 'then', 'finally', 'toString', 'stringify', 'parse', 'call',
  'apply', 'bind', 'sort', 'flat', 'flatMap', 'from', 'json', 'text', 'emit',
  'on', 'once', 'write', 'end', 'send', 'status', 'logger', 'charCodeAt',
]);

function walkFiles(absRoot, relBase, out) {
  let entries;
  try {
    entries = fs.readdirSync(absRoot, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
    if (ent.isSymbolicLink()) continue;
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name) || ent.name.startsWith('.')) continue;
      walkFiles(path.join(absRoot, ent.name), rel, out);
    } else if (ent.isFile()) {
      out.push(rel);
    }
  }
}

function serviceRootOf(relFile) {
  const seg = relFile.split('/')[0];
  return relFile.includes('/') ? seg : '(root)';
}

export async function indexRepository({ root, store, project = 'jexi-os', fresh = true, onProgress = null }) {
  const t0 = Date.now();
  if (fresh) store.reset(project);

  // ── collect files ──────────────────────────────────────────────────────
  const all = [];
  walkFiles(root, '', all);
  const sources = [];
  const manifests = [];
  for (const rel of all) {
    const abs = path.join(root, rel);
    let st;
    try { st = fs.statSync(abs); } catch { continue; }
    if (!st.isFile() || st.size > MAX_FILE_BYTES) continue;
    if (isIndexableSource(rel) && !/\.(ya?ml|json|md|txt|html|css|wasm)$/.test(rel)) sources.push(rel);
    else if (/^(Dockerfile.*|docker-compose[^/]*\.ya?ml)$/.test(rel.split('/').pop())) manifests.push(rel);
    else if (/\.(ya?ml)$/.test(rel)) manifests.push(rel);
  }

  // ── phase 1: extract ───────────────────────────────────────────────────
  const extracted = []; // { rel, src, rec }
  const resourceNodes = [];
  let bytes = 0;
  for (let i = 0; i < sources.length; i++) {
    const rel = sources[i];
    const abs = path.join(root, rel);
    let src;
    try { src = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    const rec = extractFile(rel, abs, src);
    if (rec) {
      extracted.push({ rel, src, rec });
      bytes += rec.fileNode.props.bytes;
    }
    if (onProgress && i % 250 === 0) onProgress({ phase: 'extract', at: i, total: sources.length });
  }
  for (const rel of manifests) {
    let src;
    try { src = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { continue; }
    for (const r of extractResources(rel, src)) resourceNodes.push(r);
  }

  // ── phase 1.5: upsert definition nodes + build indexes ────────────────
  const idByRec = new Map();
  const byName = new Map();       // bare name → [id]
  const methodByName = new Map(); // 'Class.method' → [id]
  const classByName = new Map();  // class name → [id]
  const fileIdByPath = new Map(); // rel file → File node id
  const sameFileDefs = new Map(); // `${rel}::${name}` → [id]

  const indexName = (map, key, id) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(id);
  };
  const upsertAll = (recs) => {
    for (const rec of recs) {
      const id = store.upsertNode(rec, project);
      idByRec.set(rec, id);
      yield_id: id;
    }
  };

  const fileNodes = extracted.map((e) => e.rec.fileNode);
  upsertAll(fileNodes);
  for (const e of extracted) fileIdByPath.set(e.rel, idByRec.get(e.rec.fileNode));

  for (const e of extracted) {
    const { rel, rec } = e;
    const defs = [...rec.functionNodes, ...rec.methodNodes];
    upsertAll(defs);
    upsertAll(rec.classNodes);
    for (const d of defs) {
      indexName(byName, d.name, idByRec.get(d));
      indexName(sameFileDefs, `${rel}::${d.name}`, idByRec.get(d));
      if (d.props.owner) indexName(methodByName, `${d.props.owner}.${d.name}`, idByRec.get(d));
    }
    for (const c of rec.classNodes) {
      indexName(byName, c.name, idByRec.get(c));
      indexName(classByName, c.name, idByRec.get(c));
    }
  }
  const methodOwners = new Set(methodByName.keys());
  const moduleIds = new Map();  // specifier → node id
  const hostIds = new Map();    // http host → node id
  const routeByPath = new Map(); // '/api/x' → [id]
  upsertAll(resourceNodes);
  for (const r of resourceNodes) indexName(byName, r.name, idByRec.get(r));

  // ── phase 2: resolve edges ─────────────────────────────────────────────
  const callEdges = []; // { src, dst, srcFile, dstFile }
  let callsResolved = 0;
  let callsDropped = 0;
  let hybridUpgrades = 0;

  const resolveDst = (rel, call) => {
    if (call.viaClass && methodByName.has(`${call.viaClass}.${call.name}`)) {
      const ids = methodByName.get(`${call.viaClass}.${call.name}`);
      // prefer the definition in the same file
      for (const id of ids) {
        const key = `${rel}::${call.viaClass}.${call.name}`;
        const local = sameFileDefs.get(key);
        if (local && local.includes(id)) return id;
      }
      return ids[0];
    }
    if (call.isNew && classByName.has(call.name)) return classByName.get(call.name)[0];
    // common member-method names only ever resolve same-file (kills `x.split()`
    // → some unrelated unique project symbol over-resolution)
    if (COMMON_MEMBER.has(call.name)) {
      const localOnly = sameFileDefs.get(`${rel}::${call.name}`);
      return localOnly ? localOnly[0] : null;
    }
    const local = sameFileDefs.get(`${rel}::${call.name}`);
    if (local && local.length >= 1) return local[0];
    if (byName.has(call.name)) {
      const ids = byName.get(call.name);
      if (ids.length === 1) return ids[0];
      const localIn = ids.find((id) => (sameFileDefs.get(`${rel}::${call.name}`) || []).includes(id));
      if (localIn) return localIn;
    }
    return null;
  };

  for (let i = 0; i < extracted.length; i++) {
    const { rel, src, rec } = extracted[i];
    const fileId = fileIdByPath.get(rel);
    if (onProgress && i % 250 === 0) onProgress({ phase: 'resolve', at: i, total: extracted.length });

    // hybrid-lsp: member-call harvest with type bindings (needs re-mask)
    const { masked } = maskSource(src);
    const bindings = collectTypeBindings(masked);
    hybridUpgrades += harvestMemberCalls(masked, bindings, rec.rawCalls, methodOwners);

    for (const call of rec.rawCalls) {
      const srcId = call.srcRef ? idByRec.get(call.srcRef) : fileId;
      const dstId = resolveDst(rel, call);
      if (!srcId || !dstId || srcId === dstId) { callsDropped++; continue; }
      const via = call.thisMethod ? 'this-method' : call.via === 'hybrid-lsp' ? 'hybrid-lsp' : call.isNew ? 'new' : 'static';
      callEdges.push({ src: srcId, dst: dstId, srcFile: rel, edge: makeEdge(EDGE_TYPES.CALLS, srcId, dstId, { via }) });
      callsResolved++;
    }

    // imports
    for (const imp of rec.imports) {
      let dstId = null;
      if (imp.specifier.startsWith('.')) {
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), imp.specifier));
        const candidates = [resolved, `${resolved}.js`, `${resolved}.mjs`, `${resolved}.cjs`, `${resolved}.ts`, `${resolved}/index.js`, `${resolved}/index.ts`];
        for (const cand of candidates) {
          if (fileIdByPath.has(cand)) { dstId = fileIdByPath.get(cand); break; }
        }
      }
      if (!dstId) {
        if (!moduleIds.has(imp.specifier)) {
          const node = makeNode(NODE_LABELS.MODULE, { specifier: imp.specifier });
          moduleIds.set(imp.specifier, store.upsertNode(node, project));
        }
        dstId = moduleIds.get(imp.specifier);
      }
      if (dstId && dstId !== fileId) {
        store.addEdge(EDGE_TYPES.IMPORTS, fileId, dstId, { specifier: imp.specifier }, project);
      }
    }

    // routes → nodes + index
    for (const rt of rec.routes) {
      const node = makeNode(NODE_LABELS.ROUTE, { method: rt.method, path: rt.path, file: rel, line: rt.line });
      const id = store.upsertNode(node, project);
      idByRec.set(node, id);
      indexName(routeByPath, rt.path, id);
      indexName(byName, node.name, id);
    }

    // http calls → host resources / internal routes
    for (const hc of rec.httpCalls) {
      let dstId = null;
      let target = hc.target;
      if (hc.internal) {
        const ids = routeByPath.get(hc.target.split('?')[0]);
        dstId = ids ? ids[0] : null;
      } else {
        const m = /^(?:https?:)?\/\/([^/'"]+)/.exec(hc.target);
        if (m) {
          if (!hostIds.has(m[1])) {
            const node = makeNode(NODE_LABELS.RESOURCE, { name: m[1], kind: 'http-host' });
            hostIds.set(m[1], store.upsertNode(node, project));
          }
          dstId = hostIds.get(m[1]);
        }
      }
      if (!dstId) continue;
      // attribute to the innermost function containing the call line, else the file
      let srcId = fileId;
      for (const d of [...rec.functionNodes, ...rec.methodNodes]) {
        if (d.line <= hc.line && hc.line <= d.endLine) { srcId = idByRec.get(d); break; }
      }
      if (srcId && srcId !== dstId) {
        store.addEdge(EDGE_TYPES.HTTP_CALLS, srcId, dstId, { target }, project);
      }
    }

    // inherits
    for (const cls of rec.classNodes) {
      if (!cls.props.superclass) continue;
      const base = cls.props.superclass.split('.').pop();
      const ids = classByName.get(base);
      if (ids && ids.length > 0) {
        store.addEdge(EDGE_TYPES.INHERITS, idByRec.get(cls), ids[0], { superclass: cls.props.superclass }, project);
      }
    }
  }

  for (const ce of callEdges) store.addEdge(ce.edge.type, ce.edge.src, ce.edge.dst, ce.edge.props, project);

  // ── cross-service derivation ───────────────────────────────────────────
  let crossService = 0;
  const nodeByIdCache = new Map();
  const fileOf = (id) => {
    if (!nodeByIdCache.has(id)) nodeByIdCache.set(id, store.getNode(id));
    return nodeByIdCache.get(id);
  };
  const seenCross = new Set();
  for (const ce of callEdges) {
    const s = fileOf(ce.src);
    const d = fileOf(ce.dst);
    if (!s || !d || !s.file || !d.file) continue;
    const from = serviceRootOf(s.file);
    const to = serviceRootOf(d.file);
    if (from === to) continue;
    const key = `${ce.edge.src}->${ce.edge.dst}`;
    if (seenCross.has(key)) continue;
    seenCross.add(key);
    store.addEdge(EDGE_TYPES.CROSS_SERVICE, ce.edge.src, ce.edge.dst, { from, to }, project);
    crossService++;
  }

  const counts = store.counts(project);
  const edgeCounts = store.edgeCounts(project);
  const stats = {
    project,
    backend: store.backend,
    filesWalked: all.length,
    sourceFilesIndexed: extracted.length,
    manifestsScanned: manifests.length,
    sourceBytes: bytes,
    nodes: counts.total,
    nodesByLabel: counts.byLabel,
    edges: edgeCounts.total,
    edgesByType: edgeCounts.byType,
    callsResolved,
    callsUnresolved: callsDropped,
    hybridLspUpgrades: hybridUpgrades,
    crossServiceEdges: crossService,
    moduleCount: moduleIds.size,
    durationMs: Date.now() - t0,
  };
  store.setMeta(`${project}:indexedAt`, new Date().toISOString());
  store.setMeta(`${project}:stats`, JSON.stringify(stats));
  store.flush();
  return stats;
}
