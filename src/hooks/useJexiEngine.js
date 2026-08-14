import { useState, useCallback, useRef, useEffect } from 'react';
import { getBackendUrl, jexiFetch, backendErrorMessage, delay } from '../utils/helpers';

// A live agent loop streams events continuously. If the stream stays silent
// this long (app backgrounded / proxy drop / host restart) the read is stuck
// — abort so the UI can say so instead of spinning forever.
const STREAM_STALE_MS = 60000;

// Backend defaults to same origin (/api is proxied by Vite in dev),
// VITE_JEXI_BACKEND_URL for hosted frontends (Vercel), or a localStorage override.

/**
 * Consume the NDJSON stream from /api/chat and turn every event into UI state.
 *
 * NDJSON lines can arrive SPLIT across network chunks (a full build report is
 * one big line — tens of KB — and almost always crosses a chunk boundary).
 * Naively splitting each chunk on '\n' silently drops those events, which is
 * exactly why JEXI finished a task in the logs while the chat showed no answer.
 * Buffer partial lines until the newline arrives.
 */
async function consumeStream(res, setMessages, setLogs, setWebsites, setPlan, { onEvent, onStale, onDrop, onRecoverable } = {}) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // Whether a completion event arrived. If the stream just ends (proxy drop,
  // host restart mid-task), the user must never be left hanging with no reply.
  let sawDone = false;
  let lastSeen = Date.now();
  // Watchdog: while the task runs, the server streams logs continuously. If the
  // stream goes silent (app backgrounded and the WebView suspended the socket,
  // proxy drop, host restart) the read can hang forever — abort after a
  // generous silence window so the UI recovers instead of spinning.
  const watchdog = setInterval(() => {
    if (Date.now() - lastSeen > STREAM_STALE_MS) onStale?.();
  }, 8000);

  const handleLine = (line) => {
    if (!line) return;
    let data;
    try {
      data = JSON.parse(line);
    } catch (e) {
      // A corrupted event must never silently eat JEXI's answer — log it
      // and keep listening (later events may still be valid).
      console.error('[JEXI stream] unparseable event:', String(line).slice(0, 300));
      return;
    }
    if (data.type) { lastSeen = Date.now(); onEvent?.(); }
    if (data.type === 'log') setLogs(prev => [...prev, { agent: data.agent, message: data.message }]);
    else if (data.type === 'website') setWebsites(prev => [...prev, data.site]);
    else if (data.type === 'plan') setPlan(prev => ({ ...prev, ...data }));
    // Build 47 — intelligence metadata (classification, task id, confidence).
    else if (data.type === 'intel') setPlan(prev => ({ ...prev, intel: data }));
    else if (data.type === 'done') {
      sawDone = true;
      if (data.success) {
        // ALWAYS show an answer on success — never a silent drop. Even if
        // the backend returns no summary, the user must see the outcome
        // (this is the root of "she finished in the logs but never answered").
        const summary = (data.summary && String(data.summary).trim())
          ? data.summary
          : '✅ Task completed — the team finished, but returned no readable summary. Check the activity log above to see what ran.';
        const stats = data.statistics || {};
        const bits = [];
        if (stats.agentsUsed) bits.push(`${stats.agentsUsed} agents`);
        if (stats.executionTime) bits.push(`${(stats.executionTime / 1000).toFixed(1)}s`);
        if (typeof stats.confidence === 'number') bits.push(`${Math.round(stats.confidence)}% confidence`);
        if (data.files?.length) bits.push(`${data.files.length} files`);
        if (data.sources?.length) bits.push(`${data.sources.length} sources`);
        const footer = bits.length ? `\n\n---\n⚙️ ${bits.join(' · ')}` : '';
        setMessages(prev => [...prev, { role: 'jexi', text: summary + footer, sources: data.sources, files: data.files }]);
      } else if (data.recoverable) {
        // Build 48, P5 — the 15-min safety deadline fired, but the server-side
        // mission is STILL running and will persist its real outcome. Show the
        // interim notice, then keep polling automatically for the real result.
        const why = data.error || 'the task hit an unexpected error';
        setMessages(prev => [...prev, {
          role: 'jexi',
          text: `⏱ ${why}\n\nI'm still running it server-side — the result will appear here automatically when it finishes.`,
        }]);
        onRecoverable?.();
      } else {
        // Honest, actionable failure — never a confusing "is the backend
        // running?" (the backend is online; the TASK failed mid-flight).
        const why = data.error || 'the task hit an unexpected error';
        setMessages(prev => [...prev, { role: 'jexi', text: `⚠ ${why}\n\nThe server is online — tap STOP and try again, or ask me to continue from where it stopped.` }]);
      }
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // { stream: true } keeps multi-byte UTF-8 (emoji!) intact across chunks
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        handleLine(line);
      }
    }
    // Flush anything left (final newline might be missing) + decoder tail bytes
    buffer += decoder.decode();
    handleLine(buffer);

    // Stream ended without a completion event — the connection dropped
    // mid-task (host restart, proxy timeout). Build 48, P5: recovery is
    // AUTOMATIC — poll the server-side result store until the mission's real
    // outcome lands (the Express handler keeps running after the client
    // disconnects). The user is never told to manually "continue".
    if (!sawDone) {
      if (onDrop) await onDrop();
      else {
        setMessages(prev => [...prev, {
          role: 'jexi',
          text: '⚠ The connection dropped before JEXI finished — the task may still be running on the server. Wait a moment, then ask me to continue from where it stopped.',
        }]);
      }
    }
  } finally {
    clearInterval(watchdog);
  }
}

