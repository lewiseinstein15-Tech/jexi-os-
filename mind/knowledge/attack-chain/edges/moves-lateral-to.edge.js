/**
 * JEXI OS — Phase 8 Scope C — EDGE: moves-lateral-to (Host → Host, via Credential).
 *
 * Decepticon semantics: lateral movement. The edge is recorded host → host
 * and carries the credential that enables it (viaCredentialId) — traversal
 * may only use the edge while that credential is in the attacker's
 * possession along the current path (granted by a succeeded exploit,
 * found on a visited host, or obtained through escalates-to chains).
 */

import { naturalKey, hash32, nowIso, GraphValidationError } from '../../store.js';

export class MovesLateralToEdge {
  constructor(storeHandle) {
    this.handle = storeHandle;
    this.db = storeHandle.db;
  }

  create({ fromHostId, toHostId, viaCredentialId } = {}) {
    if (!fromHostId || typeof fromHostId !== 'string') {
      throw new GraphValidationError('Edge moves-lateral-to', 'fromHostId', 'source must be a host id (string)');
    }
    if (!toHostId || typeof toHostId !== 'string') {
      throw new GraphValidationError('Edge moves-lateral-to', 'toHostId', 'destination must be a host id (string)');
    }
    if (fromHostId === toHostId) {
      throw new GraphValidationError('Edge moves-lateral-to', 'toHostId', 'self-lateral-movement is not a chain — source and destination must differ');
    }
    if (!viaCredentialId || typeof viaCredentialId !== 'string') {
      throw new GraphValidationError('Edge moves-lateral-to', 'viaCredentialId', `"viaCredentialId" is required — lateral movement happens VIA a credential`);
    }
    if (!this.db.prepare('SELECT id FROM hosts WHERE id = ?').get(fromHostId)) {
      throw new GraphValidationError('Edge moves-lateral-to', 'fromHostId', `source host "${fromHostId}" does not exist in the graph`);
    }
    if (!this.db.prepare('SELECT id FROM hosts WHERE id = ?').get(toHostId)) {
      throw new GraphValidationError('Edge moves-lateral-to', 'toHostId', `destination host "${toHostId}" does not exist in the graph`);
    }
    if (!this.db.prepare('SELECT id FROM credentials WHERE id = ?').get(viaCredentialId)) {
      throw new GraphValidationError('Edge moves-lateral-to', 'viaCredentialId', `enabling credential "${viaCredentialId}" does not exist in the graph`);
    }
    const nk = naturalKey('moves-lateral-to', 'host', fromHostId, 'host', toHostId, viaCredentialId, '');
    const existing = this.db.prepare('SELECT id FROM edges WHERE natural_key = ?').get(nk);
    if (existing) return { created: false, row: this.get(existing.id) };
    const id = `edge-${hash32(nk)}`;
    this.db.prepare(
      "INSERT INTO edges (id, type, src_type, src_id, dst_type, dst_id, via_credential_id, privilege, created_at, natural_key) VALUES (?, 'moves-lateral-to', 'host', ?, 'host', ?, ?, NULL, ?, ?)",
    ).run(id, fromHostId, toHostId, viaCredentialId, nowIso(), nk);
    return { created: true, row: this.get(id) };
  }

  get(id) {
    const r = this.db.prepare("SELECT * FROM edges WHERE id = ? AND type = 'moves-lateral-to'").get(id);
    return r ? rowToObject(r) : null;
  }

  list() {
    return this.db.prepare("SELECT * FROM edges WHERE type = 'moves-lateral-to' ORDER BY src_id, dst_id").all().map(rowToObject);
  }

  count() {
    return this.db.prepare("SELECT COUNT(*) AS n FROM edges WHERE type = 'moves-lateral-to'").get().n;
  }
}

function rowToObject(r) {
  return { id: r.id, type: r.type, src: { type: r.src_type, id: r.src_id }, dst: { type: r.dst_type, id: r.dst_id }, viaCredentialId: r.via_credential_id, privilege: r.privilege, createdAt: r.created_at };
}
