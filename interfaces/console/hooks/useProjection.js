/**
 * B140 — USE PROJECTION (dsh client/runtime session-projection wire cell
 * mirror, JEXI-branded).
 *
 * React hook: fetch a conversation's bounded projection (char-budgeted,
 * newest-first view) from the server with a TTL cache. Returns
 * { projection, loading, error, refresh }.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { ProjectionStore } from '../utils/jexiRuntime.js';

const store = new ProjectionStore();

export function useProjection(convId, { maxChars = 6000, enabled = true } = {}) {
  const [projection, setProjection] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const convRef = useRef(convId);

  const refresh = useCallback(async () => {
    if (!enabled || !convId) return;
    setLoading(true);
    setError(null);
    try {
      const p = await store.get(convId, { maxChars, force: true });
      if (p.ok) setProjection(p);
      else setError(p.error || 'projection failed');
    } catch (e) {
      setError((e && e.message) || 'projection failed');
    } finally {
      setLoading(false);
    }
  }, [convId, maxChars, enabled]);

  useEffect(() => {
    convRef.current = convId;
    if (!enabled || !convId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const p = await store.get(convId, { maxChars });
      if (cancelled) return;
      if (p.ok) setProjection(p);
      else setError(p.error || 'projection failed');
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [convId, maxChars, enabled]);

  return { projection, loading, error, refresh, invalidate: () => store.invalidate(convId) };
}
