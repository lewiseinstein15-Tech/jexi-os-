import { motion } from 'framer-motion';
import { Database, User, Globe, MessageSquare, HardDrive, MapPin } from 'lucide-react';

export default function MemoryPanel({ memory }) {
  if (!memory) return <div className="text-center text-gray-500 p-10">Accessing Memory Core...</div>;

  return (
    <div className="space-y-4">
      <div className="glass p-4 rounded-xl">
        <div className="flex items-center gap-2 mb-4">
          <Database className="w-4 h-4 text-[#00FF9D]" />
          <h2 className="text-sm font-bold text-[#00FF9D]">MEMORY CORE</h2>
        </div>
        
        <div className="grid grid-cols-1 gap-3">
          {/* User Knowledge */}
          <div className="glass-card p-3 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <User className="w-3 h-3 text-[#22c55e]" />
                <h3 className="text-[10px] font-bold text-[#22c55e]">USER KNOWLEDGE ({memory.stats.userItems})</h3>
              </div>
            </div>
            <div className="space-y-1 text-[10px] text-gray-400">
              <p>Name: <span className="text-white">{memory.userProfile.name || 'Unknown'}</span></p>
              <p>Location: <span className="text-white">{memory.userProfile.location || 'Unknown'}</span></p>
            </div>
          </div>

          {/* Internet Knowledge */}
          <div className="glass-card p-3 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Globe className="w-3 h-3 text-[#3b82f6]" />
                <h3 className="text-[10px] font-bold text-[#3b82f6]">INTERNET KNOWLEDGE ({memory.stats.internetItems})</h3>
              </div>
            </div>
            <div className="space-y-1 max-h-24 overflow-y-auto">
              {memory.internetKnowledge.slice(0, 3).map((item, i) => (
                <div key={i} className="text-[9px] text-gray-400 border-b border-[#00ff9d11] pb-1 mb-1">
                  <p className="text-white truncate">{item.topic}</p>
                  <p className="text-gray-600">{new Date(item.date).toLocaleString()}</p>
                </div>
              ))}
              {memory.internetKnowledge.length === 0 && <p className="text-[9px] text-gray-600 italic">No internet research saved yet.</p>}
            </div>
          </div>

          {/* Chat History */}
          <div className="glass-card p-3 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-3 h-3 text-[#a855f7]" />
                <h3 className="text-[10px] font-bold text-[#a855f7]">CHAT HISTORY ({memory.stats.chatItems})</h3>
              </div>
            </div>
            <div className="space-y-1 max-h-24 overflow-y-auto">
              {memory.chatHistory.slice(0, 3).map((item, i) => (
                <div key={i} className="text-[9px] text-gray-400 border-b border-[#00ff9d11] pb-1 mb-1">
                  <span className={item.role === 'user' ? 'text-[#00FF9D]' : 'text-[#00d4ff]'}>
                    {item.role === 'user' ? 'You: ' : 'JEXI: '}
                  </span>
                  <span className="text-gray-400 truncate">{item.text.replace(/[#*`]/g, '').substring(0, 50)}...</span>
                </div>
              ))}
              {memory.chatHistory.length === 0 && <p className="text-[9px] text-gray-600 italic">No chat history yet.</p>}
            </div>
          </div>

          {/* System Status */}
          <div className="glass-card p-3 rounded-lg flex items-center justify-between">
            <div className="flex items-center gap-2">
              <HardDrive className="w-3 h-3 text-[#f59e0b]" />
              <h3 className="text-[10px] font-bold text-[#f59e0b]">MEMORY STATUS</h3>
            </div>
            <span className="text-[10px] text-[#00FF9D] font-bold">{memory.stats.health}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
