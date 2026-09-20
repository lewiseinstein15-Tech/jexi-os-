import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

export const DEFAULT_TIMEOUT_MS = 30_000;

const PYTHON_WRAPPER = String.raw`
import importlib.util
import json
import sys
import traceback

entry, callable_name, raw_args = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    args = json.loads(raw_args)
    spec = importlib.util.spec_from_file_location("_jexi_executable_skill", entry)
    if spec is None or spec.loader is None:
        raise RuntimeError("could not create module spec for skill.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    callable_fn = getattr(module, callable_name)
    if not callable(callable_fn):
        raise TypeError(f"{callable_name} is not callable")
    result = callable_fn(args)
    if result is not None:
        if isinstance(result, (dict, list)):
            print(json.dumps(result, sort_keys=True, separators=(",", ":")))
        else:
            print(result)
except BaseException:
    traceback.print_exc()
    sys.exit(1)
`;

function loadError(code, message) {
  return { ok: false, meta: null, entry: null, callable: null, error: { code, message } };
}

function runError(code, message, extra = {}) {
  return {
    ok: false,
    stdout: '',
    stderr: '',
    exitCode: -1,
    durationMs: 0,
    parsed: null,
    error: { code, message },
    ...extra,
  };
}

function parseFrontmatter(markdown) {
  const source = String(markdown).replace(/\r\n/g, '\n');
  if (!source.startsWith('---\n')) throw new Error('frontmatter must start with ---');
  const end = source.indexOf('\n---\n', 4);
  if (end < 0) throw new Error('frontmatter closing --- is missing');
  const metadata = {};
  for (const line of source.slice(4, end).split('\n')) {
    if (!line.trim()) continue;
    const match = /^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (!match || Object.hasOwn(metadata, match[1])) throw new Error(`invalid frontmatter line: ${line}`);
    metadata[match[1]] = match[2].trim();
  }
  return { metadata, body: source.slice(end + 5) };
}

function decodeString(value) {
  if (!value) return '';
  if (value.startsWith('"')) {
    try { return JSON.parse(value); } catch { throw new Error(`invalid quoted value: ${value}`); }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'")) throw new Error(`invalid quoted value: ${value}`);
    return value.slice(1, -1).replace(/\\'/g, "'");
  }
  return value;
}

function decodeArray(value) {
  if (!value.startsWith('[') || !value.endsWith(']')) throw new Error('allowedTools must be an array');
  const inside = value.slice(1, -1).trim();
  if (!inside) return [];
  return inside.split(',').map(part => decodeString(part.trim())).filter(Boolean);
}

function normalizedMeta(metadata) {
  for (const required of ['name', 'description', 'whenToUse', 'allowedTools', 'version']) {
    if (!Object.hasOwn(metadata, required)) throw new Error(`frontmatter is missing ${required}`);
  }
  const meta = {
    name: decodeString(metadata.name),
    description: decodeString(metadata.description),
    whenToUse: decodeString(metadata.whenToUse),
    allowedTools: decodeArray(metadata.allowedTools),
    version: decodeString(metadata.version),
  };
  if (!meta.name || !meta.description || !meta.whenToUse || !meta.version) throw new Error('required frontmatter value is empty');
  const callable = Object.hasOwn(metadata, 'callable') ? decodeString(metadata.callable) : 'run';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(callable)) throw new Error('callable must be a Python identifier');
  return { meta, callable };
}

function hasBaseline(body) {
  return /^## Prompt Defense Baseline\s*$/m.test(body);
}

function pythonProbe(binary) {
  const probe = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 5_000, windowsHide: true });
  return !probe.error && probe.status === 0;
}

