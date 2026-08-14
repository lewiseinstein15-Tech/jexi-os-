/**
 * JEXI OS — Connector Registry (Build 56).
 *
 * Agents discover and call connectors by name through this registry. Every
 * connector calls ConnectorRegistry.register(...) on load — defining a class
 * is never enough.
 */

import { ConnectorConfig, ConnectorError, ERROR_CODES } from './ConnectorBase.js';

const _connectors = new Map();

export class ConnectorRegistry {
  /** Register a connector instance under a canonical name (idempotent). */
  static register(name, connector) {
    if (!name || !connector) throw new Error('ConnectorRegistry.register requires a name and a connector instance');
    if (typeof connector.send !== 'function' || typeof connector.authenticate !== 'function') {
      throw new Error(`ConnectorRegistry.register: "${name}" must be a Connector instance (send + authenticate are required)`);
    }
    _connectors.set(String(name).toLowerCase(), connector);
    return connector;
  }

  /** Fetch a connector by name. Throws a structured error when unknown. */
  static get(name) {
    const key = String(name || '').toLowerCase();
    if (!_connectors.has(key)) {
      throw new ConnectorError(ERROR_CODES.NOT_CONFIGURED, `Connector '${name}' not registered. Available: ${ConnectorRegistry.listAvailable().join(', ') || '(none)'}`);
    }
    return _connectors.get(key);
  }

  static has(name) {
    return _connectors.has(String(name || '').toLowerCase());
  }

  static listAvailable() {
    return [..._connectors.keys()];
  }

  /** All registered connector instances (stable order). */
  static all() {
    return [..._connectors.values()];
  }

  /** Unregister (used by tests / plugin unload). Returns boolean. */
  static unregister(name) {
    return _connectors.delete(String(name || '').toLowerCase());
  }

  static clear() {
    _connectors.clear();
  }
}
