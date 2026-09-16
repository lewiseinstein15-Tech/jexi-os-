import { NavIcon } from '../icons';
import { FLEET } from '../consoleData';

/* AgentsView — agent fleet list: state, capability chips, current task,
   resource bar — exactly as the approved preview. */
export default function AgentsView() {
  return (
    <div className="pad">
      <div className="ph">
        <h3>Agent Fleet</h3>
        <div className="rule" />
        <span className="meta">9 seated · 3 active · workforce registry</span>
      </div>
      <div className="toolbar">
        <div className="searchbox">
          <NavIcon name="search" />
          Filter by name, capability or task…
        </div>
        <span className="fchip on">All</span><span className="fchip">Engineering</span>
        <span className="fchip">Verification</span><span className="fchip">Research</span><span className="fchip">Ops</span>
      </div>

      <div className="card">
        {FLEET.map((a) => (
          <div className="rowline" key={a.name}>
            <span className={`avatar ${a.tone}`} style={{ width: 24, height: 24, fontSize: 9 }}>{a.ini}</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', gap: 7, alignItems: 'baseline' }}>
                <span style={{ fontWeight: 600 }}>{a.name}</span>
                <span style={{ fontSize: 10, color: 'var(--jcx-ink-2)' }}>{a.role}</span>
              </div>
              <div className="mono" style={{ fontSize: 10, color: 'var(--jcx-ink-2)' }}>
                {a.task[0] && <b style={{ color: 'var(--jcx-ember)' }}>{a.task[0]}</b>}{a.task[1]}
              </div>
            </div>
            <div>
              {a.chips.map((c) => <span className="grantchip" key={c}>{c}</span>)}
            </div>
            <span className={`pill ${a.pill[0]}`}><span className="dot" />{a.pill[1]}</span>
            <div style={{ width: 90 }}><div className="rbar"><i className={a.bar} style={{ width: `${a.pct}%` }} /></div></div>
          </div>
        ))}
      </div>
    </div>
  );
}
