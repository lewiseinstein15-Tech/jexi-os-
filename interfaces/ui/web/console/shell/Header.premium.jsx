import { Menu, Moon, Sun, Cpu, TriangleAlert, Check } from 'lucide-react';
import { useBackendStatus, useModelStatus } from './useStatus.js';

/**
 * Premium header — route title, model status chip ("model configured
 * (unified)" or a warning chip when unresolved), backend status, theme
 * toggle (dark default; light optional) and the mobile hamburger.
 * Hamburger visibility is CSS-driven (<600px); it toggles the shell's
 * is-nav-open state which slides the fixed sidebar in.
 */
export default function Header({ routeTitle, theme, onTheme, onToggleNav }) {
  const { backend } = useBackendStatus();
  const model = useModelStatus();

  const chip = model.loading
    ? { cls: '', icon: Cpu, label: 'model status…', value: '' }
    : model.configured
      ? { cls: 'is-ok', icon: Check, label: 'model configured (unified)', value: `${model.provider || ''}${model.provider && model.model ? ' · ' : ''}${model.model || ''}` }
      : { cls: 'is-warn', icon: TriangleAlert, label: 'model unresolved', value: 'configure in Settings' };

  const ChipIcon = chip.icon;

  return (
    <header className="jx-header">
      <button
        type="button"
        className="jx-hamburger"
        aria-label="Toggle navigation"
        onClick={onToggleNav}
      >
        <Menu size={16} aria-hidden="true" />
      </button>

      <h1 className="jx-route-title">{routeTitle}</h1>

      <div className="jx-header-status">
        <span className={'jx-chip ' + chip.cls} title={chip.label}>
          <ChipIcon size={13} aria-hidden="true" />
          {chip.label}
          {chip.value ? <span className="jx-chip-value">{chip.value}</span> : null}
        </span>

        <span
          className={'jx-status-dot is-' + backend}
          title={'backend ' + backend}
          aria-hidden="true"
        ></span>

        <button
          type="button"
          className="jx-iconbtn"
          onClick={() => onTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label={'switch to ' + (theme === 'dark' ? 'light' : 'dark') + ' theme'}
          title={'switch to ' + (theme === 'dark' ? 'light' : 'dark') + ' theme'}
        >
          {theme === 'dark' ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
        </button>
      </div>
    </header>
  );
}
