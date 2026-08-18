/**
 * B135 — SETTINGS FILE (DeepSeek Harness `packages/settings/settings-file`
 * mirror).
 *
 * File-backed settings provider: ONE JSON or YAML document carries every
 * namespace section. Writes are atomic whole-file rewrites (with a leaf-level
 * patch for maps so untouched keys/comments survive); external edits are
 * hot-published through a lightweight poll watcher. Format is derived from
 * the file extension (.json / .yaml / .yml).
 *
 * The YAML path uses a small deterministic subset parser (flat keys + nested
 * maps by indentation + lists of scalars) — enough for real settings files
 * without a native dependency on the Render free tier.
 */

import fs from 'fs';
import path from 'path';
import { resolveJexiHome } from './HomePaths.js';

const FORMATS = { '.yaml': 'yaml', '.yml': 'yaml', '.json': 'json' };

/** Parse a minimal YAML subset: indentation-nested maps + block scalar lists. */
function parseYamlScalar(rest) {
  if ((rest.startsWith('"') && rest.endsWith('"')) || (rest.startsWith("'") && rest.endsWith("'"))) return rest.slice(1, -1);
  if (rest === 'true') return true;
  if (rest === 'false') return false;
  if (rest === 'null' || rest === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(rest)) return Number(rest);
  return rest;
}

export function parseYamlSubset(text) {
  const root = {};
  // Frame kinds: 'map' (entries → map), 'pending' (key awaiting a child
  // block: map or list), 'list' (items → list, attached to map[key]).
  const stack = [{ indent: -1, kind: 'map', map: root, key: null, list: null }];
  const lines = String(text || '').split('\n');
  let idx = 0;
  while (idx < lines.length) {
    const raw = lines[idx].replace(/\r$/, '');
    idx += 1;
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.match(/^\s*/)[0].length;
    const content = raw.slice(indent).trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const frame = stack[stack.length - 1];

    if (frame.kind === 'pending') {
      // The pending key's value is defined by this deeper line.
      if (content.startsWith('- ')) {
        const list = [];
        frame.map[frame.key] = list;
        list.push(parseYamlScalar(content.slice(2).trim()));
        // Keep the KEY's indent so sibling items (deeper) stay in the list
        // and a later key at the same level pops it.
        stack[stack.length - 1] = { indent: frame.indent, kind: 'list', map: frame.map, key: frame.key, list };
        continue;
      }
      frame.map[frame.key] = {};
      stack[stack.length - 1] = { indent: frame.indent, kind: 'map', map: frame.map[frame.key], key: null, list: null };
      // Re-process this line against the converted frame.
      idx -= 1;
      continue;
    }

    if (frame.kind === 'list') {
      if (content.startsWith('- ')) {
        frame.list.push(parseYamlScalar(content.slice(2).trim()));
        continue;
      }
      // A non-item line terminates the list; re-process it in map context.
      stack[stack.length - 1] = { indent: frame.indent, kind: 'map', map: frame.map, key: null, list: null };
      idx -= 1;
      continue;
    }

    // Map context.
    if (content.startsWith('- ')) continue; // stray item without a key
    const m = content.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const rest = m[2].trim();
    if (rest === '') {
      frame.map[key] = null;
      stack.push({ indent, kind: 'pending', map: frame.map, key, list: null });
    } else {
      frame.map[key] = parseYamlScalar(rest);
    }
  }
  return root;
}

/** Serialize a JS value into the YAML subset. */
export function stringifyYamlSubset(value, indent = 0) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    return value.map((v) => `${pad}- ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n');
  }
  if (value && typeof value === 'object') {
    const lines = [];
    for (const [k, v] of Object.entries(value)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        lines.push(`${pad}${k}:`);
        lines.push(stringifyYamlSubset(v, indent + 2));
      } else if (Array.isArray(v)) {
        lines.push(`${pad}${k}:`);
        lines.push(stringifyYamlSubset(v, indent + 2));
      } else {
        lines.push(`${pad}${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
      }
    }
    return lines.join('\n');
  }
  return `${pad}${String(value)}`;
}

