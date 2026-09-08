import { useState, useEffect, useRef, Fragment } from 'react';
import { StatusBar } from '@capacitor/status-bar';
import { useJexiEngine } from './hooks/useJexiEngine';
import usePhoneNotifications from './hooks/usePhoneNotifications'; // B83 — real phone notifications when tasks/goals finish
import { getBackendUrl, jexiFetch, getSessionId } from './utils/helpers';
import ChatWindow from './components/ChatWindow';
import HistoryView from './components/HistoryView';
import WorkshopView from './components/WorkshopView';
// ARENA REBUILD (spec Part 26) — the seven nav destinations, all REAL
// screens backed by live APIs (no mock panels, no dead links):
import MissionsScreen from './components/MissionsScreen'; // mission instrument: work graph + events + controls
import AgentsScreen from './components/AgentsScreen'; // pipeline + roster + team management
import MemoryView from './components/MemoryView'; // the memory bank, alive from the brain
import McpScreen from './components/McpScreen'; // tools: connected MCP servers + plugins
import WorkspaceScreen from './components/WorkspaceScreen'; // files JEXI actually wrote
// B222 — the unwired screens, back in the app (endpoints verified live on the brain)
import SettingsView from './components/SettingsView';
import UpdateBanner from './components/UpdateBanner';
import { discoverBrainUrl, setBrainUrl } from './utils/updateCenter'; // B179 — brain discovery self-heal
import BootSplash from './components/BootSplash'; // B79 — branded loading screen on open (never a blank screen)
import { SidebarBrandMark, SidebarBrandName } from './brand/official'; // B160 — dsh ui-brand-official
import OrbCore from './components/OrbCore'; // B192 — the presence orb
import MissionPanel from './components/MissionPanel'; // ARENA ASTRA — desktop right mission rail
import { SidebarLockup, Crown } from './components/JexiBrand'; // reference: bolt + wordmark lockup
import { StatusCard, CalendarCard } from './components/WidgetCards'; // B192 — glass widgets
import ErrorBoundary from './components/ErrorBoundary';

// ARENA REBUILD (spec Part 26): the nav is Lewis's spec — Home / Missions /
// Agents / Memory / Tools / Files / Settings. The conversation is the hero
// (Home); every other item is a real, API-backed screen. Chat history and
// the Workshop stay reachable (top-bar shortcuts) without crowding the rail.
const VIEWS = {
  chat: { label: 'Home', icon: 'home' },
  missions: { label: 'Missions', icon: 'missions' },
  agents: { label: 'Agents', icon: 'agents' },
  memory: { label: 'Memory', icon: 'memory' },
  tools: { label: 'Tools', icon: 'tools' },
  files: { label: 'Files', icon: 'files' },
  settings: { label: 'Settings', icon: 'settings' },
  // off-rail, reachable from the top bar:
  history: { label: 'Chat history', icon: 'history' },
  workshop: { label: 'Workshop', icon: 'workshop' },
};

function MenuIcon({ name }) {
  const common = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor' };
  switch (name) {
    case 'chat':
      return <svg {...common} strokeWidth="1.8"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>;
    case 'history':
      return <svg {...common} strokeWidth="1.8"><path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l4 2" /></svg>;
    case 'workshop':
      return <svg {...common} strokeWidth="1.8"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>;
    case 'home':
      return <svg {...common} strokeWidth="1.8"><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h5v-6h4v6h5V9.5" /></svg>;
    case 'missions':
      return <svg {...common} strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" fill="currentColor" /></svg>;
    case 'agents':
      return <svg {...common} strokeWidth="1.8"><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20c.6-3.2 2.9-5 5.5-5s4.9 1.8 5.5 5" /><circle cx="17" cy="9" r="2.4" /><path d="M15.5 14.6c2.6.2 4.4 1.8 5 4.4" /></svg>;
    case 'memory':
      return <svg {...common} strokeWidth="1.8"><path d="M12 3a4 4 0 0 0-4 4v1a4 4 0 0 0-3 6.5A4 4 0 0 0 8 21h8a4 4 0 0 0 3-6.5A4 4 0 0 0 16 8V7a4 4 0 0 0-4-4z" /><path d="M12 3v18" /></svg>;
    case 'tools':
      return <svg {...common} strokeWidth="1.8"><path d="M14.7 6.3a4 4 0 0 0 5 5L21 12l-9 9-4-4 9-9 .7-3.7z" /><path d="M3 3l6 6" /></svg>;
    case 'files':
      return <svg {...common} strokeWidth="1.8"><path d="M4 4h10l6 6v10a0 0 0 0 1 0 0H4z" /><path d="M14 4v6h6" /></svg>;
    case 'settings':
      return <svg {...common} strokeWidth="1.8"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51h.09a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>;
    default:
      return <svg {...common} strokeWidth="1.8"><circle cx="12" cy="12" r="9" /></svg>;
  }
}

