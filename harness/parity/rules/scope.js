/** JEXI OS — Phase 30 Scope D — dependency-free path glob matching. */
import path from 'node:path';

function normalizePattern(value) {
  return String(value ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function normalizeFile(value) {
  const normalized = normalizePattern(value);
  return path.posix.normalize(normalized);
}

function escapeRegex(char) {
  return /[\\^$+?.()|{}[\]]/.test(char) ? `\\${char}` : char;
}

export function globRegex(glob) {
  const source = normalizePattern(glob);
  let pattern = '^';
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char !== '*') {
      pattern += char === '?' ? '[^/]' : escapeRegex(char);
      continue;
    }
    const double = source[index + 1] === '*';
    if (!double) {
      pattern += '[^/]*';
      continue;
    }
    index += 1;
    if (source[index + 1] === '/') {
      index += 1;
      pattern += '(?:.*/)?';
    } else {
      pattern += '.*';
    }
  }
  return new RegExp(`${pattern}$`);
}

export function globMatch(glob, filePath) {
  if (typeof glob !== 'string' || glob.trim() === '') return false;
  if (typeof filePath !== 'string' || filePath.trim() === '') return false;
  return globRegex(glob).test(normalizeFile(filePath));
}

export function matchRule(rule, filePath) {
  if (rule?.always === true) return true;
  if (!Array.isArray(rule?.globs) || filePath === undefined) return false;
  return rule.globs.some((glob) => globMatch(glob, filePath));
}
