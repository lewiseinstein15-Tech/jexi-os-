import { NavIcon } from '../icons';
import useLive from '../../../services/useLive';

/* <WorkGraph /> — missions-view node list driven by the brain's REAL
   context manager (/api/context). Every node is a live task with its
   true state; when the queue is empty the view says so instead of
   inventing work. */
const STATE = { active: 'run', running: 'run', completed: 'ok', done: 'ok', failed: 'err', paused: 'pending', pending: 'pending' };
const OWNER_TONE = ['f1', 'f2', 'f3', 'f4'];

export default function WorkGraph() {
  const { data, loading, error } = useLive('/api/context', { label: 'WorkGraph' });

  const tasks = (data && data.tasks) || [];
  const stats = (data && data.taskStats) || null;

  const meta = loading
    ? 'loading live queue…'
    : error
      ? `queue unreachable · ${error}`
      : stats
        ? `${stats.active} active · ${stats.completed} done · ${stats.failed} failed · ${stats.total} total`
        : `${tasks.length} task${tasks.length === 1 ? '' : 's'}`;

  return (
    <div className="col">
      <div className="ph">
        <h3>Work Graph</h3>
        <div className="rule" />
        <span className="meta">{meta}</span>
      </div>

      {loading && <div className="empty">reading the live task queue from the brain…</div>}

      {!loading && !error && tasks.length === 0 && (
        <div className="empty">
          No missions in the queue — JEXI is standing by.
          <span className="sub">dispatch one from Chat and it will appear here the moment the brain accepts it</span>
        </div>
      )}

      {!loading && error && (
        <div className="empty">Could not reach /api/context · {error}<span className="sub">the console keeps retrying — ServerRow shows the brain state</span></div>
      )}

      {tasks.map((t, i) => {
        const st = STATE[(t.status || 'pending').toLowerCase()] || 'pending';
        const owner = (t.owner || t.agent || 'J').slice(0, 2).toUpperCase();
        return (
          <div key={t.id || i}>
            <div className={`gnode${st === 'run' ? ' running' : ''}`}>
              <span className={`sdot ${st}`} />
              <div className="gmain">
                <div className="gtitle">{t.title || t.name || t.id || 'untitled task'}</div>
                <div className="gsub">{t.desc || t.detail || t.kind || 'context-manager task'}</div>
              </div>
              <span className={`avatar ${OWNER_TONE[i % 4]}`}>{owner}</span>
              {st === 'ok' && (
                <span className="badge ok"><NavIcon name="check" />DONE</span>
              )}
            </div>
            {i < tasks.length - 1 && <div className="gedge" />}
          </div>
        );
      })}
    </div>
  );
}
