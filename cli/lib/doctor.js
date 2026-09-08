/**
 * JEXI CLI — `jexi doctor`: honest environment health.
 *
 * Every check is { name, ok, detail }. Nothing is faked: a missing browser,
 * an unconfigured model, or a dead backend reports exactly that, with the
 * fix next to it. `deps` injection keeps this offline-testable.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

export function checkNodeVersion(version = process.version) {
  const m = String(version).match(/^v(\d+)\.(\d+)/);
  const major = m ? Number(m[1]) : 0;
  return {
    name: 'node',
    ok: major >= 20,
    detail: major >= 20 ? `${version} (>= 20 required)` : `${version} — install Node.js 20+ (https://nodejs.org)`,
  };
}

export function checkServerDir(serverDir) {
  const ok = !!serverDir && fs.existsSync(path.join(serverDir, 'index.js'));
  return {
    name: 'backend source',
    ok,
    detail: ok ? serverDir : 'server/ not found next to the CLI (re-run the installer)',
  };
}

export function checkServerDeps(serverDir) {
  const ok = !!serverDir && fs.existsSync(path.join(serverDir, 'node_modules'));
  return {
    name: 'backend deps',
    ok,
    detail: ok ? 'node_modules present' : (serverDir ? `run: cd ${serverDir} && npm ci` : 'unknown server dir'),
  };
}

function execOk(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 8000 }, (err, stdout) => {
      resolve(err ? null : String(stdout || '').trim());
    });
  });
}

export async function checkGit(deps = {}) {
  const run = deps.execOk || execOk;
  const v = await run('git', ['--version']);
  return { name: 'git', ok: !!v, detail: v || 'not found — install git to let JEXI commit/push' };
}

export async function checkBackendHealth(api) {
  try {
    const r = await api.health();
    if (r.ok && r.data && r.data.ok) {
      return { name: 'backend', ok: true, detail: `${r.data.name || 'brain'} v${r.data.version || '?'} · up ${r.data.uptime || 0}s · ${api.baseUrl}` };
    }
    return { name: 'backend', ok: false, detail: `HTTP ${r.status} at ${api.baseUrl}` };
  } catch (e) {
    return { name: 'backend', ok: false, detail: `unreachable at ${api.baseUrl} (${String((e && e.message) || e).slice(0, 100)})` };
  }
}

export async function checkModel(api) {
  try {
    const r = await api.providersActive();
    const a = r.data && r.data.active;
    if (r.ok && a && a.configured) {
      return { name: 'model', ok: true, detail: `${a.provider} / ${a.model} (${a.source}${a.hasKey ? ', key …' + (a.keyLast4 || '').slice(1) : ''})` };
    }
    return { name: 'model', ok: false, detail: 'no model configured — run: jexi init' };
  } catch (e) {
    return { name: 'model', ok: false, detail: `could not query (${String((e && e.message) || e).slice(0, 100)})` };
  }
}

export function checkBrowser(serverDir) {
  // Best-effort: playwright browsers installed for the backend user?
  const candidates = [
    serverDir ? path.join(serverDir, 'node_modules', '.local-browsers') : null,
    process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== '0'
      ? process.env.PLAYWRIGHT_BROWSERS_PATH : null,
    process.env.HOME ? path.join(process.env.HOME, '.cache', 'ms-playwright') : null,
  ].filter(Boolean);
  const found = candidates.find((d) => { try { return fs.existsSync(d) && fs.readdirSync(d).length > 0; } catch { return false; } });
  return {
    name: 'browser',
    ok: !!found,
    detail: found ? `chromium available (${found})` : 'no local chromium — browser tools degrade to server-side reading (run: npx playwright install chromium)',
  };
}

/** Run all checks. `api` may be null (backend/model checks report unreachable). */
export async function runDoctor({ serverDir, api = null, deps = {} } = {}) {
  const checks = [
    checkNodeVersion(deps.nodeVersion),
    checkServerDir(serverDir),
    checkServerDeps(serverDir),
    await checkGit(deps),
    api ? await checkBackendHealth(api) : { name: 'backend', ok: false, detail: 'not checked (no api)' },
    api ? await checkModel(api) : { name: 'model', ok: false, detail: 'not checked (no api)' },
    checkBrowser(serverDir),
  ];
  return checks;
}

export function formatDoctor(checks) {
  return checks.map((ch) => `  ${ch.ok ? '✓' : '✗'} ${ch.name}: ${ch.detail}`).join('\n');
}
