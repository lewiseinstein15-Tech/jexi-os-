/**
 * JEXI OS — GitHub Engine Plugin (B165).
 * DeepSeek Harness approach: GitHub as FIRST-CLASS model tools (dsh mounts
 * `mcp__github__*`); JEXI exposes them natively over the REST API:
 * read repos · read files · edit files (commits) · review repos & PRs.
 */

import { repoScan, readFile, editFile, reviewRepo, reviewPR, parseGitHubTarget } from '../../src/services/GitHubEngine.js';

export const name = 'github-engine';
export const version = '1.0.0';
export const inject = ['tools'];

export async function apply(ctx) {
  const unregisters = [];
  const reg = (def) => unregisters.push(ctx.tools.register(def));

  reg({
    slug: 'github_repo_scan',
    name: 'GitHub Repo Scan',
    desc: 'Scan any GitHub repo (owner/repo or URL): metadata, stars, language, file tree, manifests, structure summary. Works on public repos without a token.',
    args: { repo: { type: 'string', required: true, desc: 'owner/repo or a github.com URL' } },
    handler: async (a) => repoScan(a.repo),
  });

  reg({
    slug: 'github_file_read',
    name: 'GitHub File Read',
    desc: 'Read one file from a GitHub repo (decoded text, ≤64 KB). Use github_repo_scan first to see the tree.',
    args: {
      repo: { type: 'string', required: true },
      path: { type: 'string', required: true, desc: 'repo-relative path, e.g. src/App.jsx' },
    },
    handler: async (a) => readFile(a.repo, a.path),
  });

  reg({
    slug: 'github_file_edit',
    name: 'GitHub File Edit',
    desc: 'Edit (or create) a file in a GitHub repo — one commit via the Contents API. Requires GITHUB_TOKEN with repo scope.',
    args: {
      repo: { type: 'string', required: true },
      path: { type: 'string', required: true },
      content: { type: 'string', required: true, desc: 'the FULL new file content' },
      message: { type: 'string', required: false, desc: 'commit message' },
      branch: { type: 'string', required: false },
    },
    handler: async (a) => editFile(a.repo, a.path, a.content, { message: a.message, branch: a.branch }),
  });

  reg({
    slug: 'github_repo_review',
    name: 'GitHub Repo Review',
    desc: 'Review a repo: structure report, manifests, open PRs, latest PR diff, review signals. The "look at my repo and tell me what to fix" tool.',
    args: { repo: { type: 'string', required: true } },
    handler: async (a) => reviewRepo(a.repo),
  });

  reg({
    slug: 'github_pr_review',
    name: 'GitHub PR Review',
    desc: 'Review one pull request: metadata, changed files with patch hunks, additions/deletions. repo can include /pull/N.',
    args: {
      repo: { type: 'string', required: true },
      number: { type: 'number', required: false, desc: 'PR number (optional if the URL has /pull/N)' },
    },
    handler: async (a) => {
      const t = parseGitHubTarget(a.repo);
      const n = a.number || (t && t.pull);
      if (!n) return { ok: false, error: 'PR number required' };
      return reviewPR(a.repo, n);
    },
  });

  return () => unregisters.forEach((u) => { try { u(); } catch { /* noop */ } });
}
