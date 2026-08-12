import { useState, useCallback, useEffect } from 'react';
import { getBackendUrl, jexiFetch } from '../utils/helpers';

/**
 * useSchedules — roadmap stage 23 recurring missions.
 * Schedules live server-side (TaskScheduler); each due run launches a real
 * background mission visible in the Tasks list. The list is refreshed every
 * 10s (and after every action) so run counts, last status, and next-run
 * countdowns stay live without a dedicated stream.
 */

const POLL_MS = 10000;

export const useSchedules = () => {
  const [schedules, setSchedules] = useState([]);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/schedules`);
      if (!res.ok) return;
      const data = await res.json();
      setSchedules(data.schedules || []);
    } catch (e) {
      // Offline / backend asleep — keep the list; the next poll retries.
    }
  }, []);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, POLL_MS);
    return () => clearInterval(iv);
  }, [refresh]);

  const create = useCallback(async ({ query, everySeconds, label }) => {
    if (!query || !String(query).trim() || creating) return { error: 'Enter a mission to schedule.' };
    setCreating(true);
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/schedules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: String(query).trim(), everySeconds, label }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) return { error: data.error || `Backend replied HTTP ${res.status}` };
      await refresh();
      return { schedule: data.schedule };
    } catch (e) {
      return { error: (e && e.message) || 'Could not reach the backend.' };
    } finally {
      setCreating(false);
    }
  }, [creating, refresh]);

  const act = useCallback(async (id, action) => {
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/schedules/${id}/${action}`, { method: 'POST' });
      if (!res.ok) return false;
      const data = await res.json();
      if (data.success) await refresh();
      return !!data.success;
    } catch (e) {
      return false;
    }
  }, [refresh]);

  const pause = useCallback((id) => act(id, 'pause'), [act]);
  const resume = useCallback((id) => act(id, 'resume'), [act]);
  const runNow = useCallback((id) => act(id, 'run-now'), [act]);

  const remove = useCallback(async (id) => {
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/schedules/${id}`, { method: 'DELETE' });
      if (!res.ok) return false;
      const data = await res.json();
      if (data.success) await refresh();
      return !!data.success;
    } catch (e) {
      return false;
    }
  }, [refresh]);

  return { schedules, creating, refresh, create, pause, resume, runNow, remove };
};
