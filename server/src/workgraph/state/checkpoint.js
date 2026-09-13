/**
 * JEXI OS — WORK GRAPH — checkpoint persistence (SQLite).
 *
 * Save/restore the whole graph after every state change. On process restart
 * the graph is reconstructed from the saved snapshot, so a SIGKILL mid-task
 * never loses the plan. Reuses the StorageHub `loadSqliteModule` loader —
 * no new dependency.
 *
 * The whole graph (nodes + blocks adjacency) fits in one JSON column;
 * leases live in the same snapshot so a crash+restart restores a *cleared*
 * lease state (holder must reclaim).
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadSqliteModule } from '../../services/StorageHub.js';

let sqlite;
let db;

/** Open (and create on first use) the workgraph SQLite file. */
export async function openWorkGraphDb(file) {
  if (db) return db;
  sqlite = await loadSqliteModule();
  if (!sqlite) throw new Error('node:sqlite unavailable');
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  db = new sqlite.DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(`CREATE TABLE IF NOT EXISTS workgraph_checkpoint (
    id TEXT PRIMARY KEY,
    graph TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );`);
  return db;
}

/** Persist the full graph snapshot. */
export async function saveCheckpoint(file, graph, { meta = {} } = {}) {
  const d = await openWorkGraphDb(file);
  const row = JSON.stringify({ graph, savedAt: Date.now(), meta });
  d.prepare(
    `INSERT INTO workgraph_checkpoint (id, graph, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET graph = excluded.graph, updated_at = excluded.updated_at`
  ).run('default', row, Date.now());
  return { savedAt: Date.now(), nodeCount: graph.nodes?.length ?? 0 };
}

/** Reconstruct the graph from the last checkpoint, or null. */
export async function loadCheckpoint(file) {
  const d = await openWorkGraphDb(file);
  const row = d.prepare('SELECT graph, updated_at FROM workgraph_checkpoint WHERE id = ?').get('default');
  if (!row) return null;
  const parsed = JSON.parse(row.graph);
  return { graph: parsed.graph, savedAt: parsed.savedAt, meta: parsed.meta ?? {}, updatedAt: row.updated_at };
}

/** Clear the persisted snapshot (used by tests / fresh missions). */
export async function dropCheckpoint(file) {
  if (!db && !fs.existsSync(file)) return;
  const d = await openWorkGraphDb(file);
  d.prepare('DELETE FROM workgraph_checkpoint WHERE id = ?').run('default');
}