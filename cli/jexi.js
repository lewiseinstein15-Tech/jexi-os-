#!/usr/bin/env node
/**
 * JEXI — the laptop product.
 *
 *   INSTALL  →  jexi init  →  jexi
 *
 * The current directory becomes the workspace: JEXI inspects and modifies it
 * with the machine's own CPU, filesystem, terminal, git and browsers. The
 * backend runs locally (127.0.0.1) — no cloud needed for local engineering.
 *
 * Usage:
 *   jexi init                 first-run setup (provider + key + model)
 *   jexi                      interactive REPL in this workspace
 *   jexi "build X"            one-shot task in this workspace
 *   jexi run "objective"      persistent mission with progress
 *   jexi missions             list missions on the local backend
 *   jexi models               show catalog + active model
 *   jexi doctor               environment health
 *   jexi stop|restart|logs    backend control
 *   jexi update               pull latest + reinstall backend deps
 *   jexi version|help
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { CLI_VERSION, jexiHome, loadConfig, saveConfig, findServerDir, paths } from './lib/config.js';
import { ensureBackend, stopBackend } from './lib/backend.js';
import { JexiApi } from './lib/api.js';
import { runInitWizard } from './lib/wizard.js';
import { runOneShot, runRepl, runMission } from './lib/repl.js';
import { runDoctor, formatDoctor } from './lib/doctor.js';

const err = (s) => process.stderr.write(`${s}\n`);
const ok = (s) => process.stdout.write(`${s}\n`);
const HOME = jexiHome();

function help() {
  ok(`JEXI ${CLI_VERSION} — autonomous engineering OS (local)

  jexi init            first-run setup: provider + API key + model
  jexi                 interactive session in this directory
  jexi "task"          one-shot task in this directory
  jexi run "goal"      persistent mission with live progress
  jexi missions        list missions on the local backend
  jexi models          model catalog + active model (masked)
  jexi doctor          check node, backend, model, browser, git
  jexi stop            stop the local backend
  jexi restart         restart the local backend (adopts this directory)
  jexi logs [-n N]     tail the backend log
  jexi update          pull latest JEXI + reinstall backend deps
  jexi version         print version
  jexi help            this help

The backend runs at http://127.0.0.1:<port> (see ~/.jexi/config.json).`);
}

function needInit() {
  err('JEXI is not set up yet. Run: jexi init');
  process.exitCode = 2;
  return null;
}

async function withBackend(cfg, workspace) {
  const serverDir = findServerDir();
  if (!serverDir) {
    err('Backend source not found (re-run the installer).');
    process.exit(1);
  }
  let backend;
  try {
    backend = await ensureBackend({ cfg, serverDir, workspace, home: HOME, onLog: (m) => err(`  ${m}`) });
  } catch (e) {
    err(`Backend: ${e.message}`);
    process.exit(1);
  }
  // Keep the backend's model in sync with the CLI's ONE credential (a failed
  // probe at init time must not leave the backend unconfigured forever).
  if (cfg.unified && cfg.unified.provider) {
    try {
      const act = await backend.api.providersActive();
      const active = act.data && act.data.active;
      if (!modelInSync(active, cfg.unified)) {
        err('  syncing model to backend…');
        const pushed = await pushModelConfig(backend.api, cfg.unified);
        if (pushed.ok) err(`  ✓ model live: ${pushed.active.provider} / ${pushed.active.model}`);
        else err(`  ⚠ model sync failed: ${pushed.error} (legacy keys may still work)`);
      }
    } catch (e) {
      err(`  ⚠ model sync skipped: ${e.message}`);
    }
  }
  return backend;
}

/** Does the backend's active model match the CLI's ONE credential? */
function modelInSync(active, unified) {
  if (!unified || !unified.provider) return true; // nothing to push
  if (!active || !active.configured) return false;
  return active.provider === unified.provider
    && active.model === unified.model
    && (active.baseUrl || '') === (unified.baseUrl || '');
}

/** Push the CLI's ONE model credential into the backend (probe before save). */
async function pushModelConfig(api, unified) {
  if (!unified || !unified.provider) return { ok: false, error: 'no model in CLI config — run: jexi init' };
  const r = await api.configureProvider({ ...unified }).catch((e) => ({ ok: false, data: { error: e.message } }));
  if (!r.ok || !r.data || !r.data.ok) {
    return { ok: false, error: (r.data && (r.data.error || (r.data.errors || []).join('; '))) || `HTTP ${r.status}` };
  }
  return { ok: true, active: r.data.active, probe: r.data.probe };
}

