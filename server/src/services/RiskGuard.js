/**
 * JEXI OS — Risk Guard (roadmap stage 17: sandbox + folder-trust + risk
 * classification).
 *
 * The ToolRuntime already classifies tools statically (safe / medium / risky
 * slugs). This layer classifies the CALL — the actual arguments — so a
 * "safe-ish" medium tool used destructively still gets caught:
 *
 *   - code-run with `rm -rf /`  → HIGH, blocked
 *   - code-write escaping the workspace (`../../etc/passwd`) → HIGH, blocked
 *   - curl | sh, sudo, git push --force, key exfiltration → HIGH
 *
 * Fail-open by default (like hooks): nothing is blocked unless the call is
 * HIGH risk AND not covered by an explicit trust decision. Trust decisions
 * (allow / deny patterns) persist to DATA_DIR/trust.json — the folder-trust
 * model from Grok Build's verified `trusted_folders.toml`.
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR, WORKSPACE_DIR } from '../config.js';

const FILE = path.join(DATA_DIR, 'trust.json');
const DEFAULT_POLICY = { mode: 'sandbox' }; // sandbox = block HIGH untrusted calls

let store = load();

function load() {
  try {
    if (fs.existsSync(FILE)) {
      const parsed = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
      if (parsed && typeof parsed === 'object') {
        return {
          mode: parsed.mode || DEFAULT_POLICY.mode,
          allowed: Array.isArray(parsed.allowed) ? parsed.allowed : [],
          denied: Array.isArray(parsed.denied) ? parsed.denied : [],
          trustedFolders: Array.isArray(parsed.trustedFolders) ? parsed.trustedFolders : [],
        };
      }
    }
  } catch (e) { /* fresh */ }
  return { mode: DEFAULT_POLICY.mode, allowed: [], denied: [], trustedFolders: [] };
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch (e) { console.error('[RiskGuard] persist error:', e.message); }
}

/* ------------------------------------------------------------------ */
/* Risk patterns — classified from the actual call arguments.          */
/* ------------------------------------------------------------------ */
const HIGH_PATTERNS = [
  // Filesystem destruction
  { re: /\brm\s+(-[a-z]*[rf][a-z]*\s+)?\/(\s|$)/i, reason: 'destructive rm targeting the filesystem root' },
  { re: /\brm\s+-[a-z]*[rf][a-z]*\b/i, reason: 'recursive force delete (rm -rf)' },
  { re: /\bmkfs(\.\w+)?\b/, reason: 'filesystem format' },
  { re: /\bdd\s+if=/, reason: 'raw device write (dd if=)' },
  { re: /\bchmod\s+-R\s+[0-7]{3}\s+(\/|\$HOME|\.)/, reason: 'recursive permission rewrite on a broad path' },
  { re: /\bchown\s+-R\b/, reason: 'recursive ownership change' },
  // System control
  { re: /\bshutdown\b|\breboot\b|\binit\s+0\b|\bpoweroff\b/, reason: 'system shutdown / reboot' },
  { re: /\bsudo\b/, reason: 'elevated privilege execution' },
  { re: /^:\(\)/, reason: 'fork bomb' },
  // Pipe-to-shell (classic malware vector)
  { re: /\b(curl|wget)\b[^|;\n]*\|\s*(ba)?sh\b/i, reason: 'downloading and executing a remote script (curl|sh)' },
  { re: /\b(base64|xxd|openssl)\b[^|;\n]*\|/, reason: 'decoding/encoding pipeline (possible exfiltration)' },
  // Credential touch
  { re: /(cat|type|less|head|tail|grep)\s+[^\n;]*\.ssh\b/i, reason: 'reading SSH credentials' },
  { re: /\bcat\s+[^\n;]*(\.env|\.netrc|id_rsa|\.pem)\b/i, reason: 'reading secret files' },
  { re: /\bexport\s+[A-Z_]*KEY[A-Z_]*=|printenv\b/, reason: 'dumping environment secrets' },
  // Git history rewrite
  { re: /\bgit\s+(push\s+--force|push\s+-f\b|reset\s+--hard|filter-branch|clean\s+-f)/i, reason: 'force push / history rewrite' },
  // Network exfiltration of local data
  { re: /\bcurl\b[^\n;]*\b(-d|--data|--data-raw|--upload-file|--form)\b/i, reason: 'sending data to a remote endpoint' },
  { re: /\bnc\s+-l\b|\bncat\b/, reason: 'listening socket / netcat' },
];

const MEDIUM_PATTERNS = [
  { re: /\bgit\s+(push|pull|fetch|clone)\b/i, reason: 'network git operation' },
  { re: /\bnpm\s+(install|i|add|uninstall)\b/i, reason: 'installing packages' },
  { re: /\b(pip|bun|yarn|pnpm)\s+(install|add|i|remove)\b/i, reason: 'installing packages' },
  { re: /\bkill\b|\bpkill\b|\bkillall\b/, reason: 'terminating processes' },
  { re: /\bmv\b|\brm\b/i, reason: 'moving or deleting files' },
  { re: /\bsed\s+-i\b/, reason: 'in-place file rewrite' },
  { re: /\bchmod\b|\bchown\b/, reason: 'changing permissions' },
  { re: /--force|-f\b/, reason: 'force flag' },
];

