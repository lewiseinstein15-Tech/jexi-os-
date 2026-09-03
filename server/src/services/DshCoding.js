/**
 * B165 — DSH CODING LOOP (the fired crew's replacement).
 *
 * How DeepSeek Harness codes: NO persona committee writing files in one
 * giant prompt. ONE model + TOOLS in a loop (dsh minimal/standard preset):
 *
 *   str_replace_editor  (view · create · str_replace · insert — dsh
 *                        tool-str-replace-editor)
 *   bash                (persistent shell — dsh tool-bash-persistent)
 *   python_run          (bounded CPython — dsh code-runtime-python)
 *   github_*            (read/edit/review repos — dsh mcp__github__*)
 *
 * plan → [ view → edit → run → OBSERVE the real error → fix ]ₙ → report.
 * The model iterates against REAL program output until it runs clean —
 * exactly dsh's "write → run → observe the EXACT error → fix" discipline,
 * with attempt budgets so it always terminates.
 *
 * runDshCoding({ goal, plan, sendEvent, signal, maxIterations }) →
 *   { files: [{name, code}], entryPoint, iterations, ran, runOutput }
 * Falls back to the caller (old generateCode path) ONLY if the loop yields
 * no files at all (e.g. no AI key) — the pipeline never dies.
 */

import fs from 'fs';
import path from 'path';
import { generateWithToolsLoop } from './LLMClient.js';
import { coworkerName } from './ModelCoworkers.js';
import { view, create, strReplace, insert } from './StrReplaceEditor.js';
import { runPwsh } from './PwshPersistent.js';
import { pythonToolHandler } from './CodeRuntimePython.js';
import { WORKSPACE_DIR } from '../config.js';

const MAX_ITERATIONS = 14;

const TOOL_DEFS = [
  {
    slug: 'str_replace_editor', name: 'Str Replace Editor',
    desc: 'View, create and edit project files. view=path (file shows 1-based line numbers — they are display-only; old_str must be the LITERAL text), create={path,file_text}, str_replace={path,old_str,new_str} (old_str must match EXACTLY ONCE), insert={path,insert_line,text} (insert AFTER that line; 0=top).',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', enum: ['view', 'create', 'str_replace', 'insert'] },
        path: { type: 'string' },
        file_text: { type: 'string' },
        old_str: { type: 'string' },
        new_str: { type: 'string' },
        insert_line: { type: 'number' },
        text: { type: 'string' },
      },
      required: ['command', 'path'],
    },
  },
  {
    slug: 'bash', name: 'Run Shell',
    desc: 'Run a shell command in the project workspace (install deps, run the app, run tests). Output is real — read errors and fix them with str_replace_editor.',
    parameters: {
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command'],
    },
  },
  {
    slug: 'python_run', name: 'Run Python',
    desc: 'Execute a short Python 3 program (bounded, isolated) — quick checks and data crunching.',
    parameters: {
      type: 'object',
      properties: { program: { type: 'string' } },
      required: ['program'],
    },
  },
  {
    slug: 'github_repo_scan', name: 'GitHub Repo Scan',
    desc: 'Scan a GitHub repo (owner/repo or URL): tree, manifests, structure — use it when the task involves an existing repo.',
    parameters: {
      type: 'object',
      properties: { repo: { type: 'string' } },
      required: ['repo'],
    },
  },
  {
    slug: 'github_file_read', name: 'GitHub File Read',
    desc: 'Read one file from a GitHub repo.',
    parameters: {
      type: 'object',
      properties: { repo: { type: 'string' }, path: { type: 'string' } },
      required: ['repo', 'path'],
    },
  },
];

async function executeEditorTool(args) {
  const c = String(args.command || '');
  // B199e — a malformed call (missing/unknown command) must teach the model
  // the valid commands, or it retries the same broken call forever.
  if (c === 'view') return view(args.path);
  if (c === 'create') return create(args.path, args.file_text ?? '');
  if (c === 'str_replace') {
    if (args.old_str === undefined) return { ok: false, error: 'old_str required' };
    return strReplace(args.path, String(args.old_str), String(args.new_str ?? ''));
  }
  if (c === 'insert') return insert(args.path, Number(args.insert_line) || 0, String(args.text ?? ''));
  return { ok: false, error: `unknown command ${c || '(missing)'} — valid commands: view, create, str_replace, insert. Example: {"command":"create","path":"file.md","file_text":"..."}` };
}

