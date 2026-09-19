/**
 * JEXI OS — Phase 17 Scope E — CONTEXT FILESYSTEM / URI (viking://).
 *
 *   viking://{scope}/{path}
 *   scopes: resources | user | agent | session
 *
 * Pure parse/build/validate — no I/O. Errors carry machine codes:
 *   E_INVALID_URI     not a viking:// URI
 *   E_INVALID_SCOPE   scope not in the four above
 *   E_EMPTY_PATH      scope present but no path (for calls needing one)
 *   E_PATH_TRAVERSAL  path tries to escape (`..`, absolute, drive letters)
 */

export const VIKING_SCOPES = Object.freeze(['resources', 'user', 'agent', 'session']);
const SCOPE_RE = /^[a-z][a-z0-9-]*$/;

/** Parse a viking:// URI into { scope, path } (path '' = scope root). */
export function parseUri(uri) {
  if (typeof uri !== 'string' || !uri.startsWith('viking://')) {
    const e = new Error(`parseUri: not a viking:// URI: ${JSON.stringify(uri && uri.slice(0, 40))}`);
    e.code = 'E_INVALID_URI';
    throw e;
  }
  let rest = uri.slice('viking://'.length);
  const q = rest.indexOf('?');
  if (q !== -1) rest = rest.slice(0, q); // query strings are not part of the identity
  const slash = rest.indexOf('/');
  const rawScope = slash === -1 ? rest : rest.slice(0, slash);
  let rawPath = slash === -1 ? '' : rest.slice(slash + 1);
  if (!SCOPE_RE.test(rawScope)) {
    const e = new Error(`parseUri: invalid scope ${JSON.stringify(rawScope)} — expected one of ${VIKING_SCOPES.join(', ')}`);
    e.code = 'E_INVALID_SCOPE';
    throw e;
  }
  if (!VIKING_SCOPES.includes(rawScope)) {
    const e = new Error(`parseUri: unknown scope ${JSON.stringify(rawScope)} — expected one of ${VIKING_SCOPES.join(', ')}`);
    e.code = 'E_INVALID_SCOPE';
    throw e;
  }
  const path = normalizePath(rawPath);
  return { scope: rawScope, path };
}

/** Normalize a raw path: strip slashes, collapse repeats, forbid traversal. */
export function normalizePath(rawPath) {
  const segments = String(rawPath || '')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const seg of segments) {
    if (seg === '.' || seg === '..' || /[:\\]/.test(seg) || seg.startsWith('.')) {
      const e = new Error(`normalizePath: unsafe path segment ${JSON.stringify(seg)} in ${JSON.stringify(rawPath)}`);
      e.code = 'E_PATH_TRAVERSAL';
      throw e;
    }
  }
  return segments.join('/');
}

/** Build a viking:// URI from { scope, path }. Validates both parts. */
export function buildUri({ scope, path = '' }) {
  const normalized = normalizePath(path);
  if (!VIKING_SCOPES.includes(scope)) {
    const e = new Error(`buildUri: invalid scope ${JSON.stringify(scope)}`);
    e.code = 'E_INVALID_SCOPE';
    throw e;
  }
  return normalized ? `viking://${scope}/${normalized}` : `viking://${scope}`;
}

/** Parent URI ({scope, path} of the directory holding this one). */
export function parentUri(uri) {
  const { scope, path } = parseUri(uri);
  if (!path) return null; // scope root has no parent
  const parts = path.split('/');
  return buildUri({ scope, path: parts.slice(0, -1).join('/') });
}

/** Base name (last segment). Scope root → scope name. */
export function baseName(uri) {
  const { scope, path } = parseUri(uri);
  return path ? path.split('/').pop() : scope;
}

/** Join a child name onto a URI (string in, string out). */
export function joinUri(uri, name) {
  const { scope, path } = parseUri(uri);
  const child = normalizePath(name);
  if (!child || child.includes('/')) {
    const e = new Error(`joinUri: child must be a single safe segment: ${JSON.stringify(name)}`);
    e.code = 'E_PATH_TRAVERSAL';
    throw e;
  }
  return buildUri({ scope, path: path ? `${path}/${child}` : child });
}

export default { VIKING_SCOPES, parseUri, normalizePath, buildUri, parentUri, baseName, joinUri };
