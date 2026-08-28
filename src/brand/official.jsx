/**
 * B160 — OFFICIAL BRAND OCCUPANTS (DeepSeek Harness
 * `packages/client/ui-brand-official` mirror).
 *
 * Fills the shipped brand slots as ONE declaration-aware registration set:
 *   sidebar.brand.mark · sidebar.brand.name · conversation.hero.brand.mark
 *
 * DSH gates this on DSH_CLIENT_BUILD_PROFILE === 'official'; JEXI's own
 * build IS the official profile, so the gate defaults to on (set
 * VITE_BUILD_PROFILE=off to run slot-less).
 */

import React from 'react';
import { registerSlot, resolveSlot } from '../utils/uiRenderer';

/** The official JEXI mark — monochrome neon "J" tile (matches the app icon). */
export function OfficialBrandMark({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-label="JEXI" role="img">
      <rect width="32" height="32" rx="7" fill="#0a0a0f" />
      <rect x="1.5" y="1.5" width="29" height="29" rx="6" fill="none" stroke="#00ff9d" strokeOpacity="0.45" />
      <text x="16" y="22" fontFamily="Arial, sans-serif" fontSize="17" fontWeight="900" fill="#00ff9d" textAnchor="middle">J</text>
    </svg>
  );
}

/** The official brand name — the wordmark used in the sidebar. */
export function OfficialBrandName({ compact = false }) {
  return (
    <span className="jx-brandname">
      {compact ? 'JEXI' : 'JEXI OS'}
      <span className="jx-brandsub">AI Operating System</span>
    </span>
  );
}

/** Register every shipped brand slot (each registration is reversible). */
export function apply(ctx) {
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_BUILD_PROFILE === 'off') return () => {};
  const unbind = [];
  unbind.push(registerSlot('sidebar.brand.mark', () => <OfficialBrandMark />));
  unbind.push(registerSlot('sidebar.brand.name', () => <OfficialBrandName />));
  unbind.push(registerSlot('conversation.hero.brand.mark', () => <OfficialBrandMark size={40} />));
  return () => unbind.forEach((u) => u());
}

/** Render-time resolvers with static fallbacks (slots are always fillable). */
export function SidebarBrandMark() {
  const bound = resolveSlot('sidebar.brand.mark');
  return bound || <OfficialBrandMark />;
}
export function SidebarBrandName() {
  const bound = resolveSlot('sidebar.brand.name');
  return bound || <OfficialBrandName />;
}
export function ConversationHeroBrandMark() {
  const bound = resolveSlot('conversation.hero.brand.mark');
  return bound || <OfficialBrandMark size={40} />;
}