/** Resolve the document spec from a config ({ path?, jexiHome? }). */
export function resolveSettingsSpec(config = {}) {
  const filename = path.resolve(config.path || path.join(resolveJexiHome(config.jexiHome), 'settings.yaml'));
  const format = FORMATS[path.extname(filename)];
  if (!format) throw new Error(`settings-file: extension "${path.extname(filename)}" is not supported (use .yaml, .yml, or .json)`);
  return { filename, format, watch: config.watch !== false, pollMs: config.pollMs || 1000 };
}

/**
 * File-backed settings store. Loads the document (missing file = {}), keeps a
 * copy, patches on set(), and hot-publishes external edits via polling.
 */
export class SettingsFileStore {
  constructor(config = {}) {
    const spec = resolveSettingsSpec(config);
    this.filename = spec.filename;
    this.format = spec.format;
    this.pollMs = spec.pollMs;
    this.watch = spec.watch;
    this.doc = {};
    this.mtime = 0;
    this.timer = null;
    this.listeners = new Set();
    this.load();
    if (this.watch) this.startWatcher();
  }

  load() {
    try {
      if (!fs.existsSync(this.filename)) return;
      const stat = fs.statSync(this.filename);
      this.mtime = stat.mtimeMs;
      const text = fs.readFileSync(this.filename, 'utf-8');
      this.doc = this.format === 'json' ? JSON.parse(text) : parseYamlSubset(text);
    } catch (e) {
      console.error('[settings-file] load error:', e.message);
      this.doc = {};
    }
  }

  startWatcher() {
    const tick = () => {
      try {
        if (!fs.existsSync(this.filename)) return;
        const stat = fs.statSync(this.filename);
        if (stat.mtimeMs !== this.mtime) this.load();
      } catch { /* noop */ }
    };
    this.timer = setInterval(tick, this.pollMs);
    if (this.timer.unref) this.timer.unref();
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  /** Whole-document snapshot (namespaces → values). */
  all() { return this.doc; }

  /** Read one namespace section (missing → {}). */
  get(namespace) {
    return (this.doc && this.doc[namespace] && typeof this.doc[namespace] === 'object') ? this.doc[namespace] : {};
  }

  /** Read one key within a namespace. */
  getKey(namespace, key) {
    return this.get(namespace)[key];
  }

  /** Patch one leaf value (or whole namespace) and persist atomically. */
  set(namespace, key, value) {
    if (!this.doc || typeof this.doc !== 'object') this.doc = {};
    if (!this.doc[namespace] || typeof this.doc[namespace] !== 'object') this.doc[namespace] = {};
    if (key === undefined) this.doc[namespace] = value && typeof value === 'object' ? value : {};
    else this.doc[namespace][key] = value;
    const ok = this.persist();
    for (const fn of this.listeners) { try { fn(namespace, key, value); } catch { /* noop */ } }
    return { ok, filename: this.filename, namespace, key };
  }

  /** Delete a key (or a whole namespace when key is undefined). */
  remove(namespace, key) {
    if (!this.doc || typeof this.doc !== 'object') return { ok: true };
    if (key === undefined) delete this.doc[namespace];
    else if (this.doc[namespace] && typeof this.doc[namespace] === 'object') delete this.doc[namespace][key];
    const ok = this.persist();
    return { ok, filename: this.filename };
  }

  /** Atomic whole-file rewrite. */
  persist() {
    try {
      fs.mkdirSync(path.dirname(this.filename), { recursive: true });
      const text = this.format === 'json'
        ? JSON.stringify(this.doc, null, 2) + '\n'
        : stringifyYamlSubset(this.doc) + '\n';
      const tmp = `${this.filename}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, text, 'utf-8');
      fs.renameSync(tmp, this.filename);
      try { this.mtime = fs.statSync(this.filename).mtimeMs; } catch { /* noop */ }
      return true;
    } catch (e) {
      console.error('[settings-file] persist error:', e.message);
      return false;
    }
  }
}

/** Default store singleton (lazy). */
let defaultStore = null;
export function settingsFileStore(config = {}) {
  if (!defaultStore || config.force) defaultStore = new SettingsFileStore(config);
  return defaultStore;
}
