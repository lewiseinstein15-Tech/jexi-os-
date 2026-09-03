import { useState, useCallback, useRef, useEffect } from 'react';
import { getBackendUrl, jexiFetch, backendErrorMessage, delay, getSessionId, setSessionId } from '../utils/helpers';
import { sanitizeText } from '../utils/agentStream.js'; // B206 — hardened log ingestion

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
/**
 * B208 — TEAM STATE REDUCER: canonical Director events → the live team strip.
 * JEXI is the boss (first card); employees appear as they are staffed and
 * their status follows REAL events only (assigned → working → delivered /
 * verifying → verified / recovering). Nothing is animated for show: every
 * state change here corresponds to something that actually executed.
 */
const TEAM_STATUS = {
  selected: 'standby', assigned: 'ready', working: 'working', delivered: 'done',
  verifying: 'verifying', verified: 'verified', recovering: 'recovering',
};

function reduceTeam(prev, evt) {
  const safe = (v, n) => { try { return sanitizeText(v, n); } catch { return String(v || '').slice(0, n); } };
  // a brand-new objective resets the strip (fresh turn)
  if (String(evt.type) === 'OBJECTIVE_RECEIVED') {
    return { active: true, taskId: evt.taskId || null, state: evt.state || '', objective: '', employees: [], byId: {} };
  }
  const t = prev ? { ...prev, byId: { ...prev.byId } } : { active: true, taskId: null, state: '', objective: '', employees: [], byId: {} };
  if (evt.taskId) t.taskId = evt.taskId;
  if (evt.state) t.state = evt.state;
  const touch = (patch) => {
    const id = evt.agentId;
    if (!id || id === 'jexi') return; // the boss is rendered separately
    const cur = t.byId[id] || { agentId: id, name: safe(evt.agentName, 24) || id, status: 'standby', currentTask: '', provider: '' };
    t.byId[id] = { ...cur, ...patch };
  };
  switch (String(evt.type)) {
    case 'OBJECTIVE_INTERPRETED': t.objective = safe(evt.title || evt.summary, 120); break;
    case 'EMPLOYEE_SELECTED': touch({ status: 'selected', name: safe(evt.agentName, 24) }); break;
    case 'TASK_ASSIGNED': touch({ status: 'assigned' }); break;
    case 'TASK_STARTED': touch({ status: 'working', currentTask: safe(evt.summary, 110) }); break;
    case 'TASK_COMPLETED': touch({ status: evt.agentId === 'jexi' ? t.employees.length ? 'done' : 'done' : 'delivered' }); break;
    case 'MODEL_SELECTED': case 'MODEL_SWITCHED': touch({ provider: safe(evt.data?.providerLabel, 18) }); break;
    case 'RECOVERY_STARTED': case 'ERROR_DETECTED': touch({ status: 'recovering' }); break;
    // B209 — live supervision: the boss stopped a bad approach mid-stream
    case 'SUPERVISION_REDIRECT': touch({ status: 'correcting', currentTask: safe(evt.summary, 110) }); break;
    case 'TASK_BLOCKED': t.state = 'blocked'; break;
    // B210 — real command execution by employees
    case 'COMMAND_STARTED': case 'TEST_STARTED': touch({ status: 'executing', currentTask: safe(evt.summary, 110) }); break;
    case 'COMMAND_COMPLETED': case 'COMMAND_FAILED': case 'TEST_COMPLETED': case 'TEST_FAILED': touch({ status: 'working', currentTask: safe(evt.summary, 110) }); break;
    case 'VERIFICATION_STARTED': touch({ status: 'verifying' }); break;
    case 'VERIFICATION_PASSED': touch({ status: 'verified' }); break;
    case 'VERIFICATION_FAILED': touch({ status: 'verifying' }); break;
    case 'TASK_FAILED': t.active = false; break;
    default: break;
  }
  t.employees = Object.values(t.byId);
  return t;
}

