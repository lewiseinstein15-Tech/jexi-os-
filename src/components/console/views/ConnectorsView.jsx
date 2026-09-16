import { useState } from 'react';
import useLive from '../../../services/useLive';
import { brainPost, emitEvent } from '../../../services/brain';

/* ConnectorsView — the brain's REAL connector registry (/api/connectors).
   Health is shown as-is (unconfigured connectors say so — that is the
   truth, not a failure of the UI), and the enable/disable toggle hits the
   same endpoint the classic shell uses. */
const healthPill = (c) => {
  if (!c.enabled) return ['idle', 'Disabled'];
  if (c.health === 'ok') return ['ok', 'Connected'];
  if (c.configured) return ['warn', c.health || 'Degraded'];
  return ['err', 'Not configured'];
};
const dot = (c) => {
  if (!c.enabled) return 'var(--jcx-ink-3)';
  if (c.health === 'ok') return 'var(--jcx-up)';
  if (c.configured) return 'var(--jcx-gold)';
  return 'var(--jcx-down)';
};

export default function ConnectorsView() {
  const { data, loading, error, reload } = useLive('/api/connectors', { label: 'Connectors' });
  const [busy, setBusy] = useState('');
  const connectors = (data && data.connectors) || [];
  const on = connectors.filter((c) => c.enabled).length;
  const okN = connectors.filter((c) => c.enabled && c.health === 'ok').length;

  const toggle = async (c) => {
    if (busy) return;
    setBusy(c.name);
    try {
      await brainPost(`/api/connectors/${c.name}/toggle`, {}, 15000);
      emitEvent({ chip: 'TOOL', who: 'Connectors', msg: `toggled ${c.name} → ${!c.enabled ? 'enabled' : 'disabled'}`, tone: 'var(--jcx-gold)' });
      await reload();
    } catch (e) {
      emitEvent({ chip: 'WARN', who: 'Connectors', msg: `toggle ${c.name} failed · ${(e && e.message) || 'error'}`, tone: 'var(--jcx-down)' });
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="pad">
      <div className="ph">
        <h3>Connectors</h3>
        <div className="rule" />
        <span className="meta">
          {loading ? 'loading live registry…'
            : error ? `unreachable · ${error}`
              : `${connectors.length} registered · ${on} enabled · ${okN} healthy · external tiers need their keys on Render`}
        </span>
      </div>

      {loading && <div className="empty">reading /api/connectors…</div>}
      {!loading && error && <div className="empty">Could not reach /api/connectors · {error}</div>}

      <div className="card">
        {connectors.map((c) => {
          const p = healthPill(c);
          return (
            <div className="rowline" key={c.name}>
              <span className="sdot s" style={{ background: dot(c) }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600 }}>
                  {c.name} <span className="mono" style={{ fontSize: '9.5px', color: 'var(--jcx-ink-3)' }}>{c.label} · {c.tier}</span>
                </div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--jcx-ink-2)' }}>{c.detail || (c.configured ? 'configured' : 'not configured')}</div>
              </div>
              <button
                type="button"
                className={`fchip${c.enabled ? ' on' : ''}`}
                onClick={() => toggle(c)}
                disabled={busy === c.name}
                style={{ cursor: busy === c.name ? 'wait' : 'pointer', background: 'transparent' }}
              >
                {busy === c.name ? '…' : c.enabled ? 'Disable' : 'Enable'}
              </button>
              <span className={`pill ${p[0]}`}><span className="dot" />{p[1]}</span>
            </div>
          );
        })}
      </div>

      <div className="empty" style={{ marginTop: 12 }}>
        External connectors (github · email …) activate the moment their API keys exist on the brain — set them as Render env vars and this view flips green on its own.
      </div>
    </div>
  );
}