async function executeBash(args, owner) {
  const cmd = String(args.command || '');
  if (!cmd.trim()) return { ok: false, error: 'command required' };
  // pwsh-first on Windows-style hosts; bash everywhere else (dsh persistent shells).
  if (process.platform === 'win32') {
    const r = await runPwsh(owner, cmd, { timeoutMs: 60000 });
    if (r.ok || r.code !== 'PERSISTENT_PWSH_UNAVAILABLE') return r;
  }
  const { execFile } = await import('child_process');
  return new Promise((resolve) => {
    execFile('/bin/bash', ['-c', cmd], {
      cwd: WORKSPACE_DIR,
      timeout: 60000,
      maxBuffer: 256 * 1024,
      env: { ...process.env, FORCE_COLOR: '0', CI: '1' },
    }, (err, stdout, stderr) => {
      const out = String(stdout || '');
      const errs = String(stderr || '');
      resolve({
        ok: !err,
        output: (out + (errs ? `\nSTDERR:\n${errs}` : '')).slice(0, 12000) || '(no output)',
        exitCode: err ? (err.code ?? 1) : 0,
        ...(err && err.killed ? { timedOut: true } : {}),
      });
    });
  });
}

// B186 — junk filter (module scope): venv internals, caches, lockfiles and
// dot-dirs are NEVER reported as the agent's work (the user's weather-app
// build listed venv/bin/activate as a deliverable — ugly and wrong).
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.venv', 'venv', 'env', '.cache', '.pytest_cache', '.mypy_cache', '.ruff_cache', 'target', 'coverage', '.next', 'out', 'site-packages', 'vendor']);
const isJunkPath = (name) =>
  SKIP_DIRS.has(name) || name.startsWith('.') ||
  /^(venv|\.venv|env)\//.test(name) ||
  /\/(venv|\.venv|env|node_modules|__pycache__)\//.test(name) ||
  /^(package-lock|bun\.lock|poetry\.lock|Pipfile\.lock|\.python-version)/.test(name);

/** Snapshot the workspace files the loop touched (the pipeline's deliverable). */
function snapshotWorkspace(before) {
  const files = [];
  const walk = (dir, depth) => {
    if (depth > 4 || files.length > 60) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.isFile()) {
        const rel = path.relative(WORKSPACE_DIR, full).replace(/\\/g, '/');
        if (before.has(rel) || isJunkPath(rel)) continue; // untouched or junk — not ours
        const code = fs.readFileSync(full, 'utf-8');
        if (code.length <= 200 * 1024) files.push({ name: rel, code });
      }
    }
  };
  walk(WORKSPACE_DIR, 0);
  return files;
}

function beforeSet() {
  const set = new Set();
  try {
    const walk = (dir, depth) => {
      if (depth > 4) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full, depth + 1);
        else set.add(path.relative(WORKSPACE_DIR, full).replace(/\\/g, '/'));
      }
    };
    walk(WORKSPACE_DIR, 0);
  } catch { /* empty workspace */ }
  return set;
}

const SYSTEM = `You are JEXI's coding agent, running the DeepSeek Harness coding discipline.
You build software by ITERATING WITH TOOLS, never by dumping every file in one answer:

  1. Think briefly. For a multi-file project, start with the entry file.
  2. create the file (or view + str_replace an existing one).
  3. RUN it immediately (bash / python_run). READ the real output.
  4. If it errors: str_replace the EXACT broken lines and re-run. Repeat until clean.
  5. Keep files small and complete. No placeholders, no TODOs — runnable code only.

Rules:
- old_str in str_replace must be the LITERAL file text (line numbers from view are display-only).
- Prefer many small edits over rewriting whole files.
- LINKS for the user must be RELATIVE (/preview/<file>) — NEVER localhost or 127.0.0.1 (users are on phones; localhost is the server itself).
- When it runs clean, verify once more (exit 0 / expected output), then reply with a
  1-paragraph summary of what you built and how to run it.
- Budget: use at most ~14 tool rounds. Finish; do not gold-plate.`;

/**
 * THE coding loop (dsh preset style). Emits DSH-flavored streaming steps and
 * returns the pipeline's { files, entryPoint, iterations, ran, runOutput }.
 */
