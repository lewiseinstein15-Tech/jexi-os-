import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Rocket, Loader2, Pause, Play, XCircle, Send, ChevronLeft, RefreshCw,
  CircleDot, CheckCircle2, XSquare, SkipForward, AlertTriangle, Eye, MousePointerClick, Ban,
  FolderTree, TerminalSquare, Globe, UserRound,
} from 'lucide-react';
import { jexiFetch, getBackendUrl } from '../utils/helpers';

/**
 * B216 — MISSIONS SCREEN: the mission instrument (docs/DESIGN_SYSTEM.md §5).
 *
 * Everything rendered here comes from the REAL API only (list, snapshot,
 * events, world, control, steer) — the persisted record is the single source
 * of truth and the frontend never invents operational state. The screen is
 * structured the way execution actually flows:
 *
 *   OBJECTIVE → WORK GRAPH (tiered by dependencies) → EMPLOYEES →
 *   ACTIVITY STREAM (the append-only log) → ENVIRONMENT (B215 world state) →
 *   VERIFICATION / RESULT
 *
 * B207 lessons stay baked in: min-width 0 down the chain, truncation before
 * overflow, capped feeds. B216 adds semantic motion (node-in / breath /
 * settle) with a prefers-reduced-motion kill-switch in index.css.
 */

const ACTIVE_STATES = ['PLANNING', 'EXECUTING', 'VERIFYING', 'AWAITING_INPUT'];

// endpoint literals kept whole so the frontend↔server API-surface contract
// test can see them (it normalizes ${...} to :id, but only on closed braces)
const MISSION_EVENTS_URL = (id) => `/api/missions/${id}/events`;
const MISSION_WORLD_URL = (id) => `/api/missions/${id}/world`;

const STATE_META = {
  CREATED:    { label: 'CREATED',    cls: 'text-text-tertiary border-hairline' },
  PLANNING:   { label: 'PLANNING',   cls: 'text-brand border-brand-line' },
  EXECUTING:  { label: 'EXECUTING',  cls: 'text-brand border-brand-line' },
  VERIFYING:  { label: 'VERIFYING',  cls: 'text-brand border-brand-line' },
  AWAITING_INPUT: { label: 'NEEDS YOU', cls: 'text-status-warn border-status-warn/40' },
  PAUSED:     { label: 'PAUSED',     cls: 'text-status-warn border-status-warn/40' },
  COMPLETED:  { label: 'COMPLETED',  cls: 'text-brand border-brand-line' },
  FAILED:     { label: 'FAILED',     cls: 'text-status-error border-status-error/40' },
  CANCELLED:  { label: 'CANCELLED',  cls: 'text-text-tertiary border-hairline' },
};

const ITEM_ICON = {
  PENDING: <CircleDot size={12} className="text-text-tertiary shrink-0" />,
  RUNNING: <Loader2 size={12} className="text-brand jx-breath shrink-0" />,
  DONE: <CheckCircle2 size={12} className="text-brand shrink-0" />,
  FAILED: <XSquare size={12} className="text-status-error shrink-0" />,
  SKIPPED: <SkipForward size={12} className="text-text-tertiary shrink-0" />,
  SUPERSEDED: <RefreshCw size={12} className="text-status-warn shrink-0" />,
};

const DOT_CLS = {
  RUNNING: 'jx-dot-running', DONE: 'jx-dot-done', FAILED: 'jx-dot-failed',
};

const EVT_ICON = (t) => {
  if (t?.startsWith('COMPUTER_ACT')) return <MousePointerClick size={11} className="text-brand shrink-0" />;
  if (t?.startsWith('COMPUTER_')) return <Eye size={11} className="text-brand shrink-0" />;
  if (/FAIL|BLOCKED|ERROR/.test(t || '')) return <AlertTriangle size={11} className="text-status-warn shrink-0" />;
  if (/COMPLETED|PASSED|VERIFIED/.test(t || '')) return <CheckCircle2 size={11} className="text-brand shrink-0" />;
  if (/CANCELLED|DENIED/.test(t || '')) return <Ban size={11} className="text-status-error shrink-0" />;
  return <CircleDot size={11} className="text-text-tertiary shrink-0" />;
};

