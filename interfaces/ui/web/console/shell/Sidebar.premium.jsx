import { MessageSquare, Settings, Workflow, Bot, Cpu, Plus, X } from 'lucide-react';
import { useBackendStatus, useModelStatus } from './useStatus.js';
import { relativeTime } from '../chat/sessions.js';

/**
 * Premium sidebar — JEXI wordmark, "+ New chat" action, the four nav
 * destinations (Chat / Settings / Work Graph / Agents), the chat history
 * list (one row per session: title, relative time, hover-to-delete —
 * BUG 3, localStorage-backed via chat/sessions.js), and the honest bottom
 * strip: model indicator (provider + model, or "unresolved" in muted red)
 * plus the backend liveness dot. All read real probes (useStatus.js).
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

export default function Sidebar({ activeHash, routes, onNavigate, sessions, activeSessionId, onNewChat, onOpenSession, onDeleteSession }) {
  const items = [...(routes || []), AGENTS_ROUTE];
  const { backend } = useBackendStatus();
  const model = useModelStatus();
  const history = Array.isArray(sessions) ? sessions : [];

  // BUG 1 (ui-rebuild-premium-v2) — same shared signal as the header chip:
  // unified config OR legacy key (env/settings) OR the last turn's real
  // provider. "unresolved" only when there is genuinely nothing configured.
  const unresolved = model.loading ? null : model.configured !== true;
  const modelLabel = model.loading
    ? 'checking…'
    : model.configured
      ? `${model.provider || 'key detected'}${model.model ? ` · ${model.model}` : ''}`
      : 'unresolved';

  return (
    <nav className="jx-sidebar" aria-label="Console">
      <div className="jx-brand">
        <span className="jx-brand-mark" aria-hidden="true"></span>
        <span className="jx-brand-name">JEXI</span>
      </div>

      {/* BUG 3 — the "New chat" action sits above the nav items. */}
      <button type="button" className="jx-newchat" onClick={onNewChat} title="start a fresh conversation (new session id, empty transcript)">
        <Plus size={15} strokeWidth={2.2} aria-hidden="true" />
        <span>New chat</span>
      </button>

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

      {/* BUG 3 — chat history (localStorage-backed; sessions appear once they
          carry a first user message). Hover a row to reveal delete. */}
      {history.length > 0 && (
        <div className="jx-history" role="list" aria-label="Chat history">
          <div className="jx-history-head">history</div>
          {history.map((s) => {
            const active = s.id === activeSessionId;
            return (
              <div key={s.id} className={'jx-history-item' + (active ? ' is-active' : '')} role="listitem">
                <button
                  type="button"
                  className="jx-history-open"
                  onClick={() => { if (onOpenSession) onOpenSession(s.id); if (onNavigate) onNavigate(); }}
                  title={s.title || 'untitled'}
                >
                  <span className="jx-history-title">{s.title || 'untitled'}</span>
                  <span className="jx-history-time">{relativeTime(s.ts)}</span>
                </button>
                <button
                  type="button"
                  className="jx-history-del"
                  aria-label={`delete chat: ${s.title || 'untitled'}`}
                  title="delete this chat"
                  onClick={(e) => { e.stopPropagation(); if (onDeleteSession) onDeleteSession(s.id); }}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="jx-sidebar-foot">
        <div
          className={'jx-model-indicator' + (unresolved ? ' is-unresolved' : '')}
          title={model.configured
            ? (model.source === 'last-turn'
                ? `provider used by the last turn — ${model.provider}${model.model ? ` / ${model.model}` : ''}`
                : `model config${model.source ? ` (${model.source})` : ''} — ${model.provider}${model.model ? ` / ${model.model}` : ''}`)
            : 'no model key found — set one in Settings → Provider'}
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
