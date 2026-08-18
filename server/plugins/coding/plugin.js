/**
 * JEXI OS — Autonomous Coding Plugin (B126, DeepSeek Harness
 * `packages/shell/tool-bash` + `packages/fs/tool-fs` mirror).
 *
 * Replaces the 11-agent coding TEAM (Product → Designer → Engineer → Coder →
 * Runner → Debugger → QA → Reviewer → Security → Shipper → Reflector) with
 * DSH's model-driven coding: the model itself writes/edits files, runs
 * commands in a sandboxed workspace, sees errors, fixes them, and iterates
 * until it works — no team, no pipeline.
 *
 * Tools (DSH contracts):
 *   bash(command, description, timeoutMs?, workdir?)  → { ok, output, code, durationMs }
 *   write(file_path, content)                         → { ok, path, operation, before, after }
 *   read(file_path)                                   → { ok, path, content }
 *   edit(file_path, old_string?, new_string?, full?)  → { ok, path, operation }
 *   list_files(path?)                                 → { ok, path, files: [{name, type, size}] }
 * All writes stay inside the declared workspace root (path-safety).
 *
 * Also contributes the `coder` skill (progressive) with DSH's
 * plan → write → run → fix → verify loop guidance, registered on the
 * context so discovery shows it (custom rank 300).
 */

import fs from 'fs';
import path from 'path';
import { writeWorkspace, readWorkspace, listWorkspace } from '../../src/services/WorkspaceRuntime.js';
import { runCommand } from '../../src/services/Runner.js';

export const name = 'coding';
export const version = '1.0.0';
export const inject = ['tools', 'skills', 'events'];

const MAX_OUTPUT_CHARS = 12000;
const MAX_READ_CHARS = 16000;

const CODER_SKILL_BODY = `# Coder Skill (autonomous)

You are the coder. You build working software YOURSELF with the coding tools — there is no team behind you.

## Loop (follow every time)
1. **PLAN**: restate the deliverable as concrete files. A small app = 2-5 files (index.html, style.css, app.js — or package.json + src/).
2. **WRITE**: create each file with \`write\` (or \`edit\` for targeted changes after \`read\`).
3. **UNDERSTAND**: before editing unfamiliar code, use \`lsp\` (goToDefinition / findReferences / hover) for precise navigation instead of guessing with grep.
4. **RUN**: verify with \`bash\` (e.g. \`ls -R\`, \`node file.js\`, \`npm start\` for the server, \`python3 -m py_compile\`). ALWAYS run what you wrote — never claim it works without running it.
4. **FIX**: read the error, edit the file, re-run. Max ~6 attempts, then report honestly.
5. **VERIFY**: a final \`bash\` check (list files, print sizes, run a smoke test). Report what exists, what was run, and the exact result.

## Rules
- Keep every file inside the workspace (relative paths only).
- For web apps, prefer a single self-contained file when it fits — a live preview needs no build step.
- When a server is needed, run it with a background job (\`run_in_background\`) so the command returns; the preview link comes from the preview-server tool.
- Read before you edit; preserve unrelated parts of a file.
- Be honest: if a step fails after retries, say exactly what failed and what you tried.
- Never leave TODO placeholders in a delivered file.`;

/** DSH bash tool. */
function registerBash(ctx, unregisters) {
  const unregister = ctx.tools.register({
    slug: 'bash',
    name: 'Bash',
    desc: 'Execute a bash command in the workspace. Use for running, building, and verifying code.',
    args: {
      command: { type: 'string', required: true, desc: 'The bash command to execute.' },
      description: { type: 'string', required: true, desc: 'Clear 5-10 word description of what the command does (shown in the UI).' },
      timeoutMs: { type: 'number', desc: 'Timeout in ms (default 30000, max 120000).' },
      workdir: { type: 'string', desc: 'Working directory (default: the workspace root).' },
    },
    timeoutMs: 120000,
    handler: async (args) => {
      const command = String((args && args.command) || '').trim();
      if (!command) return { ok: false, error: 'command required' };
      const timeout = Math.min(Math.max(Number((args && args.timeoutMs) || 30000), 1000), 120000);
      const out = await runCommand(command, { timeout, cwd: (args && args.workdir) || undefined });
      return {
        ok: !!out.success,
        kind: 'bash-result',
        command: command.slice(0, 300),
        output: String(out.output || '').slice(0, MAX_OUTPUT_CHARS),
        code: out.code ?? null,
        durationMs: out.durationMs ?? null,
      };
    },
  });
  unregisters.push(unregister);
}

