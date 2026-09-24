import { useEffect, useState } from 'react';

/**
 * Minimal header: route title + model status indicator + backend status dot.
 * Backend liveness is real: GET /api/health (Vite proxies to the brain on 3002).
 *
 * W10.2 (Phase 31 Scope 10): the model indicator now RESOLVES from the same
 * /api/health payload — when at least one keyed provider row reports
 * configured:true (a provider keyRef present on the boot host) it shows that
 * provider's model from the Scope 10 lock-in; when none is present it stays
 * honest: "model unresolved — configure a provider".
 *
 * Known asymmetry (disclosed): the legacy health snapshot's ENV_MAP covers
 * groq but not deepseek; a deepseek-only host resolves on the next snapshot
 * update (ProviderRouter.js is outside this scope's call sites).
 */
// Phase 31 Scope 10 lock-in — mirrors server/src/wiring/phase31-providers.js.
const PROFILE_MODELS = {
  groq: 'llama-4-scout',
  deepseek: 'deepseek-v4',
};
// Keyed legacy snapshot rows (keyless lanes — pollinations, ollama — never
// satisfy a keyRef-presence gate; pollinations is always configured:true).
const KEYED_SNAPSHOT_ROWS = new Set([
  'groq', 'deepseek', 'gemini', 'openrouter', 'huggingface', 'mistral', 'nvidia', 'cloudflare', 'vllm', 'unified',
]);
const UNRESOLVED = 'unresolved — configure a provider';

/** Pure derivation (exported for the scope probe): health payload -> indicator. */
export function resolveModelIndicator(providers = []) {
  const row = (providers || []).find((p) => p && p.configured && KEYED_SNAPSHOT_ROWS.has(p.key));
  if (!row) return { resolved: false, model: UNRESOLVED, provider: null };
  return { resolved: true, model: PROFILE_MODELS[row.key] || `configured (${row.key})`, provider: row.key };
}

export default function Header({ routeTitle, initialModel = null }) {
  const [backend, setBackend] = useState('checking'); // checking | online | offline
  const [model, setModel] = useState(initialModel); // resolved model label | null

  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    fetch('/api/health', { signal: ctrl.signal })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!alive) return;
        setBackend(ok ? 'online' : 'offline');
        setModel(resolveModelIndicator(data && data.providers).model);
      })
      .catch(() => { if (alive) setBackend('offline'); })
      .finally(() => { if (alive) clearTimeout(t); });
    return () => { alive = false; clearTimeout(t); ctrl.abort(); };
  }, []);

  const dotClass =
    backend === 'online' ? 'jx-dot is-online' : backend === 'offline' ? 'jx-dot is-offline' : 'jx-dot is-checking';

  return (
    <header className="jx-header">
      <h1 className="jx-route-title">{routeTitle}</h1>
      <div className="jx-header-status">
        <span className="jx-model" title="model status indicator (W10.2: resolves from /api/health provider keyRefs)">
          model <span className="jx-model-value">{model || UNRESOLVED}</span>
        </span>
        <span className={dotClass} aria-hidden="true"></span>
        <span className="jx-backend-label">
          backend {backend}
        </span>
      </div>
    </header>
  );
}
