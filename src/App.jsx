import { useState, useEffect, useRef, Fragment } from 'react';
import { StatusBar } from '@capacitor/status-bar';
import { useJexiEngine } from './hooks/useJexiEngine';
import usePhoneNotifications from './hooks/usePhoneNotifications'; // B83 — real phone notifications when tasks/goals finish
import { getBackendUrl, jexiFetch, getSessionId } from './utils/helpers';
import ChatWindow from './components/ChatWindow';
import HistoryView from './components/HistoryView';
import AgentsScreen from './components/AgentsScreen'; // B209 — the Team view is reachable again (orphaned since the Orbit redesign)
import WorkshopView from './components/WorkshopView';
import MemoryView from './components/MemoryView'; // B221 — spec screen C: memory bank
import KnowledgePanel from './components/KnowledgePanel'; // B221 — spec screen D: books library
import DownloadPanel from './components/DownloadPanel'; // B221 — spec screen F: app installer
// B222 — the unwired screens, back in the app (endpoints verified live on the brain)
import TasksScreen from './components/TasksScreen';
import GoalsScreen from './components/GoalsScreen';
import ProjectsScreen from './components/ProjectsScreen';
import WorkspaceScreen from './components/WorkspaceScreen';
import TerminalScreen from './components/TerminalScreen';
import SkillsScreen from './components/SkillsScreen';
import ResearchScreen from './components/ResearchScreen';
import ModelsScreen from './components/ModelsScreen';
import McpScreen from './components/McpScreen';
import NotificationsScreen from './components/NotificationsScreen';
import ConnectorsScreen from './components/ConnectorsScreen';
import PluginsScreen from './components/PluginsScreen';
import MissionsScreen from './components/MissionsScreen'; // B212 — mission control over the real API
import SettingsView from './components/SettingsView';
import UpdateBanner from './components/UpdateBanner';
import { discoverBrainUrl, setBrainUrl } from './utils/updateCenter'; // B179 — brain discovery self-heal
import BootSplash from './components/BootSplash'; // B79 — branded loading screen on open (never a blank screen)
import { SidebarBrandMark, SidebarBrandName } from './brand/official'; // B160 — dsh ui-brand-official
import OrbCore from './components/OrbCore'; // B192 — the presence orb
import { StatusCard, CalendarCard } from './components/WidgetCards'; // B192 — glass widgets
import ErrorBoundary from './components/ErrorBoundary';

const VIEWS = {
  chat: { label: 'Chat', icon: 'chat' },
  history: { label: 'Chat history', icon: 'history' },
  agents: { label: 'Team', icon: 'agents' },
  missions: { label: 'Missions', icon: 'missions' },
  workshop: { label: 'Workshop', icon: 'workshop' },
  tasks: { label: 'Tasks', icon: 'tasks', group: 'WORK' }, // B222
  goals: { label: 'Goals', icon: 'goals', group: 'WORK' }, // B222
  projects: { label: 'Projects', icon: 'projects', group: 'WORK' }, // B222
  files: { label: 'Files', icon: 'files', group: 'WORK' }, // B222 — WorkspaceScreen
  terminal: { label: 'Terminal', icon: 'terminal', group: 'WORK' }, // B222
  skills: { label: 'Skills', icon: 'skills', group: 'INTELLIGENCE' }, // B222
  research: { label: 'Research', icon: 'research', group: 'INTELLIGENCE' }, // B222
  models: { label: 'Models', icon: 'models', group: 'INTELLIGENCE' }, // B222
  mcp: { label: 'MCP', icon: 'mcp', group: 'INTELLIGENCE' }, // B222
  notifications: { label: 'Notifications', icon: 'notifications', group: 'SYSTEM' }, // B222
  connectors: { label: 'Connectors', icon: 'connectors', group: 'SYSTEM' }, // B222
  plugins: { label: 'Plugins', icon: 'plugins', group: 'SYSTEM' }, // B222
  memory: { label: 'Memory', icon: 'memory' }, // B221 — spec C
  books: { label: 'Books', icon: 'books' }, // B221 — spec D
  app: { label: 'Get the app', icon: 'app' }, // B221 — spec F
  settings: { label: 'Settings', icon: 'settings' },
};

