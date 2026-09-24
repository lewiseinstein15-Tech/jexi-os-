/**
 * B142 — USE PLUGIN INVENTORY (dsh ui-settings-plugin-inventory mirror,
 * JEXI-branded).
 *
 * React hook: fetch /api/plugins/inventory with a TTL cache and expose
 * { inventory, loading, error, refresh }.
 */
import { useEffect, useState, useCallback } from 'react';
import { gatewayFetch } from '../utils/gatewayClient.js';

const cache = { at: 0, data: null };
const TTL = 15000;

export function usePluginInventory({ enabled = true } = {}) {
  const [inventory, setInventory] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const res = await gatewayFetch('/api/plugins/inventory', { timeoutMs: 10000, retries: 1 });
      if (res.ok && res.data) {
        setInventory(res.data);
        cache.at = Date.now();
        cache.data = res.data;
      } else {
        setError((res.data && res.data.error) || `inventory ${res.status}`);
      }
    } catch (e) {
      setError((e && e.message) || 'inventory fetch failed');
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    if (cache.data && Date.now() - cache.at < TTL) {
      setInventory(cache.data);
      return;
    }
    refresh();
  }, [enabled, refresh]);

  return { inventory, loading, error, refresh };
}
