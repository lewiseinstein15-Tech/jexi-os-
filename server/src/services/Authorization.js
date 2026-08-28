/**
 * B160 — AUTHORIZATION SEAM (DeepSeek Harness
 * `packages/credentials/authorization` mirror).
 *
 * ctx.authorization: plugin-owned flows that obtain a credential THROUGH A
 * CONVERSATION WITH THE HUMAN. A tool that needs, say, a GitHub token does
 * not read it directly — it starts an authorization flow:
 *
 *   const flow = beginAuthorization({
 *     key: 'github', label: 'GitHub',
 *     purpose: 'push your project to GitHub',
 *     validate: async (v) => v.startsWith('ghp_') || v.startsWith('github_pat_'),
 *   });
 *   if (flow.status === 'granted')  use(flow.value);
 *   if (flow.status === 'needed')   ask the user with flow.question
 *                                   (already-shaped ask.user payload), then
 *                                   completeAuthorization(flow.id, answer).
 *
 * Mirrors DSH semantics:
 *   - resolve-first: an existing credential never triggers a conversation
 *   - one pending flow per key per conversation (new flow supersedes)
 *   - flows expire (DSH disposalTimeoutMs → AUTH_FLOW_TTL_MS default 10 min)
 *   - answers are validated; a rejection aborts without deleting anything
 *   - granted values pass through CredentialStore.setCredential (official
 *     credentials, never echoed back in full — masked in every status shape)
 */

import crypto from 'crypto';
import { resolveCredential, setCredential, hasManagedCredential } from './CredentialStore.js';

export const AUTH_FLOW_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING_FLOWS = 32;

const flows = new Map(); // flowId → flow record

function mask(value) {
  const v = String(value || '');
  if (!v) return '';
  if (v.length <= 8) return '•'.repeat(v.length);
  return `${v.slice(0, 3)}${'•'.repeat(Math.min(12, v.length - 6))}${v.slice(-3)}`;
}

function sweep() {
  const now = Date.now();
  for (const [id, f] of flows) {
    if (f.status === 'pending' && now - f.born > AUTH_FLOW_TTL_MS) {
      f.status = 'expired';
      f.endedAt = now;
    }
    if (f.status !== 'pending' && now - (f.endedAt || now) > AUTH_FLOW_TTL_MS) flows.delete(id);
  }
  if (flows.size > MAX_PENDING_FLOWS * 2) {
    const pending = [...flows.values()].filter((f) => f.status === 'pending');
    for (const f of [...flows.values()].filter((x) => x.status !== 'pending')) {
      if (flows.size - pending.length <= MAX_PENDING_FLOWS) break;
      flows.delete(f.id);
    }
  }
}

/**
 * Start (or supersede) an authorization flow for one credential key in one
 * conversation. Returns the flow shape the caller acts on — `granted`
 * immediately when the credential already exists (DSH resolve-first).
 */
export function beginAuthorization({
  key, label, purpose = 'use this integration', validate = null,
  owner = 'default', askPrompt = null,
} = {}) {
  sweep();
  const k = String(key || '').trim();
  if (!k) throw new Error('authorization key required');
  // Resolve-first: existing credential (env or stored) never prompts.
  const existing = resolveCredential(k);
  if (existing) {
    return { id: null, key: k, status: 'granted', source: hasManagedCredential(k) ? 'stored' : 'env', masked: mask(existing) };
  }
  // One pending flow per key+owner: supersede older ones.
  for (const f of flows.values()) {
    if (f.status === 'pending' && f.key === k && f.owner === String(owner)) f.status = 'superseded';
  }
  const id = `authflow-${crypto.randomUUID().slice(0, 12)}`;
  const flow = {
    id,
    key: k,
    owner: String(owner),
    label: String(label || k),
    purpose: String(purpose),
    validate: typeof validate === 'function' ? validate : null,
    askPrompt: String(askPrompt || `Please paste your ${label || k} credential (it is stored securely on your own JEXI server and never displayed again):`),
    status: 'pending',
    born: Date.now(),
  };
  flows.set(id, flow);
  return publicFlow(flow);
}

/** Complete a pending flow with the human's answer ('' → rejected). */
export async function completeAuthorization(flowId, answer, { persist = true } = {}) {
  sweep();
  const f = flows.get(String(flowId || ''));
  if (!f) return { ok: false, code: 'AUTH_FLOW_UNKNOWN', error: 'unknown authorization flow' };
  if (f.status !== 'pending') {
    return { ok: false, code: `AUTH_FLOW_${String(f.status).toUpperCase()}`, error: `flow is ${f.status}` };
  }
  const value = String(answer ?? '').trim();
  if (!value) {
    f.status = 'rejected'; f.endedAt = Date.now();
    return { ok: false, code: 'AUTH_FLOW_REJECTED', error: 'user declined' };
  }
  if (f.validate) {
    let valid;
    try { valid = await f.validate(value); } catch (e) { valid = `validator failed: ${e.message}`; }
    if (valid !== true) {
      f.status = 'invalid'; f.endedAt = Date.now();
      return { ok: false, code: 'AUTH_FLOW_INVALID', error: typeof valid === 'string' && valid ? valid : 'credential failed validation' };
    }
  }
  if (persist) setCredential(f.key, value);
  f.status = 'granted'; f.endedAt = Date.now(); f.masked = mask(value);
  return { ok: true, key: f.key, masked: f.masked, source: 'stored' };
}

/** The ask.user payload a conversation uses to surface a flow to the human. */
export function authorizationQuestion(flow) {
  if (!flow || flow.status !== 'pending') return null;
  return {
    id: flow.id,
    kind: 'authorization',
    key: flow.key,
    label: flow.label,
    purpose: flow.purpose,
    prompt: flow.askPrompt,
    options: [
      { id: 'paste', label: `Paste ${flow.label} credential`, secret: true },
      { id: 'decline', label: `Skip — continue without ${flow.label}` },
    ],
  };
}

export function getAuthorizationFlow(flowId) {
  sweep();
  const f = flows.get(String(flowId || ''));
  return f ? publicFlow(f) : null;
}

export function listAuthorizationFlows({ owner = null } = {}) {
  sweep();
  return [...flows.values()]
    .filter((f) => !owner || f.owner === String(owner))
    .map(publicFlow);
}

function publicFlow(f) {
  return {
    id: f.id, key: f.key, owner: f.owner, label: f.label, purpose: f.purpose,
    status: f.status, born: f.born,
    ...(f.masked ? { masked: f.masked } : {}),
    question: f.status === 'pending' ? authorizationQuestion(f) : null,
  };
}
