/** JEXI OS — Phase 30 Scope D — rule schema, loader and Phase 25 bridge. */
import fs from 'node:fs';
import path from 'node:path';
import { SemanticaError } from '../../../services/semantica/_internal.js';
import instructions from '../../../capabilities/prompts/sections/08-instructions.js';
import { matchRule } from './scope.js';

export const DEFAULT_TOKEN_BUDGET = 4000;
const RULES_DIR = '.claude/rules';

let activeRules = Object.freeze([]);
let activeBudget = DEFAULT_TOKEN_BUDGET;

const byOrder = (a, b) => b.priority - a.priority
  || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function estimateTokens(content) {
  return Math.ceil(Buffer.byteLength(String(content ?? ''), 'utf8') / 4);
}

function stripQuotes(value) {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'")))) return value.slice(1, -1);
  return value;
}

function parseArray(value) {
  if (!value.startsWith('[') || !value.endsWith(']')) return null;
  const inner = value.slice(1, -1).trim();
  if (!inner) return [];
  const out = [];
  let token = '';
  let quote = null;
  for (const char of inner) {
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? null : char;
      token += char;
      continue;
    }
    if (char === ',' && !quote) {
      out.push(stripQuotes(token.trim()));
      token = '';
      continue;
    }
    token += char;
  }
  if (quote) return null;
  out.push(stripQuotes(token.trim()));
  return out.every((item) => item !== '') ? out : null;
}

function parseMetadata(frontmatter) {
  const meta = {};
  const lines = frontmatter.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const pair = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(lines[index]);
    if (!pair) continue;
    const [, key, text] = pair;
    if (key === 'always') meta.always = text === 'true' ? true : text === 'false' ? false : text;
    else if (key === 'priority') meta.priority = /^-?\d+$/.test(text) ? Number(text) : text;
    else if (key === 'globs' && text !== '') meta.globs = parseArray(text);
    else if (key === 'globs') {
      const globs = [];
      while (index + 1 < lines.length) {
        const item = /^\s+-\s*(.+?)\s*$/.exec(lines[index + 1]);
        if (!item) break;
        globs.push(stripQuotes(item[1]));
        index += 1;
      }
      meta.globs = globs;
    }
  }
  return meta;
}

function parseRule(relativePath, raw) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  const meta = match ? parseMetadata(match[1]) : {};
  const content = match ? raw.slice(match[0].length) : raw;
  return {
    path: relativePath,
    content,
    priority: meta.priority ?? 0,
    always: meta.always ?? false,
    globs: meta.globs ?? [],
    source: 'claude-rule',
    tokens: estimateTokens(content),
    frontmatter: !!match,
  };
}

function error(code, field, message) {
  return { code, field, message };
}

export function validate(rule) {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
    return { valid: false, errors: [error('E_INVALID_RULE', null, 'rule must be an object')] };
  }
  const errors = [];
  if (typeof rule.path !== 'string' || rule.path.trim() === '') {
    errors.push(error('E_INVALID_RULE', 'path', 'path must be a non-empty string'));
  }
  if (typeof rule.content !== 'string') {
    errors.push(error('E_INVALID_RULE', 'content', 'content must be a string'));
  }
  if (rule.priority !== undefined && !Number.isInteger(rule.priority)) {
    errors.push(error('E_INVALID_RULE', 'priority', 'priority must be an integer when present'));
  }
  if (rule.always !== undefined && typeof rule.always !== 'boolean') {
    errors.push(error('E_INVALID_RULE', 'always', 'always must be boolean when present'));
  }
  if (rule.globs !== undefined && !Array.isArray(rule.globs)) {
    errors.push(error('E_INVALID_RULE', 'globs', 'globs must be an array when present'));
  } else if (Array.isArray(rule.globs)
    && rule.globs.some((glob) => typeof glob !== 'string' || glob.trim() === '')) {
    errors.push(error('E_INVALID_RULE', 'globs', 'every glob must be a non-empty string'));
  }

  const always = rule.always === true;
  const pathScoped = Array.isArray(rule.globs) && rule.globs.length > 0;
  if (always && pathScoped) {
    errors.push(error('E_AMBIGUOUS_RULE_SCOPE', 'scope', 'rule cannot declare both always:true and non-empty globs'));
  } else if (!always && !pathScoped) {
    errors.push(error('E_MISSING_RULE_SCOPE', 'scope', 'rule must declare always:true or non-empty globs'));
  }
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

export function scope(rule) {
  const result = validate(rule);
  if (!result.valid) {
    const issue = result.errors.find((entry) => entry.code === 'E_AMBIGUOUS_RULE_SCOPE')
      ?? result.errors.find((entry) => entry.code === 'E_MISSING_RULE_SCOPE')
      ?? result.errors[0];
    throw new SemanticaError(issue.code, `${rule?.path ?? '(unknown rule)'}: ${issue.message}`);
  }
  return rule.always === true
    ? { mode: 'always' }
    : { mode: 'path', globs: [...rule.globs] };
}

export function match(rule, filePath) {
  scope(rule);
  return matchRule(rule, filePath);
}

function walkMarkdown(dir, root, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkMarkdown(full, root, out);
    else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  }
  return out;
}

function phase25Rules(root) {
  const entries = instructions.walk(root);
  return [...entries].map((entry) => ({
    path: entry.path,
    content: entry.content,
    priority: 0,
    always: true,
    globs: [],
    source: 'phase25-agents',
    tokens: estimateTokens(entry.content),
    frontmatter: false,
  }));
}

function validBudget(value) {
  return Number.isInteger(value) && value > 0;
}

export function load(root, options = {}) {
  const resolvedRoot = path.resolve(root);
  const budget = options.tokenBudget === undefined ? DEFAULT_TOKEN_BUDGET : options.tokenBudget;
  if (!validBudget(budget)) {
    throw new SemanticaError('E_INVALID_RULE_BUDGET', `tokenBudget must be a positive integer; got ${String(budget)}`);
  }

  const agentsRules = phase25Rules(resolvedRoot);
  const consumed = new Set(agentsRules.map((rule) => rule.path));
  const nativeRules = [];
  for (const relativePath of walkMarkdown(path.join(resolvedRoot, RULES_DIR), resolvedRoot)) {
    if (path.posix.basename(relativePath) === instructions.AGENTS_FILE || consumed.has(relativePath)) continue;
    const rule = parseRule(relativePath, fs.readFileSync(path.join(resolvedRoot, relativePath), 'utf8'));
    const checked = validate(rule);
    if (!checked.valid) {
      const issue = checked.errors.find((entry) => entry.code === 'E_AMBIGUOUS_RULE_SCOPE')
        ?? checked.errors.find((entry) => entry.code === 'E_MISSING_RULE_SCOPE')
        ?? checked.errors[0];
      throw new SemanticaError(issue.code, `${relativePath}: ${issue.message}`);
    }
    nativeRules.push(rule);
  }

  const combined = [...agentsRules, ...nativeRules].sort(byOrder);
  activeRules = Object.freeze(combined.map((rule) => Object.freeze({
    ...rule,
    globs: Object.freeze([...rule.globs]),
  })));
  activeBudget = budget;
  return combined.map(clone);
}

export function snapshot() {
  return activeRules.map(clone);
}

export function tokenBudget() {
  return activeBudget;
}
