import { useState, useEffect } from 'react';
import { BookOpen, Folder, FileText, Brain, RefreshCw, CheckCircle2, Circle } from 'lucide-react';

export default function KnowledgePanel() {
  const [structure, setStructure] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchKnowledge = async () => {
    setLoading(true);
    try {
      const [structRes, statusRes] = await Promise.all([
        fetch('http://localhost:3001/api/knowledge/structure'),
        fetch('http://localhost:3001/api/knowledge/status')
      ]);
      const structData = await structRes.json();
      const statusData = await statusRes.json();
      setStructure(structData);
      setStatus(statusData);
    } catch (e) {
      console.error("Failed to fetch knowledge", e);
    }
    setLoading(false);
  };

  useEffect(() => {
    // Fetch only once on load. No more auto-refresh interval!
    fetchKnowledge();
  }, []);

  return (
    <div className="space-y-3">
      <div className="glass p-4 rounded-xl">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-[#00FF9D]" />
            <h2 className="text-sm font-bold text-[#00FF9D] tracking-wide">KNOWLEDGE CORE</h2>
          </div>
          <button onClick={fetchKnowledge} className="text-gray-500 hover:text-[#00FF9D]">
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        
        {status && (
          <div className="grid grid-cols-3 gap-2 mt-3 mb-4">
            <div className="text-center bg-[#0a0a0a] p-2 rounded-lg">
              <p className="text-[#00FF9D] font-bold text-lg">{status.total}</p>
              <p className="text-[7px] text-gray-600">TOTAL FILES</p>
            </div>
            <div className="text-center bg-[#0a0a0a] p-2 rounded-lg">
              <p className="text-[#22c55e] font-bold text-lg">{status.filled}</p>
              <p className="text-[7px] text-gray-600">MASTERED</p>
            </div>
            <div className="text-center bg-[#0a0a0a] p-2 rounded-lg">
              <p className="text-[#f59e0b] font-bold text-lg">{status.empty}</p>
              <p className="text-[7px] text-gray-600">TO LEARN</p>
            </div>
          </div>
        )}
      </div>

      <div className="glass p-4 rounded-xl">
        <div className="flex items-center gap-2 mb-3">
          <BookOpen className="w-4 h-4 text-[#00d4ff]" />
          <h2 className="text-sm font-bold text-[#00d4ff] tracking-wide">LIBRARY STRUCTURE</h2>
        </div>
        
        {loading ? (
          <p className="text-center text-gray-600 text-xs py-4">Loading knowledge base...</p>
        ) : structure ? (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
            {Object.entries(structure).map(([category, files]) => (
              <div key={category} className="bg-[#0a0a0a] rounded-lg border border-[#1a1a1a] overflow-hidden">
                <div className="flex items-center gap-2 p-2 bg-[#111]">
                  <Folder className="w-3 h-3 text-[#00FF9D]" />
                  <span className="text-[10px] font-bold text-gray-300">{category}</span>
                </div>
                <div className="p-2 pl-4 space-y-1">
                  {files.map((file, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 text-[9px]">
                      <div className="flex items-center gap-2">
                        {file.filled ? (
                          <CheckCircle2 className="w-2.5 h-2.5 text-[#22c55e]" />
                        ) : (
                          <Circle className="w-2.5 h-2.5 text-gray-600" />
                        )}
                        <span className={file.filled ? 'text-gray-300' : 'text-gray-600'}>
                          {file.name}
                        </span>
                      </div>
                      {file.filled && (
                        <span className="text-[#22c55e] text-[8px] font-bold">MASTERED</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-center text-gray-600 text-xs py-4">Failed to load structure.</p>
        )}
      </div>
    </div>
  );
}