export default function App() {
  const [view, setView] = useState('chat');
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(t); }, []);
  const [menuOpen, setMenuOpen] = useState(false);
  const [topQuery, setTopQuery] = useState(''); // ARENA ASTRA — top search
  const [booted, setBooted] = useState(false);
  const [bootStatus, setBootStatus] = useState('Connecting to JEXI\u2019s brain…');
  const engine = useJexiEngine();
  usePhoneNotifications();

  // One-time key card: paste -> memory-only session key -> auto-continue.
  const [secretBusy, setSecretBusy] = useState(false);
  const [secretError, setSecretError] = useState('');
  useEffect(() => { setSecretError(''); }, [engine.secretAsk && engine.secretAsk.id]);
  const submitSecretKey = async (value) => {
    const ask = engine.secretAsk;
    if (!ask || secretBusy) return;
    setSecretBusy(true);
    setSecretError('');
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/secrets/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conv: ask.conv, id: ask.id, value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `Backend replied HTTP ${res.status}`);
      engine.setSecretAsk(null);
      engine.runSearch('Continue — I just pasted the one-time GitHub key in the key card.');
    } catch (e) {
      setSecretError((e && e.message) || 'Could not use that key — try again.');
    } finally {
      setSecretBusy(false);
    }
  };

  // B79 — REAL loading page on open (never a blank frame, never a fake
  // flash): the branded splash stays up until the shell has painted AND the
  // backend is reachable. Hard cap so the splash can never trap the app.
  //
  // B158 — SELF-HEALING BACKEND URL: a localStorage override (set on an older
  // build, or pointing at a backend that later died) wins over the URL baked
  // into THIS APK — which made the freshly-updated app look "broken" even
  // though its own baked backend was perfectly healthy. If the override
  // fails its health check but the baked URL answers, drop the override
  // automatically and continue on the healthy brain.
  useEffect(() => {
    let alive = true;
    let done = false;
    const finish = () => { if (alive && !done) { done = true; setBooted(true); } };
    const ping = async (base, ms) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), ms);
      try {
        const res = await fetch(`${base}/api/health`, { signal: ctrl.signal, cache: 'no-store' });
        return res.ok;
      } catch (e) { return false; }
      finally { clearTimeout(t); }
    };
    const minDelay = new Promise((r) => setTimeout(r, 1400));
    const health = (async () => {
      const baked = import.meta.env.VITE_JEXI_BACKEND_URL || '';
      const stored = localStorage.getItem('jexi_backend_url') || '';
      let ok = await ping(getBackendUrl(), 12000);
      if (!alive) return;
      if (!ok && stored && baked && stored !== baked && await ping(baked, 6000)) {
        // The saved override is dead but this build's own brain is alive —
        // recover onto it (settings still let the user re-point later).
        setBrainUrl('');
        setBrainUrl(baked);
        ok = true;
        setBootStatus('Brain online (recovered)');
      } else if (ok) {
        setBootStatus('Brain online');
      } else {
        // B179 — BOTH known URLs are dead (the brain moved again). Ask the
        // website — it always carries the current brain address (brain.json)
        // — so an installed app can never be stranded by a server move.
        setBootStatus('Finding JEXI’s new home…');
        const discovered = await discoverBrainUrl();
        if (alive && discovered && discovered !== getBackendUrl()) {
          setBrainUrl(discovered);
          setBootStatus('Found her — connecting…');
        }
      }
      await new Promise((r) => setTimeout(r, 400));
    })();
    Promise.race([
      Promise.all([minDelay, health]),
      new Promise((r) => setTimeout(r, 15000)),
    ]).then(finish);
    return () => { alive = false; };
  }, []);

  // Native polish: match the phone's status bar to the black theme.
  useEffect(() => {
    if (window.Capacitor?.isNativePlatform?.()) {
      StatusBar.setBackgroundColor({ color: '#0f1115' }).catch(() => {});
      StatusBar.setStyle({ style: 'LIGHT' }).catch(() => {});
    }
  }, []);

  const navigate = (id) => {
    setView(id);
    setMenuOpen(false);
  };

  // B97 — RESUME IN CHAT: a past conversation's RESUME button sets the
  // session id and asks the app to open Chat so it continues that log.
  useEffect(() => {
    const h = () => navigate('chat');
    window.addEventListener('jexi:resume-conversation', h);
    return () => window.removeEventListener('jexi:resume-conversation', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close the menu when tapping outside it.
  useEffect(() => {
    const onDoc = () => setMenuOpen(false);
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);

  if (!booted) {
    return <BootSplash status={bootStatus} />;
  }

  return (
    <ErrorBoundary>
      <div className="jx-app">
        {/* top bar with the three lines */}
        <header className="jx-top">
          <button
            type="button"
            className="jx-burger"
            aria-label="Menu"
            onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
          >
            <i /><i /><i />
          </button>
          <div className="jx-word">JEXI</div>
          <div className="jx-dotsep" />
          <div className="jx-ctx">{VIEWS[view]?.label || 'Home'}</div>
          {/* ARENA ASTRA — top search (desktop): ask JEXI from anywhere */}
          <form
            className="jx-topsearch"
            onSubmit={(e) => { e.preventDefault(); const q = topQuery.trim(); if (!q) return; setTopQuery(''); navigate('chat'); engine.runSearch(q); }}
          >
            <span className="jx-topsearch-ic" aria-hidden="true">⌕</span>
            <input value={topQuery} onChange={(e) => setTopQuery(e.target.value)} placeholder="Ask JEXI anything…" aria-label="Ask JEXI anything" />
          </form>
          {/* ARENA — off-rail shortcuts: history + workshop stay one tap away */}
          {view !== 'history' && (
            <button type="button" className="jx-toplink" aria-label="Chat history" onClick={(e) => { e.stopPropagation(); navigate('history'); }} title="Chat history"><MenuIcon name="history" /></button>
          )}
          {view !== 'workshop' && (
            <button type="button" className="jx-toplink" aria-label="Workshop" onClick={(e) => { e.stopPropagation(); navigate('workshop'); }} title="Workshop"><MenuIcon name="workshop" /></button>
          )}
          <div className="jx-right">
            <span className="jx-crown" aria-hidden="true">👑</span>
            {/* ARENA ASTRA — owner chip (desktop) */}
            <span className="jx-userchip" title="Lewis — owner & creator"><span className="jx-avatar" aria-hidden="true">L</span>Lewis<span className="jx-chev" aria-hidden="true">▾</span></span>
            <span className={`jx-pill${engine.isProcessing ? ' violet' : ''}`}>
              <span className="pdot" />
              {engine.isProcessing ? 'THINKING' : 'ONLINE'}
            </span>
            <span className="jx-clock">
              {clock.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </div>
        </header>

        {/* drawer backdrop (native feel) */}
        <div className={`jx-backdrop${menuOpen ? ' show' : ''}`} onClick={() => setMenuOpen(false)} aria-hidden="true" />

        {/* hamburger menu (drawer) */}
        <nav className={`jx-menu${menuOpen ? ' open' : ''}`} onClick={(e) => e.stopPropagation()}>
          {/* B160 — dsh ui-brand-official: sidebar brand occupants */}
          <SidebarLockup />
          {/* ARENA — the rail lists exactly the spec seven; history/workshop
              stay reachable from the top bar (and this drawer keeps them too
              on phone, under a divider) */}
          {Object.entries(VIEWS).map(([id, v], i, arr) => (
            <Fragment key={id}>
              {['history', 'workshop'].includes(id) && !['history', 'workshop'].includes(arr[i - 1]?.[0] || '') && (
                <div className="jx-sep" />
              )}
              {v.group && arr[i - 1]?.[1].group !== v.group && (
                <div className="jx-mgroup">{v.group}</div>
              )}
              <button
                type="button"
                className={`jx-mi${view === id ? ' active' : ''}`}
                onClick={() => navigate(id)}
              >
                <MenuIcon name={v.icon} />
                {v.label}
              </button>
            </Fragment>
          ))}
          <div className="jx-railnote">Big goals.<br />Real progress.<br /><span>— JEXI <Crown size={15} /></span></div>
        </nav>

        {/* B192 — workbench: glass widgets beside the chat on desktop */}
        <div className="jx-workbench">
        <aside className="jx-widgets" aria-hidden="true">
          <StatusCard active={engine.isProcessing ? 1 : 0} done={engine.messages.filter((m) => m.role === 'jexi' && !m.streaming).length} idle={!engine.isProcessing} />
          <CalendarCard date={clock} />
          <div className="jx2-card">
            <div className="jx2-card-title">PRESENCE</div>
            <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0' }}>
              <OrbCore size={170} state={engine.isProcessing ? 'thinking' : 'idle'} label="" />
            </div>
            <div className="jx2-card-foot" style={{ textAlign: 'center' }}>{engine.isProcessing ? 'WORKING' : 'STANDBY'}</div>
          </div>
        </aside>
        <div className="jx-stage">

        {/* chat */}
        <section className={`jx-view${view === 'chat' ? ' show' : ''}`}>
          <div className="jx-main">
            <ChatWindow
              messages={engine.messages}
              logs={engine.logs}
              isProcessing={engine.isProcessing}
              onSend={engine.runSearch}
              onStop={engine.stopGeneration}
              questions={engine.questions}
              onDismissQuestions={() => engine.setQuestions(null)}
              secretAsk={engine.secretAsk}
              secretBusy={secretBusy}
              secretError={secretError}
              onSecretSubmit={submitSecretKey}
              onDismissSecret={() => engine.setSecretAsk(null)}
              planReview={engine.planReview}
              team={engine.team}
              computer={engine.computer}
              onDismissPlan={() => engine.setPlanReview(null)}
              onVisionResult={(img) => engine.runSearch('What do you see in this image? Describe it and tell me anything important.', img)}
            />
          </div>
        </section>

        {/* chat history */}
        <section className={`jx-view${view === 'history' ? ' show' : ''}`}>
          <div className="jx-main">
            <HistoryView
              onOpen={(convId, events) => {
                engine.openConversation(convId, events);
                navigate('chat');
              }}
            />
          </div>
        </section>

        {/* workshop */}
        {/* B209 — the Team screen: live pipeline + runtime management */}

        {/* B212 — mission control: persistent work graphs, controls, live event record */}

        <section className={`jx-view${view === 'workshop' ? ' show' : ''}`}>
          <div className="jx-main">
            <WorkshopView engine={engine} />
          </div>
        </section>

        {/* B221 — spec screen C: the memory bank, alive from the brain */}

        {/* B221 — spec screen D: the books JEXI answers from */}

        {/* B221 — spec screen F: install on the phone */}

        {/* B222 — the unwired screens, wired. Each was built, styled and
            API-backed but orphaned in a shell refactor; every endpoint they
            call is live on the brain (verified). */}

        {/* ARENA — Missions: the mission instrument (work graph, events, controls) */}
        <section className={`jx-view${view === 'missions' ? ' show' : ''}`}>
          <div className="jx-main">
            <MissionsScreen />
          </div>
        </section>

        {/* ARENA — Agents: pipeline + roster + team */}
        <section className={`jx-view${view === 'agents' ? ' show' : ''}`}>
          <div className="jx-main">
            <AgentsScreen logs={engine.logs} websites={engine.websites} isProcessing={engine.isProcessing} plan={engine.plan} />
          </div>
        </section>

        {/* ARENA — Memory: the memory bank */}
        <section className={`jx-view${view === 'memory' ? ' show' : ''}`}>
          <div className="jx-main">
            <MemoryView />
          </div>
        </section>

        {/* ARENA — Tools: MCP servers + plugins */}
        <section className={`jx-view${view === 'tools' ? ' show' : ''}`}>
          <div className="jx-main">
            <McpScreen />
          </div>
        </section>

        {/* ARENA — Files: the real workspace */}
        <section className={`jx-view${view === 'files' ? ' show' : ''}`}>
          <div className="jx-main">
            <WorkspaceScreen />
          </div>
        </section>

        {/* settings */}
        <section className={`jx-view${view === 'settings' ? ' show' : ''}`}>
          <div className="jx-main">
            <SettingsView />
          </div>
        </section>

        </div>{/* /jx-stage */}
        <MissionPanel />
        </div>{/* /jx-workbench */}

        <UpdateBanner />
      </div>
    </ErrorBoundary>
  );
}