/** Classify a shell command string. Returns { level, reasons[] }. */
export function classifyCommand(command) {
  const c = String(command || '');
  const reasons = [];
  for (const p of HIGH_PATTERNS) {
    if (p.re.test(c)) reasons.push(p.reason);
  }
  if (reasons.length) return { level: 'high', reasons };
  const medium = [];
  for (const p of MEDIUM_PATTERNS) {
    if (p.re.test(c)) medium.push(p.reason);
  }
  return medium.length ? { level: 'medium', reasons: medium } : { level: 'low', reasons: [] };
}

/** Check a filename for escaping the workspace root. */
export function pathEscapesWorkspace(filename) {
  const f = String(filename || '');
  if (!f) return false;
  const norm = f.split('\\').join('/');
  const resolved = path.resolve(WORKSPACE_DIR, norm);
  return resolved !== WORKSPACE_DIR && !resolved.startsWith(WORKSPACE_DIR + path.sep);
}

/**
 * Classify a tool call end-to-end.
 * Returns { level, reasons[], canRun, blocked } — blocked only when HIGH
 * and not covered by an explicit allow decision.
 */
export function classifyRisk(slug, args = {}) {
  const reasons = [];
  let level = 'low';

  const cmd = String(args.command || args.query || args.url || '');
  if (slug === 'code-run' && cmd) {
    const r = classifyCommand(cmd);
    level = r.level;
    reasons.push(...r.reasons);
  }

  if (slug === 'code-write' && pathEscapesWorkspace(args.filename)) {
    level = 'high';
    reasons.push(`path escapes the workspace sandbox: "${args.filename}"`);
  }

  if ((slug === 'web-search' || slug === 'deep-read') && /(key|token|secret|password)=/i.test(cmd)) {
    reasons.push('query embeds what looks like a secret');
    level = level === 'high' ? 'high' : 'medium';
  }

  const risk = { level, reasons };

  // Explicit deny always blocks.
  if (store.denied.some((p) => matches(p, slug, args))) {
    return { ...risk, canRun: false, blocked: 'denied', reason: 'blocked by an explicit deny decision' };
  }
  // Explicit allow overrides HIGH classification.
  if (store.allowed.some((p) => matches(p, slug, args))) {
    return { ...risk, canRun: true, blocked: null, reason: 'covered by an explicit allow decision' };
  }
  // HIGH + sandbox mode = blocked.
  if (risk.level === 'high' && store.mode === 'sandbox') {
    return { ...risk, canRun: false, blocked: 'risk', reason: reasons[0] || 'high-risk call' };
  }
  return { ...risk, canRun: true, blocked: null, reason: null };
}

function matches(entry, slug, args) {
  if (!entry || typeof entry !== 'object') return false;
  if (entry.slug && entry.slug !== slug) return false;
  if (entry.pattern) {
    try { return new RegExp(entry.pattern, 'i').test(String(args.command || args.query || args.url || '')); }
    catch (e) { return false; }
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Trust management                                                    */
/* ------------------------------------------------------------------ */
export function trustStatus() {
  return {
    mode: store.mode,
    workspace: WORKSPACE_DIR,
    allowed: [...store.allowed],
    denied: [...store.denied],
    trustedFolders: [...store.trustedFolders],
    policy: 'sandbox mode: HIGH-risk calls are blocked unless explicitly allowed',
  };
}

export function setTrustMode(mode) {
  if (!['sandbox', 'ask', 'off'].includes(mode)) throw new Error(`Unknown trust mode: ${mode}`);
  store.mode = mode;
  persist();
  return trustStatus();
}

/** Allow a slug/pattern pair — future identical calls skip HIGH blocking. */
export function allowPattern({ slug, pattern, note = '' }) {
  const entry = { id: `a-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`, slug, pattern, note, at: Date.now() };
  store.allowed.push(entry);
  persist();
  return trustStatus();
}

export function denyPattern({ slug, pattern, note = '' }) {
  const entry = { id: `d-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`, slug, pattern, note, at: Date.now() };
  store.denied.push(entry);
  persist();
  return trustStatus();
}

export function removeDecision(id) {
  store.allowed = store.allowed.filter((e) => e.id !== id);
  store.denied = store.denied.filter((e) => e.id !== id);
  persist();
  return trustStatus();
}

export function clearTrust() {
  store.allowed = [];
  store.denied = [];
  store.trustedFolders = [];
  persist();
  return trustStatus();
}

/** Folder-trust: mark a folder as trusted (mirrors Grok's trusted_folders). */
export function trustFolder(folder) {
  const f = String(folder || '').trim();
  if (f && !store.trustedFolders.includes(f)) {
    store.trustedFolders.push(f);
    persist();
  }
  return trustStatus();
}
