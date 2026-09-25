import { useEffect } from 'react';

/**
 * Keyboard shortcuts (ui-rebuild-premium):
 *   Cmd/Ctrl + /   -> shortcuts overlay (this one)
 *   g then c/s/w/a -> navigate Chat / Settings / Work Graph / Agents
 *   g then t       -> theme toggle
 *
 * Implemented as a hash-router citizen (location.hash = '#/settings' etc.) —
 * no new routing layer. The overlay is rendered by Shell.jsx while active.
 */

export const SHORTCUTS = [
  { keys: ['⌘', '/'], label: 'toggle this shortcuts overlay' },
  { keys: ['g', 'c'], label: 'go to Chat' },
  { keys: ['g', 's'], label: 'go to Settings' },
  { keys: ['g', 'w'], label: 'go to Work Graph' },
  { keys: ['g', 'a'], label: 'go to Agents' },
  { keys: ['g', 't'], label: 'toggle dark / light theme' },
  { keys: ['Esc'], label: 'close overlay / drawer' },
];

export function useShortcuts({ onOverlay, onTheme }) {
  useEffect(() => {
    let pendingG = false;
    let gTimer = null;

    function go(hash) {
      if (window.location.hash === hash) return;
      window.location.hash = hash;
    }

    function onKey(e) {
      const tag = (e.target && e.target.tagName) || '';
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        onOverlay();
        return;
      }
      if (e.key === 'Escape') {
        onOverlay(false);
        return;
      }
      if (typing) return;

      if (pendingG) {
        pendingG = false;
        clearTimeout(gTimer);
        const k = e.key.toLowerCase();
        if (k === 'c') return go('#/chat');
        if (k === 's') return go('#/settings');
        if (k === 'w') return go('#/graph');
        if (k === 'a') return go('#/agents');
        if (k === 't') return onTheme();
        return;
      }
      if (e.key === 'g' || e.key === 'G') {
        pendingG = true;
        clearTimeout(gTimer);
        gTimer = setTimeout(() => { pendingG = false; }, 1200);
      }
    }

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(gTimer);
    };
  }, [onOverlay, onTheme]);
}
