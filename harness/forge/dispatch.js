/**
 * JEXI OS — Phase 22 Scope F — forge-agnostic dispatcher.
 *
 * Ported from louisescher/crabd @ ad083d112f26fa1dc1a1335926d5f3956567b545,
 * whose `detectTrigger` decides which of three modes an event maps to
 * (mention / review / implement) without ever inspecting which forge it is on.
 *
 * THE RULE THIS FILE EXISTS TO KEEP
 * The dispatcher resolves a vendor by NAME, once, at dispatch time — and from
 * then on asks the vendor what it can do. There is no `if (forge === 'github')`
 * anywhere in the routing path. Adding a third forge must be a matter of
 * writing a vendor file, not of editing this one.
 *
 * Routing table (independent of forge):
 *   mention -> reply
 *   pr      -> review     (subject to capabilities.canReviewPR)
 *   issue   -> implement   (subject to capabilities.canImplementIssue)
 *
 * A capability the vendor lacks is refused as E_FORGE_CAPABILITY_GAP. It is
 * never silently re-routed: answering a PR review request with an issue
 * comment would look like success while doing the wrong thing.
 */

import { ForgeError, CAPABILITY_KEYS } from './vendor.js';
import github from './github.vendor.js';
import forgejo from './forgejo.vendor.js';

/** Registered vendors by name. Adding a forge means adding a line here. */
const VENDORS = new Map([
  [github.name, github],
  [forgejo.name, forgejo],
]);

/** The routing table: normalized kind -> action. */
export const ROUTING = Object.freeze({
  mention: 'reply',
  pr: 'review',
  issue: 'implement',
  unknown: null,
});

/** Which capability each action depends on. */
export const ACTION_CAPABILITY = Object.freeze({
  reply: 'canReplyToMention',
  review: 'canReviewPR',
  implement: 'canImplementIssue',
});

export function listVendors() {
  return [...VENDORS.keys()];
}

export function getVendor(name) {
  return VENDORS.get(name) || null;
}

/**
 * Register a vendor at runtime. Validates the contract immediately so a
 * half-built vendor is rejected here rather than on a later dispatch.
 */
export function registerVendor(vendor, opts = {}) {
  vendor.assert();
  if (!opts.overwrite && VENDORS.has(vendor.name)) {
    throw new ForgeError('E_VENDOR_EXISTS', `vendor "${vendor.name}" is already registered`);
  }
  VENDORS.set(vendor.name, vendor);
  return vendor;
}

/**
 * Remove a previously registered vendor. Lets a caller install a temporary
 * vendor (a test double, an experiment) without leaving it in the registry the
 * dispatcher resolves against.
 */
export function unregisterVendor(name) {
  return VENDORS.delete(name);
}

/**
 * Resolve the vendor for an event and refuse an unknown one.
 *
 * @throws {ForgeError} E_UNKNOWN_VENDOR
 */
function resolveVendor(event) {
  const name = event?.forge;
  if (!name) {
    throw new ForgeError('E_UNKNOWN_VENDOR', 'event carries no forge name; cannot resolve a vendor');
  }
  const vendor = VENDORS.get(name);
  if (!vendor) {
    throw new ForgeError(
      'E_UNKNOWN_VENDOR',
      `no vendor registered as "${name}"; known vendors: ${listVendors().join(', ')}`,
    );
  }
  return vendor;
}

/**
 * Turn a normalized event into a dispatched task, or refuse.
 *
 * This is the ONLY place an action is chosen, and it is driven entirely by
 * (a) the routing table and (b) the vendor's declared capabilities.
 *
 * @param {object} event normalized event (from a vendor's parseEvent)
 * @returns {{action: string, task: object, unsupported?: boolean, reason?: string, capability?: string}}
 */
export function dispatch(event) {
  const vendor = resolveVendor(event);

  if (event.kind === 'unknown') {
    throw new ForgeError(
      'E_UNKNOWN_KIND',
      `event kind is "unknown" and cannot be routed; raw event was not recognized by ${vendor.name}`,
    );
  }

  const action = ROUTING[event.kind];
  if (!action) {
    throw new ForgeError(
      'E_UNKNOWN_KIND',
      `no routing for kind "${event.kind}"; routable kinds: ${Object.keys(ROUTING).filter((k) => ROUTING[k]).join(', ')}`,
    );
  }

  const capability = ACTION_CAPABILITY[action];

  // Ask the vendor, never the vendor's name.
  if (vendor.capabilities[capability] !== true) {
    return {
      unsupported: true,
      reason: 'E_FORGE_CAPABILITY_GAP',
      capability,
      action,
      vendor: vendor.name,
      kind: event.kind,
    };
  }

  const task = {
    vendor: vendor.name,
    action,
    repo: event.repo ? event.repo.slug : null,
    number: event.number,
    actor: event.actor ? event.actor.login : null,
    permission: event.permission,
    body: event.body,
    title: event.title,
    isDraft: event.isDraft,
  };

  return { action, task };
}

/**
 * Route a mention. Always `reply` — the mention *is* the instruction, so the
 * body is passed through for the agent to act on.
 */
export function onMention(event) {
  return dispatch(event);
}

/**
 * Route a pull request. `review` where the forge can, otherwise an explicit
 * capability gap.
 */
export function onPR(event) {
  return dispatch(event);
}

/** Route an issue. `implement`. */
export function onIssue(event) {
  return dispatch(event);
}

export { ForgeError, CAPABILITY_KEYS };

export default { dispatch, onMention, onPR, onIssue, listVendors, getVendor, registerVendor, unregisterVendor, ROUTING };