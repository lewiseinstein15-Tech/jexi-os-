import { useState, useEffect, useRef, useCallback } from 'react';
import { Monitor, MousePointer, Keyboard, Hand, Bot, Server, RefreshCw, Loader2 } from 'lucide-react';
import axios from 'axios';
import { getBackendUrl, onBackendUrlChange } from '../utils/helpers';

// Agent → color for the live activity strip (specialist team + search/news sub-teams).
const AGENT_ACTIVITY_COLORS = {
  Debugger: 'text-orange-400',
  Output: 'text-blue-400',
  Vision: 'text-purple-400',
  Navigator: 'text-cyan-300',
  'QA Lead': 'text-amber-400',
  'Security Officer': 'text-red-400',
  Reviewer: 'text-blue-300',
  Shipper: 'text-orange-400',
  Reflector: 'text-teal-300',
  Product: 'text-amber-300',
  Designer: 'text-pink-400',
  Engineer: 'text-violet-300',
  Coder: 'text-green-400',
  'News Scout': 'text-emerald-300',
  'News Filter': 'text-lime-400',
  'News Editor': 'text-green-300',
  'Query Analyzer': 'text-sky-300',
  Searcher: 'text-cyan-400',
  Synthesizer: 'text-indigo-300',
  ComputerUseAgent: 'text-emerald-400',
  'Memory Agent': 'text-pink-400',
};

