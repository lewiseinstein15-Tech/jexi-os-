import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Rocket, Loader2, Pause, Play, XCircle, Send, ChevronLeft, RefreshCw,
  CircleDot, CheckCircle2, XSquare, SkipForward, AlertTriangle, Eye, MousePointerClick, Ban,
} from 'lucide-react';
import { jexiFetch, getBackendUrl } from '../utils/helpers';

/**
 * B212 — MISSIONS SCREEN: mission control over the REAL API only.
 *
 * Everything rendered here comes from /api/missions (list, snapshot, events,
 * control, steer) — the persisted record is the single source of truth and
 * the frontend never invents operational state (the event-sourcing rule).
 * A mission listed here is exactly what the server knows; controls map 1:1
 * to the runner's controls; the event feed is the same append-only log the
 * chat replays.
 *
 * Layout rules (B207 lessons): min-width 0 everywhere, truncation instead of
 * overflow, capped feed heights — phone-safe by construction.
 */

const ACTIVE_STATES = ['PLANNING', 'EXECUTING', 'VERIFYING', 'AWAITING_INPUT'];

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
  RUNNING: <Loader2 size={12} className="text-brand animate-spin shrink-0" />,
  DONE: <CheckCircle2 size={12} className="text-brand shrink-0" />,
  FAILED: <XSquare size={12} className="text-status-error shrink-0" />,
  SKIPPED: <SkipForward size={12} className="text-text-tertiary shrink-0" />,
  SUPERSEDED: <RefreshCw size={12} className="text-status-warn shrink-0" />,
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

export default function MissionsScreen() {
  const [missions, setMissions] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [snap, setSnap] = useState(null);
  const [events, setEvents] = useState([]);
  const [busy, setBusy] = useState(null);
  const [steerText, setSteerText] = useState('');
  const [answerText, setAnswerText] = useState('');
  const [note, setNote] = useState('');
  const lastEventId = useRef(null);
  const selectedRef = useRef(null);
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
      const [rSnap, rEvts] = await Promise.all([
        jexiFetch(`${getBackendUrl()}/api/missions/${id}`),
        jexiFetch(`${getBackendUrl()}/api/missions/${id}/events${incremental && lastEventId.current ? `?sinceEventId=${encodeURIComponent(lastEventId.current)}` : ''}`),
      ]);
      const s = await rSnap.json();
      const e = await rEvts.json();
      if (selectedRef.current !== id) return;
      setSnap(s.ok ? s : null);
      if (e.ok && Array.isArray(e.events)) {
        setEvents((prev) => (incremental ? [...prev, ...e.events].slice(-300) : e.events.slice(-300)));
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
    setSnap(null); setEvents([]); lastEventId.current = null;
    loadDetail(selectedId, false);
  }, [selectedId, loadDetail]);

  useEffect(() => {
    if (!selectedId) return;
    const active = snap && ACTIVE_STATES.concat('PAUSED').includes(snap.mission?.state);
    const t = setInterval(() => loadDetail(selectedId, true), active ? 2500 : 8000);
    return () => clearInterval(t);
  }, [selectedId, snap && snap.mission && snap.mission.state, loadDetail]);

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
    const budgets = m.budgets || {};
    const analysis = m.analysis;
    const imagination = m.imagination;
    return (
      <div className="h-full flex flex-col min-w-0">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-hairline shrink-0">
          <button type="button" onClick={() => setSelectedId(null)} className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors" aria-label="back to missions">
            <ChevronLeft size={16} />
          </button>
          <span className={`text-[9px] font-bold tracking-[0.14em] border rounded-full px-2 py-0.5 shrink-0 ${stateMeta.cls}`}>{stateMeta.label}</span>
          <span className="text-[10px] font-mono text-text-tertiary truncate shrink min-w-0">{m.id}</span>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-w-0">
          <div className="text-[13px] text-text-primary leading-snug break-words">{m.objective}</div>

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

          {/* work items */}
          {snap.graph && (
            <div className="space-y-1.5 min-w-0">
              <div className="text-[9px] font-bold tracking-[0.14em] text-text-tertiary pt-1">WORK GRAPH</div>
              {(snap.graph.items || []).map((it) => (
                <div key={it.id} className="rounded-lg border border-hairline bg-surface-1/60 px-2.5 py-2 min-w-0">
                  <div className="flex items-start gap-2 min-w-0">
                    <span className="mt-0.5">{ITEM_ICON[it.status] || ITEM_ICON.PENDING}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] text-text-primary leading-snug break-words">
                        {it.title}
                        {it.result?.employeeName && <span className="text-text-tertiary"> — {it.result.employeeName}</span>}
                      </div>
                      {it.failureReason && <div className="text-[10px] text-status-warn break-words mt-0.5">{it.failureReason}</div>}
                      {it.result?.artifacts?.length > 0 && (
                        <div className="text-[10px] text-text-tertiary mt-0.5 truncate">{it.result.artifacts.length} artifact(s): {it.result.artifacts.map((a) => a.name || a).join(', ')}</div>
                      )}
                      {it.status === 'FAILED' && (
                        <button type="button" onClick={() => control('retry', { itemId: it.id })} className="mt-1.5 text-[10px] font-semibold text-brand disabled:opacity-40" disabled={busy === 'retry'}>
                          {busy === 'retry' ? 'retrying…' : 'retry this item'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* event feed — the same append-only log the chat replays */}
          <div className="space-y-1 min-w-0">
            <div className="text-[9px] font-bold tracking-[0.14em] text-text-tertiary pt-1">EVENT RECORD ({events.length})</div>
            <div className="rounded-lg border border-hairline bg-surface-1/40 max-h-64 overflow-y-auto px-2.5 py-2 space-y-1">
              {events.length === 0 && <div className="text-[11px] text-text-tertiary">no events yet</div>}
              {events.slice(-80).reverse().map((e) => (
                <div key={e.id || e.at} className="flex items-start gap-1.5 min-w-0">
                  <span className="mt-[3px]">{EVT_ICON(e.type)}</span>
                  <div className="min-w-0">
                    <div className="text-[11px] text-text-secondary leading-snug break-words">{String(e.summary || e.type)}</div>
                    <div className="text-[9px] font-mono text-text-tertiary">{e.type}{e.at ? ` · ${timeAgo(e.at)}` : ''}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

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
          <div className="flex items-center gap-2 text-[12px] text-text-tertiary px-1"><Loader2 size={13} className="animate-spin" /> loading the mission record…</div>
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
              <div className="text-[12px] text-text-primary leading-snug mt-1.5 break-words line-clamp-2">{mi.objective}</div>
              <div className="text-[10px] font-mono text-text-tertiary mt-1 truncate">{mi.id}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
