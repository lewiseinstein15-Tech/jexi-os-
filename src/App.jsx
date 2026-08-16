import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { StatusBar } from '@capacitor/status-bar';
import { useJexiEngine } from './hooks/useJexiEngine';
import { useMemory } from './hooks/useMemory';
import usePhoneNotifications from './hooks/usePhoneNotifications'; // B83 — real phone notifications when tasks/goals finish
import { getBackendUrl } from './utils/helpers';
import TopNav from './components/TopNav';
import NavList from './components/NavList';
import BottomNavigation from './components/BottomNavigation';
import HomeView from './components/HomeView';
import CommandCenter from './components/CommandCenter';
import AgentsScreen from './components/AgentsScreen';
import MemoryPanel from './components/MemoryPanel';
import SettingsPanel from './components/SettingsPanel';
import KnowledgePanel from './components/KnowledgePanel';
import DownloadPanel from './components/DownloadPanel';
import UpdateBanner from './components/UpdateBanner';
import BootSplash from './components/BootSplash'; // B79 — branded loading screen on open (never a blank screen)
import TasksScreen from './components/TasksScreen';
import GoalsScreen from './components/GoalsScreen';
import NotificationsScreen from './components/NotificationsScreen';
import SkillsScreen from './components/SkillsScreen';
import WorkspaceScreen from './components/WorkspaceScreen';
import TerminalScreen from './components/TerminalScreen';
import PluginsScreen from './components/PluginsScreen';
import ModelsScreen from './components/ModelsScreen';
import McpScreen from './components/McpScreen';
import ConnectorsScreen from './components/ConnectorsScreen';
import ResearchScreen from './components/ResearchScreen';
import PlaceholderPage from './components/PlaceholderPage';
import ErrorBoundary from './components/ErrorBoundary';

const isDesktopQuery = () =>
  typeof window !== 'undefined' && !!window.matchMedia
    ? window.matchMedia('(min-width: 1024px)').matches
    : false;

// Future roadmap surfaces land here; every current nav item now has a real page.
const PLACEHOLDERS = {};