function jsonOutput(stdout) {
  const text = stdout.trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Create a local Python-backed skill loader and runner. */
export function createPythonSkill({ pythonBin = process.env.JEXI_PYTHON_BIN || 'python3', defaultTimeoutMs = DEFAULT_TIMEOUT_MS, spawnProcess = spawn } = {}) {
  function load(skillDir) {
    const directory = path.resolve(String(skillDir || ''));
    let stat;
    try { stat = fs.statSync(directory); } catch { return loadError('E_SKILL_DIR_NOT_FOUND', `skill directory not found: ${directory}`); }
    if (!stat.isDirectory()) return loadError('E_SKILL_DIR_NOT_FOUND', `skill directory is not a directory: ${directory}`);

    const skillMd = path.join(directory, 'SKILL.md');
    let markdown;
    try { markdown = fs.readFileSync(skillMd, 'utf8'); } catch { return loadError('E_MISSING_SKILL_MD', `SKILL.md is missing: ${skillMd}`); }

    let parsed;
    try { parsed = parseFrontmatter(markdown); } catch (cause) {
      return loadError('E_INVALID_FRONTMATTER', String(cause.message || cause));
    }
    let normalized;
    try { normalized = normalizedMeta(parsed.metadata); } catch (cause) {
      return loadError('E_INVALID_FRONTMATTER', String(cause.message || cause));
    }
    if (!hasBaseline(parsed.body)) return loadError('E_MISSING_BASELINE', 'SKILL.md is missing ## Prompt Defense Baseline');

    const entry = path.join(directory, 'skill.py');
    try {
      if (!fs.statSync(entry).isFile()) throw new Error('not a file');
    } catch {
      return loadError('E_MISSING_SKILL_PY', `skill.py is missing: ${entry}`);
    }

    return { ok: true, meta: normalized.meta, entry, callable: normalized.callable };
  }

  function run(skillDir, args = {}, { timeoutMs = defaultTimeoutMs } = {}) {
    const loaded = load(skillDir);
    if (!loaded.ok) return Promise.resolve(runError(loaded.error.code, loaded.error.message));
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
      return Promise.resolve(runError('E_EXECUTION_FAILED', 'timeoutMs must be a positive number'));
    }
    if (!pythonProbe(pythonBin)) {
      return Promise.resolve(runError('E_PYTHON_UNAVAILABLE', `Python runtime unavailable: ${pythonBin}`));
    }

    let encodedArgs;
    try { encodedArgs = JSON.stringify(args); } catch (cause) {
      return Promise.resolve(runError('E_EXECUTION_FAILED', `args must be JSON serializable: ${String(cause.message || cause)}`));
    }
    if (encodedArgs === undefined) encodedArgs = '{}';
    const startedAt = Date.now();
    return new Promise((resolve) => {
      let child;
      let settled = false;
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let timer = null;
      const finish = ({ exitCode, error } = {}) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        const durationMs = Date.now() - startedAt;
        const parsed = jsonOutput(stdout);
        if (timedOut) {
          resolve({ ok: false, stdout, stderr, exitCode: -1, durationMs, parsed, error: { code: 'E_EXECUTION_FAILED', message: `Python skill timed out after ${timeoutMs}ms` } });
          return;
        }
        if (error) {
          resolve({ ok: false, stdout, stderr: `${stderr}${error}`, exitCode: -1, durationMs, parsed, error: { code: 'E_EXECUTION_FAILED', message: error } });
          return;
        }
        if (exitCode !== 0) {
          resolve({ ok: false, stdout, stderr, exitCode: Number.isInteger(exitCode) ? exitCode : -1, durationMs, parsed, error: { code: 'E_EXECUTION_FAILED', message: `Python skill exited with code ${exitCode}` } });
          return;
        }
        resolve({ ok: true, stdout, stderr, exitCode: 0, durationMs, parsed });
      };
      try {
        child = spawnProcess(pythonBin, ['-I', '-B', '-c', PYTHON_WRAPPER, loaded.entry, loaded.callable, encodedArgs], {
          cwd: path.dirname(loaded.entry),
          env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } catch (cause) {
        finish({ error: String(cause.message || cause) });
        return;
      }
      child.stdout?.on('data', chunk => { stdout += String(chunk); });
      child.stderr?.on('data', chunk => { stderr += String(chunk); });
      child.once('error', cause => finish({ error: String(cause.message || cause) }));
      child.once('close', exitCode => finish({ exitCode }));
      if (!settled) {
        timer = setTimeout(() => {
          timedOut = true;
          try { child.kill('SIGKILL'); } catch { /* process already exited */ }
        }, timeoutMs);
      }
    });
  }

  return { load, run };
}

export const pythonSkill = createPythonSkill();
export const load = pythonSkill.load;
export const run = pythonSkill.run;
export default pythonSkill;
