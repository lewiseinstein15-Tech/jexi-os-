import { MessageSquare, Settings, Workflow, Bot, Cpu } from 'lucide-react';
import { useBackendStatus, useModelStatus } from './useStatus.js';

/**
 * Premium sidebar — JEXI wordmark, four nav destinations (Chat / Settings /
 * Work Graph / Agents), and the honest bottom strip: model indicator
 * (provider + model, or "unresolved" in muted red) plus the backend
 * liveness dot. Both read real probes (useStatus.js).
 *
 * Same export shape as the Phase 24 Sidebar it replaces (default + AGENTS_ROUTE)
 * so Shell.jsx's contract is unchanged. The old file stays untouched alongside.
 */
export const AGENTS_ROUTE = { id: 'agents', label: 'Agents', hash: '#/agents', title: 'Agents' };

const ICONS = {
  chat: MessageSquare,
  settings: Settings,
  graph: Workflow,
  agents: Bot,
};

export default function Sidebar({ activeHash, routes, onNavigate }) {
  const items = [...(routes || []), AGENTS_ROUTE];
  const { backend } = useBackendStatus();
  const model = useModelStatus();

  const unresolved = model.loading ? null : model.configured !== true;
  const modelLabel = model.loading
    ? 'checking…'
    : model.configured
      ? `${model.provider || 'unified'} · ${model.model || 'default'}`
      : 'unresolved';

  return (
    <nav className="jx-sidebar" aria-label="Console">
      <div className="jx-brand">
        <span className="jx-brand-mark" aria-hidden="true"></span>
        <span className="jx-brand-name">JEXI</span>
      </div>

      <ul className="jx-nav">
        {items.map((r) => {
          const Icon = ICONS[r.id];
          const active = activeHash === r.hash;
          return (
            <li key={r.id}>
              <a
                className={'jx-nav-item' + (active ? ' is-active' : '')}
                href={r.hash}
                aria-current={active ? 'page' : undefined}
                onClick={() => { if (onNavigate) onNavigate(r.hash); }}
                title={r.label}
              >
                {Icon ? <Icon size={16} strokeWidth={2} aria-hidden="true" /> : null}
                <span className="jx-nav-label">{r.label}</span>
              </a>
            </li>
          );
        })}
      </ul>

      <div className="jx-sidebar-foot">
        <div
          className={'jx-model-indicator' + (unresolved ? ' is-unresolved' : '')}
          title={model.configured
            ? `unified model config — ${model.provider} / ${model.model}`
            : 'no unified model config — set one in Settings → Provider'}
        >
          <Cpu size={14} aria-hidden="true" />
          <span className="jx-model-indicator-value">{modelLabel}</span>
        </div>
        <div className="jx-status-row">
          <span
            className={'jx-status-dot is-' + backend}
            aria-hidden="true"
          ></span>
          <span className="jx-status-label">backend {backend}</span>
        </div>
      </div>
    </nav>
  );
}
