import { useEffect, useState } from 'react';
import { CircleCheck, CircleX, Info } from 'lucide-react';

/**
 * Premium toasts (ui-rebuild-premium). Top-right, 4s auto-dismiss.
 * Imperative API so any view can fire one without prop drilling:
 *
 *   import { toast } from '../shell/toasts.js';
 *   toast('settings saved', 'ok');
 *
 * The <Toasts /> host is rendered once by Shell.jsx.
 */

const listeners = new Set();
let toasts = [];
let nextId = 1;

function emit() {
  for (const fn of listeners) {
    try { fn(toasts); } catch { /* a bad subscriber never kills the toast */ }
  }
}

export function toast(message, kind = 'info', ttl = 4000) {
  const id = nextId++;
  toasts = [...toasts, { id, message: String(message), kind }];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, ttl);
  return id;
}

export function dismissToast(id) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

const ICONS = {
  ok: CircleCheck,
  fail: CircleX,
  info: Info,
};

export function Toasts() {
  const [items, setItems] = useState(toasts);
  useEffect(() => {
    const fn = (t) => setItems(t);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);

  if (!items.length) return null;
  return (
    <div className="jx-toasts" role="status" aria-live="polite">
      {items.map((t) => {
        const Icon = ICONS[t.kind] || Info;
        return (
          <div key={t.id} className={'jx-toast is-' + t.kind} onClick={() => dismissToast(t.id)}>
            <Icon size={15} aria-hidden="true" />
            <span>{t.message}</span>
          </div>
        );
      })}
    </div>
  );
}
