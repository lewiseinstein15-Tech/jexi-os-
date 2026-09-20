/**
 * JEXI OS — Phase 22 Scope F — harness/forge entry point.
 *
 * The crab'd pattern: an `@claude`-style workflow (answer mentions, review
 * PRs, implement issues) that runs on any forge through a pluggable vendor
 * layer. Ported from louisescher/crabd @
 * ad083d112f26fa1dc1a1335926d5f3956567b545.
 *
 *   import { parse, dispatch } from './harness/forge/index.js';
 *
 *   const event = parse('github', rawPayload);   // normalized, forge-shaped
 *   const { action, task } = dispatch.onPR(event);
 *
 * Adding a forge = writing one vendor file and registering it. The dispatcher
 * reads `vendor.capabilities`; it never branches on the forge's name.
 *
 * DELIVERY IS STUBBED IN THIS SCOPE.
 * `vendor.respond()` returns { ok: true, delivery: 'stub', verified: false }
 * with an explicit NOT VERIFIED note. No network call is made to any forge.
 * Wiring delivery is a zone-owner task.
 */

import {
  ForgeError,
  PERMISSIONS,
  EVENT_KINDS,
  AUTH_STYLES,
  KIND_SOURCES,
  CAPABILITY_KEYS,
  REQUIRED_METHODS,
  assertVendor,
  normalizeEvent,
  eventShape,
  permissionFromAssociation,
  permissionFromForgejoPermission,
  stubDelivery,
} from './vendor.js';

import github from './github.vendor.js';
import forgejo from './forgejo.vendor.js';

import {
  dispatch as route,
  onMention,
  onPR,
  onIssue,
  listVendors,
  getVendor,
  registerVendor,
  unregisterVendor,
  ROUTING,
  ACTION_CAPABILITY,
} from './dispatch.js';

/**
 * The dispatcher namespace: `dispatch.onMention(event)`, `.onPR(event)`,
 * `.onIssue(event)`, plus `.route(event)` for kind-driven dispatch.
 */
export const dispatch = Object.freeze({
  onMention, onPR, onIssue, route: route,
  listVendors, registerVendor, unregisterVendor, getVendor,
});

/** Vendors registered out of the box. */
export const VENDORS = Object.freeze({ github, forgejo });

/**
 * Parse a raw event with a named vendor.
 *
 * The dispatcher's counterpart: this is where a forge name is legitimately
 * used, because resolving `'forgejo'` to the Forgejo parser is the whole point
 * of the vendor layer. Everything downstream of parseEvent is forge-blind.
 *
 * @param {string} vendorName
 * @param {object} raw
 * @throws {ForgeError} E_UNKNOWN_VENDOR
 */
export function parse(vendorName, raw) {
  const vendor = getVendor(vendorName);
  if (!vendor) {
    throw new ForgeError(
      'E_UNKNOWN_VENDOR',
      `no vendor registered as "${vendorName}"; known vendors: ${listVendors().join(', ')}`,
    );
  }
  return vendor.parseEvent(raw);
}

export {
  ForgeError,
  PERMISSIONS,
  EVENT_KINDS,
  AUTH_STYLES,
  KIND_SOURCES,
  CAPABILITY_KEYS,
  REQUIRED_METHODS,
  assertVendor,
  normalizeEvent,
  eventShape,
  permissionFromAssociation,
  permissionFromForgejoPermission,
  stubDelivery,
  onMention,
  onPR,
  onIssue,
  listVendors,
  getVendor,
  registerVendor,
  unregisterVendor,
  ROUTING,
  ACTION_CAPABILITY,
  github,
  forgejo,
};

export default {
  parse,
  dispatch,
  onMention,
  onPR,
  onIssue,
  listVendors,
  getVendor,
  registerVendor,
  unregisterVendor,
  VENDORS,
};