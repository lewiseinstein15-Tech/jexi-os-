import { useCallback, useEffect, useMemo, useState } from 'react';
import { Canvas, Node, Edge, MarkerArrow } from 'reaflow';
import NodeDetail from './NodeDetail.jsx';
import './graph.css';

/**
 * Phase 24 Scope D — Work Graph surface (view-only).
 *
 * Real data: GET /api/missions -> GET /api/missions/:id (Phase 4 / B211 work
 * graph public API). graph.items are nodes, graph.relations are typed edges.
 * No fixtures: if the API has no graph data, an honest empty state renders.
 *
 * Layout: reaflow + ELK auto-layout (deterministic — same nodes -> same
 * positions). The ELK result is hashed (sha-256, first 16 hex) and shown in
 * the toolbar so determinism is observable, not asserted.
 */

const NODE_W = 216;
const NODE_H = 64;

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default function Graph() {
  const [snapshots, setSnapshots] = useState([]); // [{ id, state, items, relations }]
  const [selectedId, setSelectedId] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null); // item object
  const [layoutHash, setLayoutHash] = useState(null);

  // Load the mission list, then every mission snapshot (capped list from API).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchJson('/api/missions');
        const missions = list.missions || [];
        const snaps = await Promise.all(missions.map(async (m) => {
          try {
            const s = await fetchJson(`/api/missions/${encodeURIComponent(m.id)}`);
            const g = s.graph || {};
            return { id: m.id, state: m.state, items: g.items || [], relations: g.relations || [] };
          } catch {
            return { id: m.id, state: m.state, items: [], relations: [] };
          }
        }));
        if (cancelled) return;
        // Deterministic pick: most graph items, tie -> lowest id.
        snaps.sort((a, b) => (b.items.length - a.items.length) || a.id.localeCompare(b.id));
        setSnapshots(snaps);
        if (snaps.length) setSelectedId(snaps[0].id);
      } catch (e) {
        if (!cancelled) setLoadError(String(e && e.message ? e.message : e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const snap = useMemo(
    () => snapshots.find((s) => s.id === selectedId) || null,
    [snapshots, selectedId],
  );

  const nodes = useMemo(() => (snap ? snap.items.map((i) => ({
    id: i.id,
    width: NODE_W,
    height: NODE_H,
    text: `${i.planIndex ?? '–'}. ${i.title}`,
    data: i,
  })) : []), [snap]);

  const edges = useMemo(() => (snap ? snap.relations.map((r) => ({
    id: `${r.from}-${r.type}-${r.to}`,
    from: r.from,
    to: r.to,
    text: r.type,
    markerEnd: 'p24-arrow',
  })) : []), [snap]);

  // Determinism probe: hash the ELK positions (sorted by id) on every layout.
  const onLayoutChange = useCallback((layout) => {
    const children = (layout && layout.childElements) || [];
    const positions = children
      .filter((c) => c && c.id && typeof c.x === 'number')
      .map((c) => ({ id: c.id, x: Math.round(c.x), y: Math.round(c.y) }))
      .sort((a, b) => a.id.localeCompare(b.id));
    sha256Hex(JSON.stringify(positions)).then((h) => setLayoutHash(h.slice(0, 16)));
  }, []);

  const onNodeClick = useCallback((_event, node) => {
    const props = node || {};
    const id = props.id || (props.props && props.props.id);
    if (!id || !snap) return;
    const item = snap.items.find((i) => i.id === id) || null;
    setSelectedNode((prev) => (prev && prev.id === id ? null : item));
  }, [snap]);

  // Esc dismisses the detail panel (non-modal; canvas stays interactive).
  useEffect(() => {
    if (!selectedNode) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setSelectedNode(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedNode]);

  const hasGraph = snap && snap.items.length > 0;

  return (
    <div className="p24-graph">
      <div className="p24-graph-toolbar">
        <span className="p24-graph-label">Mission</span>
        <select
          className="p24-graph-select"
          value={selectedId || ''}
          onChange={(e) => { setSelectedId(e.target.value); setSelectedNode(null); }}
          disabled={!snapshots.length}
        >
          {snapshots.length === 0 && <option value="">—</option>}
          {snapshots.map((s) => (
            <option key={s.id} value={s.id}>{`${s.id} · ${s.state} · ${s.items.length} items`}</option>
          ))}
        </select>
        <span className="p24-graph-counts" data-testid="graph-counts">
          {hasGraph ? `${snap.items.length} nodes · ${snap.relations.length} edges` : '0 nodes · 0 edges'}
        </span>
        <span className="p24-graph-hash" data-testid="layout-hash">
          {layoutHash ? `layout hash: ${layoutHash}` : 'layout: …'}
        </span>
        <span className="p24-graph-hint">scroll = zoom · drag = pan · click node = detail · Esc closes</span>
      </div>

      <div className="p24-graph-canvas">
        {loadError && (
          <div className="p24-graph-empty" data-testid="graph-empty">
            <div className="p24-graph-empty-title">Work graph unavailable</div>
            <div className="p24-graph-empty-sub">{loadError}</div>
          </div>
        )}
        {!loadError && !hasGraph && (
          <div className="p24-graph-empty" data-testid="graph-empty">
            <div className="p24-graph-empty-title">No work graph data</div>
            <div className="p24-graph-empty-sub">
              {snapshots.length === 0
                ? 'No missions found via /api/missions. Start a mission and its work graph appears here.'
                : 'The selected mission has no work items yet. The graph renders when the mission plans work.'}
            </div>
          </div>
        )}
        {!loadError && hasGraph && (
          <Canvas
            className="p24-graph-canvas-el"
            nodes={nodes}
            edges={edges}
            direction="right"
            fit
            zoomable
            pannable
            panType="drag"
            selectable
            onLayoutChange={onLayoutChange}
            node={(n) => (
              <Node {...n} onClick={onNodeClick}>
                {(node) => (
                  <foreignObject width={node.width} height={node.height} x={0} y={0} style={{ pointerEvents: 'none' }}>
                    <div
                      className={`p24-gnode-card st-${String(node.data && node.data.status || 'PENDING').toLowerCase()}`}
                    >
                      <div className="p24-gnode-title">{node.text}</div>
                      <div className="p24-gnode-sub">
                        {String(node.data && node.data.status || '')} · {String(node.data && node.data.priority || '')}
                      </div>
                    </div>
                  </foreignObject>
                )}
              </Node>
            )}
            edge={(e) => <Edge {...e} />}
          >
            <MarkerArrow id="p24-arrow" size={7} color="#8a8f98" />
          </Canvas>
        )}
      </div>

      {selectedNode && (
        <NodeDetail
          item={selectedNode}
          relations={snap ? snap.relations : []}
          items={snap ? snap.items : []}
          onClose={() => setSelectedNode(null)}
        />
      )}
    </div>
  );
}