const timeAgo = (iso) => {
  if (!iso) return '—';
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
};

const clockOf = (iso) => {
  if (!iso) return '--:--:--';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
};

/** Dependency tiers: level = longest chain of dependsOn (planIndex refs). Cycle-safe. */
const tierOf = (items) => {
  const byIdx = new Map(items.map((i) => [i.planIndex, i]));
  const level = new Map();
  const visiting = new Set();
  const depth = (idx, guard = 0) => {
    if (level.has(idx)) return level.get(idx);
    if (visiting.has(idx) || guard > 64) return 0; // cycle/absent guard — honest flat placement
    visiting.add(idx);
    const it = byIdx.get(idx);
    const ds = (it?.dependsOn || []).filter((d) => byIdx.has(d));
    const v = ds.length ? Math.max(...ds.map((d) => depth(d, guard + 1))) + 1 : 0;
    visiting.delete(idx);
    level.set(idx, v);
    return v;
  };
  const tiers = [];
  for (const i of items) {
    const t = depth(i.planIndex);
    (tiers[t] = tiers[t] || []).push(i);
  }
  return tiers.filter(Boolean);
};

/** B224 — duplicate-safe event append: SSE push and the REST fallback can
 *  both deliver an event; ids are unique so the union stays clean. */
const appendEvents = (prev, incoming, incremental) => {
  if (!incremental) return (incoming || []).slice(-300);
  const seen = new Set(prev.map((e) => e.id));
  const fresh = (incoming || []).filter((e) => e && e.id && !seen.has(e.id));
  return fresh.length ? [...prev, ...fresh].slice(-300) : prev;
};

