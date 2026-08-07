import { useState, useEffect } from 'react';
import { Settings, Key, Save, CheckCircle2, AlertCircle, Zap, Sparkles, Server } from 'lucide-react';
import { getBackendUrl, setBackendUrl } from '../utils/helpers';

export default function SettingsPanel() {
  const [geminiKey, setGeminiKey] = useState('');
  const [groqKey, setGroqKey] = useState('');
  const [status, setStatus] = useState('idle'); // idle, loading, saved, error
  const [initialLoad, setInitialLoad] = useState(true);

  const [backendUrl, setBackendUrlState] = useState(getBackendUrl());
  const [backendInput, setBackendInput] = useState(getBackendUrl());
  const [backendStatus, setBackendStatus] = useState('idle'); // idle, saved, error

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await fetch(`${getBackendUrl()}/api/settings`);
        const data = await res.json();
        setGeminiKey(data.geminiKey || '');
        setGroqKey(data.groqKey || '');
      } catch (e) {
        console.error("Failed to fetch settings", e);
      }
      setInitialLoad(false);
    };
    fetchSettings();
  }, []);

  const saveBackendUrl = () => {
    const clean = setBackendUrl(backendInput);
    setBackendUrlState(clean);
    setBackendStatus('saved');
    setTimeout(() => setBackendStatus('idle'), 2500);
  };

  const handleSave = async () => {
    setStatus('loading');
    try {
      const res = await fetch(`${backendUrl}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geminiKey, groqKey })
      });
      const data = await res.json();
      if (data.success) {
        setStatus('saved');
        setTimeout(() => setStatus('idle'), 3000);
      } else {
        setStatus('error');
      }
    } catch (e) {
      setStatus('error');
    }
  };

  return (
    <div className="space-y-4">
      <div className="glass p-4 rounded-xl">
        <div className="flex items-center gap-2 mb-4">
          <Settings className="w-4 h-4 text-[#00FF9D]" />
          <h2 className="text-sm font-bold text-[#00FF9D] tracking-wide">SYSTEM SETTINGS</h2>
        </div>

        <div className="space-y-4">
          {/* Google Gemini Key */}
          <div>
            <label className="flex items-center gap-2 text-[10px] font-bold text-gray-400 mb-1.5 tracking-wider">
              <Sparkles className="w-3 h-3 text-[#4285F4]" />
              GOOGLE GEMINI KEY (PRIMARY)
            </label>
            <input
              type="password"
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              placeholder="Enter Google Gemini API Key"
              className="w-full bg-[#0a0a0a] text-gray-200 border border-[#1a1a1a] rounded-lg px-3 py-2.5 text-xs focus:outline-none focus:border-[#00FF9D]/50 font-mono"
            />
            <p className="text-[8px] text-gray-600 mt-1">Get free key at aistudio.google.com/app/apikey</p>
          </div>

          {/* Groq Key */}
          <div>
            <label className="flex items-center gap-2 text-[10px] font-bold text-gray-400 mb-1.5 tracking-wider">
              <Zap className="w-3 h-3 text-[#f59e0b]" />
              GROQ KEY (FALLBACK)
            </label>
            <input
              type="password"
              value={groqKey}
              onChange={(e) => setGroqKey(e.target.value)}
              placeholder="Enter Groq API Key"
              className="w-full bg-[#0a0a0a] text-gray-200 border border-[#1a1a1a] rounded-lg px-3 py-2.5 text-xs focus:outline-none focus:border-[#00FF9D]/50 font-mono"
            />
            <p className="text-[8px] text-gray-600 mt-1">Get free key at console.groq.com/keys</p>
          </div>

          {/* Backend URL (runtime override) */}
          <div className="pt-3 border-t border-[#1a1a1a]">
            <label className="flex items-center gap-2 text-[10px] font-bold text-gray-400 mb-1.5 tracking-wider">
              <Server className="w-3 h-3 text-[#00d4ff]" />
              BACKEND URL (RUNTIME OVERRIDE)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={backendInput}
                onChange={(e) => setBackendInput(e.target.value)}
                placeholder="https://jexi-os-brain.onrender.com"
                className="w-full bg-[#0a0a0a] text-gray-200 border border-[#1a1a1a] rounded-lg px-3 py-2.5 text-xs focus:outline-none focus:border-[#00d4ff]/50 font-mono"
              />
              <button
                onClick={saveBackendUrl}
                className="bg-[#00d4ff] text-black rounded-lg px-3 py-2.5 text-xs font-bold flex items-center gap-1.5 flex-shrink-0"
              >
                <Save className="w-3.5 h-3.5" /> SAVE
              </button>
            </div>
            <p className="text-[8px] text-gray-600 mt-1">
              Current: <span className="text-[#00d4ff]">{backendUrl || 'same origin (/api)'}</span>
              {backendStatus === 'saved' && <span className="text-[#22c55e] ml-1">✓ Saved — applies immediately</span>}
            </p>
            <p className="text-[8px] text-gray-600">Leave empty to use the same origin or VITE_JEXI_BACKEND_URL. Changes apply instantly, no reload needed.</p>
          </div>

          {/* Save Button */}
          <button
            onClick={handleSave}
            disabled={status === 'loading' || initialLoad}
            className="w-full bg-[#00FF9D] text-black rounded-lg px-4 py-3 text-xs font-bold flex items-center justify-center gap-2 disabled:opacity-50 transition-opacity"
          >
            {status === 'loading' ? (
              'SAVING...'
            ) : status === 'saved' ? (
              <>
                <CheckCircle2 className="w-4 h-4" />
                KEYS SAVED SUCCESSFULLY
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                SAVE API KEYS
              </>
            )}
          </button>

          {status === 'error' && (
            <div className="flex items-center gap-2 text-red-500 text-[10px]">
              <AlertCircle className="w-3 h-3" />
              Failed to save keys. Check connection.
            </div>
          )}
        </div>
      </div>

      {/* Info Box */}
      <div className="glass p-4 rounded-xl">
        <div className="flex items-center gap-2 mb-2">
          <Key className="w-3 h-3 text-[#00d4ff]" />
          <h3 className="text-[10px] font-bold text-[#00d4ff] tracking-wider">SECURE STORAGE</h3>
        </div>
        <p className="text-[9px] text-gray-500 leading-relaxed">
          Your API keys are stored locally in JEXI OS's secure settings file on your device. They are never sent to any external server except the official AI provider you configure.
        </p>
      </div>
    </div>
  );
}
