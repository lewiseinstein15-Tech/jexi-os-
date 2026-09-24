import { useHud } from '../ConsoleApp';

/* <ActiveAgents /> — Phase 7(F): renders ONLY hud.activeAgents — the
   roster with each agent's real state (idle/working), current objective,
   resource share and start time from the contract payload. Absent
   section = honest "no data"; nothing here is scripted. */
export default function ActiveAgents() {
  const { hud } = useHud();
  const agents = hud?.activeAgents ?? null;
  const shown = (agents || []).slice(0, 4);

  if (agents == null) {
    return (
      <>
        <div className="ph">
          <h3>Active Agents</h3>
          <div className="rule" />
          <span className="meta">hud.activeAgents</span>
        </div>
        <div className="empty">no data — the payload carries no activeAgents section</div>
      </>
    );
  }

  return (
    <>
      <div className="ph">
        <h3>Active Agents</h3>
        <div className="rule" />
        <span className="meta">{agents.length} teammates seated · {agents.filter((a) => a.state === 'working').length} working · showing {shown.length}</span>
      </div>

      {shown.map((a) => (
        <div className="agent" key={a.id} style={{ cursor: 'pointer' }}>
          <span className="avatar f2">{a.name.slice(0, 2).toUpperCase()}</span>
          <div className="amain">
            <div className="nrow">
              <span className="nm">{a.name}</span>
              <span className="rl">{a.role}</span>
            </div>
            <div className="task">
              {a.state === 'working'
                ? `${a.objective || 'working'} · ${a.resourcePct}%`
                : 'idle — available for dispatch'}
            </div>
          </div>
          <span className={`badge ${a.state === 'working' ? 'ok' : ''}`}>{a.state}</span>
        </div>
      ))}
    </>
  );
}
