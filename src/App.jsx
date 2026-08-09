import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { StatusBar } from '@capacitor/status-bar';
import { useJexiEngine } from './hooks/useJexiEngine';
import { useMemory } from './hooks/useMemory';
import Header from './components/Header';
import BottomNavigation from './components/BottomNavigation';
import ActivityWindow from './components/ActivityWindow';
import ChatWindow from './components/ChatWindow';
import MemoryPanel from './components/MemoryPanel';
import SettingsPanel from './components/SettingsPanel';
import KnowledgePanel from './components/KnowledgePanel';
import DesktopViewer from './components/DesktopViewer';
import DownloadPanel from './components/DownloadPanel';
import UpdateBanner from './components/UpdateBanner';

export default function App() {
  const [activeNav, setActiveNav] = useState("home");
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

  // No more auto-switching! You control the tabs manually.

  return (
    <div className="min-h-screen bg-[#030303] text-gray-200 flex flex-col">
      <Header />
      <UpdateBanner />
      <main className="flex-1 overflow-y-auto p-3 pb-24">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeNav}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="space-y-3"
          >
            {activeNav === 'home' && (
              <>
                <ActivityWindow
                  logs={engine.logs}
                  websites={engine.websites}
                  isProcessing={engine.isProcessing}
                />
                <ChatWindow
                  messages={engine.messages}
                  logs={engine.logs}
                  isProcessing={engine.isProcessing}
                  onSend={engine.runSearch}
                  onStop={engine.stopGeneration}
                  onVisionResult={(text) => engine.pushMessage('jexi', text)}
                />
              </>
            )}
            {activeNav === 'agents' && (
              <ActivityWindow
                logs={engine.logs}
                websites={engine.websites}
                isProcessing={engine.isProcessing}
              />
            )}
            {activeNav === 'memory' && <MemoryPanel memory={memory} />}
            {activeNav === 'knowledge' && <KnowledgePanel />}
            {activeNav === 'desktop' && <DesktopViewer logs={engine.logs} />}
            {activeNav === 'settings' && <SettingsPanel />}
            {activeNav === 'download' && <DownloadPanel />}
          </motion.div>
        </AnimatePresence>
      </main>
      <BottomNavigation activeNav={activeNav} setActiveNav={setActiveNav} />
    </div>
  );
}
