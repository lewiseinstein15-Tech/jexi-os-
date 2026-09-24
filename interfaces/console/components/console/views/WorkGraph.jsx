import { NavIcon } from '../icons';
import { useHud } from '../ConsoleApp';

/* <WorkGraph /> — Phase 7(F): renders ONLY the HUD payload's todos +
   queueState (the contract's work-graph section set). Every node is a
   real task with its true status and owner; when the payload carries no
   todos, the view says "no data" instead of inventing work. */
const STATE = { active: 'run', running: 'run', completed: 'ok', done: 'ok', failed: 'err', paused: 'pending', pending: 'pending' };
const OWNER_TONE = ['f1', 'f2', 'f3', 'f4'];

export default function WorkGraph() {
  const { hud } = useHud();
  const todos = hud?.todos ?? null;
  const queue = hud?.queueState ?? null;

  if (todos == null) {
    return (
      <div className="col">
        <div className="ph">
          <h3>Work Graph</h3>
          <div className="rule" />
          <span className="meta">hud.todos</span>
        </div>
        <div className="empty">no data — the payload carries no todos section</div>
      </div>
    );
  }

  const done = todos.filter((t) => t.status === 'done').length;
  const active = todos.filter((t) => t.status === 'active').length;
  const failed = 0; // the contract's todo statuses are pending|active|done only
  const meta = queue
    ? `${active} active · ${done} done · ${queue.missionsQueued + queue.toolsQueued + queue.verificationsQueued} queued`
    : `${todos.length} task${todos.length === 1 ? '' : 's'}`;

  return (
    <div className="col">
      <div className="ph">
        <h3>Work Graph</h3>
        <div className="rule" />
        <span className="meta">{meta}</span>
      </div>

      {todos.length === 0 && (
        <div className="empty">
          No missions in the queue — JEXI is standing by.
          <span className="sub">dispatch one from Chat and it will appear here the moment the brain accepts it</span>
        </div>
      )}

      {todos.map((t, i) => {
        const st = STATE[(t.status || 'pending').toLowerCase()] || 'pending';
        const owner = (t.owner || 'J').slice(0, 2).toUpperCase();
        return (
          <div key={t.id || i}>
            <div className={`gnode${st === 'run' ? ' running' : ''}`}>
              <span className={`sdot ${st}`} />
              <div className="gmain">
                <div className="gtitle">{t.text || t.id || 'untitled task'}</div>
                <div className="gsub">{t.owner ? `owner · ${t.owner}` : 'hud todo'}</div>
              </div>
              <span className={`avatar ${OWNER_TONE[i % 4]}`}>{owner}</span>
              {st === 'ok' && (
                <span className="badge ok"><NavIcon name="check" />DONE</span>
              )}
            </div>
            {i < todos.length - 1 && <div className="gedge" />}
          </div>
        );
      })}
    </div>
  );
}
