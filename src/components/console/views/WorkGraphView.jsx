import { useHud } from '../ConsoleApp';

/* WorkGraphView — full graph canvas built from the HUD payload's todos +
   activeAgents sections (jexi.hud-status.v1). The brain node leads, then
   real tasks flow left→right. A payload without these sections renders
   "no data" — the canvas cannot invent nodes (probe P7). */
const STATE = { active: 'run', running: 'run', completed: 'ok', done: 'ok', failed: 'err', paused: 'pending', pending: 'pending' };
const TONES = ['jexi', 'f1', 'f2', 'f3', 'f4'];
const SLOT_W = 272; const ROWS = 2;

export default function WorkGraphView() {
  const { hud, connected } = useHud();

  const todos = hud?.todos ?? null;
  const agents = hud?.activeAgents ?? null;
  const ctx = hud?.context ?? null;

  if (todos == null) {
    return (
      <div className="pad">
        <div className="ph">
          <h3>Work Graph — full canvas</h3>
          <div className="rule" />
          <span className="meta">hud.todos</span>
        </div>
        <div className="empty">no data — the payload carries no todos section</div>
      </div>
    );
  }

  const working = (agents || []).filter((a) => a.state === 'working').length;

  /* chain layout: brain node + up to 8 live task nodes flowing left→right */
  const nodes = [
    {
      state: 'ok',
      title: ctx ? `${ctx.model || 'jexi-brain'} · ${ctx.provider || 'jexi'}` : 'JEXI OS Brain',
      sub: connected ? `hud rev live · ${agents ? `${agents.length} agents seated · ${working} working` : 'roster absent'}` : 'hud syncing…',
      owner: 'J', tone: 'jexi', foot: 'entry point · always live', running: false,
    },
    ...todos.slice(0, 8).map((t, i) => ({
      state: STATE[(t.status || 'pending').toLowerCase()] || 'pending',
      title: t.text || t.id || 'untitled task',
      sub: t.owner ? `owner · ${t.owner}` : 'hud todo',
      owner: (t.owner || 'J').slice(0, 2).toUpperCase(),
      tone: TONES[(i + 1) % 5],
      foot: (t.status || 'pending').toLowerCase(),
      running: STATE[(t.status || 'pending').toLowerCase()] === 'run',
    })),
  ];

  const col = (i) => 16 + Math.floor(i / ROWS) * SLOT_W;
  const row = (i) => 58 + (i % ROWS) * 140;

  const done = todos.filter((t) => t.status === 'done').length;
  const active = todos.filter((t) => t.status === 'active').length;
  const counts = `${active} active · ${done} done · ${todos.length} total`;

  return (
    <div className="pad">
      <div className="ph">
        <h3>Work Graph — full canvas</h3>
        <div className="rule" />
        <span className="meta">hud payload · {counts}</span>
      </div>
      <div className="legend" style={{ marginBottom: 10 }}>
        <span className="li"><i style={{ background: 'var(--jcx-up)' }} />done</span>
        <span className="li"><i style={{ background: 'var(--jcx-ember)' }} />running</span>
        <span className="li"><i style={{ background: 'var(--jcx-ink-3)' }} />pending</span>
        <span className="li"><i style={{ background: 'var(--jcx-down)' }} />failed</span>
        <span className="li" style={{ color: 'var(--jcx-ink-3)' }}>· nodes are real tasks — dispatch one from Chat and watch it appear</span>
      </div>

      <div className="canvas" style={{ height: Math.max(400, Math.ceil(nodes.length / ROWS) * 140 + 118) }}>
        {todos.length === 0 && (
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
