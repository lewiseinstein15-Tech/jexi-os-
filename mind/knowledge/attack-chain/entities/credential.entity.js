/**
 * JEXI OS — Phase 8 Scope C — CREDENTIAL ENTITY.
 *
 * Contract: { id, hostId, kind, username, scope, obtainedVia }
 * Required: hostId (must exist), kind, username. obtainedVia records how the
 * credential was captured — an exploit id (exploit grants credential in the
 * traversal model) or a source string like "manual" / "config-dump".
 * Natural key: (hostId, kind, username, scope) — resume-safe.
 */

import { naturalKey, hash32, GraphValidationError } from '../../store.js';

export class CredentialEntity {
  constructor(storeHandle) {
    this.handle = storeHandle;
    this.db = storeHandle.db;
  }

  validate(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new GraphValidationError('Credential', 'input', 'expected an object');
    }
    const { id, hostId, kind, username, scope, obtainedVia } = input;

    if (id !== undefined && (typeof id !== 'string' || !id.trim())) {
      throw new GraphValidationError('Credential', 'id', 'must be a non-empty string when provided');
    }
    if (hostId === undefined || hostId === null || hostId === '') {
      throw new GraphValidationError('Credential', 'hostId', `"hostId" is required — a Credential is valid ON a Host`);
    }
    if (!this.db.prepare('SELECT id FROM hosts WHERE id = ?').get(hostId)) {
      throw new GraphValidationError('Credential', 'hostId', `referenced host "${hostId}" does not exist in the graph`);
    }
    for (const [k, val] of [['kind', kind], ['username', username]]) {
      if (val === undefined || val === null || (typeof val === 'string' && !val.trim())) {
        throw new GraphValidationError('Credential', k, `"${k}" is required (non-empty string) — got ${JSON.stringify(val)}`);
      }
      if (typeof val !== 'string') {
        throw new GraphValidationError('Credential', k, 'must be a string');
      }
    }
    for (const [k, val] of [['scope', scope], ['obtainedVia', obtainedVia]]) {
      if (val !== undefined && val !== null && typeof val !== 'string') {
        throw new GraphValidationError('Credential', k, 'must be a string or null');
      }
    }
    return {
      id: id || `cred-${hash32(naturalKey(hostId, kind.trim(), username.trim(), scope || ''))}`,
      hostId,
      kind: kind.trim(),
      username: username.trim(),
      scope: scope || null,
      obtainedVia: obtainedVia || null,
    };
  }

  create(input) {
    const v = this.validate(input);
    const nk = naturalKey(v.hostId, v.kind, v.username, v.scope || '');
    const existing = this.db.prepare('SELECT id FROM credentials WHERE natural_key = ?').get(nk);
    if (existing) {
      this.db.prepare(
        'UPDATE credentials SET scope = ?, obtained_via = ? WHERE id = ?',
      ).run(v.scope, v.obtainedVia, existing.id);
      return { created: false, row: this.get(existing.id) };
    }
    this.db.prepare(
      'INSERT INTO credentials (id, host_id, kind, username, scope, obtained_via, natural_key) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(v.id, v.hostId, v.kind, v.username, v.scope, v.obtainedVia, nk);
    return { created: true, row: this.get(v.id) };
  }

  get(id) {
    const r = this.db.prepare('SELECT * FROM credentials WHERE id = ?').get(id);
    return r ? rowToObject(r) : null;
  }

  list() {
    return this.db.prepare('SELECT * FROM credentials ORDER BY host_id, username, id').all().map(rowToObject);
  }

  count() {
    return this.db.prepare('SELECT COUNT(*) AS n FROM credentials').get().n;
  }
}

function rowToObject(r) {
  return {
    id: r.id,
    hostId: r.host_id,
    kind: r.kind,
    username: r.username,
    scope: r.scope,
    obtainedVia: r.obtained_via,
  };
}
