/**
 * JEXI OS — Phase 8 Scope C — EDGE: connects-to (Service → Host).
 *
 * Decepticon semantics: compromising this service gives reach into the host
 * on the far side of the edge (its own host, or a pivot target reached via
 * east-west traffic from this service).
 */

import { naturalKey, hash32, nowIso, GraphValidationError } from '../../store.js';

export class ConnectsToEdge {
  constructor(storeHandle) {
    this.handle = storeHandle;
    this.db = storeHandle.db;
  }

  create({ serviceId, hostId } = {}) {
    if (!serviceId || typeof serviceId !== 'string') {
      throw new GraphValidationError('Edge connects-to', 'serviceId', 'source must be a service id (string)');
    }
    if (!hostId || typeof hostId !== 'string') {
      throw new GraphValidationError('Edge connects-to', 'hostId', 'destination must be a host id (string)');
    }
    if (!this.db.prepare("SELECT id FROM services WHERE id = ?").get(serviceId)) {
      throw new GraphValidationError('Edge connects-to', 'serviceId', `source service "${serviceId}" does not exist in the graph`);
    }
    if (!this.db.prepare("SELECT id FROM hosts WHERE id = ?").get(hostId)) {
      throw new GraphValidationError('Edge connects-to', 'hostId', `destination host "${hostId}" does not exist in the graph`);
    }
    const nk = naturalKey('connects-to', 'service', serviceId, 'host', hostId, '', '');
    const existing = this.db.prepare('SELECT id FROM edges WHERE natural_key = ?').get(nk);
    if (existing) return { created: false, row: this.get(existing.id) };
    const id = `edge-${hash32(nk)}`;
    this.db.prepare(
      "INSERT INTO edges (id, type, src_type, src_id, dst_type, dst_id, via_credential_id, privilege, created_at, natural_key) VALUES (?, 'connects-to', 'service', ?, 'host', ?, NULL, NULL, ?, ?)",
    ).run(id, serviceId, hostId, nowIso(), nk);
    return { created: true, row: this.get(id) };
  }

  get(id) {
    const r = this.db.prepare("SELECT * FROM edges WHERE id = ? AND type = 'connects-to'").get(id);
    return r ? rowToObject(r) : null;
  }

  list() {
    return this.db.prepare("SELECT * FROM edges WHERE type = 'connects-to' ORDER BY src_id, dst_id").all().map(rowToObject);
  }

  count() {
    return this.db.prepare("SELECT COUNT(*) AS n FROM edges WHERE type = 'connects-to'").get().n;
  }
}

function rowToObject(r) {
  return { id: r.id, type: r.type, src: { type: r.src_type, id: r.src_id }, dst: { type: r.dst_type, id: r.dst_id }, viaCredentialId: r.via_credential_id, privilege: r.privilege, createdAt: r.created_at };
}
