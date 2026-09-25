import { useEffect, useState } from 'react';
import { Check, CircleX, Loader2, PlugZap, Save } from 'lucide-react';

/**
 * Premium Provider section (ui-rebuild-premium). Wired to the REAL unified
 * model-config API — no static catalogs, no fake saves:
 *
 *   GET  /api/providers/catalog   -> 17 providers (openai…ollama, openrouter,
 *                                    custom — OpenAI-compatible base URL)
 *   GET  /api/providers/active    -> masked active config (key never leaves
 *                                    the server; responses carry hasKey + last4)
 *   POST /api/providers/configure -> save (+ optional live probe). Key is
 *                                    sticky server-side: omitting apiKey keeps
 *                                    the stored one. probe:true SAVES ONLY when
 *                                    the live probe passes (server contract —
 *                                    disclosed in the UI).
 *
 * "custom" exposes Base URL / API Key / Model Name inputs per spec. Model
 * dropdown populates from the chosen provider's modelHints (custom: free-text).
 */
export default function ProviderSection({ /* settings unused — real API is the source of truth */ }) {
  const [catalog, setCatalog] = useState(null);
  const [catalogError, setCatalogError] = useState(null);
  const [active, setActive] = useState(null);

  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');

  const [busy, setBusy] = useState(null); // 'save' | 'test'
  const [result, setResult] = useState(null); // { ok, message, detail? }

  async function loadActive() {
    try {
      const r = await fetch('/api/providers/active');
      const j = await r.json();
      const a = (j && j.active) || {};
      setActive(a);
      if (a.configured) {
        setProvider(a.provider || '');
        setModel(a.model || '');
        setBaseUrl(a.baseUrl || '');
      }
    } catch { setActive(null); }
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/providers/catalog');
        const j = await r.json();
        if (!alive) return;
        const list = (j && j.providers) || [];
        setCatalog(list);
        setProvider((prev) => prev || (list[0] ? list[0].id : ''));
      } catch (e) {
        if (alive) setCatalogError(String((e && e.message) || e));
      }
    })();
    void loadActive();
    return () => { alive = false; };
  }, []);

  const def = catalog ? catalog.find((p) => p.id === provider) : null;
  const isCustom = provider === 'custom';
  const models = def ? def.modelHints : [];
  const needsKey = def ? def.needsKey : true;
  const effectiveBaseUrl = baseUrl || (def ? def.defaultBaseUrl : '');

  function pickProvider(id) {
    setProvider(id);
    setModel('');
    setApiKey('');
    setResult(null);
    const d = catalog ? catalog.find((p) => p.id === id) : null;
    setBaseUrl(d && d.defaultBaseUrl ? d.defaultBaseUrl : '');
  }

  async function configure(probe) {
    setBusy(probe ? 'test' : 'save');
    setResult(null);
    try {
      const body = {
        provider,
        model: model || undefined,
        baseUrl: effectiveBaseUrl || undefined,
        probe,
      };
      if (apiKey.trim()) body.apiKey = apiKey.trim();
      const r = await fetch('/api/providers/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) {
        setResult({
          ok: true,
          message: probe
            ? 'connection ok — config saved (probe passed)'
            : 'config saved (not probed)',
          detail: j.probe && j.probe.detail ? String(j.probe.detail).slice(0, 300) : '',
        });
        setApiKey('');
        await loadActive();
      } else {
        const errors = Array.isArray(j.errors) ? j.errors : [];
        setResult({
          ok: false,
          message: j.error || (errors.length ? errors.join(' · ') : `HTTP ${r.status}`),
          detail: j.hint ? String(j.hint).slice(0, 300) : '',
        });
      }
    } catch (e) {
      setResult({ ok: false, message: String((e && e.message) || e), detail: '' });
    } finally {
      setBusy(null);
    }
  }

  if (catalogError) {
    return (
      <section className="jx-section">
        <h2 className="jx-section-title">Provider</h2>
        <div className="jx-errorbox">
          <span className="jx-errorbox-title"><CircleX size={15} aria-hidden="true" /> provider catalog unreachable</span>
          <span>GET /api/providers/catalog failed — {catalogError}. Start the brain (npm run dev:full) and retry.</span>
        </div>
      </section>
    );
  }

  return (
    <section className="jx-section">
      <h2 className="jx-section-title">Provider</h2>

      <div className="jx-srow">
        <div className="jx-srow-label">
          <div className="jx-srow-name">Provider</div>
          <div className="jx-srow-sub">
            {def ? def.blurb : 'live catalog from /api/providers/catalog'}
            {def && def.docsUrl ? <> · <a href={def.docsUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--jx-accent)' }}>get a key</a></> : null}
          </div>
        </div>
        <div className="jx-srow-control">
          <select
            className="jx-select"
            value={provider}
            onChange={(e) => pickProvider(e.target.value)}
            aria-label="Provider"
          >
            {(catalog || [{ id: '', label: 'loading…' }]).map((p) => (
              <option key={p.id} value={p.id}>{p.label || p.id}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="jx-srow">
        <div className="jx-srow-label">
          <div className="jx-srow-name">Model</div>
          <div className="jx-srow-sub">{isCustom ? 'model name served by your endpoint' : 'models advertised by the provider catalog'}</div>
        </div>
        <div className="jx-srow-control">
          {isCustom || models.length === 0 ? (
            <input
              className="jx-input"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="e.g. my-model@2026-01"
              aria-label="Model name"
            />
          ) : (
            <select
              className="jx-select"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              aria-label="Model"
            >
              <option value="" disabled>choose a model…</option>
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
        </div>
      </div>

      <div className="jx-srow">
        <div className="jx-srow-label">
          <div className="jx-srow-name">Base URL</div>
          <div className="jx-srow-sub">{isCustom ? 'required — any OpenAI-compatible endpoint' : 'defaults to the provider endpoint; override for gateways/proxies'}</div>
        </div>
        <div className="jx-srow-control jx-srow-control-wide">
          <input
            className="jx-input"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={(def && def.defaultBaseUrl) || 'https://your-endpoint.example.com/v1'}
            aria-label="Base URL"
            spellCheck="false"
          />
        </div>
      </div>

      <div className="jx-srow">
        <div className="jx-srow-label">
          <div className="jx-srow-name">API key</div>
          <div className="jx-srow-sub">
            {active && active.hasKey
              ? <>saved key …{active.keyLast4 || '••••'} — leave empty to keep it</>
              : 'stored server-side in settings; responses only ever show the last 4 chars'}
          </div>
        </div>
        <div className="jx-srow-control jx-srow-control-wide">
          <input
            className="jx-input"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={needsKey ? (active && active.hasKey ? 'unchanged' : 'paste API key') : 'optional for this provider'}
            aria-label="API key"
            autoComplete="off"
          />
        </div>
      </div>

      <div className="jx-save-row">
        <button className="jx-btn jx-btn-primary" onClick={() => configure(false)} disabled={!!busy || !provider}>
          {busy === 'save' ? <Loader2 size={14} className="jx-spin" aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}
          Save
        </button>
        <button className="jx-btn" onClick={() => configure(true)} disabled={!!busy || !provider}>
          {busy === 'test' ? <Loader2 size={14} className="jx-spin" aria-hidden="true" /> : <PlugZap size={14} aria-hidden="true" />}
          Test connection
        </button>
        {busy && <span className="jx-status-inline is-busy">contacting brain…</span>}
        {!busy && result && result.ok && (
          <span className="jx-status-inline is-ok"><Check size={14} aria-hidden="true" /> {result.message}</span>
        )}
        {!busy && result && !result.ok && (
          <span className="jx-status-inline is-fail"><CircleX size={14} aria-hidden="true" /> {result.message}</span>
        )}
      </div>
      {result && result.detail ? (
        <div className={'jx-hintbox ' + (result.ok ? 'is-ok' : 'is-error')}>{result.detail}</div>
      ) : null}
      <div className="jx-hintbox" style={{ borderStyle: 'dashed' }}>
        Test connection performs a LIVE probe of the configured provider. When the
        probe passes the config is saved (server contract); when it fails nothing is
        written. The raw key is never logged and never returned by the API.
      </div>
    </section>
  );
}
