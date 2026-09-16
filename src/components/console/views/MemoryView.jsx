import { MEMORY } from '../consoleData';

/* MemoryView — memory browser across the four tiers
   (working / session / episodic / semantic), exactly as the approved preview. */
export default function MemoryView() {
  return (
    <div className="pad">
      <div className="ph">
        <h3>Memory Browser</h3>
        <div className="rule" />
        <span className="meta">SQLite store · 4 tiers · pressure 72% warm</span>
      </div>
      <div className="grid2">
        {MEMORY.map((t) => (
          <div className="card" key={t.tier}>
            <div className="tierhead">
              <h4>{t.tier}</h4>
              <div className="prose"><i style={{ width: `${t.pct}%` }} /></div>
              <span className="cnt">{t.cnt}</span>
            </div>
            {t.rows.map((r, i) => (
              <div className="kv" key={i}>
                <span className="k">{r[0]}</span>
                <span className="v">{r[1]}</span>
                <span className="t">{r[2]}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
