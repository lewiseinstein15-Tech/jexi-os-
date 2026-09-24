import { useState } from 'react';
import useLive from '../../../services/useLive';
import { brainPost, emitEvent } from '../../../services/brain';

/* PluginsView — the brain's REAL plugin registry (/api/plugins): versions,
   contributed agents/tools/skills and live counts, with a working
   enable/disable toggle (POST /api/plugins/:id/toggle). */
export default function PluginsView() {
  const { data, loading, error, reload } = useLive('/api/plugins', { label: 'Plugins' });
  const [busy, setBusy] = useState('');
  const plugins = (data && data.plugins) || [];
  const enabled = plugins.filter((p) => p.enabled).length;

  const toggle = async (p) => {
    if (busy || p.builtin) return;
    setBusy(p.id);
    try {
      await brainPost(`/api/plugins/${p.id}/toggle`, {}, 15000);
      emitEvent({ chip: 'TOOL', who: 'Plugins', msg: `toggled ${p.id} → ${!p.enabled ? 'enabled' : 'disabled'}`, tone: 'var(--jcx-gold)' });
      await reload();
    } catch (e) {
      emitEvent({ chip: 'WARN', who: 'Plugins', msg: `toggle ${p.id} failed · ${(e && e.message) || 'error'}`, tone: 'var(--jcx-down)' });
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="pad">
      <div className="ph">
        <h3>Installed Plugins</h3>
        <div className="rule" />
        <span className="meta">
          {loading ? 'loading live registry…'
            : error ? `unreachable · ${error}`
              : `${plugins.length} installed · ${enabled} enabled · live skill/agent/tool counts from the brain`}
        </span>
      </div>

      {loading && <div className="empty">reading /api/plugins…</div>}
      {!loading && error && <div className="empty">Could not reach /api/plugins · {error}</div>}

      <div className="card">
        {plugins.map((p) => {
          const live = p.live || {};
          const chips = [];
          if (live.agents) chips.push(`${live.agents} agents`);
          if (live.skills) chips.push(`${live.skills} skills`);
          if (live.tools) chips.push(`${live.tools} tools`);
          const ctb = p.contributes || {};
          return (
            <div className="rowline" key={p.id}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600 }}>
                  {p.name} <span className="mono" style={{ fontSize: '9.5px', color: 'var(--jcx-ink-3)' }}>v{p.version}{p.builtin ? ' · builtin (locked on)' : ''}</span>
                </div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--jcx-ink-2)' }}>{p.desc}</div>
                <div style={{ marginTop: 3 }}>
                  {chips.map((c) => <span className="grantchip" key={c}>{c}</span>)}
                  {ctb.hooks ? <span className="grantchip">{ctb.hooks} hooks</span> : null}
                </div>
              </div>
              {!p.builtin && (
                <button
                  type="button"
                  className={`fchip${p.enabled ? ' on' : ''}`}
                  onClick={() => toggle(p)}
                  disabled={busy === p.id}
                  style={{ cursor: busy === p.id ? 'wait' : 'pointer', background: 'transparent' }}
                >
                  {busy === p.id ? '…' : p.enabled ? 'Disable' : 'Enable'}
                </button>
              )}
              <span className={`pill ${p.enabled ? 'ok' : 'idle'}`}><span className="dot" />{p.enabled ? 'Enabled' : 'Disabled'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
