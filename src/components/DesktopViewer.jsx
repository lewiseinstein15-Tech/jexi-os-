import { useState, useEffect } from 'react';
import { Monitor, Activity } from 'lucide-react';
import axios from 'axios';

export default function DesktopViewer({ logs = [] }) {
  const [screenshot, setScreenshot] = useState(null);

  useEffect(() => {
    const takeScreenshot = async () => {
      try {
        const res = await axios.get('/desktop-api/desktop/coder/screenshot');
        if (res.data.success) setScreenshot(res.data.image);
      } catch (e) {}
    };
    
    takeScreenshot();
    const interval = setInterval(takeScreenshot, 800);
    return () => clearInterval(interval);
  }, []);

  const agentLogs = logs.filter(l => l.agent === 'ComputerUseAgent' || l.agent === 'Debugger' || l.agent === 'Output');

  return (
    <div className="flex flex-col h-full p-2 pb-20">
      <div className="flex items-center gap-2 mb-2">
        <Monitor className="w-4 h-4 text-[#00FF9D]" />
        <h2 className="text-[10px] font-bold text-[#00FF9D] tracking-wider">VIRTUAL DESKTOP (LIVE)</h2>
      </div>

      {/* THE SCREEN - Takes up all available space, NO overlays blocking it */}
      <div className="flex-1 bg-black rounded-xl overflow-hidden border border-[#1a1a1a] relative flex items-center justify-center min-h-0">
        {screenshot ? (
          <img 
            src={screenshot} 
            alt="Desktop" 
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="text-gray-600 text-[10px]">
            Connecting to Virtual Desktop...
          </div>
        )}
      </div>

      {/* LOGS - Moved to a small fixed-height panel BELOW the screen */}
      <div className="mt-2 bg-[#0a0a0a] rounded-lg p-2 h-28 overflow-y-auto border border-[#1a1a1a] flex-shrink-0">
        <div className="flex items-center gap-1 mb-1 sticky top-0 bg-[#0a0a0a] pb-1">
          <Activity className="w-3 h-3 text-[#00FF9D] animate-pulse" />
          <span className="text-[8px] font-bold text-[#00FF9D] tracking-wider">JEXI ACTIVITY</span>
        </div>
        {agentLogs.length === 0 ? (
          <p className="text-gray-700 text-[8px] italic">Waiting for JEXI to act...</p>
        ) : (
          agentLogs.slice(-10).reverse().map((log, i) => (
            <div key={i} className="text-[8px] flex gap-1 leading-tight mb-1">
              <span className={`font-bold flex-shrink-0 ${
                log.agent === 'Debugger' ? 'text-orange-400' :
                log.agent === 'Output' ? 'text-blue-400' :
                'text-[#00FF9D]'
              }`}>
                [{log.agent}]
              </span>
              <span className="text-gray-400 break-all">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