export default function MissionsScreen() {
  const [missions, setMissions] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [snap, setSnap] = useState(null);
  const [events, setEvents] = useState([]);
  const [world, setWorld] = useState(null);
  const [busy, setBusy] = useState(null);
  const [steerText, setSteerText] = useState('');
  const [answerText, setAnswerText] = useState('');
  const [note, setNote] = useState('');
  const lastEventId = useRef(null);
  const selectedRef = useRef(null);
  const [esLive, setEsLive] = useState(false); // B224 — SSE push live (stretches the poll)
  const seenItemIds = useRef(null); // B216: animate only nodes that join AFTER first render
  selectedRef.current = selectedId;

  const loadList = useCallback(async () => {
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/missions`);
      const data = await res.json();
      setMissions(data.missions || []);
    } catch { setMissions((prev) => prev); }
  }, []);

  const loadDetail = useCallback(async (id, incremental = false) => {
    try {
      const [rSnap, rEvts, rWorld] = await Promise.all([
        jexiFetch(`${getBackendUrl()}/api/missions/${id}`),
        jexiFetch(`${getBackendUrl()}${MISSION_EVENTS_URL(id)}${incremental && lastEventId.current ? `?sinceEventId=${encodeURIComponent(lastEventId.current)}` : ''}`),
        jexiFetch(`${getBackendUrl()}${MISSION_WORLD_URL(id)}`).catch(() => null), // B215 world (best-effort, never blocks)
      ]);
      const s = await rSnap.json();
      const e = await rEvts.json();
      if (selectedRef.current !== id) return;
      setSnap(s.ok ? s : null);
      const w = rWorld && rWorld.ok ? await rWorld.json().catch(() => null) : null;
      if (w && w.ok) setWorld(w.world || null);
      if (e.ok && Array.isArray(e.events)) {
        setEvents((prev) => appendEvents(prev, e.events, incremental));
        const last = e.events[e.events.length - 1];
        if (last?.id) lastEventId.current = last.id;
      }
    } catch { /* offline: keep what we have */ }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  useEffect(() => {
    const anyActive = (missions || []).some((m) => ACTIVE_STATES.includes(m.state));
    const t = setInterval(loadList, anyActive ? 4000 : 20000);
    return () => clearInterval(t);
  }, [missions, loadList]);

  useEffect(() => {
    if (!selectedId) return;
    setSnap(null); setEvents([]); setWorld(null); lastEventId.current = null; seenItemIds.current = null; setEsLive(false);
    loadDetail(selectedId, false);
  }, [selectedId, loadDetail]);

  // B224 — Part 29: SSE PUSH while a mission is open. Events arrive within a
  // second of landing; native reconnect replays the missed tail. On any error
  // the stream closes and the REST poll (below) keeps the screen alive — the
  // polling fabric is the fallback, not the primary.
  useEffect(() => {
    if (!selectedId || typeof EventSource === 'undefined') return;
    const key = getAccessKey();
    const streamUrl = `${getBackendUrl()}/api/missions/${selectedId}/events/stream`;
    const url = key ? `${streamUrl}?key=${encodeURIComponent(key)}` : streamUrl;
    let es;
    try { es = new EventSource(url); } catch { return; }
    es.addEventListener('ready', () => setEsLive(true));
    es.addEventListener('mission-event', (ev) => {
      try {
        const e = JSON.parse(ev.data);
        setEvents((prev) => appendEvents(prev, [e], true));
        if (e.id) lastEventId.current = e.id;
      } catch { /* malformed frame — the poll will backstop */ }
    });
    es.onerror = () => { setEsLive(false); try { es.close(); } catch { /* already closed */ } };
    return () => { try { es.close(); } catch { /* already closed */ } setEsLive(false); };
  }, [selectedId]);

  // the REST poll: still the state source (progress/items), but stretched
  // while SSE is live — events already arrive by push (§8 performance contract).
  useEffect(() => {
    if (!selectedId) return;
    const active = snap && ACTIVE_STATES.concat('PAUSED').includes(snap.mission?.state);
    const interval = esLive ? (active ? 8000 : 20000) : (active ? 2500 : 8000);
    const t = setInterval(() => loadDetail(selectedId, true), interval);
    return () => clearInterval(t);
  }, [selectedId, snap && snap.mission && snap.mission.state, esLive, loadDetail]);

  const control = async (action, extra = {}) => {
    if (!selectedId) return;
    setBusy(action);
    setNote('');
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/missions/${selectedId}/control`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      const r = await res.json();
      if (!r.ok) setNote(r.error || 'refused');
      loadDetail(selectedId, true);
      loadList();
    } catch (e) { setNote('offline — the mission is unaffected'); }
    setBusy(null);
  };

  const steer = async () => {
    const message = steerText.trim();
    if (!message || !selectedId) return;
    setBusy('steer'); setNote('');
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/missions/${selectedId}/steer`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      const r = await res.json();
      if (!r.ok) setNote(r.error || 'refused');
      setSteerText('');
    } catch { setNote('offline — try again'); }
    setBusy(null);
  };

  const m = snap?.mission;
  const stateMeta = m ? STATE_META[m.state] || STATE_META.CREATED : null;
  const active = m && ACTIVE_STATES.includes(m.state);

  /* ── list (phone-first: detail replaces the list) ─────────────────── */
  if (selectedId && m) {
    const usage = m.usage || {};
    const analysis = m.analysis;
    const imagination = m.imagination;
    const items = snap.graph?.items || [];
    const stats = snap.graph?.stats || null;
    const tiers = tierOf(items);

    // B216 motion contract: the first render of a graph settles every node;
    // only nodes that JOIN later animate in (a reconnect is not a replay).
    if (seenItemIds.current === null && items.length) {
      seenItemIds.current = new Set(items.map((i) => i.id));
    }
    const isNewNode = (it) => {
      if (!seenItemIds.current) return false;
      if (seenItemIds.current.has(it.id)) return false;
      seenItemIds.current.add(it.id);
      return true;
    };

    // the live phase line — derived from the LATEST REAL EVENT, never invented
    const lastEvt = events[events.length - 1] || null;
    const phaseLine = lastEvt
      ? `${clockOf(lastEvt.ts || lastEvt.at)} · ${String(lastEvt.summary || lastEvt.type).slice(0, 96)}`
      : m.state === 'PLANNING' ? 'planning — no events yet' : 'waiting for the first event…';

    // progress rail — REAL counts, no percentage fiction
    const rail = stats ? [
      { k: 'done', n: stats.byStatus.DONE || 0, cls: 'bg-brand' },
      { k: 'run', n: stats.byStatus.RUNNING || 0, cls: 'bg-brand/60' },
      { k: 'ready', n: stats.ready || 0, cls: 'bg-text-secondary/50' },
      { k: 'pend', n: Math.max(0, (stats.open || 0) - (stats.ready || 0)), cls: 'bg-text-tertiary/40' },
      { k: 'fail', n: (stats.byStatus.FAILED || 0) + (stats.blockedByFailures || 0), cls: 'bg-status-error/70' },
    ] : [];
    const railTotal = rail.reduce((n, s) => n + s.n, 0) || 1;

    // employee lane — real workers only (from item results); absent when unstaffed
    const workers = new Map();
    for (const it of items) {
      const name = it.result?.employeeName;
      if (name && !workers.has(name)) workers.set(name, { name, last: it.title, status: it.status, ms: it.result?.ms });
    }
    const inFlight = stats?.byStatus.RUNNING || 0;

    const worldFiles = world?.files || [];
    const worldProcs = world?.processes || [];
    const worldLastCmd = worldProcs[worldProcs.length - 1] || null;
    const worldBrowser = world?.browser || {};
    const worldHasContent = worldFiles.length || worldProcs.length || worldBrowser.updatedAt || (world?.repos || []).length;

    return (
      <div className="h-full flex flex-col min-w-0">
        {/* header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-hairline shrink-0">
          <button type="button" onClick={() => setSelectedId(null)} className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors" aria-label="back to missions">
            <ChevronLeft size={16} />
          </button>
          <span className={`text-[9px] font-bold tracking-[0.14em] border rounded-full px-2 py-0.5 shrink-0 ${stateMeta.cls}`}>{stateMeta.label}</span>
          <span className="text-[10px] font-mono text-text-tertiary truncate shrink min-w-0">{m.id}</span>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-w-0">
          {/* objective — the display voice: what she understood */}
          <div className="min-w-0">
            <div className="text-[9px] font-bold tracking-[0.14em] text-text-tertiary mb-1">OBJECTIVE</div>
            <div className="font-display text-[15px] leading-snug text-text-primary break-words">{m.objective}</div>
          </div>

          {/* live phase line — real telemetry, never a spinner */}
          <div className="jx-phase flex items-center gap-2 min-w-0" aria-live="polite">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${active ? 'bg-brand jx-breath' : m.state === 'FAILED' ? 'bg-status-error' : 'bg-text-tertiary'}`} />
            <span className="text-[10px] font-mono text-text-secondary truncate min-w-0">{phaseLine}</span>
          </div>

          {/* progress rail — real item counts */}
          {stats && stats.total > 0 && (
            <div className="flex h-[3px] rounded-full overflow-hidden gap-px min-w-0 jx-rail-in" role="img" aria-label={`work graph: ${stats.byStatus.DONE || 0} done, ${stats.byStatus.RUNNING || 0} running, ${stats.ready} ready, ${stats.byStatus.FAILED || 0} failed of ${stats.total}`}>
              {rail.map((s) => s.n > 0 && (
                <div key={s.k} className={s.cls} style={{ width: `${(s.n / railTotal) * 100}%` }} />
              ))}
            </div>
          )}

          {m.state === 'AWAITING_INPUT' && m.needsQuestion && (
            <div className="rounded-xl border border-status-warn/40 bg-status-warn/5 p-3 space-y-2 min-w-0">
              <div className="text-[9px] font-bold tracking-[0.14em] text-status-warn">ONE ANSWER NEEDED</div>
              <div className="text-[12px] text-text-secondary break-words">{m.needsQuestion.question}</div>
              <div className="flex gap-2">
                <input
                  value={answerText}
                  onChange={(e) => setAnswerText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && answerText.trim()) { control('answer', { text: answerText.trim() }); setAnswerText(''); } }}
                  placeholder="approve — or say what to change"
                  className="flex-1 min-w-0 bg-surface-2 border border-hairline rounded-lg px-3 py-2 text-[12px] text-text-primary placeholder:text-text-tertiary outline-none focus:border-brand-line"
                />
                <button type="button" disabled={busy === 'answer' || !answerText.trim()} onClick={() => { control('answer', { text: answerText.trim() }); setAnswerText(''); }} className="shrink-0 px-3 rounded-lg bg-brand/15 text-brand text-[11px] font-semibold disabled:opacity-40">
                  {busy === 'answer' ? <Loader2 size={13} className="animate-spin" /> : 'Answer'}
                </button>
              </div>
            </div>
          )}

          {/* intelligence layer — real fields from the snapshot */}
          {(analysis || imagination || usage.itemsCreated !== undefined) && (
            <div className="flex flex-wrap gap-1.5 min-w-0">
              {analysis && (
                <span className="text-[9px] font-semibold tracking-wide border border-hairline rounded-full px-2 py-0.5 text-text-secondary">
                  {analysis.complexity} · risk {analysis.risk} · by {analysis.decidedBy}
                </span>
              )}
              {imagination && (
                <span className={`text-[9px] font-semibold tracking-wide border rounded-full px-2 py-0.5 ${imagination.status === 'COMPLETED' ? 'border-brand-line text-brand' : 'border-hairline text-text-tertiary'}`}>
                  {imagination.status === 'COMPLETED' ? `strategy: ${imagination.selected}` : 'simulation unavailable (honest)'}
                </span>
              )}
              {m.verification && (
                <span className={`text-[9px] font-semibold tracking-wide border rounded-full px-2 py-0.5 ${m.verification.verdict === 'pass' ? 'border-brand-line text-brand' : 'border-status-warn/40 text-status-warn'}`}>
                  verified: {m.verification.verdict}
                </span>
              )}
              {usage.itemsCreated !== undefined && (
                <span className="text-[9px] font-semibold tracking-wide border border-hairline rounded-full px-2 py-0.5 text-text-tertiary">
                  {usage.itemsCreated} items · {usage.failures} fail · {usage.replans} replan{usage.restarts ? ` · ${usage.restarts} restart survived` : ''}
                </span>
              )}
            </div>
          )}

          {/* controls */}
          <div className="flex flex-wrap gap-2">
            {active && (
              <button type="button" disabled={busy === 'pause'} onClick={() => control('pause', { reason: 'from missions screen' })} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-hairline text-[11px] text-text-secondary hover:bg-surface-2 disabled:opacity-40">
                <Pause size={12} /> Pause
              </button>
            )}
            {m.state === 'PAUSED' && (
              <button type="button" disabled={busy === 'resume'} onClick={() => control('resume', { reason: 'from missions screen' })} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-brand-line text-[11px] text-brand hover:bg-surface-2 disabled:opacity-40">
                <Play size={12} /> Resume
              </button>
            )}
            {!['COMPLETED', 'CANCELLED'].includes(m.state) && m.state !== 'FAILED' && (
              <button type="button" disabled={busy === 'cancel'} onClick={() => control('cancel', { reason: 'from missions screen' })} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-status-error/40 text-[11px] text-status-error hover:bg-surface-2 disabled:opacity-40">
                <XCircle size={12} /> Cancel
              </button>
            )}
            <span className="text-[10px] text-text-tertiary self-center ml-auto shrink-0">updated {timeAgo(m.updatedAt)}</span>
          </div>
          {note && <div className="text-[11px] text-status-warn break-words">{note}</div>}

          {/* steering */}
          {(active || m.state === 'PAUSED') && (
            <div className="flex gap-2 min-w-0">
              <input
                value={steerText}
                onChange={(e) => setSteerText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') steer(); }}
                placeholder="steer mid-flight: change, add, replace…"
                className="flex-1 min-w-0 bg-surface-2 border border-hairline rounded-lg px-3 py-2 text-[12px] text-text-primary placeholder:text-text-tertiary outline-none focus:border-brand-line"
              />
              <button type="button" disabled={busy === 'steer' || !steerText.trim()} onClick={steer} className="shrink-0 px-3 rounded-lg bg-brand/15 text-brand disabled:opacity-40" aria-label="send steering">
                {busy === 'steer' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              </button>
            </div>
          )}

          {/* ══ WORK GRAPH — the tier ladder (signature element, §5.3) ══ */}
          {snap.graph && (
            <div className="space-y-2 min-w-0">
              <div className="text-[9px] font-bold tracking-[0.14em] text-text-tertiary pt-1">WORK GRAPH — DEPENDENCY TIERS</div>
              {items.length === 0 && <div className="text-[11px] text-text-tertiary">graph not built yet — planning in progress</div>}
              <div className="space-y-2">
                {tiers.map((tier, ti) => (
                  <div key={ti} className="jx-tier space-y-1.5 min-w-0">
                    <div className="text-[9px] font-mono text-text-tertiary pl-1">{ti === 0 ? 'TIER 0 · INDEPENDENT' : `TIER ${ti} · NEEDS TIER ${ti - 1}`}</div>
                    {tier.map((it) => {
                      const dot = DOT_CLS[it.status] || (it.deferred ? 'jx-dot-warn' : '');
                      const joined = isNewNode(it);
                      return (
                        <div key={it.id} className={`jx-tier-node jx-settle ${dot} rounded-lg border bg-surface-1/60 px-2.5 py-2 min-w-0 ${it.status === 'FAILED' ? 'border-status-error/30' : 'border-hairline'} ${joined ? 'jx-node-in' : ''}`}>
                          <div className="flex items-start gap-2 min-w-0">
                            <span className="mt-0.5">{ITEM_ICON[it.status] || ITEM_ICON.PENDING}</span>
                            <div className="min-w-0 flex-1">
                              <div className="text-[12px] text-text-primary leading-snug break-words">
                                {it.title}
                                {it.result?.employeeName && <span className="text-text-tertiary"> — {it.result.employeeName}</span>}
                              </div>
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                                <span className="text-[9px] font-mono text-text-tertiary">{it.status}{it.deferred ? ' · deferred' : ''}{(it.attempts || 0) > 1 ? ` · ${it.attempts} attempts` : ''}</span>
                                {it.origin === 'discovered' && <span className="text-[9px] font-mono text-status-warn/80 border border-status-warn/25 rounded-full px-1.5">discovered</span>}
                                {it.result?.artifacts?.length > 0 && (
                                  <span className="text-[9px] font-mono text-text-tertiary truncate">{it.result.artifacts.length} artifact{it.result.artifacts.length > 1 ? 's' : ''}</span>
                                )}
                              </div>
                              {it.failureReason && <div className="text-[10px] text-status-warn break-words mt-0.5">{it.failureReason}</div>}
                              {it.status === 'FAILED' && (
                                <button type="button" onClick={() => control('retry', { itemId: it.id })} className="mt-1.5 text-[10px] font-semibold text-brand disabled:opacity-40" disabled={busy === 'retry'}>
                                  {busy === 'retry' ? 'retrying…' : 'retry this item'}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ══ EMPLOYEE LANE — real workers only (§5.4) ══ */}
          {(workers.size > 0 || inFlight > 0) && (
            <div className="space-y-1.5 min-w-0">
              <div className="text-[9px] font-bold tracking-[0.14em] text-text-tertiary pt-1">WORKFORCE</div>
              <div className="flex flex-wrap gap-1.5">
                {[...workers.values()].map((w) => (
                  <span key={w.name} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-surface-1/60 px-2 py-1 min-w-0 max-w-full">
                    <UserRound size={10} className="text-text-tertiary shrink-0" />
                    <span className="text-[10px] text-text-secondary truncate">{w.name}</span>
                    <span className="text-[9px] font-mono text-text-tertiary truncate">{w.status === 'DONE' ? 'delivered' : w.status.toLowerCase()}</span>
                  </span>
                ))}
                {inFlight > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-brand-line bg-brand/5 px-2 py-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand jx-breath" />
                    <span className="text-[10px] font-mono text-brand">{inFlight} in flight</span>
                  </span>
                )}
              </div>
            </div>
          )}

          {/* ══ TOOL DISCOVERY — B223 Part 20, surfaced (real event data only) ══ */}
          {(() => {
            const td = [...events].reverse().find((e) => e.type === 'TOOLS_DISCOVERED' && e.data);
            if (!td) return null;
            const d = td.data;
            const tools = Array.isArray(d.tools) ? d.tools : [];
            const caps = Array.isArray(d.requiredCapabilities) ? d.requiredCapabilities : [];
            const gaps = [...(Array.isArray(d.gaps) ? d.gaps : []), ...(Array.isArray(d.blockedByAllowlist) ? d.blockedByAllowlist : [])];
            return (
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-[9px] font-mono font-bold tracking-[0.14em] text-text-tertiary">TOOL DISCOVERY</span>
                  <span className="text-[9px] font-mono text-text-tertiary">{tools.length} tools · {caps.length} capabilities</span>
                  {esLive && <span className="text-[8px] font-mono text-brand">· push</span>}
                </div>
                <div className="rounded-lg border border-hairline bg-surface-1/40 px-2.5 py-2 space-y-1.5 min-w-0">
                  {caps.length > 0 && (
                    <div className="flex flex-wrap gap-1 min-w-0">
                      {caps.map((c) => (
                        <span key={c} className="text-[9px] font-mono text-text-secondary border border-hairline rounded-full px-1.5 py-0.5">{c}</span>
                      ))}
                    </div>
                  )}
                  {tools.length > 0 && (
                    <div className="text-[9px] font-mono text-text-tertiary break-words leading-relaxed">{tools.slice(0, 10).join(' · ')}{tools.length > 10 ? ` · +${tools.length - 10} more` : ''}</div>
                  )}
                  {gaps.length > 0 && (
                    <div className="space-y-0.5">
                      {gaps.map((g) => (
                        <div key={g.capability} className="text-[9px] font-mono text-status-warn leading-snug">⚠ {g.capability} — {g.reason}</div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* ══ ACTIVITY STREAM — the append-only log (§5.5) ══ */}
          <div className="space-y-1 min-w-0">
            <div className="text-[9px] font-bold tracking-[0.14em] text-text-tertiary pt-1">ACTIVITY STREAM ({events.length})</div>
            <div className="rounded-lg border border-hairline bg-surface-1/40 max-h-64 overflow-y-auto px-2.5 py-2 space-y-1.5">
              {events.length === 0 && <div className="text-[11px] text-text-tertiary">no events yet — the record starts when the mission does</div>}
              {events.slice(-80).reverse().map((e) => (
                <div key={e.id || e.at} className="flex items-start gap-2 min-w-0">
                  <span className="text-[9px] font-mono text-text-tertiary shrink-0 mt-[2px] tabular-nums">{clockOf(e.ts || e.at)}</span>
                  <span className="mt-[3px] shrink-0">{EVT_ICON(e.type)}</span>
                  <div className="min-w-0">
                    <div className="text-[11px] text-text-secondary leading-snug break-words">{String(e.summary || e.type)}</div>
                    <div className="text-[9px] font-mono text-text-tertiary">{e.type}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ══ ENVIRONMENT — B215 world state, real entries only (§5.6) ══ */}
          {worldHasContent ? (
            <div className="space-y-1.5 min-w-0">
              <div className="text-[9px] font-bold tracking-[0.14em] text-text-tertiary pt-1">ENVIRONMENT — OBSERVED</div>
              <div className="rounded-lg border border-hairline bg-surface-1/40 px-2.5 py-2 space-y-1 min-w-0">
                {worldLastCmd && (
                  <div className="flex items-center gap-2 min-w-0">
                    <TerminalSquare size={11} className="text-text-tertiary shrink-0" />
                    <span className="text-[10px] font-mono text-text-secondary truncate min-w-0">{worldLastCmd.command} → exit {worldLastCmd.exitCode ?? '?'}{worldLastCmd.ms != null ? ` · ${worldLastCmd.ms}ms` : ''}</span>
                  </div>
                )}
                {worldFiles.length > 0 && (
                  <div className="flex items-center gap-2 min-w-0">
                    <FolderTree size={11} className="text-text-tertiary shrink-0" />
                    <span className="text-[10px] font-mono text-text-secondary truncate min-w-0">{worldFiles.length} file{worldFiles.length > 1 ? 's' : ''}: {worldFiles.slice(-8).map((f) => f.path).join(', ')}</span>
                  </div>
                )}
                {worldBrowser.updatedAt && (
                  <div className="flex items-center gap-2 min-w-0">
                    <Globe size={11} className="text-text-tertiary shrink-0" />
                    <span className={`text-[10px] font-mono truncate min-w-0 ${worldBrowser.available ? 'text-text-secondary' : 'text-status-warn'}`}>
                      browser {worldBrowser.available ? `available${worldBrowser.lastTitle ? ` · “${worldBrowser.lastTitle}”` : ''}` : `unavailable — ${worldBrowser.blockedReason || 'not configured'}`}
                    </span>
                  </div>
                )}
                {(world?.repos || []).length > 0 && (
                  <div className="flex items-center gap-2 min-w-0">
                    <Rocket size={11} className="text-text-tertiary shrink-0" />
                    <span className="text-[10px] font-mono text-text-secondary truncate min-w-0">published: {(world.repos || []).slice(-3).map((r) => r.slug).join(', ')}</span>
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {/* ══ ERROR SURFACE — what happened / what you can do (§5.7) ══ */}
          {m.state === 'FAILED' && (
            <div className="rounded-xl border border-status-error/40 bg-status-error/5 p-3 space-y-2 min-w-0">
              <div className="text-[9px] font-bold tracking-[0.14em] text-status-error">MISSION FAILED — HONESTLY RECORDED</div>
              {m.verification?.verdict === 'fail' && m.verification.problems?.length > 0 && (
                <div className="text-[11px] text-text-primary break-words border-l-2 border-status-error/40 pl-2">{String(m.verification.problems[0]).slice(0, 400)}</div>
              )}
              <div className="text-[11px] text-text-secondary break-words">
                Every item's state is preserved above — failed items show their real failure reason and can be retried individually.
                {usage.failures ? ` ${usage.failures} failure${usage.failures > 1 ? 's' : ''} recorded.` : ''}
                {usage.replans ? ` A replan was attempted.` : ''}
              </div>
            </div>
          )}

          {/* final report */}
          {m.result?.summary && (
            <div className="rounded-xl border border-hairline bg-surface-1/60 p-3 min-w-0">
              <div className="text-[9px] font-bold tracking-[0.14em] text-text-tertiary mb-1">FINAL REPORT</div>
              <div className="text-[12px] text-text-secondary leading-relaxed break-words whitespace-pre-wrap">{String(m.result.summary).slice(0, 3000)}</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ── mission list ─────────────────────────────────────────────────── */
  return (
    <div className="h-full flex flex-col min-w-0">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-hairline shrink-0">
        <Rocket size={14} className="text-brand shrink-0" />
        <span className="text-[10px] font-bold tracking-[0.14em] text-text-secondary">MISSIONS</span>
        <span className="text-[10px] text-text-tertiary truncate min-w-0">
          {missions === null ? 'loading…' : `${missions.length} recorded · persistent work graphs`}
        </span>
        <button type="button" onClick={loadList} className="ml-auto p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 shrink-0" aria-label="refresh">
          <RefreshCw size={13} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 min-w-0">
        {missions === null && (
          <div className="flex items-center gap-2 text-[12px] text-text-tertiary px-1"><Loader2 size={13} className="animate-spin" /> retrieving mission state…</div>
        )}
        {missions !== null && missions.length === 0 && (
          <div className="text-[12px] text-text-tertiary leading-relaxed px-1">
            No missions yet. Say <span className="text-text-secondary">“as a mission: …”</span> in chat and it runs here — persistent, resumable, and honest about every item.
          </div>
        )}
        {(missions || []).map((mi) => {
          const meta = STATE_META[mi.state] || STATE_META.CREATED;
          return (
            <button
              key={mi.id}
              type="button"
              onClick={() => setSelectedId(mi.id)}
              className="w-full text-left rounded-xl border border-hairline bg-surface-1/60 px-3 py-2.5 hover:bg-surface-2 transition-colors min-w-0"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className={`text-[9px] font-bold tracking-[0.12em] border rounded-full px-2 py-0.5 shrink-0 ${meta.cls}`}>{meta.label}</span>
                <span className="text-[10px] text-text-tertiary ml-auto shrink-0">{timeAgo(mi.updatedAt)}</span>
              </div>
              <div className="font-display text-[13px] text-text-primary leading-snug mt-1.5 break-words line-clamp-2">{mi.objective}</div>
              <div className="text-[10px] font-mono text-text-tertiary mt-1 truncate">{mi.id}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
