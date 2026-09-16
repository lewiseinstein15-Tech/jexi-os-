import useLive from '../../../services/useLive';
import { emitEvent } from '../../../services/brain';

/* <ActiveAgents /> — the brain's REAL named roster (/api/team): 26
   teammates with their actual hints and model lanes. State pills reflect
   provider health; nothing here is scripted. */
export default function ActiveAgents() {
  const { data, loading, error } = useLive('/api/team', { label: 'Roster' });
  const roster = (data && data.team) || [];
  const shown = roster.slice(0, 4);

  const open = (a) => {
    emitEvent({ chip: 'AGENT', who: a.name, msg: a.hint || 'teammate profile', tone: 'var(--jcx-peach)' });
  };

  return (
    <>
      <div className="ph">
        <h3>Active Agents</h3>
        <div className="rule" />
        <span className="meta">{loading ? 'loading live roster…' : error ? `roster unreachable · ${error}` : `${roster.length} teammates seated · showing ${shown.length}`}</span>
      </div>

      {loading && <div className="empty">reading the live roster from /api/team…</div>}
      {!loading && error && <div className="empty">Could not reach /api/team · {error}</div>}

      {shown.map((a) => (
        <div className="agent" key={a.name} style={{ cursor: 'pointer' }} onClick={() => open(a)}>
          <span className="avatar f2">{a.name.slice(0, 2).toUpperCase()}</span>
          <div className="amain">
            <div className="nrow">
              <span className="nm">{a.name}</span>
              <span className="rl">{(a.hint || 'teammate').split('—')[0].trim()}</span>
            </div>
            <div className="task">{a.hint || 'member of the live roster'}</div>
          </div>
        </div>
      ))}
    </>
  );
}
