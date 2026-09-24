import useLive from '../../../services/useLive';

/* SchedulerView — the brain's REAL autonomy scheduler (/api/scheduler/jobs):
   true job/run counters and real run history. An empty scheduler says so —
   it means nothing is registered YET, not that the view is pretending. */
export default function SchedulerView() {
  const { data, loading, error } = useLive('/api/scheduler/jobs', { label: 'Scheduler' });

  const counts = (data && data.counts) || null;
  const runs = (data && data.runs) || [];
  const jobs = counts ? counts.jobs : null;

  return (
    <div className="pad">
      <div className="ph">
        <h3>Scheduler</h3>
        <div className="rule" />
        <span className="meta">
          {loading ? 'loading live scheduler…'
            : error ? `unreachable · ${error}`
              : counts
                ? `${jobs} job${jobs === 1 ? '' : 's'} · ${counts.runs} recorded run${counts.runs === 1 ? '' : 's'} · SQLite-persisted`
                : '—'}
        </span>
      </div>

      {loading && <div className="empty">reading /api/scheduler/jobs…</div>}
      {!loading && error && <div className="empty">Could not reach /api/scheduler/jobs · {error}</div>}

      {!loading && !error && (
        <>
          <div className="card">
            <div className="tierhead"><h4>Registered jobs</h4><span className="cnt">{jobs ?? '—'} registered</span></div>
            {jobs === 0 && (
              <div className="empty">
                No jobs registered — the autonomy scheduler is armed but idle.
                <span className="sub">register cron work via POST /api/scheduler/jobs, or just ask JEXI in Chat to schedule something</span>
              </div>
            )}
          </div>

          <div className="card">
            <div className="tierhead"><h4>Run history</h4><span className="cnt">last {runs.length}</span></div>
            {runs.length === 0 ? (
              <div className="empty">no runs recorded yet — history lands here after the first fire</div>
            ) : (
              <table className="ctable">
                <thead>
                  <tr><th>Fired</th><th>Job</th><th>Duration</th><th>Outcome</th></tr>
                </thead>
                <tbody>
                  {runs.map((r, i) => (
                    <tr key={r.id || i}>
                      <td>{r.at || r.firedAt || r.startedAt || '—'}</td>
                      <td>{r.jobId || r.job || r.name || '—'}</td>
                      <td>{r.ms ? `${r.ms}ms` : (r.duration || '—')}</td>
                      <td>
                        <span className={`pill ${r.status === 'ok' ? 'ok' : r.status === 'error' ? 'err' : 'warn'}`}>
                          <span className="dot" />{r.status || r.outcome || '—'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
