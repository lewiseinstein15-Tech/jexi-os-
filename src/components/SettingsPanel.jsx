import { useState, useEffect } from 'react';
import { Settings, Key, Save, CheckCircle2, AlertCircle, Zap, Sparkles, Server, Github, ShieldCheck, Globe, Lock, Cpu, Cloud } from 'lucide-react';
import { getBackendUrl, setBackendUrl, getAccessKey, setAccessKey, jexiFetch } from '../utils/helpers';
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
          <span className="ml-auto flex items-center gap-1 text-brand text-[8px] bg-brand-dim border border-brand-line rounded-full px-2 py-0.5">
            <CheckCircle2 className="w-2.5 h-2.5" /> ACTIVE — ENV VAR
          </span>
        ) : status && status.source === 'settings' ? (
          <span className="ml-auto flex items-center gap-1 text-cyan-400 text-[8px] bg-[#22D3EE]/10 border border-[#22D3EE]/30 rounded-full px-2 py-0.5">
            <ShieldCheck className="w-2.5 h-2.5" /> STORED ON DEVICE
          </span>
        ) : (
          <span className="ml-auto text-text-tertiary text-[8px] bg-surface-2 border border-hairline rounded-full px-2 py-0.5">
            NOT SET
          </span>
        )}
      </label>
      {activeEnv ? (
        <div className="w-full bg-surface-2/60 text-text-secondary border border-brand-line rounded-md px-3 py-2.5 text-xs font-mono">
          ✓ Loaded from the server environment ({envNames.join(' / ')}) — set in Render, nothing to paste here.
        </div>
      ) : (
        <input
          type="password"
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          className="w-full bg-surface-2 text-text-primary border border-hairline rounded-md px-3 py-2.5 text-xs focus:outline-none focus:border-brand-line font-mono"
        />
      )}
      <p className="text-[8px] text-text-tertiary mt-1">{hint}</p>
    </div>
  );
}

