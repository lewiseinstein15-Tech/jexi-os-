/**
 * B144 — BRAND (DeepSeek Harness `packages/util/brand` mirror, JEXI-branded).
 *
 * JEXI's brand constants: the canonical product name, tagline, version
 * source, and identity strings used across prompts, UI, and diagnostics —
 * one source of truth (dsh brand parity).
 */

export const BRAND = {
  name: 'JEXI OS',
  short: 'JEXI',
  tagline: 'Your personal AI operating system',
  home: '~/.jexi',
  envHome: 'JEXI_HOME',
  apiKeyEnv: 'JEXI_API_KEY',
  defaultBackendPort: 3002,
  version: '1.0.0',
};

export function brandName() { return BRAND.name; }
export function brandTagline() { return BRAND.tagline; }
export function brandIdentity() {
  return `I am ${BRAND.name} — ${BRAND.tagline}. My data home is ${BRAND.home} (override with $${BRAND.envHome}).`;
}
