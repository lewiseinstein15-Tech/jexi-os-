import { useState } from 'react';
import { validate, ENV_REF_RE, KEYRING_REF_RE } from '../../../../../integrations/providers/profiles/schema.js';

/**
 * Phase 24 Scope C — keyRef input with Phase 27 discipline.
 * Accepts env-var names (ENV_REF_RE) or keyring:<service>[/<account>].
 * Anything that looks like an inline credential -> E_INLINE_KEY_REFUSED,
 * surfaced in the field with the reason. Values are never rendered or logged.
 */
export default function KeyRefInput({ provider, model, value, onAccept }) {
  const [draft, setDraft] = useState(value || '');
  const [state, setState] = useState(value ? { code: 'ACCEPTED' } : null);

  // Raw-secret value shapes: refused as inline keys even though the schema's
  // findInlineKeys keys off FIELD NAMES (values never reach a profile).
  const INLINE_VALUE_RE = /^(sk-|ghp_|gho_|github_pat_|xox[bapreos]-|AIza[0-9A-Za-z_-]|-----BEGIN)/i;

  function check(v) {
    if (ENV_REF_RE.test(v)) return { code: 'ACCEPTED', kind: 'env' };
    if (KEYRING_REF_RE.test(v)) return { code: 'ACCEPTED', kind: 'keyring' };
    if (INLINE_VALUE_RE.test(v)) {
      return { code: 'E_INLINE_KEY_REFUSED', message: 'value looks like a raw credential' };
    }
    // Let Phase 27's validator classify the refusal (inline key precedence).
    const verdict = validate({ name: 'ui-check', provider, model: model || 'm', keyRef: v });
    const inline = (verdict.errors || []).find((e) => e.code === 'E_INLINE_KEY_REFUSED');
    if (inline) return { code: 'E_INLINE_KEY_REFUSED', message: inline.message };
    const other = (verdict.errors || []).find((e) => e.code === 'E_INVALID_KEY_REF');
    return { code: 'E_INVALID_KEY_REF', message: (other && other.message) || 'not a valid keyRef' };
  }

  function submit() {
    const v = draft.trim();
    const res = check(v);
    setState(res);
    if (res.code === 'ACCEPTED') onAccept(v, res.kind);
  }

  return (
    <div className="p24-keyref">
      <div className="p24-keyref-row">
        <input
          className={'p24-input' + (state && state.code !== 'ACCEPTED' ? ' is-refused' : '')}
          value={draft}
          placeholder="OPENAI_API_KEY or keyring:jexi/openai"
          onChange={(e) => { setDraft(e.target.value); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
          aria-label="API key reference"
          spellCheck={false}
        />
        <button className="p24-send" onClick={submit}>set</button>
      </div>
      {!state && (
        <div className="p24-keyref-none">no key reference set — the active provider profile runs with its own env/keyring credential</div>
      )}
      {state && state.code === 'ACCEPTED' && (
        <div className="p24-keyref-ok" role="status">keyRef accepted ({state.kind}) — value never rendered</div>
      )}
      {state && state.code === 'E_INLINE_KEY_REFUSED' && (
        <div className="p24-keyref-refused" role="alert">E_INLINE_KEY_REFUSED — inline keys are refused; use an env var name or keyring ref</div>
      )}
      {state && state.code === 'E_INVALID_KEY_REF' && (
        <div className="p24-keyref-refused" role="alert">E_INVALID_KEY_REF — {state.message}</div>
      )}
    </div>
  );
}