async function cmdInit(args) {
  const serverDir = findServerDir();
  if (!serverDir) { err('Backend source not found (re-run the installer).'); process.exit(1); }
  const modelOnly = args.includes('--model');
  const existing = loadConfig(HOME);
  if (existing && !modelOnly) {
    err(`Already initialized (backend http://127.0.0.1:${existing.port}, workspace ${existing.workspace}).`);
    err('  jexi init --model   re-run the model step only');
    process.exitCode = 2;
    return;
  }
  const cfg = await runInitWizard({ serverDir, cwd: process.cwd() }).catch((e) => {
    err(`Setup: ${e.message}`);
    process.exit(1);
  });
  if (modelOnly && existing) {
    cfg.port = existing.port;
    cfg.host = existing.host;
    cfg.accessKey = existing.accessKey;
    cfg.workspace = existing.workspace;
  }
  if (!saveConfig(cfg, HOME)) { err('Could not write ~/.jexi/config.json'); process.exit(1); }
  err('  starting the backend…');
  const { api } = await withBackend(cfg, cfg.workspace);
  err('  probing the model…');
  const pushed = await pushModelConfig(api, cfg.unified);
  if (!pushed.ok) {
    err(`  ⚠ model probe failed: ${pushed.error}`);
    err('  Saved anyway — fix the key/model, then: jexi init --model');
  } else {
    err(`  ✓ model live: ${pushed.active.provider} / ${pushed.active.model} (${pushed.probe ? `${pushed.probe.latencyMs}ms` : 'probed'})`);
  }
  ok(`\nReady. Run: jexi "your first task"`);
}

async function cmdChat(args) {
  const cfg = loadConfig(HOME);
  if (!cfg || !cfg.accessKey) return needInit();
  const workspace = process.cwd();
  const { api } = await withBackend(cfg, workspace);
  const query = args.join(' ').trim();
  if (query) {
    await runOneShot(api, query, { workspace }).catch((e) => { err(`  ✕ ${e.message}`); process.exitCode = 1; });
    return;
  }
  const code = await runRepl(api, { workspace });
  if (code === 2) return cmdDoctor(); // /doctor from inside the REPL
  if (process.exitCode === 2) return cmdDoctor();
}

async function cmdRun(args) {
  const cfg = loadConfig(HOME);
  if (!cfg || !cfg.accessKey) return needInit();
  const objective = args.join(' ').trim();
  if (!objective) { err('Usage: jexi run "objective"'); process.exitCode = 2; return; }
  const { api } = await withBackend(cfg, process.cwd());
  await runMission(api, objective).catch((e) => { err(`  ✕ ${e.message}`); process.exitCode = 1; });
}

async function cmdMissions() {
  const cfg = loadConfig(HOME);
  if (!cfg || !cfg.accessKey) return needInit();
  const { api } = await withBackend(cfg, process.cwd());
  const r = await api.get('/api/missions').catch((e) => ({ ok: false, data: { error: e.message } }));
  if (!r.ok) { err(`  ✕ HTTP ${r.status}`); process.exitCode = 1; return; }
  const list = (r.data && r.data.missions) || [];
  if (!list.length) { ok('No missions yet. Start one: jexi run "objective"'); return; }
  for (const m of list.slice(0, 20)) {
    ok(`  ${m.id}  [${m.state}]  ${(m.title || m.objective || '').slice(0, 90)}`);
  }
}

async function cmdModels() {
  const cfg = loadConfig(HOME);
  if (!cfg || !cfg.accessKey) return needInit();
  const { api } = await withBackend(cfg, process.cwd());
  const [cat, act] = await Promise.all([api.providersCatalog(), api.providersActive()]);
  if (act.ok && act.data && act.data.active && act.data.active.configured) {
    const a = act.data.active;
    ok(`Active: ${a.provider} / ${a.model} (${a.source})`);
  } else {
    ok('Active: none — run: jexi init --model');
  }
  ok('\nProviders:');
  const list = (cat.data && cat.data.providers) || [];
  for (const p of list) {
    ok(`  ${p.id.padEnd(12)} ${p.label} — ${p.blurb}`);
  }
}

