/**
 * JEXI OS — Phase 8 Scope C — HOST ENTITY.
 *
 * Contract: { id, ip, hostname, os, discoveredAt, tags[] }
 * Required: hostname. ip/hostname pair is the natural key — writing the same
 * host twice (recon re-run, pipeline resume) updates in place, never duplicates.
 */

import { naturalKey, hash32, nowIso, GraphValidationError } from '../../store.js';

const TABLE = 'hosts';

export class HostEntity {
  constructor(storeHandle) {
    this.handle = storeHandle;
    this.db = storeHandle.db;
  }

  validate(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new GraphValidationError('Host', 'input', 'expected an object');
    }
    const { id, ip, hostname, os, discoveredAt, tags } = input;

    if (id !== undefined && (typeof id !== 'string' || !id.trim())) {
      throw new GraphValidationError('Host', 'id', 'must be a non-empty string when provided');
    }
    if (hostname === undefined || hostname === null || (typeof hostname === 'string' && !hostname.trim())) {
      throw new GraphValidationError('Host', 'hostname', `"hostname" is required (non-empty string) — got ${JSON.stringify(hostname)}`);
    }
    if (typeof hostname !== 'string') {
      throw new GraphValidationError('Host', 'hostname', 'must be a string');
    }
    if (ip !== undefined && ip !== null && (typeof ip !== 'string' || !ip.trim())) {
      throw new GraphValidationError('Host', 'ip', 'must be a non-empty string or null');
    }
    if (os !== undefined && os !== null && typeof os !== 'string') {
      throw new GraphValidationError('Host', 'os', 'must be a string or null');
    }
    let disc = nowIso();
    if (discoveredAt !== undefined) {
      if (typeof discoveredAt !== 'string' || Number.isNaN(Date.parse(discoveredAt))) {
        throw new GraphValidationError('Host', 'discoveredAt', 'must be a parseable ISO-8601 string');
      }
      disc = new Date(discoveredAt).toISOString();
    }
    let tagList = [];
    if (tags !== undefined) {
      if (!Array.isArray(tags) || tags.some((t) => typeof t !== 'string')) {
        throw new GraphValidationError('Host', 'tags', 'must be an array of strings');
      }
      tagList = tags;
    }
    return {
      id: id || `host-${hash32(naturalKey(hostname.trim(), ip || ''))}`,
      ip: ip || null,
      hostname: hostname.trim(),
      os: os || null,
      discoveredAt: disc,
      tags: tagList,
    };
  }

  /** Upsert by (hostname, ip). Returns { created, row }. */
  create(input) {
    const v = this.validate(input);
    const nk = naturalKey(v.hostname, v.ip || '');
    const existing = this.db.prepare('SELECT id FROM hosts WHERE natural_key = ?').get(nk);
    if (existing) {
      this.db.prepare(
        'UPDATE hosts SET ip = ?, hostname = ?, os = ?, tags = ? WHERE id = ?',
      ).run(v.ip, v.hostname, v.os, JSON.stringify(v.tags), existing.id);
      return { created: false, row: this.get(existing.id) };
    }
    this.db.prepare(
      'INSERT INTO hosts (id, ip, hostname, os, discovered_at, tags, natural_key) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(v.id, v.ip, v.hostname, v.os, v.discoveredAt, JSON.stringify(v.tags), nk);
    return { created: true, row: this.get(v.id) };
  }

  get(id) {
    const r = this.db.prepare('SELECT * FROM hosts WHERE id = ?').get(id);
    return r ? rowToObject(r) : null;
  }

  list() {
    return this.db.prepare('SELECT * FROM hosts ORDER BY hostname, id').all().map(rowToObject);
  }

  count() {
    return this.db.prepare('SELECT COUNT(*) AS n FROM hosts').get().n;
  }
}

function rowToObject(r) {
  return {
    id: r.id,
    ip: r.ip,
    hostname: r.hostname,
    os: r.os,
    discoveredAt: r.discovered_at,
    tags: JSON.parse(r.tags || '[]'),
  };
}
