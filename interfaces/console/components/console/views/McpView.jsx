import useLive from '../../../services/useLive';

/* McpView — the brain's REAL MCP posture: mounted status endpoint +
   registered servers with live circuit/tool/call telemetry
   (/api/mcp/status · /api/mcp/servers). */
const circuitTone = { closed: 'ok', open: 'err', half_open: 'warn' };

export default function McpView() {
  const { data, loading, error } = useLive('/api/mcp/servers', { label: 'MCP' });
  const { data: status } = useLive('/api/mcp/status', { label: 'MCP status' });

  const servers = (data && data.servers) || [];
  const on = servers.filter((s) => s.enabled).length;
  const ready = servers.filter((s) => s.status === 'ready').length;
  const st = status || {};

  return (
    <div className="pad">
      <div className="ph">
        <h3>MCP Registry</h3>
        <div className="rule" />
        <span className="meta">
          {loading ? 'loading live registry…'
            : error ? `unreachable · ${error}`
              : `${servers.length} registered · ${on} enabled · ${ready} ready · ${(st.tools || []).length} allowlisted tools at ${st.endpoint || '/mcp'}`}
        </span>
      </div>

      {loading && <div className="empty">reading /api/mcp/servers…</div>}
      {!loading && error && <div className="empty">Could not reach /api/mcp/servers · {error}</div>}

      <div className="card">
        {servers.map((s) => (
          <div className="rowline" key={s.name}>
            <span className="sdot s" style={{ background: s.enabled ? (s.status === 'ready' ? 'var(--jcx-up)' : 'var(--jcx-gold)') : 'var(--jcx-ink-3)' }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 600 }}>
                {s.name} <span className="mono" style={{ fontSize: '9.5px', color: 'var(--jcx-ink-3)' }}>{(s.permissions || []).join(' · ') || s.trustLevel}</span>
              </div>
              <div className="mono" style={{ fontSize: 10, color: 'var(--jcx-ink-2)' }}>
                {s.tools} tool{s.tools === 1 ? '' : 's'} · calls {s.calls || 0} · failures {s.failures || 0}
                {s.lastError ? ` · last error: ${String(s.lastError).slice(0, 90)}` : ''}
              </div>
            </div>
            <span className={`pill ${circuitTone[s.circuit] || 'idle'}`}><span className="dot" />circuit {s.circuit}</span>
            <span className={`pill ${s.enabled ? (s.status === 'ready' ? 'ok' : 'warn') : 'idle'}`}>
              <span className="dot" />{s.enabled ? (s.status === 'ready' ? 'Ready' : s.status) : 'Disabled'}
            </span>
          </div>
        ))}
        {!loading && !error && servers.length === 0 && (
          <div className="empty">no MCP servers registered on the brain yet<span className="sub">the built-in /mcp endpoint with its allowlisted tools is still live</span></div>
        )}
      </div>

      <div className="card">
        <div className="tierhead"><h4>Allowlisted tools (any MCP client can call)</h4><span className="cnt">{st.endpoint || '/mcp'} · mounted: {st.mounted ? 'yes' : 'no'}</span></div>
        {(st.tools || []).map((t) => (
          <div className="kv" key={t.name}>
            <span className="k">{t.tier}</span>
            <span className="v">{t.name}</span>
            <span className="t">{t.builtin ? 'builtin' : 'external'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
