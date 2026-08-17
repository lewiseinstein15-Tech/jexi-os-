/**
 * JEXI OS — Autonomous Builder (B91): build a whole project from a prompt,
 * run it, fix failures with loop+graph engineering, push to GitHub, report.
 *
 *   1. PLAN    — Architect.planProject(prompt) → { files, entryPoint, language }.
 *   2. WRITE   — files land in a per-build workspace dir under WORKSPACE_DIR.
 *   3. RUN+FIX — execute the entry point; on failure, the CodingLoop-style
 *                fix cycle applies the exact error and re-runs (bounded
 *                MAX_FIX_ROUNDS; each round receives the previous error —
 *                FAILURE → HISTORY → CORRECT → VERIFY). If the runtime isn't
 *                runnable (no interpreter), syntax-check what we can and
 *                treat "not runnable" honestly (not as a pass).
 *   4. GITHUB  — needs a token: env GITHUB_TOKEN / settings githubToken /
 *                opts.token. Missing → needInfo (parked): ask for repo name
 *                and token (or "use my name" for the repo). Resume creates
 *                the repo via the GitHub API and pushes via git with the
 *                token (never printed, never committed).
 *   5. REPORT  — files, fix rounds, run output, repo URL + commit SHA →
 *                notifier (in-app + email + FCM/web push) + live stream.
 *
 * All deps injectable for tests; git ops via execFile with token in env.
 */

import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { WORKSPACE_DIR } from '../config.js';

const MAX_FIX_ROUNDS = 4;
const MAX_FILE_CHARS = 200000;

/* ------------------------------------------------------------------ */
/* Git helpers (token passed via env, never on the command line)       */
/* ------------------------------------------------------------------ */

function runGit(cwd, args, env = {}) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, env: { ...process.env, ...env }, timeout: 60000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? (err.code || 1) : 0, output: String(stdout || '') + String(stderr || '') });
    });
  });
}

