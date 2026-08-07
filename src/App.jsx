import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
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

export default function App() {
  const [activeNav, setActiveNav] = useState("home");
  const engine = useJexiEngine();
  const memory = useMemory(activeNav);

  return (
    <div className="min-h-screen bg-[#030303] text-gray-200 flex flex-col">
      <Header />
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
                  isProcessing={engine.isProcessing}
                  onSend={engine.runSearch}
                  onStop={engine.stopGeneration}
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
          </motion.div>
        </AnimatePresence>
      </main>
      <BottomNavigation activeNav={activeNav} setActiveNav={setActiveNav} />
    </div>
  );
}
