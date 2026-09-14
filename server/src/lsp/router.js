/**
 * JEXI OS — LSP router.
 *
 * Maps a file to the language server that owns it. Each server declares the
 * extensions it handles and how to launch it. If a server's binary is not
 * installed, the route resolves to `{ available: false }` — the caller skips
 * that language gracefully instead of failing the tool call.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));

/** Walk up from a directory to the first node_modules/.bin containing `name`. */
function findBin(name, startDir = __dir) {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, 'node_modules', '.bin', name);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** True when `bin` is resolvable on PATH (no node_modules needed). */
function onPath(bin) {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const d of dirs) {
    const p = path.join(d, bin);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Language server catalog. `resolve()` returns the argv to spawn, or null when
 * the server is not installed in this environment.
 */
const SERVERS = [
  {
    id: 'typescript',
    language: 'typescript',
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
    languageId: (ext) => ({ '.ts': 'typescript', '.tsx': 'typescriptreact', '.js': 'javascript', '.jsx': 'javascriptreact', '.mjs': 'javascript', '.cjs': 'javascript' }[ext] ?? 'javascript'),
    resolve() {
      const bin = findBin('typescript-language-server');
      if (bin) return { cmd: process.execPath, args: [bin, '--stdio'] };
      const p = onPath('typescript-language-server');
      if (p) return { cmd: process.execPath, args: [p, '--stdio'] };
      return null;
    },
  },
  {
    id: 'python',
    language: 'python',
    extensions: ['.py'],
    languageId: () => 'python',
    resolve() {
      for (const bin of ['pyright-langserver', 'pylsp', 'python-lsp-server']) {
        const local = findBin(bin) || onPath(bin);
        if (!local) continue;
        if (bin === 'pyright-langserver') return { cmd: local, args: ['--stdio'] };
        return { cmd: local, args: [] };
      }
      return null;
    },
  },
  {
    id: 'go',
    language: 'go',
    extensions: ['.go'],
    languageId: () => 'go',
    resolve() {
      const p = onPath('gopls');
      if (p) return { cmd: p, args: [] };
      return null;
    },
  },
];

/** The server descriptor that owns an extension, or null. */
export function serverForPath(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  return SERVERS.find((s) => s.extensions.includes(ext)) ?? null;
}

/** The route for a file: which server, whether it is installed, and argv. */
export function route(filePath) {
  const server = serverForPath(filePath);
  if (!server) {
    return { server: null, available: false, reason: `no language server registered for ${path.extname(String(filePath || '')) || '(no extension)'}` };
  }
  const argv = server.resolve();
  if (!argv) {
    return { server: server.id, available: false, reason: `language server for ${server.language} is not installed` };
  }
  return { server: server.id, language: server.language, available: true, argv };
}

/** Every registered server with its install status — for diagnostics. */
export function serverStatus() {
  return SERVERS.map((s) => {
    const argv = s.resolve();
    return { id: s.id, language: s.language, extensions: s.extensions, installed: Boolean(argv) };
  });
}

export const _servers = SERVERS;
