import { useState, useEffect } from 'react';
import { Cable, RefreshCw, Send, Wrench, CheckCircle2, XCircle, Circle, ShieldCheck } from 'lucide-react';
import { getBackendUrl, jexiFetch } from '../utils/helpers';

// Which auth fields each connector exposes in the UI (env vars always win at
// call time; these are the Settings-stored fallbacks).
const FIELDS = {
  whatsapp: [
    { key: 'accessToken', label: 'ACCESS TOKEN', ph: 'EAA…', hint: 'env: WHATSAPP_ACCESS_TOKEN' },
    { key: 'phoneNumberId', label: 'PHONE NUMBER ID', ph: '10-digit id', hint: 'env: WHATSAPP_PHONE_NUMBER_ID' },
    { key: 'appSecret', label: 'APP SECRET', ph: '…', hint: 'webhook verify · env: WHATSAPP_APP_SECRET' },
    { key: 'verifyToken', label: 'VERIFY TOKEN', ph: 'your own token', hint: 'Meta hub.challenge · env: WHATSAPP_VERIFY_TOKEN' },
  ],
  github: [
    { key: 'token', label: 'TOKEN (PAT)', ph: 'ghp_…', hint: 'env: GITHUB_TOKEN / GH_TOKEN — or GitHub App via GITHUB_APP_ID + PRIVATE KEY' },
    { key: 'webhookSecret', label: 'WEBHOOK SECRET', ph: '…', hint: 'X-Hub-Signature verify · env: GITHUB_WEBHOOK_SECRET' },
  ],
  email: [
    { key: 'apiKey', label: 'SENDGRID API KEY', ph: 'SG.…', hint: 'env: SENDGRID_API_KEY' },
    { key: 'defaultFrom', label: 'DEFAULT FROM (email)', ph: 'jexi@yourdomain.com', hint: 'used when send() has no from' },
  ],
  telegram: [
    { key: 'botToken', label: 'BOT TOKEN', ph: '123:ABC…', hint: 'env: TELEGRAM_BOT_TOKEN (from @BotFather)' },
    { key: 'secretToken', label: 'WEBHOOK SECRET', ph: '…', hint: 'X-Telegram-Bot-Api-Secret-Token · env: TELEGRAM_SECRET_TOKEN' },
  ],
};

// Minimal per-connector test-send inputs.
const TESTS = {
  whatsapp: [{ key: 'to', label: 'TO (E.164)', ph: '15551234567' }, { key: 'text', label: 'TEXT', ph: 'Hello from JEXI OS' }],
  github: [{ key: 'owner', label: 'OWNER', ph: 'your-org' }, { key: 'repo', label: 'REPO', ph: 'my-repo' }, { key: 'title', label: 'TITLE', ph: 'Test issue from JEXI' }],
  email: [{ key: 'to', label: 'TO', ph: 'you@example.com' }, { key: 'subject', label: 'SUBJECT', ph: 'Test from JEXI OS' }, { key: 'text', label: 'TEXT', ph: 'Hello!' }],
  telegram: [{ key: 'chat_id', label: 'CHAT ID', ph: '777' }, { key: 'text', label: 'TEXT', ph: 'Hello from JEXI OS' }],
};

const buildTestPayload = (name, v) => {
  if (name === 'whatsapp') return { to: v.to, type: 'text', text: v.text || 'Hello from JEXI OS' };
  if (name === 'github') return { action: 'create_issue', owner: v.owner, repo: v.repo, title: v.title || 'Test issue from JEXI' };
  if (name === 'email') return { to: [{ email: v.to }], subject: v.subject || 'Test from JEXI OS', text: v.text || 'Hello!' };
  if (name === 'telegram') return { chat_id: Number(v.chat_id), text: v.text || 'Hello from JEXI OS' };
  return {};
};

