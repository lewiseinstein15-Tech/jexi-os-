/**
 * JEXI OS — Phase 8 Scope C — EDGE: escalates-to (Credential → Credential).
 *
 * Decepticon semantics: privilege escalation — holding credential A yields
 * credential B of strictly higher privilege (e.g. service account → domain
 * admin). `privilege` records what the escalation grants.
 */

import { naturalKey, hash32, nowIso, GraphValidationError } from '../../store.js';

export class EscalatesToEdge {
  constructor(storeHandle) {
    this.handle = storeHandle;
    this.db = storeHandle.db;
  }

  create({ fromCredentialId, toCredentialId, privilege } = {}) {
    if (!fromCredentialId || typeof fromCredentialId !== 'string') {
      throw new GraphValidationError('Edge escalates-to', 'fromCredentialId', 'source must be a credential id (string)');
    }
    if (!toCredentialId || typeof toCredentialId !== 'string') {
      throw new GraphValidationError('Edge escalates-to', 'toCredentialId', 'destination must be a credential id (string)');
    }
    if (fromCredentialId === toCredentialId) {
      throw new GraphValidationError('Edge escalates-to', 'toCredentialId', 'self-escalation is not a chain — source and destination must differ');
    }
    if (!this.db.prepare('SELECT id FROM credentials WHERE id = ?').get(fromCredentialId)) {
      throw new GraphValidationError('Edge escalates-to', 'fromCredentialId', `source credential "${fromCredentialId}" does not exist in the graph`);
    }
    if (!this.db.prepare('SELECT id FROM credentials WHERE id = ?').get(toCredentialId)) {
      throw new GraphValidationError('Edge escalates-to', 'toCredentialId', `destination credential "${toCredentialId}" does not exist in the graph`);
    }
    if (privilege !== undefined && privilege !== null && typeof privilege !== 'string') {
      throw new GraphValidationError('Edge escalates-to', 'privilege', 'must be a string or null');
    }
    const nk = naturalKey('escalates-to', 'credential', fromCredentialId, 'credential', toCredentialId, '', privilege || '');
    const existing = this.db.prepare('SELECT id FROM edges WHERE natural_key = ?').get(nk);
    if (existing) return { created: false, row: this.get(existing.id) };
    const id = `edge-${hash32(nk)}`;
    this.db.prepare(
      "INSERT INTO edges (id, type, src_type, src_id, dst_type, dst_id, via_credential_id, privilege, created_at, natural_key) VALUES (?, 'escalates-to', 'credential', ?, 'credential', ?, NULL, ?, ?, ?)",
    ).run(id, fromCredentialId, toCredentialId, privilege || null, nowIso(), nk);
    return { created: true, row: this.get(id) };
  }

  get(id) {
    const r = this.db.prepare("SELECT * FROM edges WHERE id = ? AND type = 'escalates-to'").get(id);
    return r ? rowToObject(r) : null;
  }

  list() {
    return this.db.prepare("SELECT * FROM edges WHERE type = 'escalates-to' ORDER BY src_id, dst_id").all().map(rowToObject);
  }

  count() {
    return this.db.prepare("SELECT COUNT(*) AS n FROM edges WHERE type = 'escalates-to'").get().n;
  }
}

function rowToObject(r) {
  return { id: r.id, type: r.type, src: { type: r.src_type, id: r.src_id }, dst: { type: r.dst_type, id: r.dst_id }, viaCredentialId: r.via_credential_id, privilege: r.privilege, createdAt: r.created_at };
}
