/**
 * JEXI OS — Phase 14 Scope F — disk cache keyed by path + mtime + size.
 *
 * The key is sha256 over the sorted manifest [{ path, mtime, size }],
 * so ANY mtime or size change produces a different key -> a miss.
 * Entries live under os.tmpdir()/semantica-repo-map/<key>.json; an
 * index.json maps root -> keys so invalidate(root) can clear them.
 * A cache READ never rebuilds: it only stats + hashes the manifest.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { scan } from './rank.js';

const DIR = path.join(os.tmpdir(), 'semantica-repo-map');
const INDEX = path.join(DIR, 'index.json');

const ensure = () => { fs.mkdirSync(DIR, { recursive: true }); };

export function keyFor(root, budget) {
  const manifest = scan(root).map((e) => ({ path: e.path, mtime: e.mtime, size: e.size }));
  const payload = JSON.stringify({ manifest, budget: budget ?? null });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

const fileOf = (key) => path.join(DIR, `${key}.json`);

export function has(key) {
  return fs.existsSync(fileOf(key));
}

export function load(key) {
  try { return JSON.parse(fs.readFileSync(fileOf(key), 'utf8')); }
  catch { return null; }
}

export function save(root, key, value) {
  ensure();
  fs.writeFileSync(fileOf(key), JSON.stringify({ key, value }));
  const idx = readIndex();
  const abs = path.resolve(root);
  const keys = new Set(idx[abs] || []);
  keys.add(key);
  idx[abs] = [...keys];
  fs.writeFileSync(INDEX, JSON.stringify(idx));
}

function readIndex() {
  try { return JSON.parse(fs.readFileSync(INDEX, 'utf8')); }
  catch { return {}; }
}

export function clearRoot(root) {
  const idx = readIndex();
  const abs = path.resolve(root);
  const keys = idx[abs] || [];
  let cleared = 0;
  for (const key of keys) {
    try { fs.rmSync(fileOf(key)); cleared += 1; } catch { /* already gone */ }
  }
  delete idx[abs];
  ensure();
  fs.writeFileSync(INDEX, JSON.stringify(idx));
  return { cleared };
}
