import { useState, useCallback, useEffect, useRef } from 'react';
import { getBackendUrl, jexiFetch, onAccessKeyChange } from '../utils/helpers';

/**
 * useTasks — roadmap stage 8 frontend.
 * Background missions created via POST /api/tasks run server-side and stream
 * `task.*` NDJSON events over GET /api/tasks/:id/events. The stream replays the
 * full history on connect, so the UI rebuilds state purely from events; if the
 * stream cannot be established (or drops), a 2.5s poll of GET /api/tasks/:id
 * takes over — the task list itself is always refreshed on terminal events.
 */

const TERMINAL = new Set(['done', 'failed', 'cancelled', 'interrupted']);

/** Fold one task.* event into the detail snapshot. */
export function applyTaskEvent(prev, ev) {
  if (!prev) return prev;
  const next = { ...prev, events: [...(prev.events || []), ev] };
  switch (ev.type) {
    case 'task.plan':
      next.intent = ev.intent || next.intent;
      next.steps = ev.steps || next.steps;
      next.domainNames = ev.domainNames || next.domainNames;
      next.skillsLine = ev.skillsLine || next.skillsLine;
      break;
    case 'task.started':
      next.status = 'running';
      next.startedAt = ev.at || next.startedAt;
      break;
    case 'task.done':
      next.status = 'done';
      next.finishedAt = ev.at || next.finishedAt;
      next.summary = ev.summary || next.summary;
      next.statistics = ev.statistics || next.statistics;
      next.sources = ev.sources || next.sources;
      next.files = ev.files || next.files;
      break;
    case 'task.failed':
      next.status = 'failed';
      next.finishedAt = ev.at || next.finishedAt;
      next.error = ev.error || next.error;
      break;
    case 'task.cancelled':
      next.status = 'cancelled';
      next.finishedAt = ev.at || next.finishedAt;
      break;
    default:
      break;
  }
  return next;
}

export const useTasks = () => {
  const [tasks, setTasks] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [creating, setCreating] = useState(false);
  const [streamOpen, setStreamOpen] = useState(false);
  const abortRef = useRef(null);
  const pollRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/tasks`);
      if (!res.ok) return;
      const data = await res.json();
      setTasks(data.tasks || []);
    } catch (e) {
      // Offline / backend asleep — keep the list as-is; the next action retries.
    }
  }, []);

  const fetchDetail = useCallback(async (id, signal) => {
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/tasks/${id}`, { signal });
      if (!res.ok) return;
      const data = await res.json();
      if (data.task) setDetail(data.task);
    } catch (e) {
      // Ignore — the live stream or a later poll covers this.
    }
  }, []);

  const create = useCallback(async (query) => {
    if (!query || !String(query).trim() || creating) return null;
    setCreating(true);
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: String(query).trim() }),
      });
      if (!res.ok) throw new Error(`Backend replied HTTP ${res.status}`);
      const data = await res.json();
      if (data.task) {
        setSelectedId(data.task.id);
        setDetail({ ...data.task, events: [] });
      }
      await refresh();
      return data.task || null;
    } finally {
      setCreating(false);
    }
  }, [creating, refresh]);

  const cancel = useCallback(async (id) => {
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/tasks/${id}/cancel`, { method: 'POST' });
      if (!res.ok) return;
      const data = await res.json();
      if (data.task && selectedId === id) setDetail((prev) => (prev ? { ...prev, ...data.task } : data.task));
      await refresh();
    } catch (e) {
      // Ignore transient failures — the stream/poll will surface real state.
    }
  }, [refresh, selectedId]);

  const remove = useCallback(async (id) => {
    try {
      await jexiFetch(`${getBackendUrl()}/api/tasks/${id}`, { method: 'DELETE' });
      if (selectedId === id) {
        setSelectedId(null);
        setDetail(null);
      }
      await refresh();
    } catch (e) {
      // Ignore.
    }
  }, [refresh, selectedId]);

  const rerun = useCallback(async (id) => {
    setCreating(true);
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/tasks/${id}/rerun`, { method: 'POST' });
      if (!res.ok) return null;
      const data = await res.json();
      if (data.task) {
        setSelectedId(data.task.id);
        setDetail({ ...data.task, events: [] });
      }
      await refresh();
      return data.task || null;
    } finally {
      setCreating(false);
    }
  }, [refresh]);

  // B70 — when the backend is locked (JEXI_API_KEY) and the user pastes the
  // access key in Settings → System, requests that 401'd can now succeed:
  // refetch the list immediately instead of waiting for a manual retry.
  useEffect(() => onAccessKeyChange(() => refresh()), [refresh]);

  // Live subscription: connect to the task.* stream, rebuild detail from it,
  // and fall back to polling when the stream is unavailable or drops.
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setStreamOpen(false);
      return;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let stopped = false;

    const beginPolling = () => {
      if (stopped) return;
      setStreamOpen(false);
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const res = await jexiFetch(`${getBackendUrl()}/api/tasks/${selectedId}`, { signal: ctrl.signal });
          if (!res.ok) return;
          const data = await res.json();
          if (!data.task) return;
          setDetail(data.task);
          if (TERMINAL.has(data.task.status)) {
            clearInterval(pollRef.current);
            refresh();
          }
        } catch (e) {
          // Aborted or offline — stop polling on abort.
          if (e.name === 'AbortError') clearInterval(pollRef.current);
        }
      }, 2500);
    };

    (async () => {
      // 1. Snapshot first (fast paint for the header), then live-stream.
      try {
        const res = await jexiFetch(`${getBackendUrl()}/api/tasks/${selectedId}`, { signal: ctrl.signal });
        if (res.ok) {
          const data = await res.json();
          if (!stopped && data.task) setDetail(data.task);
        }
      } catch (e) {
        if (!stopped) setDetail({ id: selectedId, query: '', status: 'loading', events: [] });
      }
      if (stopped) return;

      // 2. Event stream (replays history, then live).
      try {
        const res = await jexiFetch(`${getBackendUrl()}/api/tasks/${selectedId}/events`, { signal: ctrl.signal });
        if (!res.ok || !res.body) {
          beginPolling();
          return;
        }
        setStreamOpen(true);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let first = true;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl;
          while ((nl = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 1);
            if (!line.trim()) continue;
            let ev;
            try { ev = JSON.parse(line); } catch (e) { continue; }
            if (ev.type === 'task.heartbeat') continue;
            if (first) {
              // The stream replays from the start — reset so nothing duplicates.
              setDetail((prev) => (prev && prev.id === selectedId ? { ...prev, events: [] } : prev));
              first = false;
            }
            setDetail((prev) => applyTaskEvent(prev, ev));
            if (ev.type === 'task.done' || ev.type === 'task.failed' || ev.type === 'task.cancelled') {
              refresh();
            }
          }
        }
        setStreamOpen(false);
        // Terminal or dropped connection — pull the exact final record.
        await fetchDetail(selectedId, ctrl.signal);
        refresh();
      } catch (e) {
        if (e.name === 'AbortError') return;
        setStreamOpen(false);
        beginPolling();
      }
    })();

    return () => {
      stopped = true;
      abortRef.current = null;
      ctrl.abort();
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [selectedId, refresh, fetchDetail]);

  return {
    tasks,
    detail,
    selectedId,
    creating,
    streamOpen,
    select: setSelectedId,
    refresh,
    create,
    cancel,
    remove,
    rerun,
  };
};
