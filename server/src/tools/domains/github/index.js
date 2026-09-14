/**
 * JEXI OS — tools — github domain.
 *
 * pr-create, pr-review, issue-list. Executors are injected; definitions are always registered so the
 * capability surface stays stable and provider-independent.
 */

import { defineTool } from '../../interface/ToolDefinition.js';
import { registerToolBatch } from '../../registry/ToolRegistry.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** Read the GitHub token from .jexi-secrets/git-token (never print it). */
function readToken(ctx = {}) {
  const candidates = [
    ctx.tokenFile ? path.resolve(ctx.tokenFile) : null,
    path.join(process.cwd(), '.jexi-secrets', 'git-token'),
    path.join(process.cwd(), '..', '.jexi-secrets', 'git-token'),
    path.join(os.homedir(), '.jexi-secrets', 'git-token'),
  ].filter(Boolean);
  for (const f of candidates) {
    try {
      const t = fs.readFileSync(f, 'utf8').trim().split(/\r?\n/)[0].trim();
      if (t) return t;
    } catch { /* try next */ }
  }
  return null;
}

async function ghApi(pathname, { method = 'GET', token, ctx = {}, body } = {}) {
  const tok = token ?? readToken(ctx);
  if (!tok) return { ok: false, error: 'no GitHub token configured (set .jexi-secrets/git-token)' };
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (tok) headers.Authorization = `Bearer ${tok}`;
  if (body) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(`https://api.github.com${pathname}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  } catch (e) {
    return { ok: false, error: `github request failed: ${(e && e.message) || e}` };
  }
  const text = await res.text().catch(() => '');
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  if (!res.ok) {
    return { ok: false, error: `github ${res.status}: ${(json?.message || text || '').slice(0, 300)}` };
  }
  return { ok: true, status: res.status, data: json };
}

export function registerGithubTools() {
  const defs = [
    defineTool({ name: 'gh_pr_create', description: 'Open a GitHub pull request.', riskLevel: 'medium', runtimeRing: 2, parameters: { type: 'object', properties: { repo: { type: 'string' }, title: { type: 'string' }, head: { type: 'string' }, base: { type: 'string' }, body: { type: 'string' } }, required: ['repo', 'title', 'head', 'base'] }, sideEffects: ['gh'], failureTypes: ['tool_error'], idempotent: false }),
    defineTool({ name: 'gh_pr_review', description: 'View a GitHub pull request review/comments.', riskLevel: 'medium', runtimeRing: 2, parameters: { type: 'object', properties: { repo: { type: 'string' }, pr: { type: 'integer' } }, required: ['repo', 'pr'] }, sideEffects: ['gh'], failureTypes: ['tool_error'], idempotent: false }),
    defineTool({ name: 'gh_issue_list', description: 'List GitHub issues for a repo.', riskLevel: 'medium', runtimeRing: 2, parameters: { type: 'object', properties: { repo: { type: 'string' }, state: { type: 'string', enum: ['open', 'closed', 'all'] }, limit: { type: 'integer' } }, required: ['repo'] }, sideEffects: ['gh'], failureTypes: ['tool_error'], idempotent: false })
  ];
  const unreg = registerToolBatch(defs);
  const engines = {
    async gh_issue_list({ repo, state, limit }, ctx = {}) {
      const r = await ghApi(`/repos/${String(repo || '')}/issues?state=${String(state || 'open')}&per_page=${Math.min(Number(limit) || 30, 100)}`, { ctx });
      if (!r.ok) return { ok: false, error: r.error, repo };
      return { ok: true, repo, state: state || 'open', issues: (r.data || []).map((i) => ({ number: i.number, title: i.title, state: i.state, url: i.html_url })) };
    },
    async gh_pr_create({ repo, title, head, base, body }, ctx = {}) {
      const r = await ghApi(`/repos/${String(repo || '')}/pulls`, { method: 'POST', ctx, body: { title, head, base, body: body || '' } });
      return r.ok ? { ok: true, repo, pr: r.data?.number, url: r.data?.html_url } : { ok: false, error: r.error, repo };
    },
    async gh_pr_review({ repo, pr }, ctx = {}) {
      const r = await ghApi(`/repos/${String(repo || '')}/pulls/${Number(pr)}/reviews`, { ctx });
      return r.ok ? { ok: true, repo, pr, reviews: (r.data || []).map((v) => ({ id: v.id, user: v.user?.login, state: v.state, body: v.body })) } : { ok: false, error: r.error, repo, pr };
    },
  };
  return { unreg, engines };
}
