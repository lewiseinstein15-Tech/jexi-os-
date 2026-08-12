import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { StatusBar } from '@capacitor/status-bar';
import { useJexiEngine } from './hooks/useJexiEngine';
import { useMemory } from './hooks/useMemory';
import Header from './components/Header';
import BottomNavigation from './components/BottomNavigation';
import ActivityWindow from './components/ActivityWindow';
import AgentsScreen from './components/AgentsScreen';
import ChatWindow from './components/ChatWindow';
import MemoryPanel from './components/MemoryPanel';
import SettingsPanel from './components/SettingsPanel';
import KnowledgePanel from './components/KnowledgePanel';
import DownloadPanel from './components/DownloadPanel';
import UpdateBanner from './components/UpdateBanner';
import TasksScreen from './components/TasksScreen';

const isDesktopQuery = () =>
  typeof window !== 'undefined' && !!window.matchMedia
    ? window.matchMedia('(min-width: 768px)').matches
    : false;

export default function App() {
  const [activeNav, setActiveNav] = useState("home");
  const [isDesktop, setIsDesktop] = useState(isDesktopQuery);
  const engine = useJexiEngine();
  const memory = useMemory(activeNav);

  // Native polish: match the phone's status bar to the app's dark theme
  // (light text on the dark background). No-op on the web.
  useEffect(() => {
    if (window.Capacitor?.isNativePlatform?.()) {
      StatusBar.setBackgroundColor({ color: '#030303' }).catch(() => {});
      StatusBar.setStyle({ style: 'LIGHT' }).catch(() => {});
    }
  }, []);

  // §7 responsiveness: ≥768px is desktop — chat caps at 640px centered, the
  // activity window becomes a persistent 280px right rail, and the nav moves
  // into the header (bottom nav hides).
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const onChange = (e) => setIsDesktop(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  return (
    <div className="min-h-screen bg-void text-text-primary flex flex-col">
      <Header
        plan={engine.plan}
        logs={engine.logs}
        running={engine.isProcessing}
        activeNav={activeNav}
        setActiveNav={setActiveNav}
      />
      <UpdateBanner />
      {/* Home is a fixed app viewport (not a scrolling web page): the activity
          strip sits on top and the chat fills the remaining space with its own
          internal scroll — input always pinned at the bottom, no page scroll.
          §7: pb includes the bottom-nav height + iOS safe area. */}
      <main className="flex-1 overflow-y-auto p-3 pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeNav}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className={
              activeNav === 'home'
                ? 'h-[calc(100dvh-118px)] flex flex-col gap-3'
                : activeNav === 'agents'
                  ? 'space-y-3 md:max-w-[900px] md:mx-auto'
                  : activeNav === 'tasks'
                    ? 'md:max-w-[1000px] md:mx-auto'
                    : 'space-y-3 md:max-w-[640px] md:mx-auto'
            }
          >
            {activeNav === 'home' && (
              <div className={isDesktop ? 'flex gap-4 items-stretch justify-center h-full min-h-0' : 'flex flex-col gap-3 flex-1 min-h-0'}>
                {/* Main column — chat capped at 640px on desktop */}
                <div className={isDesktop ? 'flex flex-col gap-3 w-full max-w-[640px] min-h-0' : 'flex flex-col gap-3 flex-1 min-h-0'}>
                  <ActivityWindow
                    logs={engine.logs}
                    websites={engine.websites}
                    isProcessing={engine.isProcessing}
                    compact
                    onOpenFull={() => setActiveNav('agents')}
                  />
                  <ChatWindow
                    messages={engine.messages}
                    logs={engine.logs}
                    isProcessing={engine.isProcessing}
                    onSend={engine.runSearch}
                    onStop={engine.stopGeneration}
                    onVisionResult={(text) => engine.pushMessage('jexi', text)}
                  />
                </div>
                {/* Desktop right rail — the pipeline as a persistent instrument */}
                {isDesktop && (
                  <aside className="w-[280px] flex-shrink-0 min-h-0">
                    <ActivityWindow
                      logs={engine.logs}
                      websites={engine.websites}
                      isProcessing={engine.isProcessing}
                      rail
                    />
                  </aside>
                )}
              </div>
            )}
            {activeNav === 'agents' && (
              <AgentsScreen
                logs={engine.logs}
                websites={engine.websites}
                isProcessing={engine.isProcessing}
                plan={engine.plan}
              />
            )}
            {activeNav === 'tasks' && <TasksScreen />}
            {activeNav === 'memory' && <MemoryPanel memory={memory} />}
            {activeNav === 'knowledge' && <KnowledgePanel />}
            {activeNav === 'settings' && <SettingsPanel />}
            {activeNav === 'download' && <DownloadPanel />}
          </motion.div>
        </AnimatePresence>
      </main>
      <BottomNavigation activeNav={activeNav} setActiveNav={setActiveNav} />
    </div>
  );
}
