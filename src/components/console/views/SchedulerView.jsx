import { CRON, CRON_RUNS } from '../consoleData';

/* SchedulerView — cron jobs + upcoming fires + recent run history,
   exactly as the approved preview. */
export default function SchedulerView() {
  return (
    <div className="pad">
      <div className="ph">
        <h3>Scheduler</h3>
        <div className="rule" />
        <span className="meta">4 jobs · SQLite-persisted runs · next fire in 2h 04m</span>
      </div>
      <div className="card">
        <div className="tierhead"><h4>Cron jobs</h4><span className="cnt">4 registered</span></div>
        {CRON.map((j) => (
          <div className="rowline" key={j.name}>
            <span className="sdot s" style={{ background: j.dot }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{j.name}</div>
              <div className="mono" style={{ fontSize: 10, color: 'var(--jcx-ink-2)' }}>{j.desc}</div>
            </div>
            <span className="cron-next">{j.next}</span>
            <span className={`pill ${j.pill[0]}`}><span className="dot" />{j.pill[1]}</span>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="tierhead"><h4>Recent runs</h4><span className="cnt">last 5</span></div>
        <table className="ctable">
          <thead>
            <tr><th>Fired</th><th>Job</th><th>Duration</th><th>Outcome</th></tr>
          </thead>
          <tbody>
            {CRON_RUNS.map((r, i) => (
              <tr key={i}>
                <td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td>
                <td><span className={`pill ${r[3][0]}`}><span className="dot" />{r[3][1]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
