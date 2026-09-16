import { useBrain } from '../ConsoleApp';
import useLive from '../../../services/useLive';

/* WorkGraphView — full graph canvas built from the brain's REAL task queue
   (/api/context). The intent → team → work → verify → ship chain renders
   as live nodes: the first node is always the brain itself (real name +
   version), the rest are actual queued tasks. Empty queue = honest state. */
const STATE = { active: 'run', running: 'run', completed: 'ok', done: 'ok', failed: 'err', paused: 'pending', pending: 'pending' };
const TONES = ['jexi', 'f1', 'f2', 'f3', 'f4'];
const SLOT_W = 272; const ROWS = 2;

export default function WorkGraphView() {
  const { health } = useBrain();
  const { data, loading, error } = useLive('/api/context', { label: 'Canvas' });

  const tasks = (data && data.tasks) || [];
  const stats = (data && data.taskStats) || null;

  /* chain layout: brain node + up to 8 live task nodes flowing left→right */
  const nodes = [
    {
      state: 'ok',
      title: health ? `${health.name} v${health.version}` : 'JEXI OS Brain',
      sub: 'intent parsed · team composed from the live roster',
      owner: 'J', tone: 'jexi', foot: 'entry point · always live', running: false,
    },
    ...tasks.slice(0, 8).map((t, i) => ({
      state: STATE[(t.status || 'pending').toLowerCase()] || 'pending',
      title: t.title || t.name || t.id || 'untitled task',
      sub: t.desc || t.detail || t.kind || 'context-manager task',
      owner: (t.owner || t.agent || 'J').slice(0, 2).toUpperCase(),
      tone: TONES[(i + 1) % 5],
      foot: (t.status || 'pending').toLowerCase(),
      running: STATE[(t.status || 'pending').toLowerCase()] === 'run',
    })),
  ];

  const col = (i) => 16 + Math.floor(i / ROWS) * SLOT_W;
  const row = (i) => 58 + (i % ROWS) * 140;

  const counts = stats
    ? `${stats.active} active · ${stats.completed} done · ${stats.failed} failed · ${stats.total} total`
    : loading ? 'reading live queue…' : `${tasks.length} node${tasks.length === 1 ? '' : 's'}`;

  return (
    <div className="pad">
      <div className="ph">
        <h3>Work Graph — full canvas</h3>
        <div className="rule" />
        <span className="meta">live /api/context · {counts}</span>
      </div>
      <div className="legend" style={{ marginBottom: 10 }}>
        <span className="li"><i style={{ background: 'var(--jcx-up)' }} />done</span>
        <span className="li"><i style={{ background: 'var(--jcx-ember)' }} />running</span>
        <span className="li"><i style={{ background: 'var(--jcx-ink-3)' }} />pending</span>
        <span className="li"><i style={{ background: 'var(--jcx-down)' }} />failed</span>
        <span className="li" style={{ color: 'var(--jcx-ink-3)' }}>· nodes are real tasks — dispatch one from Chat and watch it appear</span>
      </div>

      <div className="canvas" style={{ height: Math.max(400, Math.ceil(nodes.length / ROWS) * 140 + 118) }}>
        {loading && <div className="empty">reading the live task queue…</div>}
        {!loading && error && <div className="empty">Could not reach /api/context · {error}</div>}
        {!loading && !error && tasks.length === 0 && (
          <div className="empty" style={{ margin: 20 }}>
            The graph is waiting on its first mission — JEXI parsed nothing into the queue yet.
            <span className="sub">open Chat, give JEXI a real task, and the canvas fills with live nodes</span>
          </div>
        )}
        {nodes.map((n, i) => (
          <div
            key={i}
            className={`wnode${n.running ? ' running' : ''}`}
            style={{ left: col(i), top: row(i), position: 'absolute' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className={`sdot ${n.state}`} />
              <div className="wt">{n.title}</div>
            </div>
            <div className="ws">{n.sub}</div>
            <div className="wrow">
              <span className={`avatar ${n.tone}`} style={{ width: 16, height: 16, fontSize: '7.5px' }}>{n.owner}</span>
              <span className="ws" style={n.running ? { color: 'var(--jcx-ember)' } : undefined}>{n.foot}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
