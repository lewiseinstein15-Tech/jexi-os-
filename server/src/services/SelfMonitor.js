import os from 'os';
import fs from 'fs';
import path from 'path';
import { SERVER_ROOT, PORT, DATA_DIR, WORKSPACE_DIR } from '../config.js';
import { resolveKeys } from './LLMClient.js';
import { providerHealthSnapshot } from './ProviderRouter.js';
import { browserStatus } from './DesktopManager.js';

/**
 * JEXI's self-monitor — she can inspect her own system, keep a ring buffer of
 * recent errors, and READ her own source code to find the root cause of problems.
 */

const MAX_ERRORS = 50;
const errors = [];
let bootTime = Date.now();
let chatCount = 0;
let visionCount = 0;

export function recordBoot() { bootTime = Date.now(); }
export function recordChat() { chatCount++; }
export function recordVision() { visionCount++; }

export function recordError(source, message, stack = '') {
  errors.push({
    source: String(source || 'unknown'),
    message: String(message || '').slice(0, 500),
    stack: String(stack || '').slice(0, 900),
    at: new Date().toISOString(),
  });
  if (errors.length > MAX_ERRORS) errors.shift();
  console.error(`[SelfMonitor:${source}] ${message}`);
}

export function getRecentErrors(n = 10) {
  return errors.slice(-Math.max(1, n));
}

/* ---------------- Live system status ---------------- */

export function collectSystemStatus() {
  const mem = process.memoryUsage();
  const { groqKey, geminiKey } = resolveKeys();
  const dirCheck = (d) => { try { fs.accessSync(d, fs.constants.W_OK); return true; } catch { return false; } };
  return {
    ok: true,
    name: 'JEXI OS Brain',
    uptimeSec: Math.round((Date.now() - bootTime) / 1000),
    memoryMB: { rss: Math.round(mem.rss / 1048576), heap: Math.round(mem.heapUsed / 1048576) },
    host: os.hostname(),
    node: process.version,
    port: PORT,
    keys: { groq: !!groqKey, gemini: !!geminiKey },
    providers: providerHealthSnapshot(),
    browser: browserStatus(),
    requests: { chat: chatCount, vision: visionCount },
    errors: { count: errors.length, recent: getRecentErrors(10) },
    dirs: { dataWritable: dirCheck(DATA_DIR), workspaceWritable: dirCheck(WORKSPACE_DIR) },
    timestamp: new Date().toISOString(),
  };
}

/* ---------------- Read her own source (whitelisted) ---------------- */

const SERVER_DIR = SERVER_ROOT;                     // <repo>/server
const REPO_DIR = path.resolve(SERVER_ROOT, '..');   // <repo>
const SERVER_ONLY = new Set(['index.js', 'package.json', 'Dockerfile']);
// Whitelist: backend sources, frontend sources, and a few top-level config files.
const ALLOWED = /^(server\/src\/.*\.(js|jsx|ts|tsx|md)$)|^(src\/.*\.(js|jsx|ts|tsx|css|md)$)|^(index\.js|package\.json|vite\.config\.js|tailwind\.config\.js|postcss\.config\.js|render\.yaml|Dockerfile)$/;

export function readSourceFile(relPath) {
  const clean = String(relPath || '').replace(/\\/g, '/').replace(/^\.?\//, '');
  if (clean.includes('..') || !ALLOWED.test(clean)) {
    return { ok: false, error: `Not allowed to read: ${relPath}` };
  }
  let abs;
  if (clean.startsWith('server/')) abs = path.join(SERVER_DIR, clean.slice('server/'.length));
  else if (SERVER_ONLY.has(clean)) abs = path.join(SERVER_DIR, clean);
  else abs = path.join(REPO_DIR, clean);
  if (!fs.existsSync(abs)) return { ok: false, error: `File not found: ${clean}` };
  try {
    const content = fs.readFileSync(abs, 'utf-8');
    return { ok: true, path: clean, size: content.length, content: content.slice(0, 20000) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
