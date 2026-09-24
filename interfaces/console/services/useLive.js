import { useCallback, useEffect, useState } from 'react';
import { brainGet, emitEvent } from './brain';

/* useLive(path, {pick}) — one hook behind every console view's REAL data.
   Fetches on mount, exposes honest loading / error / empty states and
   announces every load on the live event bus (which feeds <EventStream />).
   No view ships fake rows: if the brain returns nothing, the view says so. */
export default function useLive(path, { label = 'Data', pick, deps = [] } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const raw = await brainGet(path, 20000);
      const d = pick ? pick(raw) : raw;
      setData(d);
      emitEvent({ chip: 'NET', who: label, msg: `loaded ${path} · live`, tone: 'var(--jcx-up)' });
    } catch (e) {
      setError((e && e.message) || 'request failed');
      emitEvent({ chip: 'WARN', who: label, msg: `${path} failed · ${(e && e.message) || 'error'}`, tone: 'var(--jcx-down)' });
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, label, ...deps]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, error, reload: load };
}
