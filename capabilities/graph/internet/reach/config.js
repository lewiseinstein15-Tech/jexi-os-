// Phase 11 Scope D — reach config: YAML file + env override.
//
// Layered resolution (highest wins):
//   1. process.env (KEY upper-snake-cased, e.g. web_backend → WEB_BACKEND)
//   2. YAML config file (default: ~/.agent-reach/config.yaml, overridable
//      via REACH_CONFIG / ctor path)
//   3. built-in defaults
//
// Only a flat `key: value` YAML subset is parsed (all reach config is flat
// scalars) — no dependency on an external YAML library.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DEFAULTS = Object.freeze({
  web_backend: '',
  read_timeout_ms: 15000,
  max_bytes: 5 * 1024 * 1024,
});

function envKeyOf(key) {
  return key.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

function parseScalar(raw) {
  const v = raw.trim();
  if (v === '') return '';
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

/** Minimal flat YAML: `key: value`, comments, blank lines. */
export function parseFlatYaml(text) {
  const out = {};
  for (const line of String(text || '').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const m = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(t);
    if (!m) continue; // nested structure — not part of the reach config contract
    out[m[1]] = parseScalar(m[2]);
  }
  return out;
}

export function serializeFlatYaml(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n') + '\n';
}

export class ReachConfig {
  constructor(filePath = process.env.REACH_CONFIG || path.join(os.homedir(), '.agent-reach', 'config.yaml')) {
    this.filePath = filePath;
    this.fileData = {};
    try {
      this.fileData = parseFlatYaml(fs.readFileSync(filePath, 'utf8'));
      this.fileLoaded = true;
    } catch {
      this.fileData = {};
      this.fileLoaded = false; // reads never create the file (Agent-Reach semantics)
    }
  }

  /** Effective value for a key: env > file > default. */
  get(key) {
    const env = process.env[envKeyOf(key)];
    if (env !== undefined && env !== '') return env;
    if (key in this.fileData) return this.fileData[key];
    return key in DEFAULTS ? DEFAULTS[key] : undefined;
  }

  /** Where a value came from — probes use this to prove overrides applied. */
  sourceOf(key) {
    const env = process.env[envKeyOf(key)];
    if (env !== undefined && env !== '') return 'env';
    if (key in this.fileData) return 'file';
    return key in DEFAULTS ? 'default' : 'unset';
  }

  set(key, value) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.fileData[key] = value;
    fs.writeFileSync(this.filePath, serializeFlatYaml({ ...DEFAULTS, ...this.fileData }));
    this.fileLoaded = true;
  }

  /** `${channel}_backend` override for a channel (or null). */
  channelBackend(channelName) {
    const v = this.get(`${channelName}_backend`);
    return v === undefined || v === '' ? null : String(v);
  }

  snapshot() {
    const keys = new Set([...Object.keys(DEFAULTS), ...Object.keys(this.fileData)]);
    const out = {};
    for (const k of keys) out[k] = { value: this.get(k), source: this.sourceOf(k) };
    return out;
  }
}