async function cmdDoctor() {
  const cfg = loadConfig(HOME);
  const serverDir = findServerDir();
  let api = null;
  if (cfg && cfg.accessKey) {
    api = new JexiApi({ baseUrl: `http://${cfg.host}:${cfg.port}`, accessKey: cfg.accessKey });
    // A health check must not START the backend — report reachability only.
    const h = await api.health().catch(() => null);
    if (!h) api = { health: async () => { throw new Error('backend not running (start it: jexi)'); }, providersActive: async () => { throw new Error('backend not running'); } };
  }
  const checks = await runDoctor({ serverDir, api });
  ok(formatDoctor(checks));
  if (!cfg) err('\nNot initialized — run: jexi init');
  process.exitCode = checks.every((x) => x.ok) ? 0 : 1;
}

async function cmdStop() {
  const r = await stopBackend(HOME);
  ok(r.stopped ? `Backend stopped (pid ${r.pid}).` : `Backend: ${r.reason}.`);
}

async function cmdRestart() {
  await stopBackend(HOME);
  const cfg = loadConfig(HOME);
  if (!cfg || !cfg.accessKey) return needInit();
  cfg.workspace = process.cwd();
  saveConfig(cfg, HOME);
  await withBackend(cfg, process.cwd());
  ok(`Backend restarted on http://127.0.0.1:${cfg.port} (workspace ${cfg.workspace}).`);
}

function cmdLogs(args) {
  const n = Number((args[args.indexOf('-n') + 1] || '60').valueOf()) || 60;
  const p = paths(HOME).log;
  if (!fs.existsSync(p)) { err('No backend log yet.'); return; }
  const lines = fs.readFileSync(p, 'utf-8').split('\n');
  ok(lines.slice(-n).join('\n'));
}

function sh(cmd, cargs, cwd) {
  return new Promise((resolve) => {
    execFile(cmd, cargs, { cwd, timeout: 600000 }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

async function cmdUpdate() {
  const serverDir = findServerDir();
  if (!serverDir) { err('Backend source not found.'); process.exit(1); }
  const repo = path.resolve(serverDir, '..');
  err('  pulling latest…');
  const pull = await sh('git', ['pull', '--ff-only'], repo);
  if (pull.err) { err(`  git pull failed:\n${(pull.stderr || pull.err.message).slice(0, 500)}`); process.exitCode = 1; return; }
  err(`  ${pull.stdout.trim().split('\n').pop()}`);
  err('  reinstalling backend deps…');
  const ci = await sh('npm', ['ci', '--no-audit', '--no-fund'], serverDir);
  if (ci.err) { err(`  npm ci failed:\n${(ci.stderr || ci.err.message).slice(0, 500)}`); process.exitCode = 1; return; }
  ok('Updated. Restart the backend: jexi restart');
}

async function main() {
  const [, , cmd, ...args] = process.argv;
  if (!cmd || cmd.startsWith('-') || !['init', 'run', 'missions', 'models', 'doctor', 'stop', 'restart', 'logs', 'update', 'version', 'help'].includes(cmd)) {
    if (cmd === '--version' || cmd === '-v') return ok(`jexi ${CLI_VERSION}`);
    if (cmd === '--help' || cmd === '-h') return help();
    // Default: REPL or one-shot. Everything is the query.
    const query = [cmd, ...args].filter(Boolean).join(' ').trim();
    if (!query) return cmdChat([]);
    return cmdChat([query]);
  }
  if (cmd === 'help') return help();
  if (cmd === 'version') return ok(`jexi ${CLI_VERSION}`);
  if (cmd === 'init') return cmdInit(args);
  if (cmd === 'run') return cmdRun(args);
  if (cmd === 'missions') return cmdMissions();
  if (cmd === 'models') return cmdModels();
  if (cmd === 'doctor') return cmdDoctor();
  if (cmd === 'stop') return cmdStop();
  if (cmd === 'restart') return cmdRestart();
  if (cmd === 'logs') return cmdLogs(args);
  if (cmd === 'update') return cmdUpdate();
}

main().catch((e) => {
  err(`jexi: ${(e && e.message) || e}`);
  process.exitCode = 1;
});
