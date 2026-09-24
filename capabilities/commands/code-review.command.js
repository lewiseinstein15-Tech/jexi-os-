/**
 * JEXI OS — COMMANDS — /code-review (Phase 7 G).
 *
 * Spawns a FRESH reviewer (isolated subagent with its own context, through
 * server/src/services/SubagentRuntime.runIsolatedSubagent) to review the
 * current real diff (git diff, or --path). When no LLM provider is
 * configured the command degrades to the deterministic static review path
 * (node --check per changed JS file + diff stats) and says so — it never
 * pretends a model reviewed anything.
 */

import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { serverMod, redact, clampText } from './_context.js';

const MAX_DIFF_CHARS = 12000;
const MAX_FILES = 12;

function gitDiff(repoDir, base) {
  try {
    const args = base ? ['diff', base] : ['diff', 'HEAD'];
    let out = execFileSync('git', args, { cwd: repoDir, timeout: 15000, maxBuffer: 4e6 }).toString();
    if (!out.trim() && !base) {
      // nothing uncommitted → fall back to the last commit's diff
      out = execFileSync('git', ['show', '--stat', '--patch', 'HEAD'], { cwd: repoDir, timeout: 15000, maxBuffer: 4e6 }).toString();
    }
    return out;
  } catch (e) {
    return `/* git diff failed: ${String(e.message).slice(0, 120)} */`;
  }
}

function changedFiles(repoDir, base) {
  try {
    const args = base ? ['diff', '--name-only', base] : ['diff', '--name-only', 'HEAD'];
    let out = execFileSync('git', args, { cwd: repoDir, timeout: 15000 }).toString().trim();
    if (!out && !base) out = execFileSync('git', ['show', '--name-only', '--pretty=format:', 'HEAD'], { cwd: repoDir, timeout: 15000 }).toString().trim();
    return out ? out.split('\n').filter(Boolean).slice(0, MAX_FILES) : [];
  } catch { return []; }
}

/** Deterministic static findings for one file (real checks, no model). */
function staticReview(repoDir, file) {
  const abs = path.resolve(repoDir, file);
  if (!fs.existsSync(abs)) return [{ file, severity: 'info', message: 'file missing (deleted in diff?)' }];
  const stat = fs.statSync(abs);
  if (stat.size > 400000) return [{ file, severity: 'warn', message: `very large file (${Math.round(stat.size / 1024)}KiB) — consider splitting` }];
  return [];
}

export default {
  name: 'code-review',
  aliases: ['cr'],
  description: 'Spawn a fresh reviewer agent over the current diff',
  category: 'review',
  args: [
    { name: 'path', required: false, type: 'path', default: '', description: 'restrict the review to one file/directory' },
    { name: 'base', required: false, type: 'string', default: '', description: 'diff against this ref (default: uncommitted changes / last commit)' },
  ],
  async handler(args, ctx) {
    const repoDir = process.cwd();
    const diff = gitDiff(repoDir, args.base || '');
    const files = changedFiles(repoDir, args.base || '');
    const scoped = args.path ? files.filter((f) => f.startsWith(String(args.path))) : files;
    const diffHead = redact(clampText(diff, MAX_DIFF_CHARS));
    const diffBytes = diff.length;

    ctx.log(`diff: ${diffBytes} bytes, ${scoped.length || files.length} file(s)${args.path ? ` scoped to ${args.path}` : ''}`);

    // ── spawn a fresh reviewer agent (isolated context) when a provider is live
    const subagents = await serverMod('src/services/SubagentRuntime.js');
    const LLMmod = await serverMod('src/providers/runtime/LLMClient.js');
    const providers = await serverMod('src/providers/index.js');
    // a key on ANY provider is enough — the agent loop talks through
    // LLMClient.generateContent (resolveKeys), which is more permissive than
    // the capability registry's canChat() gate.
    const anyKey = !!(LLMmod?.resolveKeys && Object.values(LLMmod.resolveKeys()).some(Boolean));
    const canLLM = anyKey || !!(providers && typeof providers.canChat === 'function' && providers.canChat());

    if (canLLM && subagents && typeof subagents.runIsolatedSubagent === 'function') {
      ctx.log('spawning reviewer agent (isolated subagent, code-reviewer)…');
      const events = [];
      const out = await subagents.runIsolatedSubagent({
        name: 'code-reviewer',
        query: [
          'You are a strict code reviewer. Review the diff below. Return concrete findings only:',
          'bugs, security issues, regressions, missing error handling. Number each finding,',
          'name the file, and keep it under 12 findings. If the diff is clean, say CLEAN.',
          '',
          `Files in diff: ${(scoped.length ? scoped : files).join(', ') || '(none listed)'}`,
          '',
          '--- DIFF START ---',
          diffHead,
          '--- DIFF END ---',
        ].join('\n'),
        sendEvent: (t, d) => { if (events.length < 50) events.push({ t, d }); },
        opts: { depth: 1, maxTurns: 4 },
      });
      return {
        ok: out.status === 'PASS',
        summary: out.status === 'PASS'
          ? `reviewer agent completed — ${clampText(out.summary || 'no summary', 300)}`
          : `reviewer agent finished with status ${out.status}: ${clampText(out.summary || out.error || '', 300)}`,
        mode: 'llm-agent',
        spawned: { name: 'code-reviewer', isolated: true, durationMs: out.durationMs, toolCalls: out.toolCalls, status: out.status },
        files: scoped.length ? scoped : files,
        diffBytes,
        findings: clampText(out.summary || out.error || '', 2000),
        events: events.slice(0, 10),
      };
    }

    // ── deterministic fallback: static checks over changed JS files ────────
    ctx.log('no LLM provider live — running the deterministic static reviewer');
    const CodeJudgeMod = await serverMod('src/services/CodeJudge.js');
    const findings = [];
    for (const f of (scoped.length ? scoped : files)) {
      findings.push(...staticReview(repoDir, f));
      if (CodeJudgeMod?.diagnoseJsFile && /\.(js|mjs|cjs)$/.test(f)) {
        const d = CodeJudgeMod.diagnoseJsFile(path.resolve(repoDir, f));
        if (!d.pass) findings.push({ file: f, severity: 'error', line: d.line, message: `syntax: ${d.message}` });
      }
    }
    if (diffBytes < 40) findings.push({ severity: 'info', message: 'diff is empty — nothing to review' });
    return {
      ok: true,
      summary: `static review: ${findings.length} finding(s) across ${(scoped.length ? scoped : files).length} file(s)`,
      mode: 'static',
      files: scoped.length ? scoped : files,
      diffBytes,
      findings,
    };
  },
};