export default function SettingsPanel() {
  const [geminiKey, setGeminiKey] = useState('');
  const [groqKey, setGroqKey] = useState('');
  const [openrouterKey, setOpenrouterKey] = useState('');
  const [hfKey, setHfKey] = useState('');
  const [cerebrasKey, setCerebrasKey] = useState('');
  const [deepinfraKey, setDeepinfraKey] = useState('');
  const [mistralKey, setMistralKey] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [keyStatus, setKeyStatus] = useState(null); // { groq, gemini, github }
  const [status, setStatus] = useState('idle'); // idle, loading, saved, error
  const [initialLoad, setInitialLoad] = useState(true);

  const [accessKey, setAccessKeyState] = useState(getAccessKey());
  const [backendUrl, setBackendUrlState] = useState(getBackendUrl());
  const [backendInput, setBackendInput] = useState(getBackendUrl());
  const [backendStatus, setBackendStatus] = useState('idle'); // idle, saved, error

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const base = getBackendUrl();
        const [res, statusRes] = await Promise.all([
          jexiFetch(`${base}/api/settings`),
          jexiFetch(`${base}/api/settings/status`),
        ]);
        const data = await res.json();
        setGeminiKey(data.geminiKey || '');
        setGroqKey(data.groqKey || '');
        setOpenrouterKey(data.openrouterKey || '');
        setHfKey(data.hfKey || '');
        setCerebrasKey(data.cerebrasKey || '');
        setDeepinfraKey(data.deepinfraKey || '');
        setMistralKey(data.mistralKey || '');
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
      if (!keyStatus?.openrouter?.configured) body.openrouterKey = openrouterKey;
      if (!keyStatus?.huggingface?.configured) body.hfKey = hfKey;
      if (!keyStatus?.cerebras?.configured) body.cerebrasKey = cerebrasKey;
      if (!keyStatus?.deepinfra?.configured) body.deepinfraKey = deepinfraKey;
      if (!keyStatus?.mistral?.configured) body.mistralKey = mistralKey;
      if (!keyStatus?.github?.configured) body.githubToken = githubToken;
      const res = await jexiFetch(`${backendUrl}/api/settings`, {
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
      <div className="surface-card p-4">
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
            label="GROQ KEY (FAST CHAT)"
            icon={<Zap className="w-3 h-3 text-status-warn" />}
            value={groqKey}
            onChange={(e) => setGroqKey(e.target.value)}
            placeholder="Enter Groq API Key"
            hint="Get free key at console.groq.com/keys — or set GROQ_API_KEY in Render and it's automatic."
            status={keyStatus?.groq}
            envNames={['GROQ_API_KEY']}
          />

          {/* OpenRouter — Seed vision + free text fallback */}
          <KeyField
            label="OPENROUTER KEY (SEED VISION + FREE TEXT)"
            icon={<Globe className="w-3 h-3 text-cyan-400" />}
            value={openrouterKey}
            onChange={(e) => setOpenrouterKey(e.target.value)}
            placeholder="sk-or-…"
            hint="Get free key at openrouter.ai — unlocks Seed 2.0 vision (ByteDance) + free model routes as a fallback provider."
            status={keyStatus?.openrouter}
            envNames={['OPENROUTER_API_KEY']}
          />

          {/* HuggingFace — free Inference API text fallback */}
          <KeyField
            label="HUGGINGFACE TOKEN (FREE FALLBACK)"
            icon={<Sparkles className="w-3 h-3 text-brand" />}
            value={hfKey}
            onChange={(e) => setHfKey(e.target.value)}
            placeholder="hf_…"
            hint="Get free token at huggingface.co/settings/tokens — used as the last-resort text provider when the others rate-limit."
            status={keyStatus?.huggingface}
            envNames={['HF_TOKEN']}
          />

          {/* Cerebras — free fast inference (like Groq) */}
          <KeyField
            label="CEREBRAS KEY (FREE FAST)"
            icon={<Cpu className="w-3 h-3 text-brand" />}
            value={cerebrasKey}
            onChange={(e) => setCerebrasKey(e.target.value)}
            placeholder="Get free key at cloud.cerebras.ai — no card"
            hint="Free tier, no credit card — GPT-OSS 120B. Set CEREBRAS_API_KEY in Render and it's automatic."
            status={keyStatus?.cerebras}
            envNames={['CEREBRAS_API_KEY']}
          />

          {/* DeepInfra — free open-model inference */}
          <KeyField
            label="DEEPINFRA KEY (FREE OPEN MODELS)"
            icon={<Server className="w-3 h-3 text-sky-400" />}
            value={deepinfraKey}
            onChange={(e) => setDeepinfraKey(e.target.value)}
            placeholder="Get free key at deepinfra.com — no card"
            hint="Free tier models like Llama 3.1 8B. Set DEEPINFRA_API_KEY in Render and it's automatic."
            status={keyStatus?.deepinfra}
            envNames={['DEEPINFRA_API_KEY']}
          />

          {/* Mistral — free Experiment tier */}
          <KeyField
            label="MISTRAL KEY (FREE EXPERIMENT TIER)"
            icon={<Cloud className="w-3 h-3 text-orange-400" />}
            value={mistralKey}
            onChange={(e) => setMistralKey(e.target.value)}
            placeholder="Get free key at console.mistral.ai — no card"
            hint="Free Experiment tier for open models. Set MISTRAL_API_KEY in Render and it's automatic."
            status={keyStatus?.mistral}
            envNames={['MISTRAL_API_KEY']}
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

          {/* JEXI Access Key — required only if the backend is locked with JEXI_API_KEY */}
          <div className="bg-surface-2 border border-hairline rounded-md p-3">
            <label className="flex items-center gap-2 text-[10px] font-bold text-text-secondary mb-1.5 tracking-wider">
              <Lock className="w-3 h-3 text-brand" />
              JEXI ACCESS KEY (OPTIONAL)
              {accessKey ? (
                <span className="ml-auto flex items-center gap-1 text-brand text-[8px] bg-brand-dim border border-brand-line rounded-full px-2 py-0.5">
                  <CheckCircle2 className="w-2.5 h-2.5" /> KEY SET
                </span>
              ) : (
                <span className="ml-auto text-text-tertiary text-[8px] bg-surface-1 border border-hairline rounded-full px-2 py-0.5">
                  NOT LOCKED
                </span>
              )}
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                value={accessKey}
                onChange={(e) => setAccessKeyState(e.target.value)}
                placeholder="Leave empty if your server is open"
                className="w-full bg-surface-1 text-text-primary border border-hairline rounded-md px-3 py-2.5 text-xs focus:outline-none focus:border-brand-line font-mono"
              />
              <button
                onClick={() => { setAccessKey(accessKey.trim()); setStatus('saved'); setTimeout(() => setStatus('idle'), 3000); }}
                className="bg-brand text-black rounded-md px-3 py-2.5 text-xs font-bold flex items-center gap-1.5 flex-shrink-0"
              >
                <Save className="w-3.5 h-3.5" /> APPLY
              </button>
            </div>
            <p className="text-[8px] text-text-tertiary mt-1">If you set <span className="font-mono text-text-secondary">JEXI_API_KEY</span> on the server (Render → Environment), every request must carry this key. Stored in your browser, sent only to your own backend.</p>
          </div>

          {/* Backend URL (runtime override) */}
          <div className="pt-3 border-t border-hairline">
            <label className="flex items-center gap-2 text-[10px] font-bold text-text-secondary mb-1.5 tracking-wider">
              <Server className="w-3 h-3 text-cyan-400" />
              BACKEND URL (RUNTIME OVERRIDE)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={backendInput}
                onChange={(e) => setBackendInput(e.target.value)}
                placeholder="https://jexi-os-brain.onrender.com"
                className="w-full bg-surface-2 text-text-primary border border-hairline rounded-md px-3 py-2.5 text-xs focus:outline-none focus:border-brand-line font-mono"
              />
              <button
                onClick={saveBackendUrl}
                className="bg-cyan-500/15 text-cyan-400 border border-[#22D3EE]/30 rounded-md px-3 py-2.5 text-xs font-bold flex items-center gap-1.5 flex-shrink-0 hover:bg-cyan-500/25"
              >
                <Save className="w-3.5 h-3.5" /> SAVE
              </button>
            </div>
            <p className="text-[8px] text-text-tertiary mt-1">
              Current: <span className="text-cyan-400">{backendUrl || 'same origin (/api)'}</span>
              {backendStatus === 'saved' && <span className="text-brand ml-1">✓ Saved — applies immediately</span>}
            </p>
            <p className="text-[8px] text-text-tertiary">Leave empty to use the same origin or VITE_JEXI_BACKEND_URL. Changes apply instantly, no reload needed.</p>
          </div>

          {/* Save Button */}
          <button
            onClick={handleSave}
            disabled={status === 'loading' || initialLoad}
            className="w-full bg-brand text-black rounded-md px-4 py-3 text-xs font-bold flex items-center justify-center gap-2 disabled:opacity-40 transition-opacity active:scale-[0.98]"
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
            <div className="flex items-center gap-2 text-status-error text-[10px]">
              <AlertCircle className="w-3 h-3" />
              Failed to save keys. Check connection.
            </div>
          )}
        </div>
      </div>

      {/* Info Box */}
      <div className="surface-card p-4">
        <PanelHeader icon={Key} title="WHERE YOUR KEYS LIVE" color="text-cyan-400" />
        <p className="text-[9px] text-text-secondary leading-relaxed space-y-1">
          <span className="flex items-start gap-1.5"><Globe className="w-3 h-3 mt-0.5 text-[#34D399] flex-shrink-0" /> <span><span className="text-text-primary">Production (Render):</span> keys are set as environment variables (<span className="font-mono text-text-secondary">GEMINI_API_KEY</span>, <span className="font-mono text-text-secondary">GROQ_API_KEY</span>, <span className="font-mono text-text-secondary">OPENROUTER_API_KEY</span>, <span className="font-mono text-text-secondary">HF_TOKEN</span>, <span className="font-mono text-text-secondary">GITHUB_TOKEN</span>) — JEXI reads them automatically, no pasting required.</span></span>
          <span className="flex items-start gap-1.5"><ShieldCheck className="w-3 h-3 mt-0.5 text-cyan-400 flex-shrink-0" /> <span><span className="text-text-primary">Local / self-hosted:</span> the fields above store keys in JEXI's settings file on your device. They're never sent anywhere except the official AI provider / GitHub API, and only for actions you explicitly ask for.</span></span>
        </p>
      </div>
    </div>
  );
}
