import { useState } from 'react';
import { KeyRound, Eye, EyeOff, X } from 'lucide-react';

/**
 * SecretKeyCard — the one-time-paste key card.
 *
 * Rendered when the backend emits `ask.secret` (JEXI needs a GitHub key for
 * a push/commit/ship step). The pasted value goes straight to
 * POST /api/secrets/answer, lives only in server memory (30 min), and is
 * never stored, never echoed, never shown again.
 */
export default function SecretKeyCard({ ask, busy, error, onSubmit, onCancel }) {
  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  if (!ask) return null;

  const submit = () => {
    const v = value.trim();
    if (!v || busy) return;
    onSubmit(v);
    setValue('');
  };

  return (
    <div className="mx-3 mb-2 rounded-xl border border-brand-line bg-surface-2 p-3 shadow-lg">
      <div className="flex items-center gap-2">
        <KeyRound size={15} className="text-brand shrink-0" />
        <p className="text-[12.5px] font-semibold text-text-primary leading-snug">
          Paste a one-time GitHub key{ask.reason ? ` ${ask.reason}` : ''}
        </p>
        <button
          type="button" aria-label="Not now" onClick={onCancel}
          className="ml-auto p-1 rounded-md text-text-tertiary hover:text-text-primary"
        >
          <X size={14} />
        </button>
      </div>
      <p className="mt-1 text-[10.5px] leading-snug text-text-tertiary">
        Memory-only for 30 minutes · never stored · create one free at github.com → Settings → Developer settings → Personal access tokens (repo scope)
      </p>
      <div className="mt-2 flex items-center gap-2">
        <div className="relative flex-1">
          <input
            type={show ? 'text' : 'password'}
            value={value}
            autoFocus
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="ghp_… / github_pat_…"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            className="w-full bg-surface-1 text-text-primary border border-hairline rounded-lg pl-2.5 pr-9 py-2 text-[12px] focus:outline-none focus:border-brand-line placeholder:text-text-tertiary"
          />
          <button
            type="button" aria-label={show ? 'Hide key' : 'Show key'}
            onClick={() => setShow((s) => !s)}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-text-tertiary hover:text-text-primary"
          >
            {show ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <button
          type="button" onClick={submit} disabled={busy || !value.trim()}
          className="shrink-0 rounded-lg bg-brand px-3.5 py-2 text-[12px] font-bold text-black disabled:opacity-40"
        >
          {busy ? '…' : 'Use key'}
        </button>
      </div>
      {error ? <p className="mt-1.5 text-[11px] leading-snug text-status-error">{error}</p> : null}
    </div>
  );
}