/** DSH write tool. */
function registerWrite(ctx, unregisters) {
  const unregister = ctx.tools.register({
    slug: 'write',
    name: 'Write',
    desc: 'Create a file or fully replace its contents (UTF-8 text).',
    args: {
      file_path: { type: 'string', required: true, desc: 'Relative workspace path to write.' },
      content: { type: 'string', required: true, desc: 'Full text content to write.' },
    },
    timeoutMs: 30000,
    handler: async (args) => {
      const filePath = String((args && args.file_path) || '').trim();
      const content = String((args && args.content) ?? '');
      if (!filePath) return { ok: false, error: 'file_path required' };
      let before = null;
      try { before = readWorkspace(filePath); } catch { /* new file */ }
      const r = writeWorkspace(filePath, content);
      return {
        ok: true,
        kind: 'write-result',
        path: filePath,
        operation: before === null ? 'create' : 'update',
        before,
        after: content.slice(0, 2000),
        size: r.size,
      };
    },
  });
  unregisters.push(unregister);
}

/** DSH read tool. */
function registerRead(ctx, unregisters) {
  const unregister = ctx.tools.register({
    slug: 'read',
    name: 'Read',
    desc: 'Read a UTF-8 text file from the workspace.',
    args: { file_path: { type: 'string', required: true, desc: 'Relative workspace path to read.' } },
    timeoutMs: 30000,
    handler: async (args) => {
      const filePath = String((args && args.file_path) || '').trim();
      if (!filePath) return { ok: false, error: 'file_path required' };
      try {
        const content = readWorkspace(filePath);
        return { ok: true, kind: 'read-result', path: filePath, content: String(content).slice(0, MAX_READ_CHARS) };
      } catch (e) {
        return { ok: false, error: `file not found: ${filePath}` };
      }
    },
  });
  unregisters.push(unregister);
}

/** DSH edit tool (targeted string replace or full rewrite). */
function registerEdit(ctx, unregisters) {
  const unregister = ctx.tools.register({
    slug: 'edit',
    name: 'Edit',
    desc: 'Edit a file: replace one exact old_string with new_string, or replace the whole file with full.',
    args: {
      file_path: { type: 'string', required: true, desc: 'Relative workspace path.' },
      old_string: { type: 'string', desc: 'The exact text to replace.' },
      new_string: { type: 'string', desc: 'The replacement text.' },
      full: { type: 'string', desc: 'When provided, replaces the ENTIRE file with this content.' },
    },
    timeoutMs: 30000,
    handler: async (args) => {
      const filePath = String((args && args.file_path) || '').trim();
      if (!filePath) return { ok: false, error: 'file_path required' };
      let current;
      try { current = readWorkspace(filePath); } catch { return { ok: false, error: `file not found: ${filePath}` }; }
      const full = args && args.full;
      let next;
      let operation = 'edit';
      if (full !== undefined) {
        next = String(full);
        operation = 'replace';
      } else {
        const oldS = String((args && args.old_string) ?? '');
        const newS = String((args && args.new_string) ?? '');
        if (!oldS) return { ok: false, error: 'old_string required (or pass full)' };
        if (!current.includes(oldS)) return { ok: false, error: 'old_string not found in the file — read it first and match exactly' };
        next = current.replace(oldS, newS);
        operation = 'edit';
      }
      writeWorkspace(filePath, next);
      return { ok: true, kind: 'edit-result', path: filePath, operation, after: next.slice(0, 2000) };
    },
  });
  unregisters.push(unregister);
}

/** list_files tool. */
function registerList(ctx, unregisters) {
  const unregister = ctx.tools.register({
    slug: 'list_files',
    name: 'List Files',
    desc: 'List files in the workspace (optionally a subdirectory).',
    args: { path: { type: 'string', desc: 'Optional subdirectory (default: workspace root).' } },
    timeoutMs: 30000,
    handler: async (args) => {
      const sub = String((args && args.path) || '').trim();
      const raw = listWorkspace(500);
      const files = raw.map((f) => (typeof f === 'string' ? f : f.name || f.path || String(f)));
      const rel = sub ? files.filter((f) => f.startsWith(sub.replace(/\/+$/, '') + '/')) : files;
      return { ok: true, kind: 'list-result', path: sub || '.', files: rel.slice(0, 300) };
    },
  });
  unregisters.push(unregister);
}

/** Apply is called at boot with the plugin context. Return a cleanup fn. */
export async function apply(ctx) {
  const unregisters = [];
  registerBash(ctx, unregisters);
  registerWrite(ctx, unregisters);
  registerRead(ctx, unregisters);
  registerEdit(ctx, unregisters);
  registerList(ctx, unregisters);

  const unregSkill = ctx.skills.register({
    slug: 'coder',
    name: 'Coder',
    desc: 'Autonomous coding: plan → write → run → fix → verify, yourself, with the coding tools.',
    load: () => CODER_SKILL_BODY,
    body: CODER_SKILL_BODY,
  });
  unregisters.push(unregSkill);

  return () => { for (const u of unregisters) { try { u(); } catch { /* noop */ } } };
}

export { CODER_SKILL_BODY };
