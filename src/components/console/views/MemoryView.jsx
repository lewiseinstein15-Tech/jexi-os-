import { useState } from 'react';
import useLive from '../../../services/useLive';
import { brainGet, emitEvent } from '../../../services/brain';

/* MemoryView — the brain's REAL memory surface:
   · Decisions  — /api/context decisionMemory (actual recorded decisions)
   · Tasks      — /api/context taskStats (true counters)
   · Recall     — live memory search across agent stores (/api/agents/:a/memory)
   Everything else was removed rather than faked. */
const SEARCH_AGENTS = ['jexi', 'orchestrator', 'researcher', 'memory'];

export default function MemoryView() {
  const { data, loading, error } = useLive('/api/context', { label: 'Memory' });
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);

  const decisions = (data && data.decisionMemory) || [];
  const dstats = (data && data.decisionStats) || null;
  const tstats = (data && data.taskStats) || null;

  const runSearch = async () => {
    const query = q.trim();
    if (!query || searching) return;
    setSearching(true);
    setResults(null);
    emitEvent({ chip: 'TOOL', who: 'Memory', msg: `recall “${query}” across ${SEARCH_AGENTS.length} agent stores`, tone: 'var(--jcx-ember)' });
    try {
      const all = await Promise.all(SEARCH_AGENTS.map(async (a) => {
        try {
          const r = await brainGet(`/api/agents/${a}/memory?q=${encodeURIComponent(query)}`, 15000);
          return (r.memories || []).map((m) => ({ agent: a, text: m.text || m.summary || m.content || JSON.stringify(m).slice(0, 140), when: m.at || m.ts || '' }));
        } catch { return []; }
      }));
      const flat = all.flat();
      setResults(flat);
      emitEvent({ chip: 'OK', who: 'Memory', msg: `recall complete · ${flat.length} hit${flat.length === 1 ? '' : 's'}`, tone: flat.length ? 'var(--jcx-up)' : 'var(--jcx-ink-3)' });
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="pad">
      <div className="ph">
        <h3>Memory</h3>
        <div className="rule" />
        <span className="meta">
          {loading ? 'loading live context…'
            : error ? `unreachable · ${error}`
              : `${dstats ? `${dstats.total} decisions · ` : ''}${tstats ? `${tstats.total} tasks · ` : ''}live stores on the brain`}
        </span>
      </div>

      <div className="toolbar">
        <div className="searchbox" style={{ flex: 1 }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
            placeholder="search agent memory stores (jexi · orchestrator · researcher · memory)…"
            spellCheck="false"
            style={{ background: 'transparent', border: 'none', color: 'var(--jcx-ink-1)', outline: 'none', flex: 1, fontFamily: 'inherit' }}
          />
        </div>
        <button type="button" className="fchip on" onClick={runSearch} disabled={searching || !q.trim()} style={{ cursor: 'pointer' }}>
          {searching ? 'searching…' : 'Recall'}
        </button>
      </div>

      {results !== null && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="tierhead"><h4>Recall results</h4><span className="cnt">{results.length} hit{results.length === 1 ? '' : 's'}</span></div>
          {results.length === 0 && <div className="empty">no memories matched — the stores are real and this one is simply empty</div>}
          {results.map((r, i) => (
            <div className="kv" key={i}>
              <span className="k">{r.agent}</span>
              <span className="v">{r.text}</span>
              <span className="t">{r.when || '—'}</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid2">
        <div className="card">
          <div className="tierhead">
            <h4>Decision memory</h4>
            <span className="cnt">{dstats ? `${dstats.total} recorded · ${dstats.live} live` : '—'}</span>
          </div>
          {loading && <div className="empty">reading /api/context…</div>}
          {!loading && error && <div className="empty">Could not reach /api/context · {error}</div>}
          {!loading && !error && decisions.length === 0 && (
            <div className="empty">
              No decisions recorded yet.
              <span className="sub">when JEXI makes and records a decision it will appear here verbatim</span>
            </div>
          )}
          {decisions.map((d, i) => (
            <div className="kv" key={d.id || i}>
              <span className="k">{d.type || 'decision'}</span>
              <span className="v">{d.summary || d.text || d.title || JSON.stringify(d).slice(0, 120)}</span>
              <span className="t">{d.at || d.ts || '—'}</span>
            </div>
          ))}
        </div>

        <div className="card">
          <div className="tierhead"><h4>Task counters</h4><span className="cnt">/api/context/taskStats</span></div>
          {tstats ? (
            <>
              {[['total', tstats.total], ['active', tstats.active], ['paused', tstats.paused], ['completed', tstats.completed], ['failed', tstats.failed]].map(([k, v]) => (
                <div className="kv" key={k}>
                  <span className="k">{k}</span>
                  <span className="v"><b style={{ fontSize: 14 }}>{v ?? 0}</b></span>
                  <span className="t">live</span>
                </div>
              ))}
            </>
          ) : <div className="empty">stats unavailable until the context endpoint answers</div>}
        </div>
      </div>
    </div>
  );
}