export const useJexiEngine = () => {
  const [messages, setMessages] = useState([]);
  const [logs, setLogs] = useState([]);
  const [websites, setWebsites] = useState([]);
  const [plan, setPlan] = useState(null); // { intent, steps, roster, skillsLine } from the /api/chat plan event
  const [isProcessing, setIsProcessing] = useState(false);
  const abortRef = useRef(null);
  const watchdogFiredRef = useRef(false);
  const recoverRef = useRef(null); // AbortController for the auto-recovery poll

  // Return from background / tab switch: nudge a repaint so a stuck surface
  // redraws, and give a silent-but-alive stream a fresh window to speak.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        window.dispatchEvent(new Event('resize'));
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);

  /**
   * Build 48, P5 — AUTOMATIC recovery after a dropped stream.
   * The server-side mission keeps running after the client disconnects and
   * persists its real outcome to the per-session result store. Poll
   * /api/chat/result (same x-jexi-session) until it appears, then surface the
   * finished answer — no "ask me to continue" step required from the user.
   */
  const recoverResult = useCallback(async () => {
    const backendUrl = getBackendUrl();
    const ctrl = new AbortController();
    recoverRef.current = ctrl;
    const deadlineMs = Date.now() + 180000; // up to 3 minutes of recovery
    let found = false;
    try {
      while (!ctrl.signal.aborted && Date.now() < deadlineMs) {
        await delay(4000);
        if (ctrl.signal.aborted) break;
        try {
          const res = await jexiFetch(`${backendUrl}/api/chat/result`, { signal: ctrl.signal });
          if (!res.ok) continue;
          const { result } = await res.json();
          if (result && ((result.summary && String(result.summary).trim()) || result.error)) {
            found = true;
            const summary = (result.summary && String(result.summary).trim())
              ? result.summary
              : `⚠ ${result.error || 'the task hit an unexpected error'}`;
            setMessages(prev => [...prev, {
              role: 'jexi',
              text: summary,
              sources: result.sources,
              files: result.files,
            }]);
            break;
          }
        } catch (e) {
          if (ctrl.signal.aborted) break;
          // transient network blip — keep polling
        }
      }
    } finally {
      recoverRef.current = null;
    }
    // Never leave the user hanging — honest fallback after the recovery window.
    if (!found && !ctrl.signal.aborted) {
      setMessages(prev => [...prev, {
        role: 'jexi',
        text: '⚠ The connection dropped mid-task and the result did not return within the recovery window. The task may still be running server-side — tap STOP and retry, or say \"continue\" and I will pick it up from where it stopped.',
      }]);
    }
  }, [setMessages]);

  // The free Render instance hibernates after ~15 min idle and needs up to a
  // minute to cold-start — the FIRST request after a break can stall or drop.
  // Instead of surfacing a scary "connection failed", retry once: the warm-up
  // request wakes the server, and the retry sails through.
  const wakeUp = useCallback(async () => {
    try {
      const backendUrl = getBackendUrl();
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      try {
        await jexiFetch(`${backendUrl}/api/health`, { signal: ctrl.signal });
      } finally {
        clearTimeout(t);
      }
    } catch (e) {
      // Server still asleep — ignore, the retry below will trigger the start.
    }
  }, []);

  const runSearch = useCallback(async (query, image = null) => {
    // Halt any previous run AND any pending recovery before starting a new one.
    abortRef.current?.abort();
    recoverRef.current?.abort();
    recoverRef.current = null;

    setIsProcessing(true);
    setLogs([]);
    setWebsites([]);
    setPlan(null);
    const userMsg = { role: 'user', text: query, image };
    setMessages(prev => [...prev, userMsg]);
    const onEvent = () => { watchdogFiredRef.current = false; };
    const onStale = () => { watchdogFiredRef.current = true; abortRef.current?.abort(); };
    // Dropped stream / interim deadline notice → auto-poll for the real result.
    const onDrop = async () => { await recoverResult(); };
    const onRecoverable = () => { setTimeout(() => { recoverResult(); }, 1500); };

    try {
      const backendUrl = getBackendUrl();
      abortRef.current = new AbortController();
      const res = await jexiFetch(`${backendUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, image: image || undefined }),
        signal: abortRef.current.signal,
      });
      if (!res.ok && res.status >= 500) {
        // Likely a cold start / host restart mid-request. Tell the user what's
        // happening, wake the brain, and retry once — no scary failure.
        setMessages(prev => [...prev, {
          role: 'jexi',
          text: '🔄 Waking JEXI\u2019s brain — the free server was sleeping and the first call got dropped. Waking it up and retrying…',
        }]);
        await wakeUp();
        abortRef.current = new AbortController();
        const retry = await jexiFetch(`${backendUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, image: image || undefined }),
          signal: abortRef.current.signal,
        });
        if (!retry.ok) throw new Error(`Backend replied HTTP ${retry.status}`);
        await consumeStream(retry, setMessages, setLogs, setWebsites, setPlan, { onEvent, onStale, onDrop, onRecoverable });
        return;
      }
      if (!res.ok) throw new Error(`Backend replied HTTP ${res.status}`);
      await consumeStream(res, setMessages, setLogs, setWebsites, setPlan, { onEvent, onStale, onDrop, onRecoverable });
    } catch (error) {
      // Aborted by the user (STOP) — don't show a scary network error.
      if (error?.name === 'AbortError') {
        // Watchdog abort: the stream went silent (backgrounded too long / drop)
        // — the server task kept running. Build 48, P5: recover AUTOMATICALLY
        // by polling the persisted result; never ask the user to continue.
        if (watchdogFiredRef.current) {
          watchdogFiredRef.current = false;
          await recoverResult();
        }
        return;
      }
      // Diagnose the failure so the user sees the FIX, not a mystery: 401
      // (locked server, no access key) and CORS/unreachable get targeted
      // guidance; anything else stays honest about the drop.
      setMessages(prev => [...prev, {
        role: 'jexi',
        text: backendErrorMessage(error, backendUrl),
      }]);
    } finally {
      abortRef.current = null;
      watchdogFiredRef.current = false;
      setIsProcessing(false);
    }
  }, [wakeUp, recoverResult]);

  const stopGeneration = useCallback(() => {
    const wasRunning = abortRef.current != null;
    abortRef.current?.abort();
    abortRef.current = null;
    // Also stop any in-flight recovery poll.
    recoverRef.current?.abort();
    recoverRef.current = null;
    setIsProcessing(false);
    if (!wasRunning) return; // nothing was running — don't inject a phantom message
    // An agent never leaves you hanging — acknowledge the halt and propose the next move.
    setMessages(prev => [...prev, { role: 'jexi', text: '⏹ Stopped mid-task. Tell me what to do next and I\'ll take it from there.' }]);
  }, []);

  // Append an assistant or user message directly (used by the camera vision panel).
  const pushMessage = useCallback((role, text) => {
    if (!text) return;
    setMessages(prev => [...prev, { role, text }]);
  }, []);

  return { messages, logs, websites, plan, isProcessing, runSearch, stopGeneration, pushMessage };
};
