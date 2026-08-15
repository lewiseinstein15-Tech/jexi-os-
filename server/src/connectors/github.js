/**
 * JEXI OS — GitHub Connector (Build 56).
 *
 * GitHub REST API. Auth supports:
 *   - PAT:          GITHUB_TOKEN / GH_TOKEN (or settings github.token)
 *   - GitHub App:   GITHUB_APP_ID + GITHUB_PRIVATE_KEY (PEM) +
 *                   GITHUB_INSTALLATION_ID → JWT-signed installation access
 *                   token, cached and refreshed before expiry.
 *
 * send() actions: create_issue · create_comment · create_pr · create_commit
 * receive():      webhook POST (push / pull_request / issues) verified with
 *                 X-Hub-Signature-256 (HMAC-SHA256) or legacy X-Hub-Signature
 *                 (HMAC-SHA1) using GITHUB_WEBHOOK_SECRET.
 */

import { Connector, ConnectorConfig, ConnectorError, ERROR_CODES, httpJson, createHmacSha256, createHmacSha1, assertAsciiSecret } from './ConnectorBase.js';
import { ConnectorRegistry } from './ConnectorRegistry.js';
import crypto from 'crypto';

export class GitHubConnector extends Connector {
  static toolName = 'github';
  static toolLabel = 'GitHub';

  get defaultBaseUrl() { return 'https://api.github.com'; }

  resolveAuth() {
    const env = {
      token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '',
      appId: process.env.GITHUB_APP_ID || '',
      privateKey: process.env.GITHUB_PRIVATE_KEY || '',
      installationId: process.env.GITHUB_INSTALLATION_ID || '',
      webhookSecret: process.env.GITHUB_WEBHOOK_SECRET || '',
    };
    // Env wins ONLY when actually set — an unset env var must never clobber
    // a configured value.
    const merged = { ...this.config.auth };
    for (const [k, v] of Object.entries(env)) if (v) merged[k] = v;
    assertAsciiSecret(merged.token, 'GITHUB_TOKEN');
    return merged;
  }

  get hasPat() { return !!(this.resolveAuth().token); }
  get hasApp() { const a = this.resolveAuth(); return !!(a.appId && a.privateKey && a.installationId); }

  /** GitHub App JWT (RS256, 10-min max lifetime) — no external dependency. */
  createAppJwt(appId, privateKeyPem) {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = { iat: now - 60, exp: now + 540, iss: String(appId) };
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const signingInput = `${b64(header)}.${b64(payload)}`;
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(signingInput);
    const signature = signer.sign(privateKeyPem, 'base64url');
    return `${signingInput}.${signature}`;
  }

