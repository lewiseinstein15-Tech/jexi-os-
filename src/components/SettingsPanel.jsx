import { useState, useEffect } from 'react';
import { Settings, Key, Save, CheckCircle2, AlertCircle, Zap, Sparkles, Server, Github, ShieldCheck, Shield, Globe, Lock, Cpu, Cloud, Mail, Bell, Loader2 , Puzzle } from 'lucide-react';
import { getBackendUrl, setBackendUrl, getAccessKey, setAccessKey, jexiFetch } from '../utils/helpers';
import { setupFcm } from '../utils/fcmSetup';
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
  const [xaiKey, setXaiKey] = useState('');
  const [nvidiaKey, setNvidiaKey] = useState('');
  const [sambanovaKey, setSambanovaKey] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [keyStatus, setKeyStatus] = useState(null); // { groq, gemini, github }
  const [status, setStatus] = useState('idle'); // idle, loading, saved, error
  const [initialLoad, setInitialLoad] = useState(true);

  const [accessKey, setAccessKeyState] = useState(getAccessKey());
  const [autonomyMode, setAutonomyMode] = useState('ask'); // ask | full — goal autonomy level
  const [goalReportEmail, setGoalReportEmail] = useState(''); // email address for goal completion reports
  const [fcmServer, setFcmServer] = useState(false); // server FCM configured
  const [fcmDevices, setFcmDevices] = useState(0);
  const [fcmBusy, setFcmBusy] = useState(false);
  const [lastDiag, setLastDiag] = useState('');
  const [backendUrl, setBackendUrlState] = useState(getBackendUrl());
  const [backendInput, setBackendInput] = useState(getBackendUrl());
  const [backendStatus, setBackendStatus] = useState('idle'); // idle, saved, error
  const [trust, setTrust] = useState(null);
  const [tiers, setTiers] = useState(null); // B55 OpenWorker risk tiers: { tools, counts }
  const [codeMode, setCodeMode] = useState(() => (typeof localStorage !== 'undefined' ? (localStorage.getItem('jexi_code_mode') || '1') === '1' : true)); // B99 — PTC code mode
  const [plugins, setPlugins] = useState(null); // B121 — loaded plugins + their tools
  const [preset, setPreset] = useState(() => (typeof localStorage !== 'undefined' ? (localStorage.getItem('jexi_preset') || 'ptc') : 'ptc')); // B102 — dsh agent presets
  const [permissions, setPermissions] = useState(null); // B138 — dsh permission-presets (sandbox × approval bundles)
  const [permBusy, setPermBusy] = useState(false);

  const TIER_DEFS = [
    ['read', 'READ', 'Search & lookup — no side effects, always autonomous, never asks', 'text-[#34D399] border-[#34D399]/30 bg-[#34D399]/10'],
    ['write_local', 'WRITE LOCAL', 'Drafts / edits / saves your own data — always autonomous', 'text-[#34D399] border-[#34D399]/30 bg-[#34D399]/10'],
    ['exec', 'EXEC', 'Runs code & commands — autonomous by default, logged, reversible only', 'text-status-warn border-[#FBBF24]/30 bg-[#FBBF24]/10'],
    ['external', 'EXTERNAL', 'Spends money / sends / irreversible — ALWAYS asks you once with real finalized details', 'text-status-error border-[#f87171]/40 bg-[#f87171]/10'],
  ];

  useEffect(() => {
    // B121 — show every mounted plugin + the tools JEXI can call (runtime seam).
    jexiFetch(`${getBackendUrl()}/api/plugins/runtime`)
      .then((r) => r.json())
      .then(setPlugins)

    // B138 — permission presets (dsh ui-permission-presets): the session's
    // sandbox × approval bundle and the selectable presets.
    jexiFetch(`${getBackendUrl()}/api/permissions`)
      .then((r) => r.json())
      .then(setPermissions)
      .catch(() => {})
      .catch(() => setPlugins(null));
  }, []);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const base = getBackendUrl();
        const [res, statusRes, trustRes, toolsRes] = await Promise.all([
          jexiFetch(`${base}/api/settings`),
          jexiFetch(`${base}/api/settings/status`),
          jexiFetch(`${base}/api/trust`).catch(() => null),
          jexiFetch(`${base}/api/tools`).catch(() => null),
        ]);
        const data = await res.json();
        setGeminiKey(data.geminiKey || '');
        setGroqKey(data.groqKey || '');
        setOpenrouterKey(data.openrouterKey || '');
        setHfKey(data.hfKey || '');
        setCerebrasKey(data.cerebrasKey || '');
        setDeepinfraKey(data.deepinfraKey || '');
        setMistralKey(data.mistralKey || '');
        setXaiKey(data.xaiKey || '');
        setNvidiaKey(data.nvidiaKey || '');
        setSambanovaKey(data.sambanovaKey || '');
        setGithubToken(data.githubToken || '');
        setAutonomyMode(['ask', 'full'].includes(data.autonomyMode) ? data.autonomyMode : 'ask');
        setGoalReportEmail(data.goalReportEmail || '');
        try { setKeyStatus(await statusRes.json()); } catch (e) { /* status endpoint optional */ }
        try { if (trustRes) setTrust(await trustRes.json()); } catch (e) { /* trust endpoint optional */ }
        try {
          const fcmRes = await jexiFetch(`${base}/api/push/fcm-status`).catch(() => null);
          if (fcmRes) { const f = await fcmRes.json(); setFcmServer(!!f.configured); setFcmDevices(f.deviceTokens || 0); }
        } catch (e) { /* optional */ }
        try {
          if (toolsRes) {
            const toolsData = await toolsRes.json();
            const tools = toolsData.tools || [];
            setTiers({
              tools,
              counts: {
                read: tools.filter((t) => t.tier === 'read').length,
                write_local: tools.filter((t) => t.tier === 'write_local').length,
                exec: tools.filter((t) => t.tier === 'exec').length,
                external: tools.filter((t) => t.tier === 'external').length,
              },
            });
          }
        } catch (e) { /* tools endpoint optional */ }
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
      if (!keyStatus?.xai?.configured) body.xaiKey = xaiKey;
      if (!keyStatus?.nvidia?.configured) body.nvidiaKey = nvidiaKey;
      if (!keyStatus?.sambanova?.configured) body.sambanovaKey = sambanovaKey;
      if (!keyStatus?.github?.configured) body.githubToken = githubToken;
      body.autonomyMode = autonomyMode; // goal autonomy level (ask = pause at confirmations, full = preflight questions then run)
      body.goalReportEmail = goalReportEmail; // email address for goal completion reports (empty = off)
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

          {/* Grok (xAI) — frontier models (grok-4.6) */}
          <KeyField
            label="GROK KEY (XAI FRONTIER MODELS)"
            icon={<Sparkles className="w-3 h-3 text-brand" />}
            value={xaiKey}
            onChange={(e) => setXaiKey(e.target.value)}
            placeholder="Get key at console.x.ai — api.x.ai/v1"
            hint="grok-4.6 flagship, OpenAI-compatible. Set XAI_API_KEY in Render and it's automatic."
            status={keyStatus?.xai}
            envNames={['XAI_API_KEY']}
          />

          {/* NVIDIA NIM — no-card free tier (DeepSeek V4 Flash, Llama, Nemotron) */}
          <KeyField
            label="NVIDIA NIM KEY (FREE DEEPSEEK V4)"
            icon={<Cpu className="w-3 h-3 text-[#76B900]" />}
            value={nvidiaKey}
            onChange={(e) => setNvidiaKey(e.target.value)}
            placeholder="nvapi-…"
            hint="Free key at build.nvidia.com → API Keys — no credit card. Unlocks free DeepSeek V4 Flash, Llama 3.3, Nemotron. Set NVIDIA_API_KEY in Render and it's automatic."
            status={keyStatus?.nvidia}
            envNames={['NVIDIA_API_KEY']}
          />

          {/* SambaNova — live-verified B76: now requires a payment method */}
          <KeyField
            label="SAMBANOVA KEY (DEEPSEEK V3)"
            icon={<Cloud className="w-3 h-3 text-emerald-400" />}
            value={sambanovaKey}
            onChange={(e) => setSambanovaKey(e.target.value)}
            placeholder="Get key at cloud.sambanova.ai"
            hint="Live-tested: your key is valid but the account shows 402 PAYMENT_METHOD_REQUIRED (0 balance units) — the free tier now needs a card on file. Optional; skip if you don't want to add one."
            status={keyStatus?.sambanova}
            envNames={['SAMBANOVA_API_KEY']}
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

          {/* Autonomy level — goal-level execution behavior */}
          <div className="bg-surface-2 border border-hairline rounded-md p-3">
            <label className="flex items-center gap-2 text-[10px] font-bold text-text-secondary mb-1.5 tracking-wider">
              <Zap className="w-3 h-3 text-brand" />
              AUTONOMY LEVEL (GOALS)
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                ['ask', 'Ask', 'Pause at every confirmation — you approve each step.'],
                ['full', 'Full', 'Preflight questions once, then runs the whole goal itself (auto-approves confirmations for that goal; destructive/safety blocks still apply).'],
              ].map(([val, label, desc]) => (
                <button
                  key={val}
                  onClick={() => setAutonomyMode(val)}
                  className={`text-left rounded-md border px-3 py-2.5 ${autonomyMode === val ? 'border-brand bg-brand-dim' : 'border-hairline bg-surface-1'}`}
                >
                  <div className={`text-xs font-bold ${autonomyMode === val ? 'text-brand' : 'text-text-primary'}`}>{label}</div>
                  <div className="text-[8px] text-text-tertiary mt-1 leading-relaxed">{desc}</div>
                </button>
              ))}
            </div>
            <p className="text-[8px] text-text-tertiary mt-1">Used when you start a goal (<span className="font-mono text-text-secondary">/goal</span> or Goals). Full autonomy = JEXI asks for the details she needs once, then executes end-to-end and reports when done.</p>
          </div>

          {/* Goal report email — JEXI emails you when a goal finishes */}
          <div className="bg-surface-2 border border-hairline rounded-md p-3">
            <label className="flex items-center gap-2 text-[10px] font-bold text-text-secondary mb-1.5 tracking-wider">
              <Mail className="w-3 h-3 text-brand" />
              EMAIL GOAL REPORTS TO (OPTIONAL)
            </label>
            <input
              type="email"
              value={goalReportEmail}
              onChange={(e) => setGoalReportEmail(e.target.value)}
              placeholder="you@example.com — leave empty for in-app only"
              className="w-full bg-surface-1 text-text-primary border border-hairline rounded-md px-3 py-2.5 text-xs focus:outline-none focus:border-brand-line"
            />
            <p className="text-[8px] text-text-tertiary mt-1">When a goal finishes (or fails), JEXI sends you the report by email. Defaults to <span className="font-mono text-text-secondary">lewiseinstein15@gmail.com</span> — set a different address here to override (requires the Email connector key, <span className="font-mono text-text-secondary">RESEND_API_KEY</span>). Env var: <span className="font-mono text-text-secondary">GOAL_REPORT_EMAIL</span>.</p>
          </div>

          {/* Push notification status + enable button */}
          <div className="bg-surface-2 border border-hairline rounded-md p-3">
            <label className="flex items-center gap-2 text-[10px] font-bold text-text-secondary mb-1.5 tracking-wider">
              <Bell className="w-3 h-3 text-brand" />
              PHONE NOTIFICATIONS
            </label>
            <div className="flex flex-col gap-1.5 text-[10px] text-text-secondary">
              <div className="flex justify-between">
                <span>This device (web push)</span>
                <span className={typeof Notification !== 'undefined' && Notification.permission === 'granted' ? 'text-brand' : 'text-status-warn'}>
                  {typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Server FCM (installed app, closed-app push)</span>
                <span className={fcmServer ? 'text-brand' : 'text-status-warn'}>{fcmServer ? `READY · ${fcmDevices} device${fcmDevices === 1 ? '' : 's'}` : 'not configured on server'}</span>
              </div>
              {lastDiag && <div className="text-[9px] text-text-tertiary">Last device report: {lastDiag}</div>}
            </div>
            <button
              onClick={async () => {
                setFcmBusy(true);
                try {
                  const ok = await setupFcm();
                  setLastDiag(ok ? 'registered ✓' : 'could not register (check permission)');
                  setTimeout(() => setLastDiag(''), 5000);
                } catch { setLastDiag('failed'); setTimeout(() => setLastDiag(''), 5000); }
                setFcmBusy(false);
              }}
              disabled={fcmBusy}
              className="mt-2 px-3 py-2 rounded-md text-[10px] font-bold bg-brand text-black flex items-center gap-1.5 disabled:opacity-40"
            >
              {fcmBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bell className="w-3 h-3" />}
              ENABLE NOTIFICATIONS
            </button>
            <p className="text-[8px] text-text-tertiary mt-1">On Android 13+, tap this (or reinstall the app) to re-show the system permission dialog. Closed-app notifications need FCM: installed APK + server FCM configured + this toggle granted.</p>
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
                placeholder="https://jexi-brain-image.onrender.com"
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

      {/* Security / Risk Guard (roadmap stage 17) */}
      <div className="surface-card p-4">
        <PanelHeader icon={Shield} title="SECURITY · RISK GUARD" color="text-brand" />
        <p className="text-[8px] text-text-tertiary mb-3">Every tool call is classified by its actual arguments — destructive commands, path escapes and secret exfiltration are blocked before they run. Decisions persist on the server (DATA_DIR/trust.json).</p>

        {/* B55 OpenWorker risk tiers — what runs autonomously vs. what asks first */}
        {tiers && (
          <div className="mb-3 rounded-md bg-surface-1 border border-hairline p-2.5">
            <p className="text-[8px] font-black text-text-secondary tracking-wider mb-1.5">RISK TIERS — WHAT JEXI RUNS ON ITS OWN ({tiers.tools.length} TOOLS)</p>
            <div className="grid grid-cols-2 gap-1.5">
              {TIER_DEFS.map(([key, label, hint, color]) => (
                <div key={key} className={`rounded-md border px-2 py-1.5 ${color}`}>
                  <p className="text-[8px] font-black tracking-wider">{label} · {tiers.counts[key] || 0}</p>
                  <p className="text-[7px] text-text-tertiary mt-0.5 leading-snug">{hint}</p>
                </div>
              ))}
            </div>
            <p className="text-[7px] text-text-tertiary mt-1.5">EXTERNAL actions always pause for ONE explicit approval showing the real finalized details — never a placeholder, never auto-run.</p>
          </div>
        )}

        {trust ? (
          <div className="space-y-3">
            {/* Trust mode */}
            <div>
              <p className="text-[9px] font-bold text-text-secondary mb-1.5 tracking-wider">TRUST MODE</p>
              <div className="grid grid-cols-3 gap-1.5">
                {[['sandbox', 'SANDBOX', 'Block high-risk calls'], ['ask', 'ASK', 'Warn, never block'], ['off', 'OFF', 'No gating']].map(([m, label, hint]) => (
                  <button
                    key={m}
                    type="button"
                    onClick={async () => {
                      const r = await jexiFetch(`${getBackendUrl()}/api/trust/mode`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: m }) });
                      setTrust(await r.json());
                    }}
                    className={`rounded-md px-2 py-2 border text-left transition-colors ${trust.mode === m ? 'bg-brand-dim border-brand-line' : 'bg-surface-1 border-hairline'}`}
                  >
                    <p className={`text-[8px] font-black tracking-wider ${trust.mode === m ? 'text-brand' : 'text-text-secondary'}`}>{label}</p>
                    <p className="text-[7px] text-text-tertiary mt-0.5">{hint}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* B102 — AGENT PRESETS (deepseek-harness: standard / ptc / minimal / creator) */}
            <div>
              <p className="text-[9px] font-bold text-text-secondary mb-1.5 tracking-wider">AGENT PRESET</p>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  ['standard', 'STANDARD', 'Native tool calling'],
                  ['ptc', 'PTC', 'Code Mode + SDK'],
                  ['minimal', 'MINIMAL', 'Direct answers'],
                  ['creator', 'CREATOR', 'Code Mode + flair'],
                ].map(([key, label, hint]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      try { localStorage.setItem('jexi_preset', key); } catch { /* noop */ }
                      setPreset(key);
                      // B117 — ONE mode (JEXI decides); presets only adjust the
                      // code-mode default. Minimal keeps the server's direct
                      // answers via its preset mapping.
                      const cm = key === 'standard' || key === 'minimal' ? '0' : '1';
                      try { localStorage.setItem('jexi_code_mode', cm); } catch { /* noop */ }
                      setCodeMode(cm === '1');
                    }}
                    className={`rounded-md px-2 py-2 border text-left transition-colors ${preset === key ? 'bg-brand-dim border-brand-line' : 'bg-surface-1 border-hairline'}`}
                  >
                    <p className={`text-[8px] font-black tracking-wider ${preset === key ? 'text-brand' : 'text-text-secondary'}`}>{label}</p>
                    <p className="text-[7px] text-text-tertiary mt-0.5">{hint}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* B99 — Code Mode (PTC): deepseek-harness `code` preset toggle */}
            <div className="flex items-center justify-between gap-3 rounded-md border border-hairline bg-surface-1 px-2.5 py-2">
              <div className="min-w-0">
                <p className="text-[9px] font-bold text-text-secondary tracking-wider flex items-center gap-1.5">
                  <Cpu className="w-3 h-3 text-brand" /> CODE MODE (PTC)
                </p>
                <p className="text-[7px] text-text-tertiary mt-0.5 leading-snug">
                  DeepSeek-Harness style: the model may write ONE TypeScript program that composes the auto-selected tools via <code className="text-brand">await tools.name(args)</code> — a whole workflow in a single call.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const next = (localStorage.getItem('jexi_code_mode') || '1') === '1' ? '0' : '1';
                  try { localStorage.setItem('jexi_code_mode', next); } catch { /* noop */ }
                  setCodeMode(next === '1');
                }}
                className={`flex-shrink-0 w-11 h-6 rounded-full relative transition-colors ${codeMode ? 'bg-brand' : 'bg-surface-2 border border-hairline'}`}
                aria-label="Toggle code mode"
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${codeMode ? 'left-[22px]' : 'left-0.5'}`}
                  style={codeMode ? { background: '#04140D' } : {}}
                />
              </button>
            </div>

            {/* B121 — LOADED PLUGINS: every plugin JEXI has access to */}
            <div className="rounded-md border border-hairline bg-surface-1 px-2.5 py-2">
              <p className="text-[9px] font-bold text-text-secondary tracking-wider flex items-center gap-1.5">
                <Puzzle className="w-3 h-3 text-brand" /> LOADED PLUGINS · {plugins?.pluginTools?.length || 0} TOOLS
              </p>
              <p className="text-[7px] text-text-tertiary mt-0.5 leading-snug">
                Plugins mount live tools through the DeepSeek-Harness seam — JEXI can call every tool below in chat (weather, time, currency, and more).
              </p>
              {plugins?.pluginTools?.length ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {plugins.pluginTools.map((t) => (
                    <span key={t.slug} className="text-[7px] font-bold text-brand bg-brand-dim/40 border border-brand-line/40 rounded-full px-1.5 py-0.5">
                      {t.slug}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-[7px] text-text-tertiary mt-1">Loading…</p>
              )}
            </div>

            {/* B138 — PERMISSION PRESETS (dsh permission-presets): one tap switches
                the session's sandbox mode + approval policy bundle. */}
            <div className="rounded-md border border-hairline bg-surface-1 px-2.5 py-2">
              <p className="text-[9px] font-bold text-text-secondary tracking-wider flex items-center gap-1.5">
                <Shield className="w-3 h-3 text-brand" /> PERMISSION PRESETS · {permissions?.preset ? String(permissions.preset).toUpperCase() : '…'}
              </p>
              <p className="text-[7px] text-text-tertiary mt-0.5 leading-snug">
                Sandbox mode × approval policy in one bundle: Assistant (workspace-write + ask), Autonomous (workspace-write + never), Sandboxed (read-only), Full Access (danger-full-access + ask).
              </p>
              <div className="mt-1.5 grid grid-cols-2 gap-1">
                {permissions?.presets?.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    disabled={permBusy}
                    onClick={async () => {
                      setPermBusy(true);
                      try {
                        const r = await jexiFetch(`${getBackendUrl()}/api/permissions`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ conv: 'default', preset: p.key }),
                        });
                        setPermissions(await r.json());
                      } catch { /* noop */ }
                      setPermBusy(false);
                    }}
                    className={`text-left text-[7px] font-bold rounded px-1.5 py-1 border transition-colors ${
                      permissions?.preset === p.key
                        ? 'text-brand bg-brand-dim/40 border-brand-line/50'
                        : 'text-text-secondary bg-surface-2 border-hairline hover:border-brand-line/40'
                    }`}
                  >
                    {p.name}
                    <span className="block text-[6px] font-medium text-text-tertiary mt-0.5 leading-tight">{p.description}</span>
                  </button>
                ))}
              </div>
              <p className="text-[7px] text-text-tertiary mt-1">
                Sandbox: {permissions?.sandbox || '…'} · Approval: {permissions?.approval || '…'}
              </p>
            </div>

            {/* Decisions */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[9px] font-bold text-brand mb-1 tracking-wider">ALLOWED ({trust.allowed?.length || 0})</p>
                <div className="space-y-1 max-h-24 overflow-y-auto">
                  {trust.allowed?.map((d) => (
                    <div key={d.id} className="flex items-center gap-1.5 bg-surface-1 border border-hairline rounded px-2 py-1">
                      <code className="text-[7px] font-mono text-text-secondary flex-1 truncate">{d.slug}: {d.pattern || '*'}</code>
                      <button type="button" onClick={async () => { const r = await jexiFetch(`${getBackendUrl()}/api/trust/decision/${d.id}`, { method: 'DELETE' }); setTrust(await r.json()); }} className="text-text-tertiary hover:text-status-error text-[8px]">✕</button>
                    </div>
                  ))}
                  {!trust.allowed?.length && <p className="text-[7px] text-text-tertiary">None — everything HIGH is blocked.</p>}
                </div>
              </div>
              <div>
                <p className="text-[9px] font-bold text-status-error mb-1 tracking-wider">DENIED ({trust.denied?.length || 0})</p>
                <div className="space-y-1 max-h-24 overflow-y-auto">
                  {trust.denied?.map((d) => (
                    <div key={d.id} className="flex items-center gap-1.5 bg-surface-1 border border-hairline rounded px-2 py-1">
                      <code className="text-[7px] font-mono text-text-secondary flex-1 truncate">{d.slug}: {d.pattern || '*'}</code>
                      <button type="button" onClick={async () => { const r = await jexiFetch(`${getBackendUrl()}/api/trust/decision/${d.id}`, { method: 'DELETE' }); setTrust(await r.json()); }} className="text-text-tertiary hover:text-status-error text-[8px]">✕</button>
                    </div>
                  ))}
                  {!trust.denied?.length && <p className="text-[7px] text-text-tertiary">No explicit denies.</p>}
                </div>
              </div>
            </div>

            <p className="text-[7px] font-mono text-text-tertiary truncate">workspace: {trust.workspace}</p>
          </div>
        ) : (
          <p className="text-[9px] text-text-tertiary">Risk guard status unavailable (server offline?).</p>
        )}
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
