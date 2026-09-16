import { NavIcon } from '../icons';
import { GRAPH_NODES } from '../consoleData';

/* <WorkGraph /> — missions-view node list with state dots, owner avatars and
   verification badges, exactly as the approved preview. */
export default function WorkGraph() {
  return (
    <div className="col">
      <div className="ph">
        <h3>Work Graph</h3>
        <div className="rule" />
        <span className="meta">2 verified · 1 running · 2 pending</span>
      </div>

      {GRAPH_NODES.map((n, i) => (
        <div key={i}>
          <div className={`gnode${n.running ? ' running' : ''}`}>
            <span className={`sdot ${n.state}`} />
            <div className="gmain">
              <div className="gtitle">{n.title}</div>
              <div className="gsub">{n.sub}</div>
            </div>
            <span className={`avatar ${n.tone}`}>{n.owner}</span>
            {n.verified && (
              <span className="badge ok"><NavIcon name="check" />VERIFIED</span>
            )}
          </div>
          {i < GRAPH_NODES.length - 1 && <div className="gedge" />}
        </div>
      ))}
    </div>
  );
}
