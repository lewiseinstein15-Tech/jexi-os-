// Capability/Code — SQLite graph store (node:sqlite, Node >= 22.5).
// Same surface as FileGraphStore; the graph is a persistent SQLite DB at
// <dir>/graph.db — CBM's storage model.

import fs from 'node:fs';
import path from 'node:path';

const DDL = `
CREATE TABLE IF NOT EXISTS nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT NOT NULL,
  label TEXT NOT NULL,
  name TEXT NOT NULL,
  qualname TEXT NOT NULL,
  file TEXT,
  line INTEGER DEFAULT 0,
  end_line INTEGER DEFAULT 0,
  language TEXT,
  props TEXT,
  UNIQUE(project, qualname)
);
CREATE TABLE IF NOT EXISTS edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT NOT NULL,
  type TEXT NOT NULL,
  src INTEGER NOT NULL,
  dst INTEGER NOT NULL,
  props TEXT,
  UNIQUE(project, src, dst, type)
);
CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(project, name);
CREATE INDEX IF NOT EXISTS idx_nodes_label ON nodes(project, label);
CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(project, src);
CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(project, dst);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
`;

export class SqliteGraphStore {
  constructor(dir, project = 'default', nodeSqlite = null) {
    this.dir = dir;
    this.file = path.join(dir, 'graph.db');
    this.backend = 'node:sqlite (persistent)';
    this.project = project;
    if (!nodeSqlite) throw new Error('SqliteGraphStore requires the dynamically imported node:sqlite module');
    const { DatabaseSync } = nodeSqlite;
    this.db = new DatabaseSync(this.file);
    this.db.exec(DDL);
    this._stmt = {
      nodeSel: this.db.prepare('SELECT id FROM nodes WHERE project = ? AND qualname = ?'),
      nodeIns: this.db.prepare(
        'INSERT INTO nodes (project, label, name, qualname, file, line, end_line, language, props) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ),
      nodeUpd: this.db.prepare(
        'UPDATE nodes SET label = ?, name = ?, line = ?, end_line = ?, language = ?, props = ? WHERE project = ? AND qualname = ?'
      ),

      edgeIns: this.db.prepare('INSERT OR IGNORE INTO edges (project, type, src, dst, props) VALUES (?, ?, ?, ?, ?)'),
      nodeById: this.db.prepare('SELECT * FROM nodes WHERE id = ?'),
      nodesAll: this.db.prepare('SELECT * FROM nodes WHERE project = ?'),
      edgesAll: this.db.prepare('SELECT * FROM edges WHERE project = ?'),
      byName: this.db.prepare('SELECT * FROM nodes WHERE project = ? AND name = ?'),
      metaSet: this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'),
      metaGet: this.db.prepare('SELECT value FROM meta WHERE key = ?'),
      delNodes: this.db.prepare('DELETE FROM nodes WHERE project = ?'),
      delEdges: this.db.prepare('DELETE FROM edges WHERE project = ?'),
    };
  }

  upsertNode(rec, project = this.project) {
    const existing = this._stmt.nodeSel.get(project, rec.qualname);
    if (existing) {
      this._stmt.nodeUpd.run(
        rec.label, rec.name, rec.line || 0, rec.endLine || 0, rec.language || null,
        JSON.stringify(rec.props || {}), project, rec.qualname
      );
      return Number(existing.id);
    }
    const r = this._stmt.nodeIns.run(
      project, rec.label, rec.name, rec.qualname, rec.file || null,
      rec.line || 0, rec.endLine || 0, rec.language || null, JSON.stringify(rec.props || {})
    );
    return Number(r.lastInsertRowid);
  }

  addEdge(type, src, dst, props = {}, project = this.project) {
    const r = this._stmt.edgeIns.run(project, type, src, dst, JSON.stringify(props || {}));
    return Number(r.changes) > 0;
  }

  nodes(project = this.project) {
    return this._stmt.nodesAll.all(project).map(this._rowToNode);
  }

  edges(project = this.project) {
    return this._stmt.edgesAll.all(project).map(this._rowToEdge);
  }

  _rowToNode(r) {
    return { id: Number(r.id), project: r.project, label: r.label, name: r.name, qualname: r.qualname, file: r.file, line: r.line, endLine: r.end_line, language: r.language, props: r.props ? JSON.parse(r.props) : {} };
  }
  _rowToEdge(r) {
    return { id: Number(r.id), project: r.project, type: r.type, src: Number(r.src), dst: Number(r.dst), props: r.props ? JSON.parse(r.props) : {} };
  }

  counts(project = this.project) {
    const byLabel = {};
    let total = 0;
    for (const n of this.nodes(project)) {
      total++;
      byLabel[n.label] = (byLabel[n.label] || 0) + 1;
    }
    return { total, byLabel };
  }

  edgeCounts(project = this.project) {
    const byType = {};
    let total = 0;
    for (const e of this.edges(project)) {
      total++;
      byType[e.type] = (byType[e.type] || 0) + 1;
    }
    return { total, byType };
  }

  searchGraph({ project = this.project, namePattern = null, label = null, limit = 20, offset = 0 } = {}) {
    const re = namePattern ? new RegExp(namePattern, 'i') : null;
    const out = [];
    for (const n of this.nodes(project)) {
      if (label && n.label !== label) continue;
      if (re && !(re.test(n.name) || re.test(n.qualname))) continue;
      out.push(n);
    }
    out.sort((a, b) => a.label.localeCompare(b.label) || a.name.localeCompare(b.name));
    return { total: out.length, rows: out.slice(offset, offset + limit) };
  }

  getByName(name, project = this.project) {
    return this._stmt.byName.all(project, name).map(this._rowToNode);
  }

  getNode(id) {
    const r = this._stmt.nodeById.get(id);
    return r ? this._rowToNode(r) : null;
  }

  tracePath({ project = this.project, name, direction = 'out', depth = 2, limit = 50 } = {}) {
    const starts = this.getByName(name, project);
    if (starts.length === 0) return { roots: [], paths: [] };
    const out = new Map();
    const inn = new Map();
    for (const e of this.edges(project)) {
      if (e.type !== 'CALLS') continue;
      if (!out.has(e.src)) out.set(e.src, []);
      out.get(e.src).push(e);
      if (!inn.has(e.dst)) inn.set(e.dst, []);
      inn.get(e.dst).push(e);
    }
    const paths = [];
    const walk = (id, path, edgesPath, budget) => {
      if (paths.length >= limit) return;
      if (budget < 0) {
        if (path.length > 1) paths.push({ path, edges: edgesPath });
        return;
      }
      const nxt = direction === 'in' ? (inn.get(id) || []) : direction === 'both' ? [...(out.get(id) || []), ...(inn.get(id) || [])] : (out.get(id) || []);
      let extended = false;
      for (const e of nxt) {
        const nextId = direction === 'in' ? e.src : e.dst;
        if (path.some((p) => p.id === nextId)) continue;
        extended = true;
        const node = this.getNode(nextId);
        walk(nextId,
          [...path, node ? { id: node.id, name: node.name, label: node.label, qualname: node.qualname } : { id: nextId }],
          [...edgesPath, e.type], budget - 1);
        if (paths.length >= limit) return;
      }
      if (!extended && path.length > 1) paths.push({ path, edges: edgesPath });
    };
    for (const root of starts.slice(0, 5)) {
      walk(root.id, [{ id: root.id, name: root.name, label: root.label, qualname: root.qualname }], [], depth - 1);
    }
    return { roots: starts.map((r) => ({ id: r.id, qualname: r.qualname })), paths };
  }

  schemaInfo(project = this.project) {
    return { backend: this.backend, nodes: this.counts(project), edges: this.edgeCounts(project) };
  }

  setMeta(key, value) { this._stmt.metaSet.run(key, String(value)); }
  getMeta(key) {
    const r = this._stmt.metaGet.get(key);
    return r ? r.value : undefined;
  }

  reset(project = this.project) {
    this._stmt.delEdges.run(project);
    this._stmt.delNodes.run(project);
  }

  flush() { return false; } // SQLite persists synchronously
  close() { try { this.db.close(); } catch { /* already closed */ } }
}
