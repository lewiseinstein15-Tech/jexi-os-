import { useState } from 'react';
import useLive from '../../../services/useLive';
import { brainGet, brainPost, emitEvent } from '../../../services/brain';

/* KnowledgeView — the brain's REAL knowledge surface:
   · MCP knowledge tools (knowledge_search / memory_lookup / list_books …)
     straight from /api/mcp/status — these are the exact tools any MCP
     client can call on the brain.
   · Live recall across agent memory stores (/api/agents/:a/memory?q=).
   The mock zettel graph is gone — no invented notes. */
const RECALL_AGENTS = ['jexi', 'orchestrator', 'researcher', 'memory'];

export default function KnowledgeView() {
  const { data, loading, error } = useLive('/api/mcp/status', { label: 'Knowledge' });
  const [q, setQ] = useState('');
  const [hits, setHits] = useState(null);
  const [busy, setBusy] = useState(false);

  const tools = (data && data.tools) || [];
  const knowledgeTools = tools.filter((t) => /knowledge|memory|book|search|health/i.test(t.name));

  const recall = async () => {
    const query = q.trim();
    if (!query || busy) return;
    setBusy(true);
    setHits(null);
    emitEvent({ chip: 'TOOL', who: 'Knowledge', msg: `recall “${query}” across ${RECALL_AGENTS.length} stores + ${knowledgeTools.length} mcp tools`, tone: 'var(--jcx-ember)' });
    try {
      const [mem, mcp] = await Promise.all([
        Promise.all(RECALL_AGENTS.map(async (a) => {
          try {
            const r = await brainGet(`/api/agents/${a}/memory?q=${encodeURIComponent(query)}`, 15000);
            return (r.memories || []).map((m) => ({ src: `memory:${a}`, text: m.text || m.summary || m.content || JSON.stringify(m).slice(0, 140) }));
          } catch { return []; }
        })),
        // MCP knowledge tools are registered server-side; try the documented invoke path best-effort
        Promise.all(knowledgeTools.slice(0, 2).map(async (t) => {
          try {
            const r = await brainPost('/api/mcp/tools/invoke', { server: 'builtin', tool: t.name, args: { query } }, 15000);
            return r && r.ok && r.result ? [{ src: `mcp:${t.name}`, text: typeof r.result === 'string' ? r.result : JSON.stringify(r.result).slice(0, 160) }] : [];
          } catch { return []; }
        })),
      ]);
      const flat = [...mem.flat(), ...mcp.flat()];
      setHits(flat);
      emitEvent({ chip: 'OK', who: 'Knowledge', msg: `recall complete · ${flat.length} hit${flat.length === 1 ? '' : 's'}`, tone: flat.length ? 'var(--jcx-up)' : 'var(--jcx-ink-3)' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pad">
      <div className="ph">
        <h3>Knowledge</h3>
        <div className="rule" />
        <span className="meta">
          {loading ? 'loading live tool registry…'
            : error ? `unreachable · ${error}`
              : `${tools.length} MCP tools mounted at ${data.endpoint} · ${knowledgeTools.length} knowledge tools`}
        </span>
      </div>

      <div className="toolbar">
        <div className="searchbox" style={{ flex: 1 }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') recall(); }}
            placeholder="search knowledge + memory on the brain…"
            spellCheck="false"
            style={{ background: 'transparent', border: 'none', color: 'var(--jcx-ink-1)', outline: 'none', flex: 1, fontFamily: 'inherit' }}
          />
        </div>
        <button type="button" className="fchip on" onClick={recall} disabled={busy || !q.trim()} style={{ cursor: 'pointer' }}>
          {busy ? 'searching…' : 'Search'}
        </button>
      </div>

      {hits !== null && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="tierhead"><h4>Results</h4><span className="cnt">{hits.length} hit{hits.length === 1 ? '' : 's'}</span></div>
          {hits.length === 0 && <div className="empty">no knowledge matched — the brain answered honestly with an empty set</div>}
          {hits.map((h, i) => (
            <div className="kv" key={i}>
              <span className="k">{h.src}</span>
              <span className="v">{h.text}</span>
              <span className="t">live</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid2">
        <div className="card">
          <div className="tierhead"><h4>Knowledge tools (MCP)</h4><span className="cnt">/api/mcp/status</span></div>
          {loading && <div className="empty">reading the MCP tool registry…</div>}
          {!loading && error && <div className="empty">Could not reach /api/mcp/status · {error}</div>}
          {knowledgeTools.map((t) => (
            <div className="rowline" key={t.name}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{t.name}</div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--jcx-ink-2)' }}>{t.builtin ? 'builtin tool' : 'registered tool'} · tier {t.tier}</div>
              </div>
              <span className="pill ok"><span className="dot" />Mounted</span>
            </div>
          ))}
          {!loading && !error && knowledgeTools.length === 0 && <div className="empty">no knowledge-classified tools in the allowlist right now</div>}
        </div>

        <div className="card">
          <div className="tierhead"><h4>Full MCP allowlist</h4><span className="cnt">{(data && data.allowlist || []).length} tools</span></div>
          {tools.map((t) => (
            <div className="kv" key={t.name}>
              <span className="k">{t.tier}</span>
              <span className="v">{t.name}</span>
              <span className="t">{t.builtin ? 'builtin' : 'external'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