export default function App() {
  const [activeNav, setActiveNav] = useState('home');
  const [isDesktop, setIsDesktop] = useState(isDesktopQuery);
  // B79 — boot splash: hold the branded loading screen until the shell has
  // painted and a short branded moment has passed (ChatGPT/Claude style), so
  // opening the app never shows a blank frame.
  const [booted, setBooted] = useState(false);
  const [bootStatus, setBootStatus] = useState('Connecting to JEXI\u2019s brain…');
  const engine = useJexiEngine();
  const memory = useMemory(activeNav);
  usePhoneNotifications(); // B83 — polls the notification center and shows phone notifications

  // B79 — REAL loading page on open (never a blank screen, never a fake
  // flash): the branded splash stays up until the shell has painted AND the
  // backend is reachable, so a sleeping Render instance (up to ~45s cold
  // start) is covered by the loading page instead of an empty app. Hard cap
  // so the splash can never trap the app behind itself.
  useEffect(() => {
    let alive = true;
    let done = false;
    const finish = () => { if (alive && !done) { done = true; setBooted(true); } };
    // 1) Minimum brand moment — the splash never flashes.
    const minDelay = new Promise((r) => setTimeout(r, 1400));
    // 2) Real readiness signal — ping the brain. On success show "Brain
    //    online" for a beat before fading.
    const health = (async () => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      try {
        const res = await fetch(`${getBackendUrl()}/api/health`, { signal: ctrl.signal, cache: 'no-store' });
        if (alive && res.ok) {
          setBootStatus('Brain online');
          await new Promise((r) => setTimeout(r, 400));
        }
      } catch (e) { /* brain still sleeping — the hard cap releases us */ }
      finally { clearTimeout(t); }
    })();
    Promise.race([
      Promise.all([minDelay, health]),
      new Promise((r) => setTimeout(r, 15000)), // hard cap — never trap the app
    ]).then(finish);
    return () => { alive = false; };
  }, []);

  // Native polish: match the phone's status bar to the app's dark theme.
  useEffect(() => {
    if (window.Capacitor?.isNativePlatform?.()) {
      StatusBar.setBackgroundColor({ color: '#090A0E' }).catch(() => {});
      StatusBar.setStyle({ style: 'LIGHT' }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = (e) => setIsDesktop(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  const navigate = (id) => {
    setActiveNav(id);
    window.scrollTo?.({ top: 0 });
  };

  const openCommand = () => navigate('command');

  const renderPage = () => {
    switch (activeNav) {
      case 'home':
        return (
          <HomeView
            messages={engine.messages}
            logs={engine.logs}
            isProcessing={engine.isProcessing}
            onSend={engine.runSearch}
            onOpenCommand={openCommand}
          />
        );
      case 'command':
        return <CommandCenter engine={engine} isDesktop={isDesktop} />;
      case 'agents':
        return (
          <div className="px-3 pt-4 pb-8 space-y-3 max-w-[900px] mx-auto">
            <AgentsScreen logs={engine.logs} websites={engine.websites} isProcessing={engine.isProcessing} plan={engine.plan} />
          </div>
        );
      case 'tasks':
        return <TasksScreen />;
      case 'goals':
        return <GoalsScreen />;
      case 'notifications':
        return <NotificationsScreen />;
      case 'skills':
        return (
          <div className="px-3 pt-4 pb-8 space-y-3 max-w-[900px] mx-auto">
            <SkillsScreen
              onUseSkill={(query) => {
                engine.runSearch(query);
                navigate('home');
              }}
            />
          </div>
        );
      case 'research':
        return (
          <ResearchScreen
            engine={engine}
            onResearch={(query) => engine.runSearch(query)}
          />
        );
      case 'workspace':
        return (
          <div className="px-3 pt-4 pb-8 space-y-3 max-w-[900px] mx-auto">
            <WorkspaceScreen />
          </div>
        );
      case 'terminal':
        return (
          <div className="px-3 pt-4 pb-8 space-y-3 max-w-[900px] mx-auto">
            <TerminalScreen />
          </div>
        );
      case 'plugins':
        return (
          <div className="px-3 pt-4 pb-8 space-y-3 max-w-[900px] mx-auto">
            <PluginsScreen />
          </div>
        );
      case 'models':
        return (
          <div className="px-3 pt-4 pb-8 space-y-3 max-w-[900px] mx-auto">
            <ModelsScreen />
          </div>
        );
      case 'mcp':
        return (
          <div className="px-3 pt-4 pb-8 space-y-3 max-w-[900px] mx-auto">
            <McpScreen />
          </div>
        );
      case 'connectors':
        return (
          <div className="px-3 pt-4 pb-8 space-y-3 max-w-[900px] mx-auto">
            <ConnectorsScreen />
          </div>
        );
      case 'memory':
        return <MemoryPanel memory={memory} />;
      case 'knowledge':
        return <KnowledgePanel />;
      case 'settings':
        return <SettingsPanel />;
      case 'download':
        return <DownloadPanel />;
      default: {
        const p = PLACEHOLDERS[activeNav];
        return p
          ? <PlaceholderPage title={p.title} stage={p.stage} blurb={p.blurb} />
          : <PlaceholderPage title={activeNav.toUpperCase()} />;
      }
    }
  };

  return (
    <ErrorBoundary>
      <div className="app-shell overflow-hidden bg-void text-text-primary flex flex-col relative">
        {/* FIXED TOP BAR — never scrolls */}
        <TopNav activeNav={activeNav} running={engine.isProcessing} onNavigate={navigate} />
        <UpdateBanner />

        {/* MIDDLE ROW — fills the space between top bar and bottom nav; ONLY
            <main> scrolls. Everything else is pinned. */}
        <div className="flex flex-1 min-h-0">
          {/* Desktop rail — the OS navigation column (spec §47) */}
          {isDesktop && (
            <aside className="hidden lg:flex w-[216px] flex-shrink-0 border-r border-hairline px-2 py-4 overflow-y-auto">
              <NavList activeNav={activeNav} onNavigate={navigate} />
            </aside>
          )}

          {/* THE ONLY SCROLL CONTAINER — internal content scrolls here, the
              app shell never moves. */}
          <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeNav}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}
                className={activeNav === 'command'
                  ? 'h-full flex flex-col py-3 overflow-hidden' // B79 — the Command Center NEVER scrolls the page; only the inner chat scrolls
                  : 'min-h-full'}
              >
                {renderPage()}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>

        {/* FIXED BOTTOM NAVIGATION — mobile only, always visible */}
        <BottomNavigation activeNav={activeNav} setActiveNav={navigate} />

        {/* B79 — branded loading page on open; fades out once the shell is
            painted AND the brain is reachable (covers Render cold starts) */}
        <AnimatePresence>
          {!booted && <BootSplash key="boot-splash" status={bootStatus} />}
        </AnimatePresence>
      </div>
    </ErrorBoundary>
  );
}
