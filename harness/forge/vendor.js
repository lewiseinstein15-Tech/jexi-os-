/**
 * JEXI OS — Phase 22 Scope F — forge vendor interface.
 *
 * Ported from louisescher/crabd @ ad083d112f26fa1dc1a1335926d5f3956567b545,
 * whose README calls it "a forge-agnostic, multi-provider coding agent for CI".
 * The load-bearing idea is this file: a forge is a *vendor* that satisfies a
 * declared interface, and everything downstream consumes the normalized shape
 * rather than the forge. The dispatcher never asks "is this GitHub?" — it asks
 * the vendor what it can do.
 *
 * THE CONTRACT
 *   vendor.name          'github' | 'forgejo' | <string>
 *   vendor.capabilities  { canReviewPR, canImplementIssue, canReplyToMention,
 *                          authStyle, kindSource }
 *   vendor.parseEvent(raw)  -> normalized event (see normalizeEvent below)
 *   vendor.respond(task)    -> { ok, delivery, error? }   — STUB in this scope
 *   vendor.assert()         -> throws E_VENDOR_INCOMPLETE if anything is missing
 *
 * WHY CAPABILITIES ARE DECLARED, NOT DISCOVERED
 * The forges are not equivalent, and the differences are not bugs to paper
 * over. Forgejo has no `pull_request_review` event at all, so a submitted
 * review cannot start a run there. crabd records that as a documented
 * workaround ("comment /crabd implement instead"); we record it as a
 * capability flag so the dispatcher can refuse the request honestly rather
 * than silently downgrading it to a different action.
 *
 * ONE SHAPE, EVERY VENDOR
 * normalizeEvent() is the single constructor for the normalized event. Every
 * vendor builds through it, so two vendors handling the same logical event
 * produce the same key set — including keys whose value is null. Per-vendor
 * ad-hoc object literals are what make cross-forge shapes drift, so there is
 * exactly one place the shape is written down.
 */

/** Forge-permission vocabulary, ordered least to most privileged. */
export const PERMISSIONS = Object.freeze(['none', 'read', 'write', 'admin', 'owner']);

/** Normalized routing kinds. `unknown` is refused, never dropped silently. */
export const EVENT_KINDS = Object.freeze(['mention', 'pr', 'issue', 'unknown']);

/** Auth header styles a vendor may declare. */
export const AUTH_STYLES = Object.freeze(['bearer', 'token', 'none']);

/** Where a vendor learns the event kind: a transport header, or the payload. */
export const KIND_SOURCES = Object.freeze(['header', 'payload']);

/** Everything a vendor must declare about itself. */
export const CAPABILITY_KEYS = Object.freeze([
  'canReviewPR',
  'canImplementIssue',
  'canReplyToMention',
  'authStyle',
  'kindSource',
]);

/** Every method a vendor must implement. `assert` is included: it validates itself. */
export const REQUIRED_METHODS = Object.freeze(['parseEvent', 'respond', 'assert']);

export class ForgeError extends Error {
  constructor(code, reason) {
    super(`${code}: ${reason}`);
    this.name = 'ForgeError';
    this.code = code;
    this.reason = reason;
  }
}

/**
 * Validate a vendor against the contract.
 *
 * Called at registration/import time so a half-built vendor fails immediately
 * with its own name in the message, rather than at 2am on whichever code path
 * happens to reach the missing method first.
 *
 * @param {object} vendor
 * @returns {true}
 * @throws {ForgeError} E_VENDOR_INCOMPLETE
 */
export function assertVendor(vendor) {
  const fail = (reason) => {
    throw new ForgeError('E_VENDOR_INCOMPLETE', `vendor "${vendor?.name || '?'}" ${reason}`);
  };

  if (!vendor || typeof vendor !== 'object') fail('must be an object');
  if (typeof vendor.name !== 'string' || !vendor.name.trim()) fail('name must be a non-empty string');

  if (!vendor.capabilities || typeof vendor.capabilities !== 'object') {
    fail('must declare capabilities');
  }
  for (const key of CAPABILITY_KEYS) {
    if (!(key in vendor.capabilities)) fail(`capabilities.${key} is missing`);
  }
  for (const key of ['canReviewPR', 'canImplementIssue', 'canReplyToMention']) {
    if (typeof vendor.capabilities[key] !== 'boolean') {
      fail(`capabilities.${key} must be a boolean (got ${typeof vendor.capabilities[key]})`);
    }
  }
  if (!AUTH_STYLES.includes(vendor.capabilities.authStyle)) {
    fail(`capabilities.authStyle must be one of ${AUTH_STYLES.join(' | ')}`);
  }
  if (!KIND_SOURCES.includes(vendor.capabilities.kindSource)) {
    fail(`capabilities.kindSource must be one of ${KIND_SOURCES.join(' | ')}`);
  }

  for (const method of REQUIRED_METHODS) {
    if (typeof vendor[method] !== 'function') fail(`${method}() must be a function`);
  }

  return true;
}

