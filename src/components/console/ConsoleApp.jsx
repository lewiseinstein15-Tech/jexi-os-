import { useEffect, useState } from 'react';
import '../../styles/jexi-theme.css'; // console design tokens + styles (extracted verbatim from the approved preview)
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import EventStream from './EventStream';
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

/* ConsoleApp — the approved preview (ui/preview/console.html) as a real
   React surface. Hash-routed (#missions … #scheduler) so the URL matches
   the preview exactly. No router dependency: the existing React setup has
   none, and the Scope Guard forbids new dependencies that aren't required
   — a 15-line hash hook covers every route.

   All 12 views from the preview, same mock data, same design tokens
   (src/styles/jexi-theme.css). Chat is mock until wired to /api/chat in a
   later scope. */

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

export default function ConsoleApp({ route }) {
  /* mission clock — continues the preview's static mission clock */
  const [elapsed, setElapsed] = useState('00:14:22');
  useEffect(() => {
    let base = 14 * 3600 + 26 * 60 + 42;
    const pad = (n) => (n < 10 ? '0' : '') + n;
    const t = setInterval(() => {
      base += 1;
      setElapsed(pad(Math.floor(base / 3600)) + ':' + pad(Math.floor(base / 60) % 60) + ':' + pad(base % 60));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const Active = VIEWS[route] || MissionsView;

  return (
    <div className="jcx">
      <div className="jcx-glow" />
      <Sidebar
        route={route}
        onNavigate={(id) => { window.location.hash = '#' + id; }}
        onHome={() => { window.location.hash = ''; }}
      />
      <main className="appmain">
        <TopBar elapsed={elapsed} />
        <div className="views">
          <section key={route} className="vw active" data-view={route}>
            <Active />
          </section>
        </div>
        <EventStream />
      </main>
    </div>
  );
}
