/**
 * Phase 24 Scope D — node detail panel (non-modal, right region).
 * Shows the node's id, kind, label and immediate edges. Esc / × dismisses.
 * View-only: nothing here mutates the graph.
 */
export default function NodeDetail({ item, relations, items, onClose }) {
  const title = (id) => {
    const other = items.find((i) => i.id === id);
    return other ? other.title : id;
  };

  const outgoing = relations.filter((r) => r.from === item.id);
  const incoming = relations.filter((r) => r.to === item.id);

  return (
    <aside className="p24-gdetail" data-testid="node-detail" aria-label="Node detail">
      <div className="p24-gdetail-head">
        <span className="p24-gdetail-title">Work item</span>
        <button className="p24-gdetail-close" onClick={onClose} aria-label="Close detail">×</button>
      </div>

      <div className="p24-gdetail-rows">
        <div className="p24-gdetail-row">
          <span className="p24-gdetail-k">id</span>
          <span className="p24-gdetail-v mono" data-testid="detail-id">{item.id}</span>
        </div>
        <div className="p24-gdetail-row">
          <span className="p24-gdetail-k">kind</span>
          <span className="p24-gdetail-v" data-testid="detail-kind">{item.origin || 'work-item'}</span>
        </div>
        <div className="p24-gdetail-row">
          <span className="p24-gdetail-k">label</span>
          <span className="p24-gdetail-v" data-testid="detail-label">{item.title}</span>
        </div>
        <div className="p24-gdetail-row">
          <span className="p24-gdetail-k">status</span>
          <span className={`p24-gdetail-v st-${String(item.status || '').toLowerCase()}`}>{item.status}</span>
        </div>
        <div className="p24-gdetail-row">
          <span className="p24-gdetail-k">priority</span>
          <span className="p24-gdetail-v">{item.priority}</span>
        </div>
        {item.capability && (
          <div className="p24-gdetail-row">
            <span className="p24-gdetail-k">capability</span>
            <span className="p24-gdetail-v">{item.capability}</span>
          </div>
        )}
      </div>

      <div className="p24-gdetail-edges">
        <div className="p24-gdetail-edge-head">Immediate edges</div>
        {outgoing.length === 0 && incoming.length === 0 && (
          <div className="p24-gdetail-edge-none">No edges touch this item.</div>
        )}
        {outgoing.map((r) => (
          <div className="p24-gdetail-edge" key={`out-${r.id || r.to}-${r.type}`}>
            <span className="p24-gdetail-etype">{r.type}</span>
            <span className="p24-gdetail-edir">→</span>
            <span className="p24-gdetail-elabel">{title(r.to)}</span>
            <span className="p24-gdetail-eid mono">{r.to}</span>
          </div>
        ))}
        {incoming.map((r) => (
          <div className="p24-gdetail-edge" key={`in-${r.id || r.from}-${r.type}`}>
            <span className="p24-gdetail-etype">{r.type}</span>
            <span className="p24-gdetail-edir">←</span>
            <span className="p24-gdetail-elabel">{title(r.from)}</span>
            <span className="p24-gdetail-eid mono">{r.from}</span>
          </div>
        ))}
      </div>

      <div className="p24-gdetail-foot">Esc closes · view-only</div>
    </aside>
  );
}