  /** Installation access token with refresh-on-expiry (5-min safety margin). */
  async getInstallationToken() {
    const auth = this.resolveAuth();
    if (this._installToken && this._installTokenExpiresAt && Date.now() < this._installTokenExpiresAt - 5 * 60 * 1000) {
      return this._installToken;
    }
    const jwt = this.createAppJwt(auth.appId, auth.privateKey);
    const { data } = await httpJson(
      `${this.baseUrl}/app/installations/${auth.installationId}/access_tokens`,
      { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'X-GitHub-Api-Version': '2022-11-28' }, provider: 'GitHub API', timeout: this.requestTimeoutMs }
    );
    if (!data || !data.token) {
      throw new ConnectorError(ERROR_CODES.MALFORMED_RESPONSE, 'GitHub App auth returned no installation token', { provider: this.label, cause: data });
    }
    this._installToken = data.token;
    this._installTokenExpiresAt = data.expires_at ? Date.parse(data.expires_at) : Date.now() + 55 * 60 * 1000;
    return this._installToken;
  }

  /** Resolve the bearer token for API calls (PAT or App install token). */
  async getToken() {
    const auth = this.resolveAuth();
    if (auth.token) return { token: auth.token, mode: 'pat' };
    if (this.hasApp) return { token: await this.getInstallationToken(), mode: 'app' };
    throw new ConnectorError(ERROR_CODES.NOT_CONFIGURED, 'GitHub is not configured — set GITHUB_TOKEN (PAT) or GITHUB_APP_ID + GITHUB_PRIVATE_KEY + GITHUB_INSTALLATION_ID (App)', { provider: this.label });
  }

  /** Actually call the API — verify the token against the authenticated user/install. */
  async authenticate() {
    const { token } = await this.getToken();
    const { data } = await httpJson(`${this.baseUrl}/user`, { headers: { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' }, provider: 'GitHub API', timeout: this.requestTimeoutMs });
    if (!data || !data.login) {
      throw new ConnectorError(ERROR_CODES.MALFORMED_RESPONSE, 'GitHub auth returned no user identity', { provider: this.label, cause: data });
    }
    return true;
  }

  /**
   * send(payload):
   *   { action: 'create_issue', owner, repo, title, body? }
   *   { action: 'create_comment', owner, repo, issue_number, body }
   *   { action: 'create_pr', owner, repo, title, head, base, body? }
   *   { action: 'create_commit', owner, repo, branch, message, changes: [{path, content}] }
   * Returns the provider's real response.
   */
  async send(payload = {}) {
    const { action, owner, repo } = payload;
    if (!action || !owner || !repo) {
      throw new ConnectorError(ERROR_CODES.PROVIDER_ERROR, 'GitHub send requires action + owner + repo', { provider: this.label });
    }
    const { token } = await this.getToken();
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    const url = (p) => `${this.baseUrl}${p}`;

    try {
      if (action === 'create_issue') {
        if (!payload.title) throw new ConnectorError(ERROR_CODES.PROVIDER_ERROR, 'create_issue requires title', { provider: this.label });
        const { status, data } = await httpJson(url(`/repos/${owner}/${repo}/issues`), { method: 'POST', headers, body: { title: payload.title, body: payload.body || '' }, provider: 'GitHub API', timeout: this.requestTimeoutMs });
        return { ok: true, provider: 'github', action, number: data.number, html_url: data.html_url, status };
      }
      if (action === 'create_comment') {
        if (!payload.issue_number || !payload.body) throw new ConnectorError(ERROR_CODES.PROVIDER_ERROR, 'create_comment requires issue_number + body', { provider: this.label });
        const { status, data } = await httpJson(url(`/repos/${owner}/${repo}/issues/${payload.issue_number}/comments`), { method: 'POST', headers, body: { body: payload.body }, provider: 'GitHub API', timeout: this.requestTimeoutMs });
        return { ok: true, provider: 'github', action, id: data.id, html_url: data.html_url, status };
      }
      if (action === 'create_pr') {
        if (!payload.title || !payload.head || !payload.base) throw new ConnectorError(ERROR_CODES.PROVIDER_ERROR, 'create_pr requires title + head + base', { provider: this.label });
        const { status, data } = await httpJson(url(`/repos/${owner}/${repo}/pulls`), { method: 'POST', headers, body: { title: payload.title, head: payload.head, base: payload.base, body: payload.body || '' }, provider: 'GitHub API', timeout: this.requestTimeoutMs });
        return { ok: true, provider: 'github', action, number: data.number, html_url: data.html_url, status };
      }
      if (action === 'create_commit') {
        return await this.createCommit(payload, headers, url);
      }
      throw new ConnectorError(ERROR_CODES.PROVIDER_ERROR, `Unknown GitHub action "${action}" (create_issue | create_comment | create_pr | create_commit)`, { provider: this.label });
    } catch (e) {
      // GitHub returns 403 for rate limits too — reclassify honestly.
      if (e instanceof ConnectorError && e.code === ERROR_CODES.PERMISSION_DENIED && /rate limit/i.test(e.message)) {
        throw new ConnectorError(ERROR_CODES.RATE_LIMITED, 'GitHub API rate limit exceeded (HTTP 403)', { provider: this.label, cause: e.cause });
      }
      throw e;
    }
  }

  /** Minimal real commit: blob(s) → tree → commit → update ref. */
  async createCommit(payload, headers, url) {
    const { owner, repo, branch, message, changes } = payload;
    if (!branch || !message || !Array.isArray(changes) || !changes.length) {
      throw new ConnectorError(ERROR_CODES.PROVIDER_ERROR, 'create_commit requires branch + message + changes [{path, content}]', { provider: this.label });
    }
    // 1. current head of the branch
    let headSha;
    try {
      const { data } = await httpJson(url(`/repos/${owner}/${repo}/git/ref/heads/${branch}`), { headers, provider: 'GitHub API', timeout: this.requestTimeoutMs });
      headSha = data.object && data.object.sha;
    } catch (e) {
      if (!(e instanceof ConnectorError && e.status === 404)) throw e;
    }
    // 2. blobs
    const treeEntries = [];
    for (const change of changes) {
      const { data: blob } = await httpJson(url(`/repos/${owner}/${repo}/git/blobs`), { method: 'POST', headers, body: { content: change.content || '', encoding: 'utf-8' }, provider: 'GitHub API', timeout: this.requestTimeoutMs });
      treeEntries.push({ path: change.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    // 3. tree
    const { data: tree } = await httpJson(url(`/repos/${owner}/${repo}/git/trees`), { method: 'POST', headers, body: { ...(headSha ? { base_tree: headSha } : {}), tree: treeEntries }, provider: 'GitHub API', timeout: this.requestTimeoutMs });
    // 4. commit
    const { data: commit } = await httpJson(url(`/repos/${owner}/${repo}/git/commits`), { method: 'POST', headers, body: { message, tree: tree.sha, ...(headSha ? { parents: [headSha] } : {}) }, provider: 'GitHub API', timeout: this.requestTimeoutMs });
    // 5. update ref
    const { status, data: ref } = await httpJson(url(`/repos/${owner}/${repo}/git/refs/heads/${branch}`), { method: 'PATCH', headers, body: { sha: commit.sha, force: false }, provider: 'GitHub API', timeout: this.requestTimeoutMs });
    return { ok: true, provider: 'github', action: 'create_commit', sha: commit.sha, branch, ref: ref.ref, status };
  }

  /* ------------------------- webhook / receive ------------------------- */

  /** Verify X-Hub-Signature-256 (sha256=…) or legacy X-Hub-Signature (sha1=…). */
  verifyWebhookSignature(rawBody, headers = {}) {
    const auth = this.resolveAuth();
    if (!auth.webhookSecret) throw new ConnectorError(ERROR_CODES.NOT_CONFIGURED, 'GitHub webhook verification needs GITHUB_WEBHOOK_SECRET', { provider: this.label });
    const sha256 = headers['x-hub-signature-256'];
    if (sha256) {
      return createHmacSha256(auth.webhookSecret, rawBody) === String(sha256).replace(/^sha256=/, '');
    }
    const sha1 = headers['x-hub-signature'];
    if (sha1) {
      return createHmacSha1(auth.webhookSecret, rawBody) === String(sha1).replace(/^sha1=/, '');
    }
    return false;
  }

  /** Normalize push / pull_request / issues webhook payloads. */
  normalizeInbound(body) {
    if (!body) return [];
    const repo = body.repository && body.repository.full_name;
    const events = [];
    if (body.zen) return events; // ping
    if (body.hook_id && !body.pusher) return events; // non-push hook events without payload
    if (body.ref && body.commits) { // push
      events.push({
        id: body.head_commit ? body.head_commit.id : null,
        provider: 'github',
        type: 'push',
        repo,
        ref: body.ref,
        branch: String(body.ref || '').replace(/^refs\/heads\//, ''),
        commits: (body.commits || []).map((c) => ({ id: c.id, message: (c.message || '').split('\n')[0], author: c.author && c.author.name })),
        pusher: body.pusher && body.pusher.name,
        timestamp: new Date().toISOString(),
        raw: body,
      });
    } else if (body.action && body.issue && !body.pull_request) { // issues
      events.push({
        id: String(body.issue.number),
        provider: 'github',
        type: 'issue',
        action: body.action,
        repo,
        number: body.issue.number,
        title: body.issue.title,
        body: body.issue.body,
        url: body.issue.html_url,
        author: body.issue.user && body.issue.user.login,
        timestamp: new Date().toISOString(),
        raw: body,
      });
    } else if (body.action && body.pull_request) { // pull_request
      events.push({
        id: String(body.pull_request.number),
        provider: 'github',
        type: 'pull_request',
        action: body.action,
        repo,
        number: body.pull_request.number,
        title: body.pull_request.title,
        url: body.pull_request.html_url,
        author: body.pull_request.user && body.pull_request.user.login,
        timestamp: new Date().toISOString(),
        raw: body,
      });
    }
    return events;
  }

  async receive(inbound) {
    return this.normalizeInbound(inbound || {});
  }

  static sendSchema() {
    return {
      action: { type: 'string', required: true, desc: "create_issue | create_comment | create_pr | create_commit" },
      owner: { type: 'string', required: true, desc: 'Repository owner (user or org)' },
      repo: { type: 'string', required: true, desc: 'Repository name' },
      title: { type: 'string', desc: 'Issue/PR title' },
      body: { type: 'string', desc: 'Issue/PR body or comment text' },
      issue_number: { type: 'number', desc: 'Issue number (create_comment)' },
      head: { type: 'string', desc: 'Head branch (create_pr)' },
      base: { type: 'string', desc: 'Base branch (create_pr)' },
      branch: { type: 'string', desc: 'Target branch (create_commit)' },
      message: { type: 'string', desc: 'Commit message (create_commit)' },
      changes: { type: 'array', desc: '[{ path, content }] files to write (create_commit)' },
    };
  }
}

export function registerGitHubConnector(config) {
  return ConnectorRegistry.register('github', new GitHubConnector(config instanceof ConnectorConfig ? config : new ConnectorConfig(config)));
}
