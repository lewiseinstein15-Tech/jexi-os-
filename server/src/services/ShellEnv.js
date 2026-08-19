/**
 * B136 — SHELL ENV (DeepSeek Harness `packages/shell/shell-env` mirror,
 * JEXI-branded).
 *
 * The canonical environment handed to shells (persistent bash, terminal
 * sessions, subprocesses): the parent environment SCRUBBED of secrets by
 * name pattern (keys/tokens/passwords/secrets), plus JEXI identity vars so
 * the shell knows which workspace/session it belongs to. A secret name that
 * sneaks through the pattern list is removed by the value shape check
 * (long high-entropy values are dropped too) — fail-closed on secrets.
 */

import path from 'path';
import { DATA_DIR, WORKSPACE_DIR } from '../config.js';

const SECRET_NAME_PATTERNS = [
  /(^|_)(API[_-]?KEY|KEY|TOKEN|SECRET|PASSWORD|PASSWD|AUTH|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|CREDENTIALS?)(_|$)/i,
  /^(JEXI_API_KEY|GITHUB_TOKEN|GH_TOKEN|OPENAI_API_KEY|GROQ_API_KEY|GEMINI_API_KEY|ANTHROPIC_API_KEY|DEEPSEEK_API_KEY|XAI_API_KEY|OPENROUTER_API_KEY|REDIS_URL|DATABASE_URL|PGPASSWORD|FIREBASE.*|GOOGLE_APPLICATION_CREDENTIALS.*)$/,
  /JWT|BEARER/i,
];

const SECRET_VALUE_SHAPES = [
  /^[A-Za-z0-9_\-.]{32,}$/,          // long high-entropy blob
  /^ghp_[A-Za-z0-9]{20,}$/,          // GitHub PAT
  /^github_pat_/,                     // fine-grained PAT
  /^sk-[A-Za-z0-9]{16,}$/,            // OpenAI-style
  /^AIza[0-9A-Za-z_-]{20,}$/,        // Google API key
  /^Bearer\s+/,
];

/** Whether a name+value pair looks like a secret (fail-closed: drop it). */
export function looksLikeSecret(name, value) {
  if (SECRET_NAME_PATTERNS.some((re) => re.test(name))) return true;
  if (typeof value === 'string' && SECRET_VALUE_SHAPES.some((re) => re.test(value))) return true;
  return false;
}

/**
 * Build the scrubbed shell environment.
 * @param {object} o { extra, convId, keep }
 */
export function shellEnv({ extra = {}, convId = null } = {}) {
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (looksLikeSecret(name, value)) continue;
    env[name] = value;
  }
  // JEXI identity vars (never secrets, always present for the shell).
  env.JEXI_WORKSPACE = path.resolve(WORKSPACE_DIR || process.cwd());
  env.JEXI_DATA_DIR = DATA_DIR;
  env.JEXI_SHELL = '1';
  if (convId) env.JEXI_SESSION = String(convId).slice(0, 80);
  // Explicit caller entries win over the scrubbed base.
  for (const [name, value] of Object.entries(extra)) {
    if (value === undefined) delete env[name];
    else env[name] = String(value);
  }
  return env;
}

/** dsh subprocess parity name: the scrubbed parent environment. */
export function scrubbedParentEnv() {
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (looksLikeSecret(name, value)) continue;
    env[name] = value;
  }
  return env;
}

/** Which ambient names were dropped (diagnostics, never values). */
export function scrubbedNames() {
  const out = [];
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && looksLikeSecret(name, value)) out.push(name);
  }
  return out;
}
