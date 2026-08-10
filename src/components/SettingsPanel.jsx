import { useState, useEffect } from 'react';
import { Settings, Key, Save, CheckCircle2, AlertCircle, Zap, Sparkles, Server, Github, ShieldCheck, Globe } from 'lucide-react';
import { getBackendUrl, setBackendUrl } from '../utils/helpers';
import PanelHeader from './PanelHeader';

// Each credential's status from the backend: { configured, source: 'env' | 'settings' | 'none' }
function KeyField({ label, icon, color, value, onChange, placeholder, hint, status, envNames }) {
  const activeEnv = status && status.source === 'env';
  return (
    <div>
      <label className="flex items-center gap-2 text-[10px] font-bold text-gray-400 mb-1.5 tracking-wider">
        {icon}
        {label}
        {activeEnv ? (
          <span className="ml-auto flex items-center gap-1 text-[#22c55e] text-[8px] bg-[#22c55e]/10 border border-[#22c55e]/30 rounded-full px-2 py-0.5">
            <CheckCircle2 className="w-2.5 h-2.5" /> ACTIVE — ENV VAR
          </span>
        ) : status && status.source === 'settings' ? (
          <span className="ml-auto flex items-center gap-1 text-[#00d4ff] text-[8px] bg-[#00d4ff]/10 border border-[#00d4ff]/30 rounded-full px-2 py-0.5">
            <ShieldCheck className="w-2.5 h-2.5" /> STORED ON DEVICE
          </span>
        ) : (
          <span className="ml-auto text-[#6b7280] text-[8px] bg-[#1a1a1a] border border-[#2a2a2a] rounded-full px-2 py-0.5">
            NOT SET
          </span>
        )}
      </label>
      {activeEnv ? (
        <div className="w-full bg-[#0a0a0a]/60 text-gray-400 border border-[#22c55e]/20 rounded-lg px-3 py-2.5 text-xs font-mono">
          ✓ Loaded from the server environment ({envNames.join(' / ')}) — set in Render, nothing to paste here.
        </div>
      ) : (
        <input
          type="password"
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          className="w-full bg-[#0a0a0a] text-gray-200 border border-[#1a1a1a] rounded-lg px-3 py-2.5 text-xs focus:outline-none focus:border-[#00FF9D]/50 font-mono"
        />
      )}
      <p className="text-[8px] text-gray-600 mt-1">{hint}</p>
    </div>
  );
}

export default function SettingsPanel() {
  const [geminiKey, setGeminiKey] = useState('');
  const [groqKey, setGroqKey] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [keyStatus, setKeyStatus] = useState(null); // { groq, gemini, github }
  const [status, setStatus] = useState('idle'); // idle, loading, saved, error
  const [initialLoad, setInitialLoad] = useState(true);

  const [backendUrl, setBackendUrlState] = useState(getBackendUrl());
  const [backendInput, setBackendInput] = useState(getBackendUrl());
  const [backendStatus, setBackendStatus] = useState('idle'); // idle, saved, error

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const base = getBackendUrl();
        const [res, statusRes] = await Promise.all([
          fetch(`${base}/api/settings`),
          fetch(`${base}/api/settings/status`),
        ]);
        const data = await res.json();
        setGeminiKey(data.geminiKey || '');
        setGroqKey(data.groqKey || '');
        setGithubToken(data.githubToken || '');
        try { setKeyStatus(await statusRes.json()); } catch (e) { /* status endpoint optional */ }
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
      // Only send keys that are NOT already active via environment variables —
      // env-configured keys are the source of truth in production (Render).
      const body = {};
      if (!keyStatus?.gemini?.configured) body.geminiKey = geminiKey;
      if (!keyStatus?.groq?.configured) body.groqKey = groqKey;
      if (!keyStatus?.github?.configured) body.githubToken = githubToken;
      const res = await fetch(`${backendUrl}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
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
        <PanelHeader icon={Settings} title="SYSTEM SETTINGS" />

        <div className="space-y-4">
          {/* Google Gemini Key */}
          <KeyField
            label="GOOGLE GEMINI KEY (PRIMARY)"
            icon={<Sparkles className="w-3 h-3 text-[#4285F4]" />}
            value={geminiKey}
            onChange={(e) => setGeminiKey(e.target.value)}
            placeholder="Enter Google Gemini API Key"
            hint="Get free key at aistudio.google.com/app/apikey — or set GEMINI_API_KEY in Render and it's automatic."
            status={keyStatus?.gemini}
            envNames={['GEMINI_API_KEY']}
          />

          {/* Groq Key */}
          <KeyField
            label="GROQ KEY (FALLBACK)"
            icon={<Zap className="w-3 h-3 text-[#f59e0b]" />}
            value={groqKey}
            onChange={(e) => setGroqKey(e.target.value)}
            placeholder="Enter Groq API Key"
            hint="Get free key at console.groq.com/keys — or set GROQ_API_KEY in Render and it's automatic."
            status={keyStatus?.groq}
            envNames={['GROQ_API_KEY']}
          />

          {/* GitHub Token — powers the GitHub Agent (commit, push, PR, issues) */}
          <KeyField
            label="GITHUB TOKEN (COMMIT, PUSH, PRS)"
            icon={<Github className="w-3 h-3 text-white" />}
            value={githubToken}
            onChange={(e) => setGithubToken(e.target.value)}
            placeholder="ghp_… (Settings → Developer settings → Personal access tokens → repo scope)"
            hint={'Without it, GitHub actions show "not authenticated" — set GITHUB_TOKEN in Render, or paste a token with the repo scope here to let JEXI commit, push and open pull requests for you.'}
            status={keyStatus?.github}
            envNames={['GITHUB_TOKEN / GH_TOKEN']}
          />

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
                <CheckCircle2 className="w-4 h-4" /> KEYS SAVED SUCCESSFULLY
              </>
            ) : (
              <>
                <Save className="w-4 h-4" /> SAVE KEYS
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
        <PanelHeader icon={Key} title="WHERE YOUR KEYS LIVE" color="text-[#00d4ff]" />
        <p className="text-[9px] text-gray-500 leading-relaxed space-y-1">
          <span className="flex items-start gap-1.5"><Globe className="w-3 h-3 mt-0.5 text-[#22c55e] flex-shrink-0" /> <span><span className="text-gray-400">Production (Render):</span> keys are set as environment variables (<span className="font-mono text-gray-400">GEMINI_API_KEY</span>, <span className="font-mono text-gray-400">GROQ_API_KEY</span>, <span className="font-mono text-gray-400">GITHUB_TOKEN</span>) — JEXI reads them automatically, no pasting required.</span></span>
          <span className="flex items-start gap-1.5"><ShieldCheck className="w-3 h-3 mt-0.5 text-[#00d4ff] flex-shrink-0" /> <span><span className="text-gray-400">Local / self-hosted:</span> the fields above store keys in JEXI's settings file on your device. They're never sent anywhere except the official AI provider / GitHub API, and only for actions you explicitly ask for.</span></span>
        </p>
      </div>
    </div>
  );
}
