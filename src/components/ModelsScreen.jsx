import { useState, useEffect } from 'react';
import { Brain, Activity, Cpu } from 'lucide-react';
import { getBackendUrl, jexiFetch } from '../utils/helpers';

const STATUS_COLOR = {
  ok: 'text-brand',
  cooldown: 'text-acc-automation',
  error: 'text-status-error',
  unused: 'text-text-tertiary',
};

export default function ModelsScreen() {
  const [routing, setRouting] = useState([]);
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [r, p] = await Promise.all([
          jexiFetch(`${getBackendUrl()}/api/models`).then((x) => x.json()),
          jexiFetch(`${getBackendUrl()}/api/health/providers`).then((x) => x.json()).catch(() => ({ providers: [] })),
        ]);
        setRouting(r.routing || []);
        setProviders(p.providers || []);
      } catch (e) { console.error('Models fetch failed', e); }
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="skeleton h-14 rounded-lg" />)}</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Brain className="w-3.5 h-3.5 text-brand" />
        <h2 className="text-[10px] font-bold text-brand tracking-wider flex-1">MODEL ROUTING</h2>
      </div>

      {/* Provider health */}
      <div>
        <p className="eyebrow mb-1.5">PROVIDERS · HEALTH</p>
        <div className="grid grid-cols-2 gap-2">
          {providers.map((p) => (
            <div key={p.key} className="surface-card p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold text-text-primary truncate">{p.provider}</span>
                <span className={`text-[8px] font-bold tracking-wider ${STATUS_COLOR[p.inCooldown ? 'cooldown' : p.ok > 0 ? 'ok' : p.fails > 0 ? 'error' : 'unused']}`}>
                  {p.inCooldown ? 'COOLDOWN' : p.ok > 0 ? 'OK' : p.fails > 0 ? 'ERRORS' : 'IDLE'}
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-2 text-[8px] font-mono text-text-tertiary">
                <span className="flex items-center gap-0.5"><Activity className="w-2.5 h-2.5" /> {p.calls || 0}</span>
                <span>ok {p.ok || 0}</span>
                <span>fails {p.fails || 0}</span>
                {p.configured && <span className="text-brand">· key ✓</span>}
                {!p.configured && <span className="text-text-tertiary">· no key</span>}
              </div>
            </div>
          ))}
        </div>
        {providers.length === 0 && <p className="text-[10px] text-text-tertiary">Provider health is unavailable right now.</p>}
      </div>

      {/* Per-domain routing */}
      <div>
        <p className="eyebrow mb-1.5">PER-DOMAIN ROUTING · WHICH PROVIDER LEADS</p>
        <div className="surface-card divide-y divide-hairline/50">
          {routing.map((r) => (
            <div key={r.intent} className="flex items-center gap-2 px-3 py-2">
              <Cpu className="w-3 h-3 text-text-tertiary flex-shrink-0" />
              <span className="text-[10px] font-mono text-text-secondary flex-1 truncate">{r.intent}</span>
              <span className={`text-[9px] font-semibold ${r.provider === '(auto)' ? 'text-text-tertiary' : 'text-brand'}`}>{r.providerLabel}</span>
            </div>
          ))}
        </div>
        <p className="text-[8px] text-text-tertiary mt-1.5">Math/vision lead with Gemini · research/news with OpenRouter · code/data with Groq. Every task still fails over through the full chain automatically.</p>
      </div>
    </div>
  );
}
