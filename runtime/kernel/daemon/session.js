// Phase 11 Scope C — per-session registration.
//
// Sessions register on open (handshake + register), unregister on close.
// The registry is the ownership source for jobs and watchers: closing a
// session cancels ONLY the work that session owns (CBM semantics).

export class SessionRegistry {
  constructor(onLastSession = null) {
    this.sessions = new Map(); // sessionId → { id, namespace, registeredAt, conns }
    this.onLastSession = onLastSession; // fired when the last session leaves
  }

  register(sessionId, namespace, conn) {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.conns.add(conn);
      return { reattached: true, session: existing };
    }
    const session = {
      id: sessionId,
      namespace: namespace || `ns-${sessionId}`,
      registeredAt: new Date().toISOString(),
      conns: new Set([conn]),
    };
    this.sessions.set(sessionId, session);
    return { reattached: false, session };
  }

  unregister(sessionId, conn = null) {
    const session = this.sessions.get(sessionId);
    if (!session) return { removed: false, session: null };
    if (conn) {
      session.conns.delete(conn);
      if (session.conns.size > 0) return { removed: false, session, connDroppedOnly: true };
    }
    this.sessions.delete(sessionId);
    if (this.onLastSession && this.sessions.size === 0) this.onLastSession();
    return { removed: true, session };
  }

  get(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  require(sessionId) {
    const s = this.sessions.get(sessionId);
    if (!s) {
      const err = new Error(`session "${sessionId}" is not registered (register first)`);
      err.code = 'SESSION_NOT_REGISTERED';
      throw err;
    }
    return s;
  }

  list() {
    return [...this.sessions.values()].map((s) => ({
      id: s.id,
      namespace: s.namespace,
      registeredAt: s.registeredAt,
      connections: s.conns.size,
    }));
  }

  get size() {
    return this.sessions.size;
  }
}
