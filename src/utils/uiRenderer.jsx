/**
 * B160 — UI RENDERER (DeepSeek Harness
 * `packages/client/ui-renderer` mirror).
 *
 * Browser UI renderer seam: React slot bindings, a uiRenderer context, and
 * the assembled application root. JEXI's App is a React tree; this module
 * owns the RENDERER assembly exactly like ctx.uiRenderer:
 *
 *   - registerSlot(name, bind)      → named slot bindings (reversible)
 *   - slotBindings()                → the live bindings map (render-time)
 *   - renderRoot(element, target)   → the assembled application root with
 *                                     slot context + error boundary
 *
 * Slots used today: 'sidebar.brand', 'chat.hero', 'chat.empty' (the official
 * brand occupants — ui-brand-official mirror — live in theme.js/Brand).
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import ErrorBoundary from '../components/ErrorBoundary';

const bindings = new Map();

/** Register a named slot binding. Returns an unregister function (reversible). */
export function registerSlot(name, bind) {
  const key = String(name || '');
  if (!key) throw new Error('slot name required');
  bindings.set(key, bind);
  return () => bindings.delete(key);
}

/** Live slot bindings (copy — render-time read). */
export function slotBindings() {
  return Object.fromEntries(bindings.entries());
}

/** Resolve one slot's current binding (null when unbound). */
export function resolveSlot(name) {
  const bind = bindings.get(String(name || ''));
  return typeof bind === 'function' ? bind() : null;
}

/** The uiRenderer context passed through the assembled root. */
export const UiRendererContext = React.createContext({ slots: {} });

/** Assemble + mount the application root (slot-aware, error-bounded). */
export function renderRoot(AppElement, target) {
  const host = target || (typeof document !== 'undefined' ? document.getElementById('root') : null);
  if (!host) throw new Error('renderRoot: no target element');
  const root = createRoot(host);
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <UiRendererContext.Provider value={{ slots: slotBindings() }}>
          {AppElement}
        </UiRendererContext.Provider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
  return root;
}
