import { NavIcon } from '../icons';
import { SKILLS } from '../consoleData';

/* SkillsView — skill catalog browser with search + category chips,
   exactly as the approved preview. */
export default function SkillsView() {
  return (
    <div className="pad">
      <div className="ph">
        <h3>Skill Catalog</h3>
        <div className="rule" />
        <span className="meta">508 skills · 52 from plugins · 96.4% 30-day success</span>
      </div>
      <div className="toolbar">
        <div className="searchbox"><NavIcon name="search" />Search 508 skills…</div>
        <span className="fchip on">All</span><span className="fchip">code</span><span className="fchip">test</span>
        <span className="fchip">data</span><span className="fchip">web</span><span className="fchip">ops</span>
      </div>
      <div className="card">
        {SKILLS.map((s) => (
          <div className="rowline" key={s[0]}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 600 }}>
                {s[0]} <span className="mono" style={{ fontSize: '9.5px', color: 'var(--jcx-ink-3)' }}>{s[1]}</span>
              </div>
              <div className="mono" style={{ fontSize: 10, color: 'var(--jcx-ink-2)' }}>{s[2]}</div>
            </div>
            <span className="mono" style={{ fontSize: 10, color: 'var(--jcx-ink-3)' }}>{s[3]}</span>
            <div style={{ width: 90 }}><div className="rbar"><i style={{ width: `${s[4]}%` }} /></div></div>
            <span className={`pill ${s[5][0]}`}><span className="dot" />{s[5][1]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
