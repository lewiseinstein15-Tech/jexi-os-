/**
 * JEXI OS — Phase 22 Scope F — Forgejo forge vendor.
 *
 * Ported from louisescher/crabd @ ad083d112f26fa1dc1a1335926d5f3956567b545.
 *
 * Forgejo is *not* a GitHub clone with a different URL, and this adapter exists
 * to say so precisely rather than approximately. Three confirmed differences:
 *
 * 1. NO `pull_request_review` EVENTS. Forgejo Actions cannot dispatch on a
 *    submitted review, so a review cannot start a run there. crabd documents
 *    the workaround ("comment /crabd implement address the review instead");
 *    we declare `canReviewPR: false` so the dispatcher can refuse the request
 *    honestly instead of quietly doing something else.
 *
 * 2. PERMISSION IS REPORTED DIFFERENTLY. Forgejo reports a repo permission
 *    (`owner` / `admin` / `write` / `read`) where GitHub reports an
 *    `author_association`. Different field, same normalized output.
 *
 * 3. THE EVENT KIND MAY NOT ARRIVE AT ALL. Forgejo emits `workflow_call` from
 *    a reusable workflow rather than the caller's trigger name, so the kind has
 *    to be inferred from the payload. `kindSource: 'payload'` records that.
 *
 * A `pr` event still normalizes cleanly here — parsing is not the problem.
 * The gap is delivery, and it is reported as `isCapabilityUnsupported: true`
 * on the event so the dispatcher's refusal is driven by data the vendor
 * declared, not by the dispatcher knowing Forgejo's name.
 */

import {
  normalizeEvent,
  permissionFromForgejoPermission,
  stubDelivery,
  assertVendor,
} from './vendor.js';

export const name = 'forgejo';

export const capabilities = Object.freeze({
  // Forgejo Actions has no review-submission trigger. See note 1 above.
  canReviewPR: false,
  canImplementIssue: true,
  canReplyToMention: true,
  authStyle: 'token',
  kindSource: 'payload',
});

/** Forgejo transport event names → normalized kinds. */
const HEADER_KINDS = Object.freeze({
  issue_comment: 'mention',
  issues: 'issue',
  pull_request: 'pr',
});

/**
 * Infer the kind from the payload.
 *
 * Required on Forgejo because a reusable workflow reports `workflow_call`
 * rather than the caller's trigger, so the transport name can be unusable.
 *
 * Order matters, and a comment outranks the subject it hangs off. An
 * `issue_comment` payload carries BOTH a `comment` and an `issue`, so testing
 * `issue` first would classify a mention as an issue and route it to
 * `implement` instead of `reply`. A comment is the more specific signal: it
 * only appears on comment events, whereas `issue` appears on both.
 */
export function inferKindFromPayload(payload) {
  const p = payload || {};
  if (p.comment) return 'mention';
  if (p.pull_request) return 'pr';
  if (p.issue) return p.issue.pull_request ? 'pr' : 'issue';
  return 'unknown';
}

function mentionActionFor(action) {
  if (action === 'created') return 'created';
  return null;
}

function buildRepo(p) {
  const owner = p?.repository?.owner?.login || p?.repository?.owner?.username;
  const repoName = p?.repository?.name;
  const full = p?.repository?.full_name;
  if (!owner || !repoName) return null;
  return { owner, name: repoName, slug: full || `${owner}/${repoName}` };
}

/**
 * Parse a raw Forgejo event.
 *
 * @param {{eventName?: string, payload?: object, headers?: object}} raw
 * @returns {object} normalized event
 */
export function parseEvent(raw) {
  const payload = raw?.payload || {};
  const eventName = raw?.eventName || raw?.headers?.['x-forgejo-event'] || '';

  // Never trust the transport name alone: a reusable workflow reports
  // `workflow_call`, which maps to nothing, so fall through to the payload.
  const kind = HEADER_KINDS[eventName] || inferKindFromPayload(payload);

  const repo = buildRepo(payload);
  const actorLogin = payload?.sender?.login || payload?.comment?.user?.login || 'unknown';
  // Forgejo reports a permission level, not a GitHub author-association.
  const permission = payload?.comment?.permission
    ?? payload?.issue?.permission
    ?? payload?.pull_request?.permission
    ?? payload?.sender?.permission
    ?? 'none';
  const actor = {
    login: actorLogin,
    isBot: String(payload?.sender?.type || '').toLowerCase() === 'bot' || actorLogin.endsWith('[bot]'),
  };

  const comment = payload?.comment;
  const issue = payload?.issue;
  const pull = payload?.pull_request;
  const subject = pull || issue || null;

  // A PR event is parseable here, but Forgejo cannot natively deliver a
  // review run for it. Mark the gap at parse time so the flag travels with
  // the data and the dispatcher stays forge-agnostic.
  const isCapabilityUnsupported = kind === 'pr' && !capabilities.canReviewPR;

  return normalizeEvent({
    forge: name,
    kind,
    repo,
    actor,
    body: comment?.body ?? issue?.body ?? pull?.body ?? '',
    permission: permissionFromForgejoPermission(permission),
    number: subject?.number ?? null,
    title: subject?.title ?? null,
    isDraft: pull ? Boolean(pull.draft) : null,
    mentionAction: comment ? mentionActionFor(payload?.action) : null,
    instruction: null,
    isCapabilityUnsupported,
    raw,
  });
}

/**
 * Deliver a dispatched task to Forgejo.
 *
 * NOT VERIFIED - no forge credentials. Returns the stub result and makes no
 * network call. Wiring this to the live API is a zone-owner task.
 */
export function respond(task) {
  return stubDelivery(name);
}

export function assert() {
  return assertVendor(vendor);
}

export const vendor = { name, capabilities, parseEvent, respond, assert, inferKindFromPayload };

export default vendor;