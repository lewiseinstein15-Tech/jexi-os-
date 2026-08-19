/**
 * B139 — PRESET DISCOVERY (DeepSeek Harness `packages/preset/agent-presets`
 * discovery + authoring mirror, JEXI-branded).
 *
 * Filesystem preset discovery + authoring:
 *   - `DATA_DIR/presets/<name>/preset.json` declares a preset (label,
 *     description, flavor, codeMode, bundles[]); built-in presets come from
 *     PresetManager; user presets merge over them.
 *   - authoring: create/delete/read a preset folder's composition file
 *     (`composition.json` — the patch-layer analog of dsh cordis.patch.yml).
 *
 *   discoverPresets()   → [{ key, file, meta }]
 *   createPreset(key, meta) / deletePreset(key) / readComposition(key)
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';
import { PRESETS, PRESET_NAMES } from './PresetManager.js';

export function userPresetDir() { return path.join(DATA_DIR, 'presets'); }
export const COMPOSITION_FILE = 'composition.json';
export const METADATA_FILE = 'preset.json';

/** Scan the user preset directory. */
export function scanPresetDir(dir = userPresetDir()) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const metaFile = path.join(dir, entry.name, METADATA_FILE);
    if (!fs.existsSync(metaFile)) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
      out.push({ key: entry.name, file: metaFile, meta });
    } catch { /* corrupt metadata → skip */ }
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/** Discover presets: built-ins + user dir (user wins on key collision). */
export function discoverPresets() {
  const presets = {};
  for (const key of PRESET_NAMES) presets[key] = { key, builtin: true, meta: { ...PRESETS[key], label: PRESETS[key].label, description: PRESETS[key].description } };
  for (const found of scanPresetDir()) {
    presets[found.key] = { key: found.key, builtin: false, file: found.file, meta: found.meta };
  }
  return Object.values(presets).sort((a, b) => a.key.localeCompare(b.key));
}

/** Create (or update) a user preset from metadata. */
export function createPreset(key, meta) {
  const k = String(key || '').trim();
  if (!/^[a-z][a-z0-9_-]*$/.test(k)) return { ok: false, error: 'preset key must match ^[a-z][a-z0-9_-]*$' };
  if (PRESET_NAMES.includes(k)) return { ok: false, error: `"${k}" is a built-in preset and cannot be overridden by a file` };
  if (!meta || typeof meta !== 'object') return { ok: false, error: 'preset metadata required' };
  try {
    const dir = path.join(userPresetDir(), k);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, METADATA_FILE), JSON.stringify(meta, null, 2), 'utf-8');
    return { ok: true, key: k, file: path.join(dir, METADATA_FILE) };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** Delete a user preset. */
export function deletePreset(key) {
  const k = String(key || '').trim();
  if (PRESET_NAMES.includes(k)) return { ok: false, error: 'built-in presets cannot be deleted' };
  const dir = path.join(userPresetDir(), k);
  if (!fs.existsSync(dir)) return { ok: false, error: `no user preset "${k}"` };
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: true, key: k };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** Read a preset's composition (patch-layer) file. */
export function readComposition(key) {
  const k = String(key || '').trim();
  const file = path.join(userPresetDir(), k, COMPOSITION_FILE);
  try {
    if (!fs.existsSync(file)) return { ok: true, key: k, composition: null };
    return { ok: true, key: k, composition: JSON.parse(fs.readFileSync(file, 'utf-8')) };
  } catch (e) {
    return { ok: false, key: k, error: (e && e.message) || String(e) };
  }
}

/** Write a preset's composition file. */
export function writeComposition(key, composition) {
  const k = String(key || '').trim();
  const dir = path.join(userPresetDir(), k);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, COMPOSITION_FILE), JSON.stringify(composition ?? {}, null, 2), 'utf-8');
    return { ok: true, key: k, file: path.join(dir, COMPOSITION_FILE) };
  } catch (e) {
    return { ok: false, key: k, error: (e && e.message) || String(e) };
  }
}

/** Full status for /api/presets. */
export function presetsStatus() {
  const presets = discoverPresets();
  return {
    ok: true,
    count: presets.length,
    builtin: presets.filter((p) => p.builtin).length,
    user: presets.filter((p) => !p.builtin).length,
    presets: presets.map((p) => ({ key: p.key, builtin: p.builtin, label: p.meta.label || p.meta.name || p.key, description: p.meta.description || '', codeMode: !!p.meta.codeMode, flavor: p.meta.flavor || '' })),
    userDir: userPresetDir(),
  };
}
