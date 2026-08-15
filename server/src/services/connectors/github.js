/**
 * GITHUB CONNECTOR — GitHub REST API (the existing GitHubAgent.js shells out to
 * the `gh` CLI for commit/push/PR work; this connector is the verifiable REST
 * layer: real key check, real issue creation, webhook receive with HMAC).
 *
 *   health_check()  GET  https://api.github.com/user          → real username
 *   send()          POST https://api.github.com/repos/{owner}/{repo}/issues
 *   webhook         POST /webhooks/connectors/github          (HMAC-verified)
 *
 * Env: GITHUB_TOKEN (or GH_TOKEN, or Settings → GitHub token). The webhook
 * secret is GITHUB_WEBHOOK_SECRET when set, else the same GITHUB_TOKEN (set
 * the webhook's secret to your token value in GitHub's webhook settings).
 */
import axios from 'axios';
import crypto from 'crypto';
import { getGhToken } from '../GitHubAgent.js';

export const GITHUB_API = 'https://api.github.com';
const GITHUB_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'JEXI-OS-Connector/1.0',
};

function authHeaders() {
  const token = getGhToken();
  return token ? { ...GITHUB_HEADERS, Authorization: `Bearer ${token}` } : { ...GITHUB_HEADERS };
}

/** Masked credential info — presence + source only. */
export function githubEnvInfo() {
  const token = getGhToken();
  if (!token) return { configured: false, source: 'none', envVars: ['GITHUB_TOKEN', 'GH_TOKEN'] };
  if (process.env.GITHUB_TOKEN || process.env.GH_TOKEN) return { configured: true, source: 'env', envVars: ['GITHUB_TOKEN', 'GH_TOKEN'] };
  return { configured: true, source: 'settings', envVars: ['GITHUB_TOKEN', 'GH_TOKEN'] };
}

/** Exact GitHub issue-creation body (pure — exported for tests). */
export function buildGitHubIssue({ title, body } = {}) {
  return { title: String(title), body: body ? String(body) : 'Reported by JEXI OS.' };
}

/**
 * health_check() — REAL call to GitHub's API (GET /user). 200 = the token
 * works and returns the authenticated username. Never PASSes on presence.
 */
export async function healthCheck() {
  const token = getGhToken();
  if (!token) return { status: 'BLOCKED', ok: false, reason: 'GITHUB_TOKEN is not set (Render env or Settings → GitHub)' };
  try {
    const res = await axios.get(`${GITHUB_API}/user`, { headers: authHeaders(), timeout: 15000 });
    const u = res.data || {};
    return {
      status: 'PASS',
      ok: true,
      detail: `GitHub API OK — authenticated as @${u.login}${u.name ? ` (${u.name})` : ''}`,
      user: { login: u.login, name: u.name, id: u.id },
    };
  } catch (e) {
    const status = e.response ? e.response.status : 'network';
    const msg = (e.response && e.response.data && e.response.data.message) || e.message;
    return { status: 'FAIL', ok: false, detail: `GitHub API ${status}: ${msg}` };
  }
}

/**
 * send() — create one real GitHub issue in owner/repo. Returns GitHub's actual
 * response: issue number + URL.
 */
export async function send({ owner, repo, title, body } = {}) {
  if (!owner || !repo) return { ok: false, error: 'owner and repo are required (e.g. octocat/Hello-World)', code: 'BAD_REQUEST' };
  if (!title) return { ok: false, error: 'title is required', code: 'BAD_REQUEST' };
  const token = getGhToken();
  if (!token) return { ok: false, error: 'GITHUB_TOKEN is not set', code: 'MISSING_KEY' };
  const payload = buildGitHubIssue({ title, body });
  try {
    const res = await axios.post(`${GITHUB_API}/repos/${owner}/${repo}/issues`, payload, {
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      timeout: 20000,
    });
    return {
      ok: true,
      issueNumber: res.data && res.data.number,
      url: res.data && res.data.html_url,
      raw: { number: res.data.number, title: res.data.title, state: res.data.state, html_url: res.data.html_url },
    };
  } catch (e) {
    const status = e.response ? e.response.status : 'network';
    const msg = (e.response && e.response.data && e.response.data.message) || e.message;
    return { ok: false, error: `GitHub API ${status}: ${msg}`, code: 'SEND_FAILED', status };
  }
}

/**
 * Verify x-hub-signature-256 over the RAW body. Secret = GITHUB_WEBHOOK_SECRET
 * if set, else the GitHub token itself (pass a secret explicitly for tests).
 */
export function verifySignature(rawBody, signatureHeader, secret) {
  const key = secret || process.env.GITHUB_WEBHOOK_SECRET || getGhToken();
  if (!key || !signatureHeader || !rawBody) return false;
  const expected = `sha256=${crypto.createHmac('sha256', key).update(rawBody).digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signatureHeader));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * receive() — parse a GitHub webhook payload into a flat shape.
 * event = the x-github-event header ('issues', 'issue_comment', 'push', …).
 */
export function receive(rawBody, event = '') {
  const obj = typeof rawBody === 'string'
    ? JSON.parse(rawBody)
    : Buffer.isBuffer(rawBody) ? JSON.parse(rawBody.toString('utf8')) : rawBody;
  const base = {
    event: event || obj.event || 'unknown',
    repository: (obj.repository && obj.repository.full_name) || '',
    sender: (obj.sender && obj.sender.login) || '',
    raw: obj,
  };
  if (obj.issue) {
    base.issue = { number: obj.issue.number, title: obj.issue.title, url: obj.issue.html_url, state: obj.issue.state };
  }
  if (obj.comment) {
    base.comment = { id: obj.comment.id, body: obj.comment.body || '', url: obj.comment.html_url };
  }
  if (obj.pusher) base.pusher = obj.pusher.name || '';
  if (obj.ref) base.ref = obj.ref;
  if (obj.action) base.action = obj.action;
  return base;
}
