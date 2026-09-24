/** JEXI OS — Phase 28 Scope J — injected-time 72-hour archive lifecycle. */
import { SemanticaError } from '../../../services/semantica/_internal.js';

export const RECOVERY_WINDOW_MS = 72 * 60 * 60 * 1000;
export const PURGE_REASON = 'archive recovery window expired';

function epoch(value, field) {
  const milliseconds = typeof value === 'number'
    ? value
    : value instanceof Date
      ? value.getTime()
      : typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(milliseconds)) {
    throw new SemanticaError('E_INVALID_ARGUMENT', `${field} must be an injected epoch-ms, Date, or ISO timestamp`);
  }
  return milliseconds;
}

function iso(milliseconds) {
  return new Date(milliseconds).toISOString();
}

export function createSoftDelete({ registry, now, recordAudit }) {
  if (!registry || typeof registry.find !== 'function' || typeof registry.remove !== 'function') {
    throw new SemanticaError('E_INVALID_ARGUMENT', 'soft-delete requires a source registry');
  }
  if (typeof now !== 'function') {
    throw new SemanticaError('E_INVALID_ARGUMENT', 'soft-delete requires an injected now() function');
  }
  const audit = typeof recordAudit === 'function' ? recordAudit : () => {};
  const current = () => epoch(now(), 'now()');
  const required = (id) => {
    const record = registry.find(id);
    if (!record) throw new SemanticaError('E_NOT_FOUND', `record ${JSON.stringify(id)} was not found`);
    return record;
  };

  function archive(id) {
    const record = required(id);
    if (record.archived === true) {
      return { archivedAt: record.archived_at, expiresAt: record.archive_expires_at };
    }
    const archivedMs = current();
    record.archived = true;
    record.archived_at = iso(archivedMs);
    record.archive_expires_at = iso(archivedMs + RECOVERY_WINDOW_MS);
    registry.deactivate(record.id);
    audit({
      event: 'archived', id: record.id, source_id: record.source_id,
      record_type: record.record_type, at: record.archived_at,
      expires_at: record.archive_expires_at,
    });
    return { archivedAt: record.archived_at, expiresAt: record.archive_expires_at };
  }

  function recover(id) {
    const record = required(id);
    if (record.archived !== true) return { recovered: false };
    const nowMs = current();
    const expiresMs = epoch(record.archive_expires_at, `${record.id}.archive_expires_at`);
    if (nowMs >= expiresMs) {
      throw new SemanticaError('E_RECOVERY_EXPIRED',
        `recovery window expired for ${record.id} at ${record.archive_expires_at}`);
    }
    const recoveredAt = iso(nowMs);
    record.archived = false;
    record.archived_at = null;
    record.archive_expires_at = null;
    registry.activate(record.id);
    audit({
      event: 'recovered', id: record.id, source_id: record.source_id,
      record_type: record.record_type, at: recoveredAt,
    });
    return { recovered: true };
  }

  function purge() {
    const nowMs = current();
    const purgedAt = iso(nowMs);
    const items = [];
    for (const record of registry.allRecords()) {
      if (record.archived !== true || record.archive_expires_at == null) continue;
      if (epoch(record.archive_expires_at, `${record.id}.archive_expires_at`) > nowMs) continue;
      const item = {
        id: record.id,
        source_id: record.source_id,
        record_type: record.record_type,
        reason: PURGE_REASON,
        purgedAt,
      };
      registry.remove(record.id);
      items.push(item);
      audit({ event: 'purged', ...item });
    }
    return { purged: items.length };
  }

  return Object.freeze({ archive, recover, purge });
}
