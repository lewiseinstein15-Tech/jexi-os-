import { useState, useEffect, useCallback } from 'react';
import { Plug, Wrench, ShieldCheck, ShieldAlert, RefreshCw, ChevronDown, Server } from 'lucide-react';
import { getBackendUrl, jexiFetch } from '../utils/helpers';

/* AGI Phase 2 (live): Lewis's switches for the external MCP servers.
   GET  the servers list  → registry + real health + tool ids
   POST enable per server → switch ON (connects for real)
   POST disable per server→ switch OFF (disconnects, process dies)
   Flipping a switch is the admin decision itself, so the UI sends force:true
   after showing the community-trust warning. */

const STATUS_STYLE = {
  connected: { label: 'CONNECTED', cls: 'text-brand border-brand-line' },
  ready: { label: 'READY', cls: 'text-text-secondary border-hairline' },
  error: { label: 'ERROR', cls: 'text-red-400 border-red-400/40' },
  disabled: { label: 'OFF', cls: 'text-text-tertiary border-hairline' },
};

export default function McpScreen() {
  const [servers, setServers] = useState(null);
  const [busy, setBusy] = useState(null); // server name being toggled
  const [open, setOpen] = useState(null); // expanded server (tool list)
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await jexiFetch(`${getBackendUrl()}/api/mcp/servers`).then((x) => x.json());
      setServers(r.servers || []);
    } catch (e) { console.error('MCP servers fetch failed', e); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (s) => {
    if (busy) return;
    if (s.trustLevel === 'community' && !s.enabled
      && !window.confirm(`${s.name} is community-trust (reviewed upstream, not by JEXI). Switch it on anyway?`)) return;
    setBusy(s.name);
    try {
      const action = s.enabled ? 'disable' : 'enable';
      await jexiFetch(`${getBackendUrl()}/api/mcp/servers/${s.name}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });
      await load();
    } catch (e) { console.error('MCP toggle failed', e); }
    setBusy(null);
  };

  if (loading) return <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="skeleton h-14 rounded-lg" />)}</div>;

  const connected = (servers || []).filter((s) => s.status === 'connected');
  const totalTools = connected.reduce((n, s) => n + (s.tools || 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Plug className="w-3.5 h-3.5 text-brand" />
        <h2 className="text-[10px] font-bold text-brand tracking-wider flex-1">MCP SERVERS</h2>
        <button onClick={load} className="text-text-tertiary hover:text-brand transition-colors" title="Refresh">
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>

      <p className="text-[8px] text-text-tertiary leading-relaxed">
        External tools JEXI can plug into. ON means really connected — {connected.length} live · {totalTools} tools available to the brain. Enabled servers spin up when needed, so OFF switches cost nothing.
      </p>

      <div className="surface-card divide-y divide-hairline/50">
        {(servers || []).map((s) => {
          const st = STATUS_STYLE[s.status] || STATUS_STYLE.disabled;
          const isOn = s.status === 'connected' || s.status === 'ready' || s.status === 'error';
          return (
            <div key={s.name} className="px-3 py-2.5">
              <div className="flex items-center gap-2">
                <Server className="w-3 h-3 text-brand flex-shrink-0" />
                <span className="text-[10px] font-mono font-bold text-text-primary flex-1 truncate">{s.name}</span>
                {s.trustLevel === 'community' && <ShieldAlert className="w-3 h-3 text-yellow-500/80 flex-shrink-0" title="community trust — reviewed upstream only" />}
                {s.trustLevel === 'curated' && <ShieldCheck className="w-3 h-3 text-brand flex-shrink-0" title="curated for JEXI" />}
                <span className={`text-[7px] font-mono font-bold tracking-wider border rounded-full px-1.5 py-0.5 flex-shrink-0 ${st.cls}`}>{st.label}</span>

                {/* ON/OFF switch */}
                <button
                  onClick={() => toggle(s)}
                  disabled={busy === s.name}
                  className={`relative w-8 h-4 rounded-full border flex-shrink-0 transition-colors ${isOn ? 'bg-brand/20 border-brand-line' : 'bg-transparent border-hairline'} ${busy === s.name ? 'opacity-50' : ''}`}
                  title={isOn ? 'Switch OFF' : 'Switch ON'}
                >
                  <span className={`absolute top-0.5 w-2.5 h-2.5 rounded-full transition-all ${isOn ? 'left-4 bg-brand' : 'left-0.5 bg-text-tertiary'}`} />
                </button>
              </div>

              <p className="text-[8px] text-text-tertiary leading-relaxed mt-1">{s.description}</p>

              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                {s.tools > 0 && <span className="text-[7px] font-mono text-text-secondary border border-hairline rounded-full px-1.5 py-0.5">{s.tools} tools · {s.calls || 0} calls</span>}
                {s.permissions.map((p) => (
                  <span key={p} className={`text-[7px] font-mono rounded-full px-1.5 py-0.5 border ${p === 'READ_ONLY' ? 'text-text-tertiary border-hairline' : 'text-yellow-500/80 border-yellow-500/30'}`}>{p}</span>
                ))}
                {s.tools > 0 && (
                  <button onClick={() => setOpen(open === s.name ? null : s.name)} className="text-text-tertiary hover:text-brand transition-colors ml-auto">
                    <ChevronDown className={`w-3 h-3 transition-transform ${open === s.name ? 'rotate-180' : ''}`} />
                  </button>
                )}
              </div>

              {s.lastError && <p className="text-[7px] font-mono text-red-400/80 mt-1 break-all">{s.lastError}</p>}

              {open === s.name && s.toolIds?.length > 0 && (
                <div className="mt-1.5 border-t border-hairline/50 pt-1.5 space-y-0.5">
                  {s.toolIds.map((t) => (
                    <div key={t} className="flex items-center gap-1.5">
                      <Wrench className="w-2.5 h-2.5 text-text-tertiary flex-shrink-0" />
                      <code className="text-[7px] font-mono text-text-secondary break-all">{t}</code>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {!servers?.length && <div className="px-3 py-3 text-[10px] text-text-tertiary">No MCP servers registered.</div>}
      </div>
    </div>
  );
}