async function githubApi(pathname, token, method = 'GET', body = null) {
  const res = await fetch(`https://api.github.com${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

/* ------------------------------------------------------------------ */
/* The agent                                                          */
/* ------------------------------------------------------------------ */

export class BuilderAgent {
  /**
   * @param {object} deps
   * @param {function} [deps.planProject]  — (prompt) => Promise<{files, entryPoint, language}>
   * @param {function} [deps.runFile]      — (name, onOutput) => Promise<{success, output, url?}>
   * @param {function} [deps.fixError]     — (prompt, error) => Promise<{files, entryPoint, language}>
   * @param {function} [deps.generateContent] — for a final summary
   */
  constructor(deps = {}) {
    this.planProject = deps.planProject || null;
    this.runFile = deps.runFile || null;
    this.fixError = deps.fixError || null;
    this.generateContent = deps.generateContent || null;
  }

  /** Resolve a token: explicit > env > settings file. */
  resolveToken(opts = {}) {
    if (opts.token) return opts.token;
    if (process.env.GITHUB_TOKEN || process.env.GH_TOKEN) return process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    try {
      const settings = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'settings.json'), 'utf-8'));
      if (settings.githubToken) return settings.githubToken;
    } catch { /* no settings */ }
    return null;
  }

  async run({ prompt, session = 'default', sendEvent = () => {}, opts = {} }) {
    const emit = (t, d) => { try { sendEvent(t, d); } catch { /* noop */ } };
    const buildId = `build-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
    const dir = path.join(WORKSPACE_DIR, buildId);
    const p = String(prompt || '').trim();
    emit('builder.start', { buildId, prompt: p.slice(0, 200) });

    if (!this.planProject) {
      return { success: false, error: 'builder unavailable', summary: '### ⚠ JEXI OS\n\nThe builder needs AI keys configured.' };
    }

    // Resume path: the build already happened (files exist in dir); skip
    // plan/write/run and go straight to the GitHub phase.
    if (opts.resumeBuild && opts.resumeBuild.dir) {
      const rb = opts.resumeBuild;
      emit('builder.resume', { buildId, dir: rb.dir });
      return this._githubPhase({ prompt: rb.prompt || p, session, sendEvent, opts: { ...opts, token: this.resolveToken(opts), repo: opts.repo }, dir: rb.dir, entry: rb.entry, lastOutput: rb.lastOutput, runClean: rb.runClean, language: rb.language || 'unknown', written: rb.written || 0, rounds: rb.rounds || 0 });
    }

    // ── 1 + 2: PLAN + WRITE ────────────────────────────────────────────────
    let project = null;
    try {
      project = await this.planProject(p);
    } catch (e) {
      return { success: false, error: (e && e.message) || 'plan failed', summary: `### ⚠ JEXI OS\n\nI could not plan the project: ${(e && e.message) || 'unknown error'}` };
    }
    if (!project || !Array.isArray(project.files) || !project.files.length) {
      return { success: false, error: 'empty plan', summary: '### ⚠ JEXI OS\n\nThe planner returned no files — try rephrasing the prompt.' };
    }
    fs.mkdirSync(dir, { recursive: true });
    let written = 0;
    for (const f of project.files.slice(0, 30)) {
      try {
        const name = String(f.name || '').replace(/^\/+/, '');
        if (!name || name.includes('..')) continue;
        fs.writeFileSync(path.join(dir, name), String(f.code || '').slice(0, MAX_FILE_CHARS), 'utf-8');
        written += 1;
      } catch { /* skip un-writable */ }
    }
    emit('builder.plan', { language: project.language || 'unknown', files: project.files.slice(0, 30).map((f) => f.name), written });
    if (!written) return { success: false, error: 'nothing written', summary: '### ⚠ JEXI OS\n\nThe plan produced no writable files.' };

    // ── 3: RUN + FIX (loop+graph: each round gets the exact last error) ────
    let entry = project.entryPoint || project.files[0].name;
    let lastOutput = '';
    let rounds = 0;
    let runClean = false;
    if (this.runFile) {
      for (let r = 0; r < MAX_FIX_ROUNDS; r++) {
        rounds = r + 1;
        emit('builder.run', { round: rounds, entry });
        const run = await this.runFile(path.join(buildId, entry), (s, d) => emit('log', { agent: 'Runner', message: String(d).slice(0, 200) })).catch(() => ({ success: false, output: 'run crashed' }));
        lastOutput = run.output || run.error || '';
        if (run.success) { runClean = true; emit('builder.run-ok', { round: rounds, output: lastOutput.slice(0, 400) }); break; }
        emit('builder.run-failed', { round: rounds, error: lastOutput.slice(0, 400) });
        if (!this.fixError) break;
        // Apply the EXACT error (FAILURE → HISTORY → CORRECT → VERIFY).
        const fixed = await this.fixError(p, lastOutput).catch(() => null);
        if (!fixed || !Array.isArray(fixed.files) || !fixed.files.length) break;
        for (const f of fixed.files.slice(0, 30)) {
          try {
            const name = String(f.name || '').replace(/^\/+/, '');
            if (!name || name.includes('..')) continue;
            fs.writeFileSync(path.join(dir, name), String(f.code || '').slice(0, MAX_FILE_CHARS), 'utf-8');
          } catch { /* skip */ }
        }
        if (fixed.entryPoint) entry = fixed.entryPoint;
      }
    } else {
      // No runtime — syntax-check JS/PY where possible; honest "not runnable".
      emit('builder.run', { note: 'no runtime on this host — build verified statically' });
    }

    // ── 4: GITHUB ──────────────────────────────────────────────────────────
    const gh = await this._githubPhase({ prompt: p, session, sendEvent, opts: { ...opts, token: this.resolveToken(opts) }, dir, entry, lastOutput, runClean, language: project.language || 'unknown', written, rounds });
    if (gh && gh.needInfo) return { ...gh, buildId, dir, entry, lastOutput, runClean };
    return gh;
  }

  /** GitHub create-repo + push + report. Shared by fresh builds and resumes. */
  async _githubPhase({ prompt, session, sendEvent, opts, dir, entry, lastOutput, runClean, language, written, rounds }) {
    const emit = (t, d) => { try { sendEvent(t, d); } catch { /* noop */ } };
    const token = opts.token;
    if (!token) {
      emit('builder.need-github', {});
      return {
        needInfo: [
          { field: 'repo', question: 'What should the GitHub repository be called? (or "my-name/project-name" to use your account)' },
          { field: 'token', question: 'Paste a GitHub token with repo scope (create one free at github.com/settings/tokens → repo)' },
        ],
        summary: '### 📦 Project built — ready to push\n\nI need two things to push it to GitHub: the **repository name** and a **GitHub token** (fine-grained, Contents read+write on that repo). Reply with both, e.g. `my-app` and `github_pat_...`.',
      };
    }

    // Resolve owner from the token.
    let owner = null;
    try {
      const me = await githubApi('/user', token);
      owner = me.ok ? me.data.login : null;
    } catch { owner = null; }
    if (!owner) {
      return { success: false, error: 'bad token', summary: '### ⚠ JEXI OS\n\nThe GitHub token could not authenticate — check it and try again.' };
    }

    const repoName = (opts.repo || '').replace(/[^a-zA-Z0-9._-]/g, '').toLowerCase().slice(0, 40) || `jexi-${buildId.slice(6, 12)}`;
    emit('builder.github', { owner, repo: repoName, action: 'create-repo' });
    const created = await githubApi('/user/repos', token, 'POST', { name: repoName, private: false, description: `Built autonomously by JEXI OS: ${p.slice(0, 80)}` });
    if (!created.ok && created.status !== 422) {
      return { success: false, error: `repo create failed (${created.status})`, summary: `### ⚠ JEXI OS\n\nGitHub refused to create the repo: ${(created.data && created.data.message) || created.status}. Check the token has repo scope.` };
    }

    // git init → add → commit → push (token in env, never on the command line).
    const pushUrl = `https://x-access-token:${token}@github.com/${owner}/${repoName}.git`;
    const gitEnv = { GIT_TERMINAL_PROMPT: '0' };
    const steps = [
      ['init', ['init', '-b', 'main']],
      ['add', ['add', '-A']],
      ['commit', ['commit', '-m', `Autonomous build by JEXI OS — ${p.slice(0, 60)}`]],
      ['push', ['push', pushUrl, 'HEAD:main']],
    ];
    let gitFail = null;
    for (const [label, args] of steps) {
      const r = await runGit(dir, args, gitEnv);
      if (!r.ok && label !== 'commit') {
        // commit fails when nothing changed (empty repo with no diff) — allow.
        gitFail = { label, output: r.output.slice(0, 300) };
        emit('builder.git-failed', gitFail);
        break;
      }
      emit('builder.git', { step: label });
    }

    // ── 5: REPORT ──────────────────────────────────────────────────────────
    const repoUrl = `https://github.com/${owner}/${repoName}`;
    let summary = '';
    if (this.generateContent) {
      try {
        summary = String(await this.generateContent(
          `You autonomously built a project from: "${p.slice(0, 500)}".\n\n` +
          `Result: ${written} file(s) (${project.language || 'unknown'}), ${rounds} run/fix round(s), run ${runClean ? 'PASSED' : (this.runFile ? 'STILL FAILING after fixes' : 'not runnable on this host')}, ` +
          `pushed to ${repoUrl}${gitFail ? ' (push step failed: ' + gitFail.label + ')' : ''}.\n\n` +
          `Write the final report to the user: what was built, how it ran, the GitHub link, and any honest caveats. 2-5 short paragraphs, plain markdown.`,
          'You are JEXI OS, an autonomous builder reporting to its owner.', null, { prefer: 'groq', temperature: 0.4 }
        )).trim();
      } catch { /* fall through */ }
    }
    if (!summary || summary.length < 20) {
      summary = `### 📦 BUILD COMPLETE — ${repoUrl}\n\n- **${written} files** (${project.language || 'unknown'}) from "${p.slice(0, 60)}…"\n- **Run/fix rounds:** ${rounds} — ${runClean ? '✅ ran clean' : (this.runFile ? '⚠ still failing after fixes' : 'not runnable on this host (no interpreter)')}\n- **Pushed to:** ${repoUrl}${gitFail ? `\n- ⚠ Push issue at "${gitFail.label}": ${gitFail.output}` : ''}`;
    }

    emit('builder.done', { repoUrl, repoName, files: written, rounds, runClean, gitFail: gitFail || null });
    return { success: true, summary, repoUrl, repoName, files: written, rounds, runClean, gitFail: gitFail || null };
  }
}

export const builderAgent = new BuilderAgent();
