import { useState, useEffect, useCallback } from 'react';
import { Puzzle, Boxes, Bot, Wrench, ToggleLeft, ToggleRight, Loader2 } from 'lucide-react';
import { getBackendUrl, jexiFetch } from '../utils/helpers';

export default function PluginsScreen() {
  const [plugins, setPlugins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState('');

  const refresh = useCallback(async () => {
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/plugins`);
      const data = await res.json();
      setPlugins(data.plugins || []);
    } catch (e) { console.error('Plugins fetch failed', e); }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const toggle = async (p) => {
    setBusyId(p.id);
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/plugins/${p.id}/toggle`, { method: 'POST' });
      const data = await res.json();
      if (data.success) setToast(`✓ ${p.name} ${data.enabled ? 'enabled' : 'disabled'}`);
      refresh();
    } catch (e) { setToast('Toggle failed'); }
    setBusyId(null);
    setTimeout(() => setToast(''), 2200);
  };

  if (loading) {
    return <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="skeleton h-20 rounded-lg" />)}</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Puzzle className="w-3.5 h-3.5 text-brand" />
        <h2 className="text-[10px] font-bold text-brand tracking-wider flex-1">PLUGINS</h2>
        <span className="text-[8px] font-mono text-text-tertiary">{plugins.filter((p) => p.enabled).length}/{plugins.length} ACTIVE</span>
      </div>

      <div className="space-y-2">
        {plugins.map((p) => (
          <div key={p.id} className={`surface-card p-3 ${p.enabled ? '' : 'opacity-70'}`}>
            <div className="flex items-start gap-3">
              <span className={`flex-shrink-0 w-9 h-9 rounded-md border flex items-center justify-center ${p.enabled ? 'bg-brand-dim border-brand-line text-brand' : 'bg-surface-2 border-hairline text-text-tertiary'}`}>
                <Puzzle className="w-4 h-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-[12px] font-semibold text-text-primary">{p.name}</p>
                  {p.builtin && <span className="text-[7px] font-bold text-text-tertiary bg-surface-2 border border-hairline rounded-full px-1.5 py-0.5">BUILT-IN</span>}
                  <span className="text-[8px] font-mono text-text-tertiary">v{p.version}</span>
                </div>
                <p className="text-[10px] text-text-secondary leading-snug mt-0.5">{p.desc}</p>
                <div className="flex items-center gap-2.5 mt-2 text-[8px] font-bold tracking-wider text-text-tertiary">
                  <span className="flex items-center gap-1"><Bot className="w-2.5 h-2.5" /> {p.live.agents} AGENTS</span>
                  <span className="flex items-center gap-1"><Boxes className="w-2.5 h-2.5" /> {p.live.skills} SKILLS</span>
                  <span className="flex items-center gap-1"><Wrench className="w-2.5 h-2.5" /> {p.live.tools} TOOLS</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => toggle(p)}
                disabled={p.id === 'core' || busyId === p.id}
                className={`flex-shrink-0 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[9px] font-bold tracking-wider border transition-colors ${
                  p.enabled
                    ? 'bg-brand-dim text-brand border-brand-line'
                    : 'bg-surface-2 text-text-tertiary border-hairline hover:text-text-secondary'
                } disabled:opacity-50`}
                title={p.id === 'core' ? 'Core is always on' : p.enabled ? 'Disable' : 'Enable'}
              >
                {busyId === p.id ? <Loader2 className="w-3 h-3 animate-spin" /> : p.enabled ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
                {p.enabled ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {toast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-surface-3 border border-brand-line text-text-primary rounded-lg px-4 py-2 text-[10px] font-bold">
          {toast}
        </div>
      )}
    </div>
  );
}
