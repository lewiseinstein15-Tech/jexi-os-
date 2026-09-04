import { useState, useEffect } from 'react';
import { Brain, Activity, Cpu, GitBranch, Zap } from 'lucide-react';
import { getBackendUrl, jexiFetch } from '../utils/helpers';

const STATUS_COLOR = {
  ok: 'text-brand',
  cooldown: 'text-acc-automation',
  error: 'text-status-error',
  unused: 'text-text-tertiary',
};

const COWORKER_ICON = {
  coder: GitBranch,
  memory: Brain,
  researcher: Zap,
  fallback: Cpu,
};

const COWORKER_HINT = {
  coder: 'Coding / GitHub operations',
  memory: 'Memory / conversation continuity',
  researcher: 'Research / realtime information',
  fallback: 'General fallback — last resort only',
};

export default function ModelsScreen() {
  const [workers, setWorkers] = useState([]);
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await jexiFetch(`${getBackendUrl()}/api/models`).then((x) => x.json());
        setWorkers(r.workers || []);
      } catch (e) { console.error('Models fetch failed', e); }
      setLoading(false);
    })();
  }, []);

  // B222: provider health LIVE-TESTS every configured provider (about a
  // minute) — it must never block the screen. It streams in when it lands.
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const p = await jexiFetch(`${getBackendUrl()}/api/health/providers`).then((x) => x.json());
        if (!dead) setProviders(p.providers || []);
      } catch (e) { if (!dead) setProviders([]); }
    })();
    return () => { dead = true; };
  }, []);

  if (loading) return <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="skeleton h-14 rounded-lg" />)}</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Brain className="w-3.5 h-3.5 text-brand" />
        <h2 className="text-[10px] font-bold text-brand tracking-wider flex-1">ORCHESTRATOR · WORKERS</h2>
      </div>

      {/* The real Orchestrator-Workers roster: task type → coworker → chain */}
      {workers.length > 0 && (
        <div>
          <p className="eyebrow mb-1.5">COWORKER ROUTING · TASK TYPE → MODEL CHAIN</p>
          <div className="space-y-2">
            {workers.map((w) => {
              const Icon = COWORKER_ICON[w.slug] || Cpu;
              return (
                <div key={w.slug} className="surface-card p-3">
                  <div className="flex items-center gap-2">
                    <Icon className="w-3.5 h-3.5 text-brand" />
                    <span className="text-[10px] font-bold text-text-primary uppercase tracking-wider">{w.slug}</span>
                    <span className="text-[9px] text-text-tertiary flex-1 truncate">{COWORKER_HINT[w.slug] || w.role}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {w.providers.map((p) => (
                      <span key={p} className="px-1.5 py-0.5 rounded bg-white/[0.06] border border-hairline text-[8px] font-mono text-text-secondary">
                        {p}
                      </span>
                    ))}
                    <span className="px-1.5 py-0.5 rounded bg-status-error/[0.08] border border-status-error/25 text-[8px] font-mono text-status-error/80">
                      fallback: {w.fallback.join(' → ')}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[8px] text-text-tertiary mt-1.5">Each coworker walks its own chain (primary → fallback → last-resort tier) chosen by task type — not a global preference order.</p>
        </div>
      )}

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
        {providers.length === 0 && <p className="text-[10px] text-text-tertiary font-mono">live-testing providers… (takes about a minute)</p>}
      </div>
    </div>
  );
}
