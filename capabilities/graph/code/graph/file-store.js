// Capability/Code — durable file-backed graph store (fallback backend).
//
// Used when node:sqlite is unavailable (Node < 22.5). The full graph
// (nodes/edges/meta) lives in <dir>/graph.json, written atomically
// (tmp + rename) so a SIGKILL at any moment leaves either the previous or
// the new complete state on disk — never a torn file.

import fs from 'node:fs';
import path from 'node:path';

export class FileGraphStore {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'graph.json');
    this.backend = 'file-backed JSON (atomic tmp+rename)';
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(this.file)) {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } else {
      this.data = { nodes: [], edges: [], meta: {}, seq: 0 };
    }
    this._dirty = false;
    this._byKey = new Map();
    this._byName = new Map();
    this._byQual = new Map();
    this._edgeKey = new Set();
    for (const n of this.data.nodes) {
      this._byKey.set(n.qualname, n);
      this._byQual.set(n.qualname, n);
      if (!this._byName.has(n.name)) this._byName.set(n.name, []);
      this._byName.get(n.name).push(n);
    }
    for (const e of this.data.edges) this._edgeKey.add(`${e.type}:${e.src}->${e.dst}`);
  }

  _touch() { this._dirty = true; }

  upsertNode(rec, project = 'default') {
    const existing = this._byKey.get(rec.qualname);
    if (existing) {
      Object.assign(existing, rec, { project });
      this._touch();
      return existing.id;
    }
    const id = ++this.data.seq;
    const node = { id, project, ...rec };
    this.data.nodes.push(node);
    this._byKey.set(rec.qualname, node);
    this._byQual.set(rec.qualname, node);
    if (!this._byName.has(node.name)) this._byName.set(node.name, []);
    this._byName.get(node.name).push(node);
    this._touch();
    return id;
  }

  addEdge(type, src, dst, props = {}, project = 'default') {
    const key = `${type}:${src}->${dst}`;
    if (this._edgeKey.has(key)) return false;
    this._edgeKey.add(key);
    this.data.edges.push({ id: this.data.edges.length + 1, project, type, src, dst, props });
    this._touch();
    return true;
  }

  nodes(project) {
    return project ? this.data.nodes.filter((n) => n.project === project) : this.data.nodes;
  }

  edges(project) {
    return project ? this.data.edges.filter((e) => e.project === project) : this.data.edges;
  }

  counts(project) {
    const byLabel = {};
    let total = 0;
    for (const n of this.nodes(project)) {
      total++;
      byLabel[n.label] = (byLabel[n.label] || 0) + 1;
    }
    return { total, byLabel };
  }

  edgeCounts(project) {
    const byType = {};
    let total = 0;
    for (const e of this.edges(project)) {
      total++;
      byType[e.type] = (byType[e.type] || 0) + 1;
    }
    return { total, byType };
  }

  searchGraph({ project, namePattern = null, label = null, limit = 20, offset = 0 } = {}) {
    let re = null;
    if (namePattern) re = new RegExp(namePattern, 'i');
    const out = [];
    for (const n of this.nodes(project)) {
      if (label && n.label !== label) continue;
      if (re && !(re.test(n.name) || re.test(n.qualname))) continue;
      out.push(n);
    }
    out.sort((a, b) => a.label.localeCompare(b.label) || a.name.localeCompare(b.name));
    return { total: out.length, rows: out.slice(offset, offset + limit) };
  }

  getByName(name, project) {
    return (this._byName.get(name) || []).filter((n) => !project || n.project === project);
  }

  getByQualname(qualname, project) {
    const n = this._byQual.get(qualname);
    return n && (!project || n.project === project) ? n : null;
  }

  listProjects() {
    const acc = new Map();
    for (const n of this.data.nodes) {
      if (!acc.has(n.project)) acc.set(n.project, { project: n.project, nodes: 0, edges: 0 });
      acc.get(n.project).nodes++;
    }
    for (const e of this.data.edges) {
      if (!acc.has(e.project)) acc.set(e.project, { project: e.project, nodes: 0, edges: 0 });
      acc.get(e.project).edges++;
    }
    return [...acc.values()];
  }

  getNode(id) {
    return this.data.nodes.find((n) => n.id === id) || null;
  }

  /** BFS trace over CALLS edges — CBM trace_path semantics. */
  tracePath({ project, name, direction = 'out', depth = 2, limit = 50 } = {}) {
    const starts = this.getByName(name, project);
    if (starts.length === 0) return { roots: [], paths: [] };
    const nodeById = new Map(this.nodes(project).map((n) => [n.id, n]));
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
        if (path.some((p) => p.id === nextId)) continue; // cycle guard
        extended = true;
        const node = nodeById.get(nextId);
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

  schemaInfo(project) {
    const n = this.counts(project);
    const e = this.edgeCounts(project);
    return { backend: this.backend, nodes: n, edges: e };
  }

  setMeta(key, value) { this.data.meta[key] = value; this._touch(); }
  getMeta(key) { return this.data.meta[key]; }

  reset(project = null) {
    if (project === null) {
      this.data = { nodes: [], edges: [], meta: {}, seq: 0 };
      this._byKey.clear(); this._byName.clear(); this._byQual.clear(); this._edgeKey.clear();
    } else {
      this.data.nodes = this.data.nodes.filter((n) => n.project !== project);
      this.data.edges = this.data.edges.filter((e) => e.project !== project);
      this._byKey.clear(); this._byName.clear(); this._byQual.clear(); this._edgeKey.clear();
      for (const n of this.data.nodes) {
        this._byKey.set(n.qualname, n);
        if (!this._byName.has(n.name)) this._byName.set(n.name, []);
        this._byName.get(n.name).push(n);
      }
      for (const e of this.data.edges) this._edgeKey.add(`${e.type}:${e.src}->${e.dst}`);
    }
    this._touch();
  }

  flush() {
    if (!this._dirty) return false;
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
    this._dirty = false;
    return true;
  }

  close() { this.flush(); }
}
