import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { StatusBar } from '@capacitor/status-bar';
import { useJexiEngine } from './hooks/useJexiEngine';
import { useMemory } from './hooks/useMemory';
import TopNav from './components/TopNav';
import NavList from './components/NavList';
import HomeView from './components/HomeView';
import CommandCenter from './components/CommandCenter';
import AgentsScreen from './components/AgentsScreen';
import MemoryPanel from './components/MemoryPanel';
import SettingsPanel from './components/SettingsPanel';
import KnowledgePanel from './components/KnowledgePanel';
import DownloadPanel from './components/DownloadPanel';
import UpdateBanner from './components/UpdateBanner';
import TasksScreen from './components/TasksScreen';
import SkillsScreen from './components/SkillsScreen';
import WorkspaceScreen from './components/WorkspaceScreen';
import TerminalScreen from './components/TerminalScreen';
import PluginsScreen from './components/PluginsScreen';
import PlaceholderPage from './components/PlaceholderPage';

const isDesktopQuery = () =>
  typeof window !== 'undefined' && !!window.matchMedia
    ? window.matchMedia('(min-width: 1024px)').matches
    : false;

const PLACEHOLDERS = {
  research: { title: 'RESEARCH', stage: 5, blurb: 'A dedicated research console. The research team already runs in the backend — try it now in the Command Center.' },
  models: { title: 'MODELS', stage: 24, blurb: 'Per-agent model routing and local inference (llama.cpp / Ollama / vLLM / OpenAI-compatible).' },
};

export default function App() {
  const [activeNav, setActiveNav] = useState('home');
  const [isDesktop, setIsDesktop] = useState(isDesktopQuery);
  const engine = useJexiEngine();
  const memory = useMemory(activeNav);

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
    <div className="min-h-screen bg-void text-text-primary flex flex-col">
      <TopNav activeNav={activeNav} running={engine.isProcessing} onNavigate={navigate} />
      <UpdateBanner />

      <div className="flex flex-1 min-h-0">
        {/* Desktop rail — the OS navigation column (spec §47) */}
        {isDesktop && (
          <aside className="hidden lg:flex w-[216px] flex-shrink-0 border-r border-hairline px-2 py-4 overflow-y-auto">
            <NavList activeNav={activeNav} onNavigate={navigate} />
          </aside>
        )}

        <main className="flex-1 min-h-0 overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeNav}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className={activeNav === 'command'
                ? 'h-[calc(100dvh-53px)] flex flex-col py-3'
                : 'min-h-full'}
            >
              {renderPage()}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
