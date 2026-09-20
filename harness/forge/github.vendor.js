/**
 * JEXI OS — Phase 22 Scope F — GitHub forge vendor.
 *
 * Ported from louisescher/crabd @ ad083d112f26fa1dc1a1335926d5f3956567b545.
 * crabd's GitHub path parses the webhook payload defensively and maps
 * `author_association` for the trust gate; this adapter does the same and
 * normalizes onto the Scope F event shape.
 *
 * GitHub is the vendor that can do everything, so its capabilities are all
 * true. That is a declaration of what the forge offers, not a privilege this
 * adapter grants itself — the dispatcher reads the flags, not the name.
 */

import {
  normalizeEvent,
  permissionFromAssociation,
  stubDelivery,
  assertVendor,
} from './vendor.js';

export const name = 'github';

export const capabilities = Object.freeze({
  canReviewPR: true,
  canImplementIssue: true,
  canReplyToMention: true,
  authStyle: 'bearer',
  kindSource: 'header',
});

/** GitHub's transport event names → normalized kinds. */
const HEADER_KINDS = Object.freeze({
  issue_comment: 'mention',
  issues: 'issue',
  pull_request: 'pr',
  pull_request_review: 'pr',
  pull_request_review_comment: 'mention',
});

/**
 * Infer the kind from the payload when the transport name is unusable.
 *
 * Order matters, and a comment outranks the subject it hangs off. An
 * `issue_comment` payload carries BOTH a `comment` and an `issue`, so testing
 * `issue` first would classify a mention as an issue and route it to
 * `implement` instead of `reply`. A comment is the more specific signal: it
 * only appears on comment events, whereas `issue` appears on both.
 *
 * Both forges share this JSON shape, so the same inference is correct for either.
 */
export function inferKindFromPayload(payload) {
  const p = payload || {};
  if (p.comment) return 'mention';
  if (p.pull_request) return 'pr';
  if (p.issue) return p.issue.pull_request ? 'pr' : 'issue';
  return 'unknown';
}

/** Which comment action counts as a mention. Edited/deleted do NOT re-trigger. */
function mentionActionFor(action) {
  if (action === 'created') return 'created';
  return null;
}

function buildRepo(p) {
  const full = p?.repository?.full_name;
  const owner = p?.repository?.owner?.login;
  const repoName = p?.repository?.name;
  if (!owner || !repoName) {
    return null;
  }
  return { owner, name: repoName, slug: full || `${owner}/${repoName}` };
}

/**
 * Parse a raw GitHub event.
 *
 * @param {{eventName?: string, payload?: object, headers?: object}} raw
 * @returns {object} normalized event
 */
export function parseEvent(raw) {
  const payload = raw?.payload || {};
  const eventName = raw?.eventName || raw?.headers?.['x-github-event'] || '';

  const kind = HEADER_KINDS[eventName] || inferKindFromPayload(payload);

  const repo = buildRepo(payload);
  const actorLogin = payload?.sender?.login || payload?.comment?.user?.login || 'unknown';
  const association = payload?.comment?.author_association
    || payload?.issue?.author_association
    || payload?.pull_request?.author_association
    || 'NONE';
  const actor = {
    login: actorLogin,
    isBot: String(payload?.sender?.type || '').toLowerCase() === 'bot' || actorLogin.endsWith('[bot]'),
  };

  const comment = payload?.comment;
  const issue = payload?.issue;
  const pull = payload?.pull_request;

  // The subject is whichever of the three the payload carries.
  const subject = pull || issue || null;

  return normalizeEvent({
    forge: name,
    kind,
    repo,
    actor,
    body: comment?.body ?? issue?.body ?? pull?.body ?? '',
    permission: permissionFromAssociation(association),
    number: subject?.number ?? comment?.issue_url?.number ?? null,
    title: subject?.title ?? null,
    isDraft: pull ? Boolean(pull.draft) : null,
    mentionAction: comment ? mentionActionFor(payload?.action) : null,
    instruction: null,
    isCapabilityUnsupported: false,
    raw,
  });
}

/**
 * Deliver a dispatched task to GitHub.
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