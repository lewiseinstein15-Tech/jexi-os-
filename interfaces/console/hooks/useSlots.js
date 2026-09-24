/**
 * B143 — USE SLOTS (DeepSeek Harness `packages/client/ui-slots` mirror,
 * JEXI-branded).
 *
 * React hook over the SlotRegistry: subscribe to one slot id and receive
 * its entry, re-rendering when the slot changes.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { SlotRegistry } from '../utils/clientModules.js';

const registry = new SlotRegistry();
const listeners = new Set();
const notify = () => { for (const fn of listeners) fn(); };

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useSlot(id) {
  const snapshot = () => registry.get(id) || null;
  useEffect(() => { const off = subscribe(notify); return off; }, []);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function useSlots() {
  const snapshot = () => registry.list();
  useEffect(() => { const off = subscribe(notify); return off; }, []);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Register a slot imperatively (returns a disposer). */
export function registerSlot(id, entry) {
  const dispose = registry.register(id, entry);
  notify();
  return () => { dispose(); notify(); };
}
