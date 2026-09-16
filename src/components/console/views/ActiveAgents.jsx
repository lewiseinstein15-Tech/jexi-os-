import { MISSION_AGENTS } from '../consoleData';

/* <ActiveAgents /> — agent cards with avatar, name, role, state pill, current
   task and resource bar — exactly as the approved preview. */
export default function ActiveAgents() {
  return (
    <>
      <div className="ph">
        <h3>Active Agents</h3>
        <div className="rule" />
        <span className="meta">3 of 9</span>
      </div>

      {MISSION_AGENTS.map((a) => (
        <div className="agent" key={a.name}>
          <span className={`avatar ${a.tone}`}>{a.ini}</span>
          <div className="amain">
            <div className="nrow">
              <span className="nm">{a.name}</span>
              <span className="rl">{a.role}</span>
              <span className={`pill ${a.pill}`} style={{ marginLeft: 'auto' }}>
                <span className="dot" />{a.pillLabel}
              </span>
            </div>
            <div className="task">{a.task}</div>
            <div className="rbar"><i className={a.bar} style={{ width: `${a.pct}%` }} /></div>
          </div>
        </div>
      ))}
    </>
  );
}
