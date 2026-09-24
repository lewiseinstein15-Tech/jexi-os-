import useLive from '../../../services/useLive';
import { useBrain } from '../ConsoleApp';
import { fmtUptime } from '../../../services/brain';

/* SessionsView — REAL live processes (/api/processes) plus the brain's own
   instance identity. Empty queue = honest empty state, never invented
   session trees. */
export default function SessionsView() {
  const { data, loading, error } = useLive('/api/processes', { label: 'Sessions' });
  const { health } = useBrain();
  const procs = (data && data.processes) || [];

  return (
    <div className="pad">
      <div className="ph">
        <h3>Sessions</h3>
        <div className="rule" />
        <span className="meta">
          {loading ? 'loading live processes…'
            : error ? `unreachable · ${error}`
              : `${procs.length} live process${procs.length === 1 ? '' : 'es'} · stream-capable · resume-safe`}
        </span>
      </div>
      <div className="grid2">
        <div className="card">
          <div className="tierhead"><h4>Live processes</h4><span className="cnt">{loading ? '…' : `${procs.length} running`}</span></div>
          {loading && <div className="empty">reading /api/processes…</div>}
          {!loading && error && <div className="empty">Could not reach /api/processes · {error}</div>}
          {!loading && !error && procs.length === 0 && (
            <div className="empty">
              No live processes right now — sessions appear here the moment an agent spawns.
              <span className="sub">start one from Chat; long-running work will stream its logs into this view</span>
            </div>
          )}
          {procs.map((p, i) => (
            <div className="rowline" key={p.id || i}>
              <span className="sdot s" style={{ background: 'var(--jcx-up)' }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{p.name || p.id || `process ${i + 1}`}</div>
                <div className="mono" style={{ fontSize: '9.5px', color: 'var(--jcx-ink-3)' }}>{p.status || 'running'}{p.startedAt ? ` · since ${p.startedAt}` : ''}</div>
              </div>
              <span className="pill run"><span className="dot" />Live</span>
            </div>
          ))}
        </div>

        <div className="card">
          <div className="tierhead"><h4>Brain instance</h4><span className="cnt">/api/health</span></div>
          <div className="pad" style={{ padding: '10px 12px' }}>
            <pre className="mono" style={{ fontSize: 10, lineHeight: 1.7, color: 'var(--jcx-ink-2)', whiteSpace: 'pre-wrap', margin: 0 }}>
{health ? [
  `instance    ${health.instanceId || '—'}`,
  `version     v${health.version || '—'}`,
  `uptime      ${fmtUptime(health.uptime)}`,
  `redis       ${health.redis ? 'connected' : 'not attached'}`,
  `durable     ${health.durable ? (health.durable.backend || 'none') : 'none'}`,
  `port        ${health.port || '—'}`,
].join('\n') : 'health snapshot not loaded yet — the boot screen or heartbeat will fill this in'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