/**
 * The single constructor for a normalized event.
 *
 * Emits the SAME key set for every vendor and every kind, using null for
 * absent values. That uniformity is the contract: a consumer can read
 * `event.permission` without first asking which forge produced the event.
 *
 * @param {object} fields
 * @returns {object} frozen normalized event
 */
export function normalizeEvent(fields) {
  const {
    forge, kind, repo, actor, body, permission,
    number = null, title = null, isDraft = null,
    mentionAction = null, instruction = null,
    isCapabilityUnsupported = false, raw,
  } = fields;

  // `forge` is the vendor's own name, stamped by the vendor's parseEvent. The
  // dispatcher resolves the vendor from this and nothing else, which is why it
  // is set by the vendor rather than passed in by the caller.
  if (typeof forge !== 'string' || !forge.trim()) {
    throw new ForgeError('E_VENDOR_INCOMPLETE', 'normalized event requires a forge (vendor) name');
  }

  if (!EVENT_KINDS.includes(kind)) {
    throw new ForgeError('E_UNKNOWN_KIND', `normalized kind "${kind}" is not one of ${EVENT_KINDS.join(' | ')}`);
  }
  if (!PERMISSIONS.includes(permission)) {
    throw new ForgeError('E_UNKNOWN_PERMISSION', `permission "${permission}" is not one of ${PERMISSIONS.join(' | ')}`);
  }

  return Object.freeze({
    forge,
    kind,
    repo: repo ? Object.freeze({ owner: repo.owner, name: repo.name, slug: repo.slug }) : null,
    actor: actor ? Object.freeze({ login: actor.login, isBot: actor.isBot }) : null,
    body: body ?? '',
    permission,
    number,
    title,
    isDraft,
    mentionAction,
    instruction,
    isCapabilityUnsupported,
    raw: raw ?? null,
  });
}

/** The key set every normalized event carries. Used by the probe's shape check. */
export function eventShape(event) {
  return Object.keys(event).sort();
}

/**
 * Map a GitHub `author_association` onto the normalized permission vocabulary.
 * Ported from crabd's association handling, widened to include ADMIN.
 */
export function permissionFromAssociation(association) {
  const a = String(association || '').trim().toUpperCase();
  switch (a) {
    case 'OWNER': return 'owner';
    case 'ADMIN': return 'admin';
    case 'MEMBER':
    case 'COLLABORATOR': return 'write';
    case 'CONTRIBUTOR':
    case 'NONE': return 'read';
    default: return 'none';
  }
}

/**
 * Map a Forgejo/Gitea repo permission onto the same vocabulary.
 * Forgejo reports `owner` for org owners where GitHub would say `admin`; both
 * are the top tier, so both land on `owner`.
 */
export function permissionFromForgejoPermission(permission) {
  const p = String(permission || '').trim().toLowerCase();
  switch (p) {
    case 'owner': return 'owner';
    case 'admin': return 'admin';
    case 'write': return 'write';
    case 'read': return 'read';
    default: return 'none';
  }
}

/**
 * Build the stub delivery result.
 *
 * Deliberately NOT a plausible success object. `verified: false` plus an
 * explicit note means a caller that forgets to check cannot later mistake this
 * for a real delivery — the failure mode this guards against is a stub that
 * looks like a working integration.
 */
export function stubDelivery(vendorName) {
  return {
    ok: true,
    delivery: 'stub',
    verified: false,
    note: `NOT VERIFIED - no forge credentials; ${vendorName} delivery is stubbed in this scope`,
  };
}
