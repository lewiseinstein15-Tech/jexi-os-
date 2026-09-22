/** JEXI OS — Phase 30 Scope G — ownership, schema and bounded skill updates. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SemanticaError } from '../../../semantica/_internal.js';
import skills from '../skills/index.js';

export const DEFAULT_MAX_BYTE_DELTA = 4096;

const SKILL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const clone = (value) => JSON.parse(JSON.stringify(value));

function fail(code, message, details = {}) {
  return Object.assign(new SemanticaError(code, message), details);
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

function parseFrontmatter(raw, source = '(skill)') {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) throw fail('E_INVALID_SKILL_SCHEMA', `${source}: missing Markdown frontmatter`);
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!pair) {
      if (line.trim() !== '' && !line.trimStart().startsWith('#')) {
        throw fail('E_INVALID_SKILL_SCHEMA', `${source}: malformed frontmatter line ${JSON.stringify(line)}`);
      }
      continue;
    }
    const [, key, text] = pair;
    if (Object.hasOwn(fields, key)) {
      throw fail('E_INVALID_SKILL_SCHEMA', `${source}: duplicate frontmatter key ${key}`);
    }
    if (key === 'allowedTools') fields.allowedTools = parseArray(text);
    else if (key === 'version' || key === 'maxByteDelta') {
      fields[key] = /^\d+$/.test(text) ? Number(text) : text;
    } else fields[key] = stripQuotes(text);
  }
  return { fields, body: raw.slice(match[0].length), frontmatter: match[1] };
}

function validateMetadata(raw, source, defaultMaxByteDelta) {
  const parsed = parseFrontmatter(raw, source);
  if (parsed.fields.id !== undefined && parsed.fields.name !== undefined) {
    throw fail('E_INVALID_SKILL_SCHEMA', `${source}: declare one skill identifier, not both id and name`);
  }
  const skillId = parsed.fields.id ?? parsed.fields.name;
  if (typeof skillId !== 'string' || !SKILL_ID.test(skillId)) {
    throw fail('E_INVALID_SKILL_SCHEMA', `${source}: id or name must be a valid skill id`);
  }
  if (typeof parsed.fields.owner !== 'string' || !SKILL_ID.test(parsed.fields.owner)) {
    throw fail('E_INVALID_SKILL_SCHEMA', `${source}: owner must be a valid agent id`);
  }
  if (!Number.isSafeInteger(parsed.fields.version) || parsed.fields.version < 1) {
    throw fail('E_INVALID_SKILL_SCHEMA', `${source}: version must be a positive integer`);
  }
  if (!Array.isArray(parsed.fields.allowedTools)) {
    throw fail('E_INVALID_SKILL_SCHEMA', `${source}: allowedTools must be a bracketed array`);
  }
  for (const pattern of parsed.fields.allowedTools) skills.scoping.parse(pattern);
  const declaredDelta = parsed.fields.maxByteDelta;
  if (declaredDelta !== undefined && (!Number.isSafeInteger(declaredDelta) || declaredDelta < 1)) {
    throw fail('E_INVALID_SKILL_SCHEMA', `${source}: maxByteDelta must be a positive integer when declared`);
  }
  return {
    skillId,
    owner: parsed.fields.owner,
    version: parsed.fields.version,
    allowedTools: [...parsed.fields.allowedTools],
    maxByteDelta: declaredDelta ?? defaultMaxByteDelta,
    maxByteDeltaDeclared: declaredDelta !== undefined,
    body: parsed.body,
  };
}

function inside(root, target) {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

export function resolveSkillPath(root, update) {
  const relative = update?.path ?? `${String(update?.skillId ?? '')}/SKILL.md`;
  if (typeof relative !== 'string' || relative.trim() === '') {
    throw fail('E_INVALID_SKILL_PATH', 'skill update path must be a non-empty string');
  }
  const rootPath = path.resolve(root);
  let rootReal;
  try {
    rootReal = fs.realpathSync(rootPath);
  } catch (error) {
    throw fail('E_SKILL_ROOT_UNAVAILABLE', `skill root is unavailable: ${error.code ?? error.message}`);
  }
  const absolute = path.resolve(rootPath, relative);
  if (!inside(rootPath, absolute) || path.basename(absolute) !== 'SKILL.md') {
    throw fail('E_INVALID_SKILL_PATH', `skill path must stay under the fixture root and end in SKILL.md: ${relative}`);
  }
  let real;
  try {
    real = fs.realpathSync(absolute);
  } catch (error) {
    throw fail('E_SKILL_NOT_FOUND', `skill file is unavailable: ${relative}`, { detail: error.code ?? error.message });
  }
  if (!inside(rootReal, real)) {
    throw fail('E_INVALID_SKILL_PATH', `skill path escapes the fixture root: ${relative}`);
  }
  const expectedReal = path.resolve(rootReal, path.relative(rootPath, absolute));
  if (real !== expectedReal || path.basename(real) !== 'SKILL.md') {
    throw fail('E_INVALID_SKILL_PATH', `skill path cannot traverse a symbolic link: ${relative}`);
  }
  return {
    absolute: real,
    relative: path.relative(rootReal, real).split(path.sep).join('/'),
  };
}

function boundedEditDistance(before, after, limit) {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;

  const left = before.subarray(prefix, before.length - suffix);
  const right = after.subarray(prefix, after.length - suffix);
  const maxDistance = left.length + right.length;
  const ceiling = Number.isInteger(limit) ? Math.min(limit, maxDistance) : maxDistance;
  const offset = ceiling + 1;
  const frontier = new Int32Array(ceiling * 2 + 3);
  frontier.fill(-1);
  frontier[offset + 1] = 0;

  for (let distance = 0; distance <= ceiling; distance += 1) {
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const index = offset + diagonal;
      let x;
      if (diagonal === -distance
        || (diagonal !== distance && frontier[index - 1] < frontier[index + 1])) {
        x = frontier[index + 1];
      } else {
        x = frontier[index - 1] + 1;
      }
      let y = x - diagonal;
      while (x < left.length && y < right.length && left[x] === right[y]) {
        x += 1;
        y += 1;
      }
      frontier[index] = x;
      if (x >= left.length && y >= right.length) return { distance, exact: true };
    }
  }

  const lengthChange = right.length - left.length;
  let lowerBound = Math.max(Math.abs(lengthChange), ceiling + 1);
  if (Math.abs(lowerBound - lengthChange) % 2 === 1) lowerBound += 1;
  return { distance: Math.min(lowerBound, maxDistance), exact: false };
}

export function byteDiff(before, after, limit) {
  const { distance, exact } = boundedEditDistance(before, after, limit);
  const lengthChange = after.length - before.length;
  const addedBytes = (distance + lengthChange) / 2;
  const removedBytes = (distance - lengthChange) / 2;
  return {
    beforeSha256: crypto.createHash('sha256').update(before).digest('hex'),
    afterSha256: crypto.createHash('sha256').update(after).digest('hex'),
    beforeBytes: before.length,
    afterBytes: after.length,
    addedBytes,
    removedBytes,
    totalByteDelta: distance,
    exact,
    limit,
  };
}

export function prepareUpdate(root, agentId, update, defaultMaxByteDelta) {
  const requestedSkillId = update?.skillId;
  if (update?.delete === true || update?.deleted === true || update?.remove === true
    || update?.operation === 'delete' || update?.action === 'delete' || update?.content === null) {
    throw fail('E_DELETE_NOT_ALLOWED', `skill ${JSON.stringify(requestedSkillId)} cannot be deleted`);
  }
  if (typeof requestedSkillId !== 'string' || !SKILL_ID.test(requestedSkillId)) {
    throw fail('E_INVALID_SKILL_SCHEMA', 'skillId must be a valid non-empty skill id');
  }
  if (typeof update?.content !== 'string') {
    throw fail('E_INVALID_SKILL_SCHEMA', `skill ${requestedSkillId}: content must be a string`);
  }
  if (typeof update.reason !== 'string' || update.reason.trim() === '') {
    throw fail('E_INVALID_SKILL_REASON', `skill ${requestedSkillId}: evolution reason is required`);
  }
  if (update.priority !== undefined && !Number.isSafeInteger(update.priority)) {
    throw fail('E_INVALID_SKILL_PRIORITY', `skill ${requestedSkillId}: priority must be an integer`);
  }

  const resolved = resolveSkillPath(root, update);
  const before = fs.readFileSync(resolved.absolute);
  const current = validateMetadata(before.toString('utf8'), resolved.relative, defaultMaxByteDelta);
  if (current.skillId !== requestedSkillId) {
    throw fail('E_INVALID_SKILL_SCHEMA', `${resolved.relative}: skill id ${current.skillId} does not match ${requestedSkillId}`);
  }
  if (current.owner !== agentId) {
    throw fail('E_NOT_OWNER', `agent ${agentId} does not own skill ${requestedSkillId}`, {
      agentId,
      skillId: requestedSkillId,
      owner: current.owner,
    });
  }

  const after = Buffer.from(update.content, 'utf8');
  const evolved = validateMetadata(update.content, `${resolved.relative} proposed`, defaultMaxByteDelta);
  if (evolved.skillId !== current.skillId) {
    throw fail('E_INVALID_SKILL_SCHEMA', `skill id cannot change from ${current.skillId} to ${evolved.skillId}`);
  }
  if (evolved.owner !== agentId) {
    throw fail('E_NOT_OWNER', `evolved skill ${requestedSkillId} must remain owned by ${agentId}`, {
      agentId,
      skillId: requestedSkillId,
      owner: evolved.owner,
    });
  }
  if (evolved.version !== current.version + 1) {
    throw fail('E_INVALID_SKILL_VERSION', `skill ${requestedSkillId} must evolve from version ${current.version} to ${current.version + 1}`);
  }
  if (evolved.maxByteDelta !== current.maxByteDelta
    || evolved.maxByteDeltaDeclared !== current.maxByteDeltaDeclared) {
    throw fail('E_INVALID_SKILL_SCHEMA', `skill ${requestedSkillId} cannot change its maxByteDelta guardrail`);
  }
  const diff = byteDiff(before, after, current.maxByteDelta);
  if (diff.totalByteDelta > current.maxByteDelta) {
    throw fail('E_SKILL_DELTA_EXCEEDED', `skill ${requestedSkillId} byte delta ${diff.totalByteDelta} exceeds ${current.maxByteDelta}`, {
      skillId: requestedSkillId,
      diff,
    });
  }
  return {
    skillId: requestedSkillId,
    path: resolved.absolute,
    relativePath: resolved.relative,
    reason: update.reason,
    priority: update.priority ?? 0,
    current: clone(current),
    evolved: clone(evolved),
    before,
    after,
    diff,
  };
}

export function inspectSkill(filePath, { defaultMaxByteDelta = DEFAULT_MAX_BYTE_DELTA } = {}) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return clone(validateMetadata(raw, filePath, defaultMaxByteDelta));
}
