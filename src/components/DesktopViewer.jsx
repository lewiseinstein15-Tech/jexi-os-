import { useState, useEffect, useRef } from 'react';
import { Monitor, MousePointer, Keyboard, Hand, Bot } from 'lucide-react';
import axios from 'axios';

export default function DesktopViewer({ logs = [] }) {
  const [screenshot, setScreenshot] = useState(null);
  const [manualMode, setManualMode] = useState(false);
  const [typeText, setTypeText] = useState('');
  const [lastClick, setLastClick] = useState({ x: 0, y: 0 });
  const imgRef = useRef(null);

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

  const handleScreenClick = async (e) => {
    if (!manualMode || !imgRef.current) return;
    
    const rect = imgRef.current.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) / rect.width * 1280);
    const y = Math.round((e.clientY - rect.top) / rect.height * 720);
    
    setLastClick({ x, y });
    
    try {
      await axios.post('/desktop-api/desktop/coder/click', { x, y });
      // Refresh screenshot after click
      setTimeout(async () => {
        const res = await axios.get('/desktop-api/desktop/coder/screenshot');
        if (res.data.success) setScreenshot(res.data.image);
      }, 500);
    } catch (e) { console.error(e); }
  };

  const handleType = async () => {
    if (!typeText) return;
    try {
      await axios.post('/desktop-api/desktop/coder/type', { text: typeText });
      setTypeText('');
      // Refresh screenshot
      setTimeout(async () => {
        const res = await axios.get('/desktop-api/desktop/coder/screenshot');
        if (res.data.success) setScreenshot(res.data.image);
      }, 500);
    } catch (e) { console.error(e); }
  };

  const handleKeyPress = async (key) => {
    try {
      await axios.post('/desktop-api/desktop/coder/press', { key });
      setTimeout(async () => {
        const res = await axios.get('/desktop-api/desktop/coder/screenshot');
        if (res.data.success) setScreenshot(res.data.image);
      }, 500);
    } catch (e) { console.error(e); }
  };

  const agentLogs = logs.filter(l => l.agent === 'ComputerUseAgent' || l.agent === 'Debugger' || l.agent === 'Output' || l.agent === 'Vision');

  return (
    <div className="flex flex-col h-full p-2 pb-20">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Monitor className="w-4 h-4 text-[#00FF9D]" />
          <h2 className="text-[10px] font-bold text-[#00FF9D] tracking-wider">VIRTUAL DESKTOP</h2>
        </div>
        
        {/* Manual Control Toggle */}
        <button
          onClick={() => setManualMode(!manualMode)}
          className={`px-3 py-1 rounded-md text-[9px] font-bold flex items-center gap-1 ${
            manualMode ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-[#00FF9D]/20 text-[#00FF9D] border border-[#00FF9D]/30'
          }`}
        >
          {manualMode ? <Hand className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
          {manualMode ? 'MANUAL MODE' : 'AI MODE'}
        </button>
      </div>

      {/* Desktop Screen */}
      <div className="flex-1 bg-black rounded-xl overflow-hidden border border-[#1a1a1a] relative flex items-center justify-center min-h-0">
        {screenshot ? (
          <img 
            ref={imgRef}
            src={screenshot} 
            alt="Desktop" 
            onClick={handleScreenClick}
            className={`w-full h-full object-contain ${manualMode ? 'cursor-pointer' : ''}`}
          />
        ) : (
          <div className="text-gray-600 text-[10px]">
            Connecting to Virtual Desktop...
          </div>
        )}
        
        {/* Manual Mode Indicator */}
        {manualMode && (
          <div className="absolute top-2 left-2 bg-blue-500/20 backdrop-blur-sm rounded-lg px-2 py-1 border border-blue-500/30">
            <span className="text-blue-400 text-[8px] font-bold">👆 TAP TO CLICK</span>
          </div>
        )}
      </div>

      {/* Manual Control Panel */}
      {manualMode && (
        <div className="mt-2 space-y-2">
          {/* Coordinates */}
          <div className="flex items-center gap-2 text-[9px] text-gray-500">
            <MousePointer className="w-3 h-3" />
            <span>Last Click: X={lastClick.x}, Y={lastClick.y}</span>
          </div>

          {/* Keyboard Input */}
          <div className="flex gap-2">
            <input
              type="text"
              value={typeText}
              onChange={(e) => setTypeText(e.target.value)}
              placeholder="Type text..."
              className="flex-1 bg-[#0a0a0a] text-gray-200 border border-[#1a1a1a] rounded-lg px-3 py-2 text-[10px] focus:outline-none focus:border-blue-500/50"
              onKeyDown={(e) => { if (e.key === 'Enter') handleType(); }}
            />
            <button 
              onClick={handleType}
              className="bg-blue-500 text-white rounded-lg px-3 py-2 text-[10px] font-bold flex items-center gap-1"
            >
              <Keyboard className="w-3 h-3" /> Type
            </button>
          </div>

          {/* Quick Keys */}
          <div className="flex gap-1 flex-wrap">
            {['Return', 'ctrl+l', 'ctrl+c', 'Alt+F4', 'Page_Down', 'Page_Up', 'Tab', 'Escape'].map(key => (
              <button
                key={key}
                onClick={() => handleKeyPress(key)}
                className="bg-[#1a1a1a] text-gray-400 rounded px-2 py-1 text-[8px] font-bold hover:bg-[#222] hover:text-white"
              >
                {key}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* AI Activity Log (shown when not in manual mode) */}
      {!manualMode && (
        <div className="mt-2 bg-[#0a0a0a] rounded-lg p-2 h-28 overflow-y-auto border border-[#1a1a1a] flex-shrink-0">
          <div className="flex items-center gap-1 mb-1 sticky top-0 bg-[#0a0a0a] pb-1">
            <Bot className="w-3 h-3 text-[#00FF9D] animate-pulse" />
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
                  log.agent === 'Vision' ? 'text-purple-400' :
                  'text-[#00FF9D]'
                }`}>
                  [{log.agent}]
                </span>
                <span className="text-gray-400 break-all">{log.message}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
