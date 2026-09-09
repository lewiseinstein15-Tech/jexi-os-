/**
 * M8 — PHONE SETUP WIZARD (first run: point at a brain).
 *
 * Rendered instead of the app shell when setup never completed. Two honest
 * steps — the transition is earned by a live health probe, never by typing
 * alone. Static-markup safe (no effects). The backend is open (no access
 * key), so pairing is just the brain address.
 */
import React, { useState } from 'react';
import { probeHealth, normalizeBase } from '../utils/setupProbe';

const S = {
  wrap: { minHeight: '100vh', background: '#0f1115', color: '#e8eaf0', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: 'system-ui, -apple-system, sans-serif' },
  card: { width: '100%', maxWidth: 440, background: '#171a21', border: '1px solid #262b36', borderRadius: 14, padding: 26 },
  brand: { fontFamily: "'Caveat','Segoe Script',cursive", fontWeight: 600, fontSize: 26, color: '#FFD1A9', marginBottom: 4 },
  title: { fontSize: 22, fontWeight: 650, margin: '0 0 6px' },
  sub: { fontSize: 14, color: '#9aa3b5', lineHeight: 1.5, margin: '0 0 18px' },
  dots: { display: 'flex', gap: 8, marginBottom: 18 },
  label: { display: 'block', fontSize: 13, color: '#9aa3b5', marginBottom: 6 },
  input: { width: '100%', boxSizing: 'border-box', background: '#0f1115', border: '1px solid #2c3342', color: '#e8eaf0', borderRadius: 9, padding: '12px 14px', fontSize: 15, outline: 'none' },
  btn: { width: '100%', boxSizing: 'border-box', border: 'none', borderRadius: 9, padding: '13px 14px', fontSize: 15, fontWeight: 650, cursor: 'pointer', marginTop: 12 },
  primary: { background: '#FF8A3D', color: '#14100b' },
  ghost: { background: 'transparent', color: '#9aa3b5', border: '1px solid #2c3342' },
  ok: { marginTop: 12, fontSize: 13.5, color: '#7ee2a8', background: '#12261b', border: '1px solid #1e4d32', borderRadius: 8, padding: '9px 12px' },
  err: { marginTop: 12, fontSize: 13.5, color: '#ff9d9d', background: '#2a1414', border: '1px solid #5a2323', borderRadius: 8, padding: '9px 12px' },
  row: { display: 'flex', gap: 10, marginTop: 12 },
  link: { background: 'none', border: 'none', color: '#7d8db0', fontSize: 13.5, cursor: 'pointer', padding: 0, marginTop: 16, textDecoration: 'underline' },
  mono: { fontFamily: 'ui-monospace, monospace', fontSize: 12.5, wordBreak: 'break-all', color: '#c6cddb' },
};

function Dots({ step }) {
  return (
    <div style={S.dots} aria-label={`Step ${step} of 2`}>
      {[1, 2].map((n) => (
        <div key={n} style={{ flex: 1, height: 4, borderRadius: 2, background: n <= step ? '#FF8A3D' : '#262b36' }} />
      ))}
    </div>
  );
}

export default function SetupWizard({ initialUrl = '', onDone = () => {}, onSkip = () => {} }) {
  const [step, setStep] = useState(1);
  const [url, setUrl] = useState(initialUrl || '');
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState(null);

  const testConnection = async () => {
    setBusy(true);
    setHealth(null);
    const r = await probeHealth(url);
    setHealth(r);
    setBusy(false);
    if (r.ok) setStep(2);
  };

  return (
    <div style={S.wrap}>
      <div style={S.card}>
        <div style={S.brand}>JEXI · SETUP</div>
        <Dots step={step} />

        {step === 1 && (
          <div>
            <h1 style={S.title}>Point at your brain</h1>
            <p style={S.sub}>This app is a remote — your JEXI brain runs on the server. Paste its address and test the connection.</p>
            <label style={S.label} htmlFor="jx-setup-url">Brain address</label>
            <input id="jx-setup-url" style={S.input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-brain.onrender.com" inputMode="url" autoCapitalize="off" autoCorrect="off" />
            {health && !health.ok && <div style={S.err}>✗ {health.error}</div>}
            <button type="button" style={{ ...S.btn, ...S.primary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={testConnection}>
              {busy ? 'Testing…' : 'Test connection'}
            </button>
            <button type="button" style={S.link} onClick={onSkip}>Skip setup for now</button>
          </div>
        )}

        {step === 2 && (
          <div>
            <h1 style={S.title}>Connected ✓</h1>
            <p style={S.sub}>Brain <span style={S.mono}>{normalizeBase(url)}</span> is online{health && health.ms != null ? ` (answered in ${health.ms}ms)` : ''}. This device is paired.</p>
            <div style={S.ok}>✓ Connection proven — no key needed, the brain is open</div>
            <button type="button" style={{ ...S.btn, ...S.primary }} onClick={() => onDone(normalizeBase(url))}>
              Open JEXI
            </button>
            <div style={S.row}>
              <button type="button" style={{ ...S.btn, ...S.ghost, marginTop: 0 }} onClick={() => setStep(1)}>← Back</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
