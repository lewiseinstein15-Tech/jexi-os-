/**
 * JEXI OS — Provider bridge — config loader.
 *
 * Loads providers.yaml (connection config) and models.yaml (model catalog +
 * task-class chains) into plain JS objects. A tiny YAML-subset parser keeps
 * the provider layer dependency-free; the subset covers the two files above
 * (nested maps, lists of scalars, booleans/numbers/strings).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseYamlSubset(text) {
  const root = {};
  const stack = [{ obj: root, indent: -1 }];
  const lines = text.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
  for (const line of lines) {
    const indent = line.match(/^\s*/)[0].length;
    const content = line.trim();
    const idx = content.indexOf(':');
    if (idx === -1) { pushScalar(stack, indent, content); continue; }
    const key = content.slice(0, idx).trim();
    const val = content.slice(idx + 1).trim();
    const parent = climb(stack, indent, key);
    if (val === '') { const child = {}; parent[key] = child; stack.push({ obj: child, indent }); }
    else parent[key] = parseScalar(val);
  }
  return root;
}

function climb(stack, indent, key) {
  while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
  return stack[stack.length - 1].obj;
}

function pushScalar(stack, indent, value) {
  const parent = climb(stack, indent);
  const list = parent.__list ?? (parent.__list = []);
  list.push(parseScalar(value));
}

function parseScalar(v) {
  v = v.replace(/^['"]|['"]$/g, '');
  if (v === 'true') return true;
  if (v === 'false') return false;
  const n = Number(v);
  if (v !== '' && !Number.isNaN(n) && /^-?\d+(\.\d+)?$/.test(v)) return n;
  return v;
}

let cached = null;

export function loadProviderConfig() {
  if (cached) return cached;
  const base = __dirname;
  const providersText = readFileSync(join(base, 'providers.yaml'), 'utf8');
  const modelsText = readFileSync(join(base, 'models.yaml'), 'utf8');
  cached = {
    providers: parseYamlSubset(providersText).providers ?? {},
    models: parseYamlSubset(modelsText).models ?? {},
    taskClasses: parseYamlSubset(modelsText).taskClasses ?? {},
  };
  return cached;
}

/** Remove __list artifacts left by the list parser (plain function is fine for tests). */
export function stripListArtifacts(obj) {
  if (Array.isArray(obj)) return obj.map(stripListArtifacts);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === '__list') continue;
      out[k] = stripListArtifacts(v);
    }
    return out;
  }
  return obj;
}