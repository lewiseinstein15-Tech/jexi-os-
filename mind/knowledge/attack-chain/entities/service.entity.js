/**
 * JEXI OS — Phase 8 Scope C — SERVICE ENTITY.
 *
 * Contract: { id, hostId, port, protocol, banner, product, version }
 * Required: hostId (must exist), port (1–65535 integer), protocol.
 * Natural key: (hostId, port, protocol) — re-scans update in place.
 */

import { naturalKey, hash32, GraphValidationError } from '../../store.js';

export class ServiceEntity {
  constructor(storeHandle) {
    this.handle = storeHandle;
    this.db = storeHandle.db;
  }

  validate(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new GraphValidationError('Service', 'input', 'expected an object');
    }
    const { id, hostId, port, protocol, banner, product, version } = input;

    if (id !== undefined && (typeof id !== 'string' || !id.trim())) {
      throw new GraphValidationError('Service', 'id', 'must be a non-empty string when provided');
    }
    if (hostId === undefined || hostId === null || hostId === '') {
      throw new GraphValidationError('Service', 'hostId', `"hostId" is required — a Service must live on a Host`);
    }
    if (typeof hostId !== 'string') {
      throw new GraphValidationError('Service', 'hostId', 'must be a string');
    }
    if (!this.db.prepare('SELECT id FROM hosts WHERE id = ?').get(hostId)) {
      throw new GraphValidationError('Service', 'hostId', `referenced host "${hostId}" does not exist in the graph`);
    }
    const portNum = Number(port);
    if (port === undefined || port === null || !Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      throw new GraphValidationError('Service', 'port', `"port" is required (integer 1–65535) — got ${JSON.stringify(port)}`);
    }
    if (protocol === undefined || protocol === null || (typeof protocol === 'string' && !protocol.trim())) {
      throw new GraphValidationError('Service', 'protocol', `"protocol" is required (non-empty string) — got ${JSON.stringify(protocol)}`);
    }
    if (typeof protocol !== 'string') {
      throw new GraphValidationError('Service', 'protocol', 'must be a string');
    }
    for (const [k, val] of [['banner', banner], ['product', product], ['version', version]]) {
      if (val !== undefined && val !== null && typeof val !== 'string') {
        throw new GraphValidationError('Service', k, `must be a string or null`);
      }
    }
    return {
      id: id || `svc-${hash32(naturalKey(hostId, portNum, protocol.trim()))}`,
      hostId,
      port: portNum,
      protocol: protocol.trim(),
      banner: banner || null,
      product: product || null,
      version: version || null,
    };
  }

  create(input) {
    const v = this.validate(input);
    const nk = naturalKey(v.hostId, v.port, v.protocol);
    const existing = this.db.prepare('SELECT id FROM services WHERE natural_key = ?').get(nk);
    if (existing) {
      this.db.prepare(
        'UPDATE services SET banner = ?, product = ?, version = ? WHERE id = ?',
      ).run(v.banner, v.product, v.version, existing.id);
      return { created: false, row: this.get(existing.id) };
    }
    this.db.prepare(
      'INSERT INTO services (id, host_id, port, protocol, banner, product, version, natural_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(v.id, v.hostId, v.port, v.protocol, v.banner, v.product, v.version, nk);
    return { created: true, row: this.get(v.id) };
  }

  get(id) {
    const r = this.db.prepare('SELECT * FROM services WHERE id = ?').get(id);
    return r ? rowToObject(r) : null;
  }

  list() {
    return this.db.prepare('SELECT * FROM services ORDER BY host_id, port, protocol').all().map(rowToObject);
  }

  count() {
    return this.db.prepare('SELECT COUNT(*) AS n FROM services').get().n;
  }
}

function rowToObject(r) {
  return {
    id: r.id,
    hostId: r.host_id,
    port: r.port,
    protocol: r.protocol,
    banner: r.banner,
    product: r.product,
    version: r.version,
  };
}