async function consumeStream(res, setMessages, setLogs, setWebsites, setPlan, { onEvent, onStale, onDrop, onRecoverable, setQuestions, setPlanReview, setTeam } = {}) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // Whether a completion event arrived. If the stream just ends (proxy drop,
  // host restart mid-task), the user must never be left hanging with no reply.
  let sawDone = false;
  let thinkT0 = null; // B173 — reasoning-channel bookkeeping (dsh ReasoningRow)
  let thinkMs = null;
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
    // B162b — 'agent.log' events (the named coworker join/writing lines)
    // were silently DROPPED by the UI: only 'log' was consumed. Both feed
    // the live step feed now.
    // B205 — ARENA-STYLE TRACE: the row is ALSO attached to the streaming
    // assistant message, so the unified thinking panel carries the whole
    // story per-message (not just in the global side feed). The first log
    // creates the streaming message — the panel appears instantly.
    if (data.type === 'log' || data.type === 'agent.log') {
      // B206 — HARDENED INGESTION: server log payloads are live data; a
      // structured/odd message must be coerced to a string HERE (objects as
      // React children throw), control chars/ANSI stripped, and the stored
      // array capped so a marathon task cannot grow state unbounded.
      const entry = {
        agent: sanitizeText(data.agent, 40).trim() || 'JEXI',
        message: sanitizeText(data.message, 240),
      };
      setLogs(prev => [...prev, entry].slice(-400));
      setMessages(prev => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === 'jexi' && last.streaming) {
          next[next.length - 1] = { ...last, activity: [...(last.activity || []), entry].slice(-400) };
        } else {
          next.push({ role: 'jexi', text: '', streaming: true, t0: Date.now(), activity: [entry] });
        }
        return next;
      });
    }
    // B200 — ARENA-STYLE NARRATION: JEXI's own first-person words about what
    // she is doing, live. They attach to the streaming assistant message and
    // render above the answer (NarrationFeed) — the running commentary the
    // whole task long, not just a final dump.
    else if (data.type === 'narration') {
      const text = String(data.text || '');
      if (text) {
        setMessages(prev => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === 'jexi' && last.streaming) {
            next[next.length - 1] = { ...last, narrations: [...(last.narrations || []), text] };
          } else {
            next.push({ role: 'jexi', text: '', streaming: true, t0: Date.now(), narrations: [text] });
          }
          return next;
        });
      }
    }
    else if (data.type === 'think') {
      // B173 — reasoning deltas build the Think row on the streaming message
      const delta = String(data.text || '');
      if (delta) {
        if (thinkT0 === null) thinkT0 = Date.now();
        setMessages(prev => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === 'jexi' && last.streaming) {
            next[next.length - 1] = { ...last, thinking: (last.thinking || '') + delta, by: last.by || data.by };
          } else {
            next.push({ role: 'jexi', text: '', thinking: delta, streaming: true, t0: Date.now(), thinkT0: Date.now(), ...(data.by ? { by: data.by } : {}) });
          }
          return next;
        });
      }
    }
    else if (data.type === 'stream') {
      // B150 — live answer typing: append deltas to the current JEXI message
      // (the answer appears as it is generated — no more blank wait).
      const delta = String(data.text || '');
      if (delta) {
        setMessages(prev => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === 'jexi' && last.streaming) {
            // B173 — the first answer token ends the Think row's live phase
            if (thinkT0 !== null && thinkMs === null) thinkMs = Date.now() - thinkT0;
            next[next.length - 1] = { ...last, text: last.text + delta, by: last.by || data.by, ...(thinkMs !== null && last.thinkMs === undefined ? { thinkMs } : {}) };
          } else {
            next.push({ role: 'jexi', text: delta, streaming: true, ...(data.by ? { by: data.by } : {}) });
          }
          return next;
        });
      }
    }
    else if (data.type === 'website') {
      setWebsites(prev => [...prev, data.site]);
      // B205 — per-message source count for the thinking panel's chips
      setMessages(prev => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === 'jexi' && last.streaming) {
          next[next.length - 1] = { ...last, sourceCount: (last.sourceCount || 0) + 1 };
        }
        return next;
      });
    }
    else if (data.type === 'plan') setPlan(prev => ({ ...prev, ...data }));
    // B208 — canonical team events drive the live team strip
    else if (data.type === 'team' && setTeam && data.event) {
      try { setTeam(prev => reduceTeam(prev, data.event)); } catch (e) { /* team strip never breaks the stream */ }
    }
    // Build 47 — intelligence metadata (classification, task id, confidence).
    else if (data.type === 'intel') setPlan(prev => ({ ...prev, intel: data }));
    else if (data.type === 'ask.user') setQuestions?.(data);
    else if (data.type === 'plan.review') setPlanReview?.(data);
    else if (data.type === 'done') {
      sawDone = true;
      if (setTeam) { try { setTeam(prev => (prev ? { ...prev, active: false } : prev)); } catch (e) { /* never break */ } }
      if (data.success) {
        // ALWAYS show an answer on success — never a silent drop. Even if
        // the backend returns no summary, the user must see the outcome
        // (this is the root of "she finished in the logs but never answered").
        // B157 — the summary is finalized INSIDE setMessages so the already-
        // streamed text can be kept: if the server's summary is empty but the
        // answer streamed live, the streamed content IS the answer — it must
        // never be swapped for a "no readable summary" notice.
        const stats = data.statistics || {};
        const bits = [];
        if (stats.agentsUsed) bits.push(`${stats.agentsUsed} agents`);
        if (stats.executionTime) bits.push(`${(stats.executionTime / 1000).toFixed(1)}s`);
        if (typeof stats.confidence === 'number') bits.push(`${Math.round(stats.confidence)}% confidence`);
        if (data.files?.length) bits.push(`${data.files.length} files`);
        if (data.sources?.length) bits.push(`${data.sources.length} sources`);
        const footer = bits.length ? `\n\n---\n⚙️ ${bits.join(' · ')}` : '';
        setMessages(prev => {
          const next = [...prev];
          const idx = next.findIndex((m) => m.role === 'jexi' && m.streaming);
          const streamed = idx >= 0 ? String(next[idx].text || '') : '';
          const summary = (data.summary && String(data.summary).trim())
            ? data.summary
            : (streamed.trim()
              ? streamed
              : '✅ Task completed — the team finished, but returned no readable summary. Check the activity log above to see what ran.');
          const cur = next[idx];
          const finalMsg = {
            role: 'jexi', text: summary + footer, sources: data.sources, files: data.files,
            // B173 — the Think row survives the turn (tap to review reasoning)
            ...(cur && cur.thinking ? { thinking: cur.thinking } : {}),
            ...(cur && cur.thinkMs !== undefined ? { thinkMs: cur.thinkMs } : (thinkMs !== null ? { thinkMs } : {})),
            // B205 — the whole ARENA-STYLE TRACE survives the turn: the
            // collapsed "Thought for Xs · N agents · N sources" header must
            // still open into the narrations + activity of the run. (Before
            // B205 the final message dropped narrations entirely — the
            // "HOW I WORKED" view could never render after done.)
            ...(cur && cur.narrations?.length ? { narrations: cur.narrations } : {}),
            ...(cur && cur.activity?.length ? { activity: cur.activity } : {}),
            ...(cur && cur.sourceCount ? { sourceCount: cur.sourceCount } : {}),
            ...(cur && cur.by ? { by: cur.by } : {}),
            ...(cur && cur.t0 ? { totalMs: Date.now() - cur.t0 } : {}),
          };
          if (idx >= 0) next[idx] = finalMsg; else next.push(finalMsg);
          return next;
        });
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
        // B72 — the backend's done event carries the real reason in data.error
        // (falling back to data.summary, which already held the degraded-mode
        // message). Without this fallback the user saw only the generic "the
        // task hit an unexpected error" instead of what actually went wrong.
        const why = data.error || (data.summary && String(data.summary).trim()) || 'the task hit an unexpected error';
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
  // v3 — the active conversation (set by History's "open conversation").
  const sessionRef = useRef(getSessionId());
  const [logs, setLogs] = useState([]);
  const [websites, setWebsites] = useState([]);
  const [plan, setPlan] = useState(null); // { intent, steps, roster, skillsLine } from the /api/chat plan event
  const [isProcessing, setIsProcessing] = useState(false);
  const [questions, setQuestions] = useState(null); // { conv, questions: [...] }
  const [planReview, setPlanReview] = useState(null); // { conv, plan }
  const [team, setTeam] = useState(null); // B208 — live team strip state (from 'team' events)
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
    // B105 — recovery window 30 min (was 10): the server's task budget is
    // 25 min and the result store TTL is 40 min, so long research tasks now
    // land instead of giving up while they are still running.
    const deadlineMs = Date.now() + 30 * 60 * 1000;
    let found = false;
    let interimShown = false;
    let patienceNoteShown = false;
    const startedAt = Date.now();
    try {
      // Tell the user we're still waiting (not the scary fallback yet).
      setMessages(prev => [...prev, {
        role: 'jexi',
        text: '⚠ The connection dropped — JEXI is still working server-side. Waiting for the result…',
      }]);
      interimShown = true;
      while (!ctrl.signal.aborted && Date.now() < deadlineMs) {
        await delay(3000);
        if (ctrl.signal.aborted) break;
        // After 2 minutes of waiting, reassure once — the task is likely a
        // long one, not a failure.
        if (!patienceNoteShown && Date.now() - startedAt > 120000) {
          patienceNoteShown = true;
          setMessages(prev => [...prev, {
            role: 'jexi',
            text: '⏳ Still waiting — long tasks can take several minutes. The result will appear here automatically the moment it finishes.',
          }]);
        }
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
        text: '⚠ The connection dropped and the result did not return within 30 minutes. If JEXI is still running server-side, saying "continue" will pick it up — or just retry the task.',
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

  const runSearch = useCallback(async (query, image = null, attachments = undefined) => {
    // Halt any previous run AND any pending recovery before starting a new one.
    abortRef.current?.abort();
    recoverRef.current?.abort();
    recoverRef.current = null;

    setIsProcessing(true);
    setLogs([]);
    setWebsites([]);
    setPlan(null);
    setTeam(null); // B208 — fresh turn, fresh team strip
    const userMsg = { role: 'user', text: query, image };
    setMessages(prev => [...prev, userMsg]);
    const onEvent = () => { watchdogFiredRef.current = false; };
    const onStale = () => { watchdogFiredRef.current = true; abortRef.current?.abort(); };
    // Dropped stream / interim deadline notice → auto-poll for the real result.
    const onDrop = async () => { await recoverResult(); };
    const onRecoverable = () => { setTimeout(() => { recoverResult(); }, 1500); };

    const backendUrl = getBackendUrl();
    try {
      abortRef.current = new AbortController();
      // B117 — ONE MODE: no mode header; the server routes per query.
      const headers = { 'Content-Type': 'application/json', 'x-jexi-session': sessionRef.current };
      // B117 — ONE MODE: JEXI decides per query (direct answer vs full team).
      // No x-jexi-mode header is ever sent; the server routes automatically.
      // The dsh preset (standard/ptc/minimal/creator) still rides along and
      // is the only explicit override (minimal = direct answers only).
      const preset = typeof localStorage !== 'undefined' ? (localStorage.getItem('jexi_preset') || 'ptc') : 'ptc';
      headers['x-jexi-preset'] = preset;
      // B99 — CODE MODE (PTC): on whenever the agent pipeline may run; off
      // via Settings (minimal/standard presets keep it off).
      const codeModeOn = typeof localStorage !== 'undefined' ? (localStorage.getItem('jexi_code_mode') || '1') !== '0' : true;
      if (codeModeOn && preset !== 'standard' && preset !== 'minimal') {
        headers['x-jexi-code-mode'] = '1';
      }
      const res = await jexiFetch(`${backendUrl}/api/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, image: image || undefined, files: attachments || undefined }),
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
          headers,
          body: JSON.stringify({ query, image: image || undefined, files: attachments || undefined }),
          signal: abortRef.current.signal,
        });
        if (!retry.ok) throw new Error(`Backend replied HTTP ${retry.status}`);
        await consumeStream(retry, setMessages, setLogs, setWebsites, setPlan, { onEvent, onStale, onDrop, onRecoverable, setQuestions, setPlanReview });
        return;
      }
      if (!res.ok) throw new Error(`Backend replied HTTP ${res.status}`);
      await consumeStream(res, setMessages, setLogs, setWebsites, setPlan, { onEvent, onStale, onDrop, onRecoverable, setQuestions, setPlanReview, setTeam });
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

  // v3 — open a past conversation from History: load its events as read-only
  // messages and point the session at it so the next message CONTINUES it.
  const openConversation = useCallback((convId, events) => {
    const id = String(convId || '');
    if (!id) return;
    sessionRef.current = id;
    setSessionId(id);
    const msgs = (Array.isArray(events) ? events : [])
      .filter((e) => e && (e.kind === 'chat' || !e.kind) && e.text)
      .map((e) => ({ role: e.role === 'user' ? 'user' : 'jexi', text: String(e.text) }));
    if (msgs.length === 0) msgs.push({ role: 'jexi', text: 'This conversation is empty — say something and I will start it up again.' });
    setMessages(msgs);
    setLogs([]);
    setWebsites([]);
    setPlan(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { messages, logs, websites, plan, team, isProcessing, runSearch, stopGeneration, pushMessage, questions, setQuestions, planReview, setPlanReview, openConversation };
};
