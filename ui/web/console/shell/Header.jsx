import { useEffect, useState } from 'react';

/**
 * Minimal header: route title + model status indicator + backend status dot.
 * Backend liveness is real: GET /api/health (Vite proxies to the brain on 3002).
 * No provider configured yet (Scope C owns that) -> model indicator says so.
 */
export default function Header({ routeTitle }) {
  const [backend, setBackend] = useState('checking'); // checking | online | offline

  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    fetch('/api/health', { signal: ctrl.signal })
      .then((r) => { if (alive) setBackend(r.ok ? 'online' : 'offline'); })
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
        <span className="jx-model" title="model status indicator (Scope C wires providers)">
          model <span className="jx-model-value">unconfigured</span>
        </span>
        <span className={dotClass} aria-hidden="true"></span>
        <span className="jx-backend-label">
          backend {backend}
        </span>
      </div>
    </header>
  );
}
