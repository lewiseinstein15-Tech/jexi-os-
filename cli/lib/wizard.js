/**
 * JEXI CLI — first-run setup wizard.
 *
 * INSTALL → jexi init → provider + key + model → START WORK.
 * Reuses the backend's own catalog + validators (single source of truth).
 *
 * Input works BOTH interactively (TTY, with editing + hidden key entry)
 * and piped/scripted (`printf '…\n' | jexi init`) — piped stdin is slurped
 * once and served line-by-line, because repeated readline.question() calls
 * lose buffered input on non-TTY streams.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import readline from 'node:readline';
import { defaultConfig, importServerModule } from './config.js';

export function randomAccessKey() {
  return `jx-local-${crypto.randomBytes(24).toString('hex')}`;
}

export function validPort(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1024 && n <= 65535;
}

/**
 * Create { prompt, promptHidden, close } for this process's stdin.
 * Test stubs can implement the same three functions instead.
 */
export function createPrompter() {
  if (process.stdin.isTTY) {
    const r = readline.createInterface({ input: process.stdin, output: process.stdout });
    return {
      mode: 'tty',
      prompt: (question, { def = '' } = {}) => new Promise((resolve) => {
        r.question(`${question}${def ? ` [${def}]` : ''}: `, (ans) => resolve(ans.trim() || def));
      }),
      promptHidden: (question) => new Promise((resolve) => {
        const stdin = process.stdin;
        const stdout = process.stdout;
        stdout.write(`${question}: `);
        stdin.setRawMode(true);
        stdin.resume();
        let value = '';
        const onData = (ch) => {
          const s = String(ch);
          if (s === '\n' || s === '\r' || s === '\x04') {
            stdin.setRawMode(false);
            stdin.pause();
            stdin.removeListener('data', onData);
            stdout.write('\n');
            resolve(value.trim());
          } else if (s === '\x03') {
            stdout.write('\n');
            process.exit(130);
          } else if (s === '\x7f' || s === '\b') {
            value = value.slice(0, -1);
          } else {
            value += s;
          }
        };
        stdin.on('data', onData);
      }),
      close: () => { try { r.close(); } catch {} },
    };
  }
  // Piped / redirected: read every line up front, serve in order.
  let lines = [];
  try {
    lines = fs.readFileSync(0, 'utf-8').split('\n');
  } catch {
    lines = [];
  }
  let i = 0;
  const next = (question, { def = '', hidden = false } = {}) => {
    const raw = i < lines.length ? lines[i] : '';
    i += 1;
    const val = String(raw).trim();
    process.stdout.write(`${question}${def ? ` [${def}]` : ''}: ${hidden ? '(hidden)' : val}\n`);
    return Promise.resolve(val || def);
  };
  return {
    mode: 'pipe',
    prompt: (q, o) => next(q, o),
    promptHidden: (q) => next(q, { hidden: true }),
    close: () => {},
  };
}

// Back-compat singletons used by unit tests (TTY path).
const _tty = process.stdin.isTTY ? createPrompter() : null;
export function prompt(question, opts) {
  if (_tty) return _tty.prompt(question, opts);
  return createPrompter().prompt(question, opts);
}
export function promptHidden(question) {
  if (_tty) return _tty.promptHidden(question);
  return createPrompter().promptHidden(question);
}
export function closePrompts() {
  try { _tty?.close(); } catch {}
}

export async function loadCatalog(serverDir) {
  const mod = await importServerModule(serverDir, 'src/services/providers/catalog.js');
  return mod.publicCatalog();
}

export async function loadValidators(serverDir) {
  return importServerModule(serverDir, 'src/services/providers/modelConfig.js');
}

/**
 * Interactive init. Returns the new config (unsaved — caller saves).
 * `io` can be stubbed in tests { prompt, promptHidden, print }.
 */
export async function runInitWizard({ serverDir, cwd, io = null } = {}) {
  const prompter = io || createPrompter();
  const ask = prompter.prompt;
  const askHidden = prompter.promptHidden;
  const print = io?.print || console.log;

  const catalog = await loadCatalog(serverDir);
  const { validateModelConfig } = await loadValidators(serverDir);

  print('\n  JEXI setup — one model credential runs everything.\n');
  print('  Providers:');
  catalog.forEach((p, i) => {
    const key = p.needsKey ? 'key' : 'no key';
    print(`    ${String(i + 1).padStart(2)}. ${p.label} (${key}) — ${p.blurb}`);
  });
  let provider = null;
  for (let tries = 0; tries < 4 && !provider; tries += 1) {
    const pick = await ask('Provider number or id', { def: 'groq' });
    const byNum = /^\d+$/.test(pick) ? catalog[Number(pick) - 1] : null;
    provider = byNum || catalog.find((p) => p.id === String(pick).toLowerCase()) || null;
    if (!provider) print('  Unknown provider — try again.');
  }
  if (!provider) throw new Error('no provider selected');

  let apiKey = '';
  if (provider.needsKey) {
    apiKey = await askHidden(`API key for ${provider.label}${provider.docsUrl ? ` (get one: ${provider.docsUrl})` : ''}`);
    if (!apiKey) throw new Error('an API key is required for this provider (or pick a local provider)');
  }
  const modelDef = provider.modelHints[0] || '';
  if (provider.modelHints.length > 1) {
    print(`  Models: ${provider.modelHints.join(', ')}`);
  }
  const model = await ask('Model', { def: modelDef });
  let baseUrl = provider.defaultBaseUrl;
  if (!provider.defaultBaseUrl || provider.id === 'custom' || provider.id === 'vllm') {
    baseUrl = await ask('Base URL (OpenAI-compatible endpoint)', { def: provider.defaultBaseUrl });
  }

  const v = validateModelConfig({ provider: provider.id, apiKey, model, baseUrl });
  if (!v.ok) throw new Error(`invalid model config: ${v.errors.join('; ')}`);

  const portAns = await ask('Local backend port', { def: '3210' });
  if (!validPort(portAns)) throw new Error('port must be 1024–65535');

  const cfg = {
    ...defaultConfig(),
    port: Number(portAns),
    host: '127.0.0.1',
    accessKey: randomAccessKey(),
    workspace: cwd,
    unified: v.normalized,
  };
  print(`\n  Model: ${provider.label} / ${v.normalized.model}`);
  print(`  Backend: http://127.0.0.1:${cfg.port}  workspace: ${cwd}\n`);
  try { prompter.close?.(); } catch {}
  return cfg;
}
