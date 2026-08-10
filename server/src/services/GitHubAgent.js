import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { WORKSPACE_DIR } from '../config.js';
import { loadSettings } from './SettingsManager.js';

const execP = promisify(exec);

/**
 * GitHub token resolution, same precedence as the AI keys (LLMClient.resolveKeys):
 *   1. GITHUB_TOKEN env (Render/HF/Docker)
 *   2. GH_TOKEN env
 *   3. the token pasted in Settings → GitHub (settings.json)
 * When set, every `gh` command runs with GH_TOKEN so commits/pushes/PRs work
 * without the user's own gh login. When unset, gh falls back to its ambient
 * auth (or honestly reports not-authenticated).
 */
export function getGhToken() {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || loadSettings().githubToken || '';
}

/**
 * GITHUB AGENT — JEXI's hands on GitHub (skill: 15-github-agent.md).
 * Runs the REAL `git` / `gh` CLI and reports actual output — never fakes a push.
 * Lineage: gstack /ship, PR-Agent, SWE-agent's PR flow.
 *
 * Usage: runGitHubAction({ action, args }, sendEvent) — read-only by default.
 */

const UA_HINT = 'gh';

/** Which action a natural request maps to (parsed from the query). */
export function parseGithubRequest(query) {
  const q = String(query || '').toLowerCase();
  const has = (...words) => words.some((w) => q.includes(w));

  if (has('auth status', 'is github connected', 'check github', 'check token')) {
    return { action: 'auth', args: {} };
  }
  if (has('repo create', 'create a repo', 'create a repository', 'new repo', 'new repository', 'make a repo')) {
    return { action: 'repo_create', args: { name: extractName(q), visibility: has('public') ? 'public' : 'private' } };
  }
  if (has('pr create', 'open a pull request', 'create a pull request', 'make a pull request', 'pull request')) {
    return { action: 'pr_create', args: { base: has('to main') || has('into main') ? 'main' : 'main' } };
  }
  if (has('pr list', 'list pull requests', 'list prs', 'open prs')) {
    return { action: 'pr_list', args: { state: has('all') ? 'all' : 'open' } };
  }
  if (has('issue create', 'open an issue', 'create an issue', 'file an issue')) {
    return { action: 'issue_create', args: {} };
  }
  if (has('issues', 'issue list')) {
    return { action: 'issue_list', args: { state: has('all') ? 'all' : 'open' } };
  }
  if (has('clone')) {
    return { action: 'clone', args: { url: extractUrl(q) } };
  }
  if (has('init')) {
    return { action: 'init', args: {} };
  }
  if (has('commit')) {
    return { action: 'commit', args: {} };
  }
  if (has('push', 'upload to github', 'send to github', 'sync to github')) {
    return { action: 'push', args: {} };
  }
  if (has('log', 'history', 'last commit', 'recent commit')) {
    return { action: 'log', args: { n: 10 } };
  }
  if (has('status', 'what changed', 'uncommitted', 'dirty', 'git status')) {
    return { action: 'status', args: {} };
  }
  return { action: 'status', args: {} }; // default: read-only status
}

function extractName(q) {
  // "create a repo called jexi-cli" / "create a repo named X" / trailing token
  const m = q.match(/(?:called|named|name it)\s+([\w.-]+)/i);
  if (m) return m[1];
  const tokens = q.split(/\s+/).filter(Boolean);
  return tokens[tokens.length - 1].replace(/[.!?]+$/, '');
}

