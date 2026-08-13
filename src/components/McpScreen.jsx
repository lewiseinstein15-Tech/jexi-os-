import { useState, useEffect } from 'react';
import { Plug, Wrench, TerminalSquare, ShieldCheck } from 'lucide-react';
import { getBackendUrl, jexiFetch } from '../utils/helpers';

export default function McpScreen() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await jexiFetch(`${getBackendUrl()}/api/mcp/status`).then((x) => x.json());
        setStatus(r);
      } catch (e) { console.error('MCP status fetch failed', e); }
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="skeleton h-14 rounded-lg" />)}</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Plug className="w-3.5 h-3.5 text-brand" />
        <h2 className="text-[10px] font-bold text-brand tracking-wider flex-1">MCP SERVER</h2>
        {status?.mounted && <span className="text-[8px] font-bold tracking-wider text-brand border border-brand-line rounded-full px-2 py-0.5">LIVE</span>}
      </div>

      {/* Endpoint */}
      <div className="surface-card p-3 space-y-2">
        <p className="eyebrow">ENDPOINT</p>
        <div className="flex items-center gap-2">
          <TerminalSquare className="w-3 h-3 text-brand" />
          <code className="text-[10px] font-mono text-brand break-all">{getBackendUrl()}{status?.endpoint || '/mcp'}</code>
        </div>
        <p className="text-[8px] text-text-tertiary">{status?.docs || 'Any MCP client can connect and call the allowlisted tools.'}</p>
        {status?.port && <p className="text-[8px] font-mono text-text-tertiary">port {status.port} · stdio + SSE compatible</p>}
      </div>

      {/* Allowlisted tools */}
      <div>
        <p className="eyebrow mb-1.5">ALLOWLISTED TOOLS · READ-ONLY</p>
        <div className="surface-card divide-y divide-hairline/50">
          {(status?.tools || []).map((t) => (
            <div key={t} className="flex items-center gap-2 px-3 py-2">
              <Wrench className="w-3 h-3 text-text-tertiary flex-shrink-0" />
              <code className="text-[10px] font-mono text-text-primary flex-1">{t}</code>
              <ShieldCheck className="w-3 h-3 text-brand flex-shrink-0" />
            </div>
          ))}
        </div>
        {!status?.tools?.length && <p className="text-[10px] text-text-tertiary">No tools currently allowlisted.</p>}
      </div>
    </div>
  );
}
