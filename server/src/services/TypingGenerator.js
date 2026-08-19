/**
 * B139 — TYPING GENERATOR (DeepSeek Harness `packages/typert/generator` +
 * `typert/registry` + `typert/loader` mirror, JEXI-branded).
 *
 * JEXI's wire-type generation pipeline: analyzer → model → renderer →
 * emitter, mirroring dsh typert. The generator turns a tool/skill manifest
 * (or a raw tool registry entry) into TypeScript interface declarations
 * grouped by namespace, and the registry holds contributed manifests with
 * per-entry unload. The loader scans plugin folders for a `typert.json`
 * artifact and registers it automatically.
 *
 *   analyzeManifest(manifest)  → { namespaces, tools, skills } model
 *   renderTypes(model)         → TypeScript declaration text
 *   generateTypes(input)       → analyzer + renderer + emitter (one call)
 *   registerManifest(entry)    → registry (returns unregister)
 *   loadTypertArtifacts(dir)   → loader (scans for typert.json)
 */

import fs from 'fs';
import path from 'path';

/* ---------------- analyzer ---------------- */

const NAME_RE = /^[a-z][a-z0-9_-]*$/;

/** Analyze a manifest into the generator model. */
export function analyzeManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new Error('typert manifest must be an object');
  const model = { name: String(manifest.name || 'unnamed').slice(0, 60), namespaces: {}, tools: [], skills: [] };
  const ns = (key) => {
    if (!model.namespaces[key]) model.namespaces[key] = { key, fields: [], tools: [], skills: [] };
    return model.namespaces[key];
  };
  for (const tool of Array.isArray(manifest.tools) ? manifest.tools : []) {
    if (!tool || typeof tool.slug !== 'string' || !NAME_RE.test(tool.slug)) continue;
    const entry = {
      slug: tool.slug,
      name: tool.name || tool.slug,
      namespace: String(tool.namespace || 'tools'),
      args: (tool.args && typeof tool.args === 'object') ? tool.args : {},
      output: (tool.output && typeof tool.output === 'object') ? tool.output : {},
    };
    model.tools.push(entry);
    ns(entry.namespace).tools.push(entry);
  }
  for (const skill of Array.isArray(manifest.skills) ? manifest.skills : []) {
    if (!skill || typeof skill.slug !== 'string' || !NAME_RE.test(skill.slug)) continue;
    const entry = { slug: skill.slug, name: skill.name || skill.slug, namespace: String(skill.namespace || 'skills') };
    model.skills.push(entry);
    ns(entry.namespace).skills.push(entry);
  }
  if (manifest.fields && typeof manifest.fields === 'object') {
    for (const [key, spec] of Object.entries(manifest.fields)) {
      const n = String(spec?.namespace || 'fields');
      ns(n).fields.push({ key, type: String(spec?.type || 'string'), desc: String(spec?.desc || '') });
    }
  }
  return model;
}

/* ---------------- renderer ---------------- */

function tsType(type) {
  switch (String(type || 'string')) {
    case 'number': return 'number';
    case 'boolean': return 'boolean';
    case 'object': return 'Record<string, unknown>';
    case 'array': return 'unknown[]';
    case 'any': return 'unknown';
    default: return 'string';
  }
}

/** Render the model as TypeScript declarations. */
export function renderTypes(model) {
  const lines = [`// Auto-generated wire types — JEXI typert generator (do not edit).`, `// Source manifest: ${model.name}`, ''];
  const nsNames = Object.keys(model.namespaces).sort();
  for (const key of nsNames) {
    const n = model.namespaces[key];
    const iface = `export interface ${key.replace(/[^A-Za-z0-9_]/g, '_')}Manifest {`;
    lines.push(iface);
    for (const f of n.fields) lines.push(`  /** ${f.desc} */\n  ${f.key}: ${tsType(f.type)};`);
    for (const t of n.tools) {
      const argProps = Object.entries(t.args).map(([k, spec]) => `    ${k}${spec.required ? '' : '?'}: ${tsType(spec.type)};`).join('\n');
      lines.push(`  /** ${t.name} */\n  ${t.slug}: {` + (argProps ? `\n${argProps}\n  }` : '{}') + ';');
    }
    for (const s of n.skills) lines.push(`  /** ${s.name} */\n  ${s.slug}: { load(): Promise<string>; };`);
    lines.push('}', '');
  }
  lines.push('export type JexiWireManifests = {', ...nsNames.map((k) => `  '${k}': ${k.replace(/[^A-Za-z0-9_]/g, '_')}Manifest;`), '};', '');
  return lines.join('\n');
}

/* ---------------- emitter ---------------- */

/** Emit rendered types to a file (atomic write). */
export function emitTypes(model, filePath) {
  const text = renderTypes(model);
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, text, 'utf-8');
    fs.renameSync(tmp, filePath);
    return { ok: true, file: filePath, bytes: Buffer.byteLength(text, 'utf8') };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** One-call pipeline: analyze → render → (optional) emit. */
export function generateTypes(manifest, { emitTo = null } = {}) {
  const model = analyzeManifest(manifest);
  const text = renderTypes(model);
  const out = { ok: true, model: { name: model.name, namespaces: Object.keys(model.namespaces), tools: model.tools.length, skills: model.skills.length }, types: text };
  if (emitTo) {
    const e = emitTypes(model, emitTo);
    if (!e.ok) return { ok: false, error: e.error };
    out.file = e.file;
    out.bytes = e.bytes;
  }
  return out;
}

/* ---------------- registry ---------------- */

const registry = new Map(); // name → { manifest, unregisterFns }

/** Register a manifest contribution. Returns an unregister fn. */
export function registerTypertManifest(entry) {
  if (!entry || typeof entry.name !== 'string' || !entry.name) throw new Error('typert manifest needs a name');
  if (registry.has(entry.name)) throw new Error(`typert manifest "${entry.name}" already registered`);
  const model = analyzeManifest(entry.manifest || {});
  const rec = { name: entry.name, model, manifest: entry.manifest || {}, registeredAt: Date.now() };
  registry.set(entry.name, rec);
  return () => registry.delete(entry.name);
}

/** All registered manifests. */
export function listTypertManifests() {
  return [...registry.values()].map((r) => ({ name: r.name, namespaces: Object.keys(r.model.namespaces), tools: r.model.tools.length, skills: r.model.skills.length, registeredAt: r.registeredAt }));
}

/** Registry status for /api/typert/registry. */
export function typertRegistryStatus() {
  return { ok: true, manifests: listTypertManifests(), count: registry.size };
}

/* ---------------- loader ---------------- */

/** Scan a directory for typert.json artifacts and register them. */
export function loadTypertArtifacts(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const scan = (d, depth) => {
    if (depth > 3) return;
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    const typertFile = entries.find((e) => e.isFile() && e.name === 'typert.json');
    if (typertFile) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(d, typertFile.name), 'utf-8'));
        const unregister = registerTypertManifest({ name: raw.name || path.basename(d), manifest: raw });
        results.push({ ok: true, name: raw.name || path.basename(d), file: path.join(d, typertFile.name), unregister });
        return; // do not descend into a folder that already declares an artifact
      } catch (e) {
        results.push({ ok: false, file: path.join(d, typertFile.name), error: (e && e.message) || String(e) });
      }
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
      scan(path.join(d, e.name), depth + 1);
    }
  };
  scan(dir, 0);
  return results;
}

/** Unload every artifact loaded by a loader pass. */
export function unloadTypertArtifacts(results) {
  for (const r of results) { try { if (r.unregister) r.unregister(); } catch { /* noop */ } }
}
