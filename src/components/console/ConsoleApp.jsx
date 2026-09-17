import { createContext, useContext, useEffect, useRef, useState } from 'react';
import '../../styles/jexi-theme.css'; // console design tokens + styles (extracted verbatim from the approved preview)
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import EventStream from './EventStream';
import BootScreen from './BootScreen';
import MissionsView from './views/MissionsView';
import ChatView from './ChatView';
import WorkGraphView from './views/WorkGraphView';
import AgentsView from './views/AgentsView';
import SessionsView from './views/SessionsView';
import MemoryView from './views/MemoryView';
import SkillsView from './views/SkillsView';
import KnowledgeView from './views/KnowledgeView';
import ConnectorsView from './views/ConnectorsView';
import PluginsView from './views/PluginsView';
import McpView from './views/McpView';
import SchedulerView from './views/SchedulerView';
import { subscribeBus, emitEvent, brainGet, fmtUptime } from '../../services/brain';
import { useHudStream } from '../../services/hud';

/* ConsoleApp — the approved preview (ui/preview/console.html) as a real
   React surface. Hash-routed (#missions … #scheduler) so the URL matches
   the preview exactly. No router dependency: the existing React setup has
   none, and the Scope Guard forbids new dependencies that aren't required
   — a 15-line hash hook covers every route.

   v0.9 — EVERYTHING LIVE: a <BootScreen /> wakes the brain automatically
   on open, runs the self-test question, then hands over. All 12 views
   read real brain endpoints (honest empty states — zero mock rows), the
   HUD + event stream are wired to a live bus, and a 60s health heartbeat
   keeps ServerRow/TopBar truthful. */

export const CONSOLE_ROUTES = [
  'missions', 'chat', 'workgraph', 'agents', 'sessions', 'memory',
  'skills', 'knowledge', 'connectors', 'plugins', 'mcp', 'scheduler',
];

export function routeFromHash() {
  const h = (typeof window !== 'undefined' ? window.location.hash : '').replace('#', '');
  return CONSOLE_ROUTES.includes(h) ? h : '';
}

const VIEWS = {
  missions: MissionsView,
  chat: ChatView,
  workgraph: WorkGraphView,
  agents: AgentsView,
  sessions: SessionsView,
  memory: MemoryView,
  skills: SkillsView,
  knowledge: KnowledgeView,
  connectors: ConnectorsView,
  plugins: PluginsView,
  mcp: McpView,
  scheduler: SchedulerView,
};

/* Shared live brain state for the whole console (sidebar counts, HUD…). */
const BrainCtx = createContext({ fleet: null, health: null, online: false });
export const useBrain = () => useContext(BrainCtx);

/* Phase 7(F) — the HUD status contract context. ONE payload from
   GET /api/hud + SSE /api/hud/stream feeds every operational panel.
   Panels read state ONLY from here — a section missing from the payload
   renders as "no data", never fabricated. */
const HudCtx = createContext({ hud: null, revision: 0, connected: false, error: '' });
export const useHud = () => useContext(HudCtx);

export default function ConsoleApp({ route }) {
  const [boot, setBoot] = useState(null); // null = booting, {fleet, health} = live
  const [health, setHealth] = useState(null);
  const [fleet, setFleet] = useState(null);
  const [elapsed, setElapsed] = useState('00:00:00'); // REAL clock — starts at open
  const [menu, setMenu] = useState(false); // v0.10 — phone drawer (off-canvas sidebar)
  const openedAt = useRef(Date.now());
  const hudState = useHudStream(); // Phase 7(F) — one stream, one truth

  const finishBoot = (f, h) => {
    setFleet(f);
    setHealth(h);
    setBoot({ fleet: f, health: h });
    emitEvent({
      chip: 'SYS', who: 'Console',
      msg: h ? `handover complete · console live on ${h.name} v${h.version}` : 'handover complete · degraded mode (no brain yet)',
      tone: h ? 'var(--jcx-up)' : 'var(--jcx-gold)',
    });
  };

  /* real mission clock — counts from the moment the console opened */
  useEffect(() => {
    if (!boot) return undefined;
    const p = (n) => (n < 10 ? '0' : '') + n;
    const t = setInterval(() => {
      const s = Math.floor((Date.now() - openedAt.current) / 1000);
      setElapsed(p(Math.floor(s / 3600)) + ':' + p(Math.floor(s / 60) % 60) + ':' + p(s % 60));
    }, 1000);
    return () => clearInterval(t);
  }, [boot]);

  /* 60s health heartbeat — keeps the HUD + event stream honest while open */
  useEffect(() => {
    if (!boot) return undefined;
    const id = setInterval(async () => {
      try {
        const h = await brainGet('/api/health', 12000);
        if (h && h.ok) {
          setHealth(h);
          emitEvent({ chip: 'NET', who: 'Health', msg: `check OK · v${h.version} · uptime ${fmtUptime(h.uptime)}`, tone: 'var(--jcx-up)' });
        }
      } catch {
        emitEvent({ chip: 'WARN', who: 'Health', msg: 'check failed — brain not answering (it may be sleeping)', tone: 'var(--jcx-down)' });
      }
    }, 60000);
    return () => clearInterval(id);
  }, [boot]);

  const Active = VIEWS[route] || MissionsView;

  if (!boot) {
    return (
      <div className="jcx">
        <div className="jcx-glow" />
        <BootScreen onDone={finishBoot} />
      </div>
    );
  }

  return (
    <HudCtx.Provider value={hudState}>
      <BrainCtx.Provider value={{ fleet, health, online: hudState.connected || !!health }}>
      <div className="jcx">
        <div className="jcx-glow" />
        <div
          className={`jcx-drawerback${menu ? ' show' : ''}`}
          onClick={() => setMenu(false)}
          aria-hidden="true"
        />
        <Sidebar
          route={route}
          mobileOpen={menu}
          onClose={() => setMenu(false)}
          onNavigate={(id) => { window.location.hash = '#' + id; setMenu(false); }}
          onHome={() => { window.location.hash = ''; setMenu(false); }}
        />
        <main className="appmain">
          <TopBar elapsed={elapsed} onMenu={() => setMenu((o) => !o)} />
          <div className="views">
            <section key={route} className="vw active" data-view={route}>
              <Active />
            </section>
          </div>
          <EventStream />
        </main>
      </div>
      </BrainCtx.Provider>
    </HudCtx.Provider>
  );
}

export { subscribeBus };
