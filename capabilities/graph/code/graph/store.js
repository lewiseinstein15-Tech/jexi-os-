// Capability/Code — graph store facade with backend selection.
//
// Preferred backend: node:sqlite (Node >= 22.5) — persistent SQLite graph,
// CBM-style. If the runtime lacks node:sqlite, degrade to the durable
// file-backed store with an EXPLICIT warning (never silent, never faked).

import fs from 'node:fs';
import path from 'node:path';
import { FileGraphStore } from './file-store.js';

let _sqliteProbe = null;

export async function probeSqlite() {
  if (_sqliteProbe !== null) return _sqliteProbe;
  try {
    await import('node:sqlite');
    _sqliteProbe = { ok: true, reason: null };
  } catch (err) {
    _sqliteProbe = { ok: false, reason: `${err.code || 'ERR'}: ${err.message}` };
  }
  return _sqliteProbe;
}

export async function openGraphStore(dir, { project = 'default' } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const probe = await probeSqlite();
  if (probe.ok) {
    try {
      const nodeSqlite = await import('node:sqlite');
      const { SqliteGraphStore } = await import('./sqlite-store.js');
      return new SqliteGraphStore(dir, project, nodeSqlite);
    } catch (err) {
      console.warn(`[codegraph] node:sqlite present but unusable (${err.message}) — degrading to file-backed store`);
    }
  }
  console.warn(
    `[codegraph] node:sqlite unavailable (${probe.reason}) — durable file-backed store active at ${dir}; ` +
    'SQLite-persistent path NOT VERIFIED on this runtime (requires Node >= 22.5)'
  );
  return new FileGraphStore(dir);
}