function extractUrl(q) {
  const m = q.match(/https?:\/\/[^\s)'"]+/i);
  return m ? m[0] : null;
}

async function runCmd(cmd, cwd, sendEvent) {
  sendEvent?.('log', { agent: 'GitHub Agent', message: `$ ${cmd}` });
  const token = getGhToken();
  const env = token ? { ...process.env, GH_TOKEN: token, GITHUB_TOKEN: token } : { ...process.env };
  try {
    const { stdout, stderr } = await execP(cmd, { cwd, timeout: 30000, maxBuffer: 4 * 1024 * 1024, env });
    return { ok: true, output: (stdout + stderr).trim() };
  } catch (e) {
    return { ok: false, output: String(e.stdout || '') + String(e.stderr || e.message || '').trim() };
  }
}

/** Check the gh token once (cheap) — the agent never pretends auth exists. */
export async function checkGithubAuth(sendEvent) {
  const res = await runCmd('gh auth status', WORKSPACE_DIR, sendEvent);
  const tokenSet = Boolean(getGhToken());
  const authed = (res.ok && !/not logged in|no auth/i.test(res.output)) || tokenSet;
  return { authed, tokenSet, detail: res.output.slice(0, 400) };
}

export async function runGitHubAction({ action, args = {} }, sendEvent) {
  const dir = WORKSPACE_DIR;

  switch (action) {
    case 'auth': {
      const r = await runCmd('gh auth status', dir, sendEvent);
      const authed = r.ok && !/not logged in|no auth/i.test(r.output);
      return {
        success: true,
        summary: `### 🔗 GITHUB CONNECTION\n\n${authed ? '✅ **Authenticated** — I can commit, push and open PRs for you.' : '⚠ **Not authenticated.** Add a `GITHUB_TOKEN` (or the GitHub token in Settings → GitHub) and I will be able to push, open PRs and manage issues.\n\n' + r.output.slice(0, 500)}`,
        raw: r.output.slice(0, 1200),
      };
    }
    case 'status': {
      const isRepo = await runCmd('git rev-parse --is-inside-work-tree', dir, sendEvent);
      if (!isRepo.ok) {
        return { success: true, summary: '### 🔗 GIT STATUS\n\nThe workspace is **not a git repository yet** — say *"init git and commit"* or *"push my code to github"* and I will set it up.' };
      }
      const branch = await runCmd('git branch --show-current', dir);
      const status = await runCmd('git status --short', dir);
      const lines = status.output.split('\n').filter(Boolean);
      const head = lines.length === 0
        ? '✅ Working tree is clean — nothing uncommitted.'
        : `\`\`\`\n${status.output.slice(0, 1500)}\n\`\`\`\n${lines.length} changed file(s) — say *"commit and push"* when ready.`;
      return { success: true, summary: `### 🔗 GIT STATUS\n\n**Branch:** \`${branch.output || 'unknown'}\`\n\n${head}`, raw: status.output.slice(0, 2000) };
    }
    case 'log': {
      const r = await runCmd(`git log --oneline -${args.n || 10}`, dir);
      if (!r.ok) return { success: true, summary: '### 🔗 GIT LOG\n\nNo commits yet — or not a git repo yet. Say *"commit my code"* to start.' };
      return { success: true, summary: `### 🔗 RECENT COMMITS\n\n\`\`\`\n${r.output.slice(0, 1800)}\n\`\`\``, raw: r.output.slice(0, 2000) };
    }
    case 'init': {
      const r = await runCmd('git init', dir, sendEvent);
      return { success: r.ok, summary: `### 🔗 GIT INIT\n\n${r.ok ? '✅ Initialized a new repository in the workspace.' : '⚠ ' + r.output}\n\nNext: say *"commit and push to github"* and I will create the remote + push.` };
    }
    case 'commit': {
      // Never stage secrets or deps
      await runCmd('git add -A -- . ":(exclude).env" ":(exclude).env.*" ":(exclude)node_modules"', dir);
      const status = await runCmd('git status --short', dir);
      if (!status.output.trim()) return { success: true, summary: '### 🔗 COMMIT\n\nNothing to commit — the working tree is clean.' };
      const msg = args.message || inferCommitMessage(status.output, 'Update');
      const r = await runCmd(`git commit -m "${String(msg).replace(/"/g, '\\"')}"`, dir, sendEvent);
      const hash = await runCmd('git rev-parse --short HEAD', dir);
      return {
        success: r.ok,
        summary: `### 🔗 COMMIT\n\n${r.ok ? `✅ **Committed** \`${hash.output}\` — \`${msg}\`` : '⚠ ' + r.output}\n\n${status.output.split('\n').slice(0, 20).map((l) => '`' + l + '`').join('\n')}\n\nSay *"push to github"* to upload it.`,
        raw: r.output.slice(0, 1200),
      };
    }
    case 'push': {
      // Ensure an origin exists
      const remote = await runCmd('git remote -v', dir);
      if (!remote.ok || !remote.output.trim()) {
        const repoName = path.basename(dir);
        const r = await runCmd(`gh repo create ${repoName} --private --source=. --remote=origin --push`, dir, sendEvent);
        return { success: r.ok, summary: `### 📤 PUSH TO GITHUB\n\n${r.ok ? `✅ **Created repo \`${repoName}\` and pushed everything.**` : '⚠ ' + r.output}\n\n> Need a token? Add \`GITHUB_TOKEN\` (Settings → GitHub) — or *"create a public repo"* if you want it public.`, raw: r.output.slice(0, 1500) };
      }
      const branch = await runCmd('git branch --show-current', dir);
      const r = await runCmd(`git push -u origin ${branch.output || 'main'}`, dir, sendEvent);
      return { success: r.ok, summary: `### 📤 PUSH TO GITHUB\n\n${r.ok ? `✅ **Pushed** \`${branch.output}\` to origin.` : '⚠ ' + r.output}`, raw: r.output.slice(0, 1500) };
    }
    case 'pr_create': {
      const branch = await runCmd('git branch --show-current', dir);
      const title = args.title || (args.message ? args.message : 'Automated changes from JEXI OS');
      const body = args.body || 'Built by JEXI OS — the full specialist team (plan → build → QA → security → ship).';
      await runCmd(`git push -u origin ${branch.output || 'main'}`, dir);
      const r = await runCmd(`gh pr create --base ${args.base || 'main'} --title "${String(title).replace(/"/g, '\\"')}" --body "${String(body).replace(/"/g, '\\"')}"`, dir, sendEvent);
      return { success: r.ok, summary: `### 🔀 PULL REQUEST\n\n${r.ok ? `✅ **PR opened:** ${r.output.split('\n').find((l) => l.startsWith('https://')) || r.output}` : '⚠ ' + r.output}`, raw: r.output.slice(0, 1500) };
    }
    case 'pr_list': {
      const r = await runCmd(`gh pr list --state ${args.state || 'open'}`, dir);
      if (!r.ok) return { success: true, summary: '### 🔀 PULL REQUESTS\n\nNone (or `gh` needs a token — add `GITHUB_TOKEN` in Settings).' };
      return { success: true, summary: `### 🔀 PULL REQUESTS (${args.state || 'open'})\n\n\`\`\`\n${r.output.slice(0, 1500)}\n\`\`\``, raw: r.output.slice(0, 1800) };
    }
    case 'issue_create': {
      const title = args.title || (args.message ? args.message : 'Issue from JEXI OS');
      const body = args.body || 'Reported by JEXI OS.';
      const r = await runCmd(`gh issue create --title "${String(title).replace(/"/g, '\\"')}" --body "${String(body).replace(/"/g, '\\"')}"`, dir, sendEvent);
      return { success: r.ok, summary: `### 🐛 ISSUE\n\n${r.ok ? '✅ Created: ' + r.output : '⚠ ' + r.output}`, raw: r.output.slice(0, 1500) };
    }
    case 'issue_list': {
      const r = await runCmd(`gh issue list --state ${args.state || 'open'}`, dir);
      if (!r.ok) return { success: true, summary: '### 🐛 ISSUES\n\nNone (or `gh` needs a token).' };
      return { success: true, summary: `### 🐛 ISSUES (${args.state || 'open'})\n\n\`\`\`\n${r.output.slice(0, 1500)}\n\`\`\``, raw: r.output.slice(0, 1800) };
    }
    case 'repo_create': {
      const name = args.name || 'jexi-workspace';
      const vis = args.visibility === 'public' ? '--public' : '--private';
      const r = await runCmd(`gh repo create ${name} ${vis} --source=. --remote=origin --push`, dir, sendEvent);
      return { success: r.ok, summary: `### 📦 REPOSITORY\n\n${r.ok ? `✅ **Created \`${name}\`** (${args.visibility || 'private'}) and pushed the workspace.` : '⚠ ' + r.output}`, raw: r.output.slice(0, 1500) };
    }
    case 'clone': {
      const url = args.url;
      if (!url) return { success: false, summary: '### 🔗 CLONE\n\nGive me the repo URL to clone — e.g. *"clone https://github.com/user/repo"*.' };
      const r = await runCmd(`git clone ${url}`, dir, sendEvent);
      return { success: r.ok, summary: `### 🔗 CLONE\n\n${r.ok ? '✅ Cloned into the workspace: `' + url.split('/').pop().replace('.git', '') + '`' : '⚠ ' + r.output}`, raw: r.output.slice(0, 1500) };
    }
    default:
      return { success: false, summary: 'Unknown GitHub action.' };
  }
}

/** Guess a commit message from changed files (respects the "describe the change" rule). */
export function inferCommitMessage(statusOutput, fallback) {
  const files = statusOutput.split('\n').map((l) => l.replace(/^.{0,3}\s*/, '').trim()).filter(Boolean);
  if (files.length === 0) return fallback;
  const known = {
    html: 'Add built web app', css: 'Add styles', js: 'Add JavaScript', mjs: 'Add module', ts: 'Add TypeScript',
    py: 'Add Python script', json: 'Update configuration', md: 'Update documentation', yml: 'Update CI config', yaml: 'Update CI config',
  };
  const ext = files[0].split('.').pop();
  const head = known[ext];
  const rest = files.length > 1 ? ` +${files.length - 1} more` : '';
  return `${head || 'Update'}${rest}`;
}
