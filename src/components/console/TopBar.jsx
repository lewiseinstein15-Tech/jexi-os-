import { NavIcon } from './icons';
import { useBrain } from './ConsoleApp';
import { fmtUptime } from '../../services/brain';

/* <TopBar /> — the ECC HUD Status Contract in one row — now with REAL
   values only, straight from the live brain:
   title = current mission from /api/context (or honest standing-by)
   elapsed = real session clock · uptime = the brain's own uptime
   providers/tool-calls = health counters · agents = real contracts
   todos = real context tasks · queue = real scheduler jobs.
   Stats with no real source (cost/tokens/risk guesses) are simply gone. */
export default function TopBar({ elapsed }) {
  const { fleet, health, online } = useBrain();

  const tasks = fleet?.context?.tasks || [];
  const activeTask = tasks.find((t) => (t.status || '').toLowerCase() === 'active') || tasks[0];
  const title = activeTask?.title || activeTask?.name || 'JEXI OS Brain — standing by';
  const status = online ? ['run', online ? 'Online' : ''] : ['warn', 'Waking'];

  const provs = health?.providers || [];
  const provOk = provs.filter((p) => p.configured).length;
  const calls = provs.reduce((a, p) => a + (Number(p.calls) || 0), 0);
  const agentCount = fleet?.agents?.count ?? '—';
  const ts = fleet?.context?.taskStats || { active: 0, total: 0 };
  const jobs = fleet?.scheduler?.counts?.jobs ?? 0;

  return (
    <header className="hud">
      <div className="title">{title}</div>
      <span className={`pill ${status[0]}`}><span className="dot" />{status[1]}</span>
      <div className="sep" />
      <div className="stat"><label>Elapsed</label><b>{elapsed}</b></div>
      <div className="stat"><label>Brain uptime</label><b>{health ? fmtUptime(health.uptime) : '—'}</b></div>
      <div className="stat"><label>Providers</label><b className={provOk ? 'acc' : ''}>{provs.filter((p) => p.configured).map((p) => p.key).join(', ') || 'none'}</b></div>
      <div className="stat"><label>Tool calls</label><b>{calls}</b></div>
      <div className="stat"><label>Agents</label><b className="acc">{agentCount} seated</b></div>
      <div className="stat"><label>Tasks</label><b>{ts.active || 0} active / {ts.total || 0}</b></div>
      <div className="stat"><label>Scheduler</label><b>{jobs} job{jobs === 1 ? '' : 's'}</b></div>
      <div className="controls">
        <span className="ctl" style={{ color: online ? 'var(--jcx-up)' : 'var(--jcx-gold)' }}>
          <NavIcon name="check" />{online ? 'live feed' : 'retrying'}
        </span>
      </div>
    </header>
  );
}