export default function DesktopViewer({ logs = [] }) {
  const [screenshot, setScreenshot] = useState(null);
  const [status, setStatus] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [shotError, setShotError] = useState(null);
  const [restarting, setRestarting] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [typeText, setTypeText] = useState('');
  const [lastClick, setLastClick] = useState({ x: 0, y: 0 });
  const [backendUrl, setBackendUrl] = useState(getBackendUrl());
  const [showUrlInput, setShowUrlInput] = useState(false);
  const imgRef = useRef(null);
  const inflightRef = useRef(false);
  const lastGoodShotRef = useRef(0);

  // React live when the backend URL changes in Settings
  useEffect(() => {
    const unsub = onBackendUrlChange((url) => setBackendUrl(url));
    return unsub;
  }, []);

  // One screenshot at a time — never pile up overlapping polls (which froze the stream
  // when the free backend was slow to wake or Chromium was relaunching).
  const takeScreenshot = useCallback(async () => {
    if (inflightRef.current) return;
    inflightRef.current = true;
    try {
      const res = await axios.get(`${backendUrl}/api/desktop/coder/screenshot`, { timeout: 30000 });
      if (res.data.success && res.data.image) {
        setScreenshot(res.data.image);
        lastGoodShotRef.current = Date.now();
        setShotError(null);
      } else if (res.data.error) {
        setShotError(res.data.error);
      }
    } catch (e) {
      // Most common cause on free hosting: the backend just woke from its idle sleep.
      setShotError('Backend is sleeping/waking — this can take up to a minute on the free tier. Keep this tab open; it reconnects automatically.');
    } finally {
      inflightRef.current = false;
    }
  }, [backendUrl]);

  useEffect(() => {
    takeScreenshot();
    const interval = setInterval(takeScreenshot, 800);
    return () => clearInterval(interval);
  }, [backendUrl, takeScreenshot]);

  // Live browser status — refresh the frame the moment eyes come back online.
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await axios.get(`${backendUrl}/api/desktop/status`, { timeout: 15000 });
        const wasReady = status?.ready;
        setStatus(res.data);
        if (res.data.ready && !wasReady) takeScreenshot();
      } catch (e) {
        setStatus({ ready: false, error: 'waking' });
      }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendUrl, takeScreenshot]);

  const restartEyes = async () => {
    setRestarting(true);
    setShotError('Restarting JEXI\u2019s eyes — one moment…');
    try {
      const res = await axios.post(`${backendUrl}/api/desktop/restart`, {}, { timeout: 60000 });
      if (!res.data.success) throw new Error(res.data.error || 'Restart failed');
      await takeScreenshot();
    } catch (e) {
      setShotError('Could not restart: ' + (e.message || 'backend unreachable'));
    } finally {
      setRestarting(false);
    }
  };

  const saveUrl = () => {
    localStorage.setItem('jexi_backend_url', backendUrl);
    setShowUrlInput(false);
  };

  const handleScreenClick = async (e) => {
    if (!manualMode || !imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) / rect.width * 1280);
    const y = Math.round((e.clientY - rect.top) / rect.height * 720);
    setLastClick({ x, y });
    try {
      await axios.post(`${backendUrl}/api/desktop/coder/click`, { x, y });
      setTimeout(takeScreenshot, 500);
    } catch (err) { setShotError('Click failed — browser may be reconnecting.'); }
  };

  const handleType = async () => {
    if (!typeText) return;
    try {
      await axios.post(`${backendUrl}/api/desktop/coder/type`, { text: typeText });
      setTypeText('');
      setTimeout(takeScreenshot, 500);
    } catch (err) { setShotError('Typing failed — browser may be reconnecting.'); }
  };

  const handleKeyPress = async (key) => {
    try {
      await axios.post(`${backendUrl}/api/desktop/coder/press`, { key });
      setTimeout(takeScreenshot, 500);
    } catch (err) { setShotError('Key press failed — browser may be reconnecting.'); }
  };

  // Show every agent's live activity (Planner, Coder, Runner, Terminal,
  // Debugger, Vision, Search, …) so the panel reflects what JEXI is doing
  // right now — not just computer-use actions.
  const agentLogs = (logs || []).filter(l => l && (l.agent || l.message));

  const staleSecs = screenshot ? Math.round((Date.now() - lastGoodShotRef.current) / 1000) : 0;
  const showStaleWarning = screenshot && status?.ready && staleSecs > 15;

  return (
    <div className="flex flex-col h-full p-2 pb-20">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Monitor className="w-4 h-4 text-[#00FF9D]" />
          <h2 className="text-[10px] font-bold text-[#00FF9D] tracking-wider">VIRTUAL DESKTOP</h2>
          {status && (
            status.ready
              ? <span className="flex items-center gap-1 bg-[#00FF9D]/10 border border-[#00FF9D]/30 text-[#00FF9D] rounded-full px-2 py-0.5 text-[8px] font-bold"><span className="w-1.5 h-1.5 rounded-full bg-[#00FF9D] animate-pulse" />LIVE</span>
              : <span className="flex items-center gap-1 bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-full px-2 py-0.5 text-[8px] font-bold"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />CONNECTING</span>
          )}
        </div>
        <div className="flex gap-1">
          <button onClick={restartEyes} disabled={restarting} className="bg-[#1a1a1a] text-gray-400 hover:text-[#00FF9D] rounded px-2 py-1 text-[8px] font-bold flex items-center gap-1 disabled:opacity-50" title="Force-restart JEXI's browser (fixes a stuck/white screen)">
            {restarting ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Restart eyes
          </button>
          <button onClick={() => setShowUrlInput(!showUrlInput)} className="bg-[#1a1a1a] text-gray-400 rounded px-2 py-1 text-[8px] font-bold flex items-center gap-1">
            <Server className="w-3 h-3" /> Cloud URL
          </button>
          <button onClick={() => setManualMode(!manualMode)} className={`px-3 py-1 rounded-md text-[9px] font-bold flex items-center gap-1 ${manualMode ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-[#00FF9D]/20 text-[#00FF9D] border border-[#00FF9D]/30'}`}>
            {manualMode ? <Hand className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
            {manualMode ? 'MANUAL' : 'AI'}
          </button>
        </div>
      </div>

      {showUrlInput && (
        <div className="mb-2 flex gap-1">
          <input type="text" value={backendUrl} onChange={(e) => setBackendUrl(e.target.value)} placeholder="https://...colab.dev" className="flex-1 bg-[#0a0a0a] text-gray-200 border border-[#1a1a1a] rounded-lg px-2 py-1 text-[9px]" />
          <button onClick={saveUrl} className="bg-[#00FF9D] text-black rounded-lg px-3 py-1 text-[9px] font-bold">Save</button>
        </div>
      )}

      <div className="flex-1 bg-black rounded-xl overflow-hidden border border-[#1a1a1a] relative flex items-center justify-center min-h-0">
        {screenshot ? (
          <img ref={imgRef} src={screenshot} alt="Desktop" onClick={handleScreenClick} onLoad={() => setLastUpdate(Date.now())} className={`w-full h-full object-contain ${manualMode ? 'cursor-pointer' : ''}`} />
        ) : shotError || (status && !status.ready) ? (
          <div className="text-center px-4">
            <p className="text-amber-400 text-[10px] font-bold mb-1">🖥️ Virtual Desktop connecting…</p>
            <p className="text-gray-500 text-[9px] break-all">{status?.error === 'waking' ? 'Backend is waking from idle sleep (free tier) — this takes up to a minute. Keep this tab open.' : (shotError || status?.error || 'Unknown')}</p>
          </div>
        ) : (
          <div className="text-gray-600 text-[10px] animate-pulse">Connecting to Virtual Desktop...</div>
        )}
        {manualMode && <div className="absolute top-2 left-2 bg-blue-500/20 backdrop-blur-sm rounded-lg px-2 py-1 border border-blue-500/30"><span className="text-blue-400 text-[8px] font-bold">👆 TAP TO CLICK</span></div>}
        {showStaleWarning && (
          <div className="absolute bottom-2 left-2 right-2 bg-amber-500/15 backdrop-blur-sm rounded-lg px-2 py-1 border border-amber-500/40">
            <span className="text-amber-300 text-[8px] font-bold">⚠ Screen frozen ({staleSecs}s) — tap "Restart eyes" to reconnect.</span>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between mt-1 px-1 text-[8px] text-gray-600">
        <span>{status?.ready ? '● Streaming live screenshots' : '○ Live streaming paused'}</span>
        <span>{lastUpdate ? `Updated ${Math.max(0, Math.round((Date.now() - lastUpdate) / 1000))}s ago` : '—'}</span>
      </div>

      {shotError && status?.ready && (
        <div className="mt-1 bg-red-500/10 border border-red-500/30 rounded-lg px-2 py-1">
          <span className="text-red-400 text-[8px] break-all">{shotError}</span>
        </div>
      )}

      {manualMode && (
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-2 text-[9px] text-gray-500"><MousePointer className="w-3 h-3" /><span>Last Click: X={lastClick.x}, Y={lastClick.y}</span></div>
          <div className="flex gap-2">
            <input type="text" value={typeText} onChange={(e) => setTypeText(e.target.value)} placeholder="Type text..." className="flex-1 bg-[#0a0a0a] text-gray-200 border border-[#1a1a1a] rounded-lg px-3 py-2 text-[10px]" onKeyDown={(e) => { if (e.key === 'Enter') handleType(); }} />
            <button onClick={handleType} className="bg-blue-500 text-white rounded-lg px-3 py-2 text-[10px] font-bold flex items-center gap-1"><Keyboard className="w-3 h-3" /> Type</button>
          </div>
          <div className="flex gap-1 flex-wrap">
            {['Return', 'ctrl+l', 'ctrl+c', 'Alt+F4', 'Page_Down', 'Page_Up', 'Tab', 'Escape'].map(key => <button key={key} onClick={() => handleKeyPress(key)} className="bg-[#1a1a1a] text-gray-400 rounded px-2 py-1 text-[8px] font-bold">{key}</button>)}
          </div>
        </div>
      )}

      {!manualMode && (
        <div className="mt-2 bg-[#0a0a0a] rounded-lg p-2 h-28 overflow-y-auto border border-[#1a1a1a] flex-shrink-0">
          <div className="flex items-center gap-1 mb-1 sticky top-0 bg-[#0a0a0a] pb-1"><Bot className="w-3 h-3 text-[#00FF9D] animate-pulse" /><span className="text-[8px] font-bold text-[#00FF9D] tracking-wider">JEXI ACTIVITY</span></div>
          {agentLogs.length === 0 ? <p className="text-gray-700 text-[8px] italic">Waiting for JEXI to act...</p> : agentLogs.slice(-10).reverse().map((log, i) => (
            <div key={i} className="text-[8px] flex gap-1 leading-tight mb-1">
              <span className={`font-bold flex-shrink-0 ${AGENT_ACTIVITY_COLORS[log.agent] || 'text-[#00FF9D]'}`}>[{log.agent}]</span>
              <span className="text-gray-400 break-all">{log.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
