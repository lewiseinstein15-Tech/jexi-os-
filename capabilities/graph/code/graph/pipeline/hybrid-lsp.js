// Capability/Code — pipeline/hybrid-lsp.js — semantic type resolution.
//
// CBM's Hybrid LSP fuses tree-sitter syntax with language-server semantics.
// No language server ships in this repo, so this stage provides the same
// fusion shape with deterministic heuristics over the extracted syntax:
//   1. Variable→class bindings: `const x = new Foo()`, `let y: Bar = …`
//   2. TS type annotations on declarations
//   3. Member-call qualification: `x.method()` where x: Foo → Foo::method
//      (in addition to `this.method()` handled at extraction)
// Result: member calls resolve to qualified `Class::method` CALLS edges
// instead of being dropped — the same precision jump CBM documents for its
// hybrid resolver. `resolveSymbol` is the resolution kernel reused by the
// Phase 11 tools.

const TYPE_BIND_RE = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*([A-Za-z_$][\w$.<>\[\]]+))?\s*=\s*new\s+([A-Za-z_$][\w$]*)/g;
const TS_ANN_RE = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*:\s*([A-Z][A-Za-z_$][\w$]*)/g;
const MEMBER_CALL_RE = /([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g;
const RECEIVER_SKIP = new Set(['this', 'super', 'window', 'document', 'console', 'process', 'module', 'JSON', 'Object']);

/** Map variable name → class name from `new X()` assignments and TS annotations. */
export function collectTypeBindings(masked) {
  const bindings = new Map();
  let m;
  const re = new RegExp(TYPE_BIND_RE.source, 'g');
  while ((m = re.exec(masked)) !== null) {
    if (!bindings.has(m[1])) bindings.set(m[1], m[3] || m[2]);
  }
  const ann = new RegExp(TS_ANN_RE.source, 'g');
  while ((m = ann.exec(masked)) !== null) {
    if (!bindings.has(m[1])) bindings.set(m[1], m[2]);
  }
  return bindings;
}

/**
 * Second-stage member-call harvest: the bare-name scan in tree-sitter.js
 * captures member calls without their receiver, so `x.method(` is re-scanned
 * here and attached when the receiver's bound class owns a method with that
 * name (checked against the project-wide method index `methodOwners`).
 * Returns new call records appended to `rawCalls` (each with viaClass set).
 */
export function harvestMemberCalls(masked, bindings, rawCalls, methodOwners) {
  if (!bindings || bindings.size === 0) return 0;
  let m;
  const re = new RegExp(MEMBER_CALL_RE.source, 'g');
  let added = 0;
  while ((m = re.exec(masked)) !== null) {
    const recv = m[1];
    const method = m[2];
    if (RECEIVER_SKIP.has(recv)) continue;
    const cls = bindings.get(recv);
    if (!cls) continue;
    if (!methodOwners || !methodOwners.has(`${cls}.${method}`)) continue;
    rawCalls.push({
      name: method, srcRef: null, viaClass: cls, isNew: false,
      line: 0, via: 'hybrid-lsp',
    });
    added++;
  }
  return added;
}

/** Resolve a bare symbol name against indexer indexes (used by Phase 11 tools). */
export function resolveSymbol(name, { byName, methodByName, classByName }) {
  if (byName && byName.has(name)) {
    const ids = byName.get(name);
    if (ids.length === 1) return { id: ids[0], kind: 'unique' };
  }
  for (const [cls, ids] of methodByName || []) {
    if (cls.endsWith(`.${name}`) && ids.length === 1) return { id: ids[0], kind: `method:${cls}` };
  }
  if (classByName && classByName.has(name) && classByName.get(name).length === 1) {
    return { id: classByName.get(name)[0], kind: 'class' };
  }
  return null;
}
