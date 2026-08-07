import { motion } from 'framer-motion';
import { Database, User, Globe, MessageSquare, HardDrive, Code, MapPin } from 'lucide-react';

export default function MemoryPanel({ memory }) {
  if (!memory) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Database className="w-8 h-8 text-[#00FF9D] animate-pulse mx-auto mb-2" />
          <p className="text-gray-600 text-xs">Accessing Memory Core...</p>
        </div>
      </div>
    );
  }

  const userCount = Object.values(memory.userProfile || {}).filter(v => v && v.length > 0).length;
  const internetCount = (memory.internetKnowledge || []).length;
  const codingCount = (memory.codingKnowledge || []).length;
  const chatCount = (memory.chatHistory || []).length;

  return (
    <div className="space-y-3">
      <div className="glass p-4 rounded-xl">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-[#00FF9D]" />
            <h2 className="text-sm font-bold text-[#00FF9D] tracking-wide">MEMORY CORE</h2>
          </div>
          <span className="text-[9px] text-gray-600">
            Last updated: {new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
          </span>
        </div>
        <div className="grid grid-cols-4 gap-2 mt-3">
          <div className="text-center bg-[#0a0a0a] p-2 rounded-lg">
            <p className="text-[#22c55e] font-bold text-lg">{userCount}</p>
            <p className="text-[7px] text-gray-600">USER</p>
          </div>
          <div className="text-center bg-[#0a0a0a] p-2 rounded-lg">
            <p className="text-[#3b82f6] font-bold text-lg">{internetCount}</p>
            <p className="text-[7px] text-gray-600">INTERNET</p>
          </div>
          <div className="text-center bg-[#0a0a0a] p-2 rounded-lg">
            <p className="text-[#a855f7] font-bold text-lg">{codingCount}</p>
            <p className="text-[7px] text-gray-600">CODING</p>
          </div>
          <div className="text-center bg-[#0a0a0a] p-2 rounded-lg">
            <p className="text-[#f59e0b] font-bold text-lg">{chatCount}</p>
            <p className="text-[7px] text-gray-600">CHAT</p>
          </div>
        </div>
      </div>

      <div className="glass p-3 rounded-xl">
        <div className="flex items-center gap-2 mb-2">
          <User className="w-3 h-3 text-[#22c55e]" />
          <h3 className="text-[10px] font-bold text-[#22c55e] tracking-wider">USER KNOWLEDGE</h3>
        </div>
        <div className="space-y-1 text-[10px]">
          <p className="text-gray-500">Name: <span className="text-white">{memory.userProfile?.name || 'Unknown'}</span></p>
          <p className="text-gray-500">Location: <span className="text-white">{memory.userProfile?.location || 'Unknown'}</span></p>
        </div>
      </div>

      <div className="glass p-3 rounded-xl">
        <div className="flex items-center gap-2 mb-2">
          <Globe className="w-3 h-3 text-[#3b82f6]" />
          <h3 className="text-[10px] font-bold text-[#3b82f6] tracking-wider">INTERNET KNOWLEDGE ({internetCount})</h3>
        </div>
        <div className="space-y-1 max-h-32 overflow-y-auto">
          {(memory.internetKnowledge || []).slice(-5).reverse().map((item, i) => (
            <div key={i} className="text-[9px] bg-[#0a0a0a] p-2 rounded border-l-2 border-[#3b82f6]/30">
              <p className="text-white truncate font-medium">{item.topic}</p>
              <p className="text-gray-600 text-[8px]">{new Date(item.date).toLocaleString()}</p>
            </div>
          ))}
          {internetCount === 0 && <p className="text-[9px] text-gray-700 italic">No internet research saved yet.</p>}
        </div>
      </div>

      <div className="glass p-3 rounded-xl">
        <div className="flex items-center gap-2 mb-2">
          <Code className="w-3 h-3 text-[#a855f7]" />
          <h3 className="text-[10px] font-bold text-[#a855f7] tracking-wider">CODING KNOWLEDGE ({codingCount})</h3>
        </div>
        <div className="space-y-1 max-h-32 overflow-y-auto">
          {(memory.codingKnowledge || []).slice(-5).reverse().map((item, i) => (
            <div key={i} className="text-[9px] bg-[#0a0a0a] p-2 rounded border-l-2 border-[#a855f7]/30">
              <p className="text-white truncate font-medium">{item.topic}</p>
              <p className="text-gray-600 text-[8px]">{item.language} • {new Date(item.date).toLocaleString()}</p>
            </div>
          ))}
          {codingCount === 0 && <p className="text-[9px] text-gray-700 italic">No coding solutions saved yet.</p>}
        </div>
      </div>

      <div className="glass p-3 rounded-xl">
        <div className="flex items-center gap-2 mb-2">
          <MessageSquare className="w-3 h-3 text-[#f59e0b]" />
          <h3 className="text-[10px] font-bold text-[#f59e0b] tracking-wider">CHAT HISTORY ({chatCount})</h3>
        </div>
        <div className="space-y-1 max-h-32 overflow-y-auto">
          {(memory.chatHistory || []).slice(-8).reverse().map((item, i) => (
            <div key={i} className="text-[9px] bg-[#0a0a0a] p-2 rounded border-l-2 border-[#f59e0b]/30">
              <span className={item.role === 'user' ? 'text-[#00FF9D] font-bold' : 'text-[#00d4ff] font-bold'}>
                {item.role === 'user' ? 'You: ' : 'JEXI: '}
              </span>
              <span className="text-gray-400">{item.text.replace(/[#*`]/g, '').substring(0, 80)}</span>
            </div>
          ))}
          {chatCount === 0 && <p className="text-[9px] text-gray-700 italic">No chat history yet.</p>}
        </div>
      </div>

      <div className="glass p-3 rounded-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HardDrive className="w-3 h-3 text-[#00FF9D]" />
            <h3 className="text-[10px] font-bold text-[#00FF9D] tracking-wider">MEMORY STATUS</h3>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[#00FF9D] animate-pulse" />
            <span className="text-[10px] text-[#00FF9D] font-bold">100% HEALTHY</span>
          </div>
        </div>
      </div>
    </div>
  );
}