function MenuIcon({ name }) {
  const common = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor' };
  switch (name) {
    case 'chat':
      return <svg {...common} strokeWidth="1.8"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>;
    case 'history':
      return <svg {...common} strokeWidth="1.8"><path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l4 2" /></svg>;
    case 'missions':
      return <svg {...common} strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="0.5" fill="currentColor" /></svg>;
    case 'agents':
      return (
        <svg {...common}>
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case 'workshop':
      return <svg {...common} strokeWidth="1.8"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>;
    case 'memory':
      return <svg {...common} strokeWidth="1.8"><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" /></svg>;
    case 'books':
      return <svg {...common} strokeWidth="1.8"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></svg>;
    case 'app':
      return <svg {...common} strokeWidth="1.8"><rect x="5" y="2" width="14" height="20" rx="2" /><path d="M12 18h.01" /></svg>;
    case 'tasks':
      return <svg {...common} strokeWidth="1.8"><path d="M9 6h11" /><path d="M9 12h11" /><path d="M9 18h11" /><path d="M3.5 6l1 1 2-2" /><path d="M3.5 12l1 1 2-2" /><path d="M3.5 18l1 1 2-2" /></svg>;
    case 'goals':
      return <svg {...common} strokeWidth="1.8"><path d="M3 17l6-6 4 4 8-8" /><path d="M21 7h-6" /><path d="M21 7v6" /></svg>;
    case 'projects':
      return <svg {...common} strokeWidth="1.8"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /><circle cx="8" cy="13.5" r="1.5" /><path d="M13 13.5h5" /><path d="M15.5 11v5" /></svg>;
    case 'files':
      return <svg {...common} strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M16 13H8" /><path d="M16 17H8" /></svg>;
    case 'terminal':
      return <svg {...common} strokeWidth="1.8"><path d="M4 17l6-5-6-5" /><path d="M12 19h8" /></svg>;
    case 'skills':
      return <svg {...common} strokeWidth="1.8"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>;
    case 'research':
      return <svg {...common} strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><ellipse cx="12" cy="12" rx="4" ry="9" /></svg>;
    case 'models':
      return <svg {...common} strokeWidth="1.8"><rect x="5" y="5" width="14" height="14" rx="2" /><rect x="9.5" y="9.5" width="5" height="5" /><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" /></svg>;
    case 'mcp':
      return <svg {...common} strokeWidth="1.8"><path d="M9 2v6" /><path d="M15 2v6" /><path d="M6 8h12v3a6 6 0 0 1-12 0z" /><path d="M12 22v-5" /></svg>;
    case 'notifications':
      return <svg {...common} strokeWidth="1.8"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>;
    case 'connectors':
      return <svg {...common} strokeWidth="1.8"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></svg>;
    case 'plugins':
      return <svg {...common} strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M12 8v8" /><path d="M8 12h8" /></svg>;

    default:
      return <svg {...common} strokeWidth="1.8"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>;
  }
}

export default function App() {
  const [view, setView] = useState('chat');
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(t); }, []);
  const [menuOpen, setMenuOpen] = useState(false);
  const [booted, setBooted] = useState(false);
  const [bootStatus, setBootStatus] = useState('Connecting to JEXI\u2019s brain…');
  const engine = useJexiEngine();
  usePhoneNotifications();

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
          <div className="jx-word">JEXI<em>_OS</em><span style={{ opacity: .5 }}>™</span></div>
          <div className="jx-dotsep" />
          <div className="jx-ctx">{VIEWS[view]?.label || 'Chat'}</div>
          <div className="jx-right">
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
          <div className="jx-brand">
            <SidebarBrandMark />
            <SidebarBrandName />
          </div>
          {Object.entries(VIEWS).map(([id, v], i, arr) => (
            <Fragment key={id}>
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
        <section className={`jx-view${view === 'agents' ? ' show' : ''}`}>
          <div className="jx-main">
            <AgentsScreen logs={engine.logs} websites={engine.websites} isProcessing={engine.isProcessing} plan={engine.plan} />
          </div>
        </section>

        {/* B212 — mission control: persistent work graphs, controls, live event record */}
        <section className={`jx-view${view === 'missions' ? ' show' : ''}`}>
          <div className="jx-main">
            <MissionsScreen />
          </div>
        </section>

        <section className={`jx-view${view === 'workshop' ? ' show' : ''}`}>
          <div className="jx-main">
            <WorkshopView />
          </div>
        </section>

        {/* B221 — spec screen C: the memory bank, alive from the brain */}
        <section className={`jx-view${view === 'memory' ? ' show' : ''}`}>
          <div className="jx-main">
            <MemoryView />
          </div>
        </section>

        {/* B221 — spec screen D: the books JEXI answers from */}
        <section className={`jx-view${view === 'books' ? ' show' : ''}`}>
          <div className="jx-main">
            <div className="jx-scroll">
              <div className="jx-view-inner">
                <div className="jx-vtitle">Books</div>
                <div className="jx-vsub">The library JEXI answers from — add PDFs, TXT and MD, she learns them.</div>
                <KnowledgePanel />
              </div>
            </div>
          </div>
        </section>

        {/* B221 — spec screen F: install on the phone */}
        <section className={`jx-view${view === 'app' ? ' show' : ''}`}>
          <div className="jx-main">
            <DownloadPanel />
          </div>
        </section>

        {/* B222 — the unwired screens, wired. Each was built, styled and
            API-backed but orphaned in a shell refactor; every endpoint they
            call is live on the brain (verified). */}
        <section className={`jx-view${view === 'tasks' ? ' show' : ''}`}>
          <div className="jx-main"><TasksScreen /></div>
        </section>
        <section className={`jx-view${view === 'goals' ? ' show' : ''}`}>
          <div className="jx-main">
            <div className="jx-scroll"><div className="jx-view-inner">
              <div className="jx-vtitle">Goals</div>
              <div className="jx-vsub">Long-running goals JEXI chases on a schedule — start one with /goal in chat.</div>
              <GoalsScreen />
            </div></div>
          </div>
        </section>
        <section className={`jx-view${view === 'projects' ? ' show' : ''}`}>
          <div className="jx-main">
            <div className="jx-scroll"><div className="jx-view-inner">
              <div className="jx-vtitle">Projects</div>
              <div className="jx-vsub">Everything JEXI has built — continue one and she picks up where she left off.</div>
              <ProjectsScreen onContinue={(text) => { engine.runSearch(text); navigate('chat'); }} />
            </div></div>
          </div>
        </section>
        <section className={`jx-view${view === 'files' ? ' show' : ''}`}>
          <div className="jx-main">
            <div className="jx-scroll"><div className="jx-view-inner">
              <div className="jx-vtitle">Files</div>
              <div className="jx-vsub">The workspace runtime — files, diffs, checkpoints, rollback.</div>
              <WorkspaceScreen />
            </div></div>
          </div>
        </section>
        <section className={`jx-view${view === 'terminal' ? ' show' : ''}`}>
          <div className="jx-main"><TerminalScreen /></div>
        </section>
        <section className={`jx-view${view === 'skills' ? ' show' : ''}`}>
          <div className="jx-main">
            <div className="jx-scroll"><div className="jx-view-inner">
              <div className="jx-vtitle">Skills</div>
              <div className="jx-vsub">The skill library — curated, marketplace and auto-discovered. Use one and it rides the next task.</div>
              <SkillsScreen onUseSkill={(text) => { engine.runSearch(text); navigate('chat'); }} />
            </div></div>
          </div>
        </section>
        <section className={`jx-view${view === 'research' ? ' show' : ''}`}>
          <div className="jx-main"><ResearchScreen engine={engine} onResearch={(text) => { engine.runSearch(text); navigate('chat'); }} /></div>
        </section>
        <section className={`jx-view${view === 'models' ? ' show' : ''}`}>
          <div className="jx-main"><ModelsScreen /></div>
        </section>
        <section className={`jx-view${view === 'mcp' ? ' show' : ''}`}>
          <div className="jx-main"><McpScreen /></div>
        </section>
        <section className={`jx-view${view === 'notifications' ? ' show' : ''}`}>
          <div className="jx-main">
            <div className="jx-scroll"><div className="jx-view-inner">
              <div className="jx-vtitle">Notifications</div>
              <div className="jx-vsub">What JEXI finished, found or needs from you while you were away.</div>
              <NotificationsScreen />
            </div></div>
          </div>
        </section>
        <section className={`jx-view${view === 'connectors' ? ' show' : ''}`}>
          <div className="jx-main"><ConnectorsScreen /></div>
        </section>
        <section className={`jx-view${view === 'plugins' ? ' show' : ''}`}>
          <div className="jx-main"><PluginsScreen /></div>
        </section>

        {/* settings */}
        <section className={`jx-view${view === 'settings' ? ' show' : ''}`}>
          <div className="jx-main">
            <SettingsView />
          </div>
        </section>

        </div>{/* /jx-stage */}
        </div>{/* /jx-workbench */}

        <UpdateBanner />
      </div>
    </ErrorBoundary>
  );
}