export async function runDshCoding({ goal, plan = '', sendEvent = () => {}, signal = null, owner = 'coding', onToken = null, __mockCompletions = null } = {}) {
  const before = beforeSet();
  const emits = [];
  const say = (agent, message) => {
    emits.push(message);
    sendEvent('log', { agent, message });
  };
  say('Coding Loop', `🛠 DSH coding loop engaged — one agent, real tools: editor · shell · python · github.`);

  let bashRuns = 0;
  let editorEdits = 0;
  let runFails = 0;
  let ranClean = true;
  const meta = { provider: null, model: null };
  const onTokenWrap = onToken
    ? (t, m) => { if (m) { meta.provider = m.provider; meta.model = m.model; } onToken(t, m); }
    : null;

  const executeToolCalls = async (toolCalls) => {
    const results = [];
    for (const call of toolCalls) {
      let args = {};
      try { args = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : (call.arguments || {}); } catch { args = {}; }
      let out;
      try {
        if (call.name === 'str_replace_editor') {
          out = await executeEditorTool(args);
          if (out.ok && args.command !== 'view') editorEdits += 1;
          if (out.ok && args.command === 'create') say('Editor', `✍️ I created ${args.path} (${out.bytes} bytes)`);
          else if (out.ok && args.command === 'str_replace') say('Editor', `🔧 I patched ${args.path} — replaced ${out.replacedBytes} bytes`);
          else if (out.ok && args.command === 'insert') say('Editor', `➕ I inserted ${out.insertedAfterLine !== undefined ? `after line ${out.insertedAfterLine}` : ''} in ${args.path}`);
          else if (out.ok && args.command === 'view') say('Editor', `👀 I read ${args.path}${out.kind === 'dir' ? ' (directory)' : ''}`);
          else if (!out.ok) say('Editor', `⚠ ${args.command} on ${args.path} failed: ${String(out.error || '').slice(0, 60)}`);
        } else if (call.name === 'bash') {
          out = await executeBash(args, owner);
          bashRuns += 1;
          if (!out.ok) { runFails += 1; ranClean = false; } else if (runFails > 0 && out.ok) { say('Shell', `🔁 I fixed it — the rerun passed.`); runFails = 0; }
          const cmd = String(args.command).replace(/\s+/g, ' ').slice(0, 64);
          const tail = String(out.output || '').trim().split('\n').filter(Boolean).slice(-1)[0] || '';
          const evidence = out.ok ? (tail ? ` — "${tail.slice(0, 46)}"` : '') : ` — failed: ${String(out.output || '').trim().split('\n').slice(-2).join(' ').slice(0, 60)}`;
          say('Shell', `▶ I ran \`${cmd}\` → ${out.ok ? 'success' : 'exit ' + out.exitCode}${evidence}`);
        } else if (call.name === 'python_run') {
          out = await pythonToolHandler(args);
          const lastLine = String(out.stdout || '').trim().split('\n').filter(Boolean).slice(-1)[0] || '';
          say('Python', `▶ I ran the Python check → ${out.ok ? 'ok' : 'failed'}${lastLine ? ` — "${lastLine.slice(0, 46)}"` : ''}`);
        } else if (call.name === 'github_repo_scan' || call.name === 'github_file_read') {
          const { repoScan, readFile } = await import('./GitHubEngine.js');
          out = call.name === 'github_repo_scan' ? await repoScan(args.repo) : await readFile(args.repo, args.path);
          say('GitHub Engine', `🐙 ${call.name === 'github_repo_scan' ? `scanned ${out.repo || args.repo}` : `read ${args.path}`}`);
        } else {
          out = { ok: false, error: `unknown tool ${call.name}` };
        }
      } catch (e) {
        out = { ok: false, error: (e && e.message) || String(e) };
      }
      results.push({ tool_call_id: call.id, name: call.name, content: JSON.stringify(out).slice(0, 14000) });
    }
    return results;
  };

  const userPrompt = `BUILD THIS:\n${goal}${plan ? `\n\nTEAM PLAN TO IMPLEMENT:\n${String(plan).slice(0, 6000)}` : ''}\n\nWork in the workspace with your tools. Finish when it runs clean.`;

  let res;
  try {
    res = await generateWithToolsLoop(userPrompt, SYSTEM, TOOL_DEFS, {
      temperature: 0.2,
      signal,
      maxIterations: MAX_ITERATIONS,
      ...(onTokenWrap ? { onToken: onTokenWrap } : {}),
      executeToolCalls,
      ...(__mockCompletions ? { __mockCompletions } : {}),
    });
  } catch (e) {
    say('Coding Loop', `⚠ loop ended early: ${e.message}`);
    res = { ok: false, text: '' };
  }

  const files = snapshotWorkspace(before);
  const coder = coworkerName(meta.provider, meta.model);
  say('Coding Loop', `✅ Done — I wrote ${files.length} file${files.length === 1 ? '' : 's'} (${files.map((f) => f.name).slice(0, 4).join(', ')}${files.length > 4 ? '…' : ''}), ran the code ${bashRuns} time${bashRuns === 1 ? '' : 's'}${ranClean ? ' and it all passed' : ''}.`);

  return {
    ok: files.length > 0,
    files,
    entryPoint: guessEntryPoint(files),
    summary: res && res.text ? String(res.text).slice(0, 4000) : '',
    iterations: (res && res.iterations) || 0,
    ran: bashRuns + 0,
    runOutput: '',
    coder: coder !== 'Otto' ? coder : null,
  };
}

function guessEntryPoint(files) {
  const order = [/^index\.html$/i, /^main\.(py|js|ts)$/i, /^app\.(js|jsx|ts|py)$/i, /^server\.(js|ts)$/i, /^src\/main\.(js|jsx)$/i, /^package\.json$/i];
  for (const re of order) {
    const hit = files.find((f) => re.test(f.name));
    if (hit) return hit.name === 'package.json' ? null : hit.name;
  }
  return files[0]?.name || null;
}
