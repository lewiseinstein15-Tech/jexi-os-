import KeyRefInput from './KeyRefInput.jsx';
import { PROVIDERS } from '../../../../providers/profiles/schema.js';

/* UI-level model catalog per provider (config values; Phase 27 ships tiers,
 * deployments name real models at configure() time). */
const MODEL_CATALOG = {
  anthropic: ['claude-4.5-opus', 'claude-4.5-sonnet', 'claude-4.5-haiku'],
  openai: ['gpt-5', 'gpt-5-mini', 'gpt-4.1'],
  google: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  ollama: ['llama3.1', 'qwen2.5-coder'],
  openrouter: ['auto', 'meta/llama-3.1-70b-instruct'],
};

export default function ProviderSection({ settings, onChange }) {
  const provider = settings.provider || PROVIDERS[0];
  const models = MODEL_CATALOG[provider] || [];
  const model = models.includes(settings.model) ? settings.model : models[0];

  return (
    <section className="p24-section">
      <h2 className="p24-section-title">Provider</h2>
      <div className="p24-srow">
        <div className="p24-srow-label">
          <div className="p24-srow-name">Provider</div>
          <div className="p24-srow-sub">from Phase 27 profiles provider list</div>
        </div>
        <select
          className="p24-select"
          value={provider}
          onChange={(e) => onChange({ provider: e.target.value, model: null })}
          aria-label="Provider"
        >
          {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <div className="p24-srow">
        <div className="p24-srow-label">
          <div className="p24-srow-name">Model</div>
          <div className="p24-srow-sub">available models follow the provider</div>
        </div>
        <select
          className="p24-select"
          value={model}
          onChange={(e) => onChange({ model: e.target.value })}
          aria-label="Model"
        >
          {models.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      <div className="p24-srow">
        <div className="p24-srow-label">
          <div className="p24-srow-name">API key reference</div>
          <div className="p24-srow-sub">env var name or keyring ref — never an inline key</div>
        </div>
        <KeyRefInput
          provider={provider}
          model={model}
          value={settings.keyRef || ''}
          onAccept={(v) => onChange({ keyRef: v })}
        />
      </div>
    </section>
  );
}