export default function ConnectorsScreen() {
  const [connectors, setConnectors] = useState(null);
  const [tools, setTools] = useState([]);
  const [auth, setAuth] = useState({});
  const [tests, setTests] = useState({});
  const [busy, setBusy] = useState({});
  const [notice, setNotice] = useState(null); // { name, ok, text }
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const r = await jexiFetch(`${getBackendUrl()}/api/connectors`).then((x) => x.json());
      setConnectors(r.connectors || []);
      setTools(r.tools || []);
      const next = {};
      for (const c of r.connectors || []) next[c.name] = { ...(c.auth || {}) };
      setAuth(next);
    } catch (e) { console.error('Connectors fetch failed', e); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const post = async (url, body) => {
    const r = await jexiFetch(`${getBackendUrl()}${url}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
    });
    return r.json();
  };

  const flash = (name, ok, text) => { setNotice({ name, ok, text }); setTimeout(() => setNotice(null), 6000); };

  const save = async (name) => {
    setBusy((b) => ({ ...b, [`${name}:save`]: true }));
    try {
      const r = await post(`/api/connectors/${name}/config`, { auth: auth[name] || {} });
      flash(name, r.ok, r.ok ? 'Saved — env vars still win at call time' : r.error || 'Save failed');
      load();
    } finally { setBusy((b) => ({ ...b, [`${name}:save`]: false })); }
  };

  const toggle = async (name, enabled) => {
    const r = await post(`/api/connectors/${name}/toggle`, { enabled });
    if (r.ok) { load(); flash(name, true, enabled ? 'Enabled' : 'Disabled'); }
  };

  const check = async (name) => {
    setBusy((b) => ({ ...b, [`${name}:health`]: true }));
    try {
      const r = await post(`/api/connectors/${name}/call`, { method: 'health' });
      flash(name, r.ok, r.health ? `${r.health.status.toUpperCase()} — ${r.health.detail}` : r.error || 'Unreachable');
      load();
    } finally { setBusy((b) => ({ ...b, [`${name}:health`]: false })); }
  };

  const sendTest = async (name) => {
    setBusy((b) => ({ ...b, [`${name}:send`]: true }));
    try {
      const r = await post(`/api/connectors/${name}/call`, { method: 'send', payload: buildTestPayload(name, tests[name] || {}) });
      flash(name, r.ok, r.ok ? `Sent ✓ — ${JSON.stringify(r.result || {}).slice(0, 160)}` : (r.error || 'Send failed').slice(0, 220));
    } finally { setBusy((b) => ({ ...b, [`${name}:send`]: false })); }
  };

  if (loading) return <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="skeleton h-16 rounded-lg" />)}</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Cable className="w-3.5 h-3.5 text-brand" />
        <h2 className="text-[10px] font-bold text-brand tracking-wider flex-1">CONNECTORS</h2>
        <button onClick={load} className="text-text-tertiary hover:text-brand transition-colors p-1" title="Refresh"><RefreshCw className="w-3 h-3" /></button>
      </div>
      <p className="text-[8px] text-text-tertiary">
        Agents reach these through the <span className="font-mono text-brand">connector-call</span> tool — every agent-initiated
        <span className="text-[#f87171]"> send</span> pauses for ONE approval with the finalized details. Checks and test sends
        below are you clicking the button = your approval.
      </p>

      {(connectors || []).map((c) => {
        const fields = FIELDS[c.name] || [];
        const testFields = TESTS[c.name] || [];
        const isBusy = busy[`${c.name}:save`] || busy[`${c.name}:health`] || busy[`${c.name}:send`];
        const HealthIcon = c.health === 'ok' ? CheckCircle2 : c.health === 'error' ? XCircle : Circle;
        const healthColor = c.health === 'ok' ? 'text-[#34D399]' : c.health === 'error' ? 'text-[#f87171]' : 'text-text-tertiary';
        return (
          <div key={c.name} className="surface-card p-3 space-y-2.5">
            <div className="flex items-center gap-2">
              <HealthIcon className={`w-3 h-3 ${healthColor} flex-shrink-0`} />
              <p className="text-[10px] font-black tracking-wider text-text-primary flex-1 uppercase">{c.name}</p>
              <span className="text-[7px] font-mono text-text-tertiary border border-hairline rounded-full px-1.5 py-0.5">{c.tool}</span>
              <button
                onClick={() => toggle(c.name, !c.enabled)}
                className={`text-[7px] font-black tracking-wider rounded-full px-2 py-0.5 border transition-colors ${c.enabled ? 'bg-brand-dim border-brand-line text-brand' : 'bg-surface-1 border-hairline text-text-tertiary'}`}
              >
                {c.enabled ? 'ENABLED' : 'OFF'}
              </button>
            </div>

            <div className="flex items-center gap-1.5 text-[8px] text-text-tertiary">
              <ShieldCheck className="w-2.5 h-2.5 text-brand" />
              <span className="truncate">{c.detail}</span>
            </div>

            {/* Config fields */}
            <div className="space-y-1.5">
              {fields.map((f) => (
                <div key={f.key} className="flex items-center gap-2">
                  <label className="w-28 flex-shrink-0 text-[8px] font-bold text-text-secondary tracking-wider">{f.label}</label>
                  <input
                    type="password"
                    value={(auth[c.name] && auth[c.name][f.key]) || ''}
                    onChange={(e) => setAuth((s) => ({ ...s, [c.name]: { ...s[c.name], [f.key]: e.target.value } }))}
                    placeholder={f.ph}
                    className="flex-1 min-w-0 bg-surface-2 text-text-primary border border-hairline rounded-md px-2 py-1.5 text-[9px] font-mono focus:outline-none focus:border-brand-line"
                  />
                </div>
              ))}
            </div>

            {/* Webhook */}
            {c.meta && c.meta.webhooks && (
              <p className="text-[7px] font-mono text-text-tertiary break-all">
                webhook: {c.meta.webhooks.post}
                {c.meta.webhooks.get ? ` · GET ${c.meta.webhooks.get}` : ''}
              </p>
            )}

            {/* Actions */}
            <div className="flex items-center gap-1.5">
              <button onClick={() => save(c.name)} disabled={isBusy} className="bg-brand text-black rounded-md px-2.5 py-1.5 text-[8px] font-black tracking-wide disabled:opacity-50">
                SAVE KEYS
              </button>
              <button onClick={() => check(c.name)} disabled={isBusy} className="bg-surface-2 border border-hairline rounded-md px-2.5 py-1.5 text-[8px] font-bold text-text-secondary disabled:opacity-50 flex items-center gap-1">
                <Wrench className="w-2.5 h-2.5" /> CHECK
              </button>
            </div>

            {/* Test send */}
            <div className="pt-2 border-t border-hairline space-y-1.5">
              <p className="text-[7px] font-black text-text-tertiary tracking-wider">TEST SEND → PROVIDER (REAL, IF CONFIGURED)</p>
              <div className="flex flex-wrap items-center gap-1.5">
                {testFields.map((f) => (
                  <input
                    key={f.key}
                    value={(tests[c.name] && tests[c.name][f.key]) || ''}
                    onChange={(e) => setTests((s) => ({ ...s, [c.name]: { ...s[c.name], [f.key]: e.target.value } }))}
                    placeholder={`${f.label}: ${f.ph}`}
                    className="flex-1 min-w-[90px] bg-surface-2 text-text-primary border border-hairline rounded-md px-2 py-1.5 text-[8px] font-mono focus:outline-none focus:border-brand-line"
                  />
                ))}
                <button onClick={() => sendTest(c.name)} disabled={isBusy} className="bg-[#00FF9D]/15 border border-[#00FF9D]/30 text-[#00FF9D] rounded-md px-2.5 py-1.5 text-[8px] font-black tracking-wide disabled:opacity-50 flex items-center gap-1">
                  <Send className="w-2.5 h-2.5" /> SEND
                </button>
              </div>
            </div>

            {notice && notice.name === c.name && (
              <p className={`text-[8px] font-bold ${notice.ok ? 'text-[#34D399]' : 'text-[#f87171]'}`}>{notice.text}</p>
            )}
          </div>
        );
      })}

      {/* Agent tool schemas */}
      {tools.length > 0 && (
        <div className="surface-card p-3">
          <p className="eyebrow mb-1.5">AGENT TOOL SCHEMAS (AUTO-GENERATED)</p>
          <div className="flex flex-wrap gap-1">
            {tools.map((t) => (
              <code key={t.function.name} className="text-[8px] font-mono text-brand bg-brand-dim border border-brand-line rounded-full px-2 py-0.5">{t.function.name}</code>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
