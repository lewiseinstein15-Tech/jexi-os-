/**
 * JEXI OS — tools — filesystem domain.
 *
 * read, write, edit, glob, grep, ls — keyless, sandbox-bound (runtimeRing 0).
 * Destructive ops (write/edit/rm) are medium/high risk and require grants.
 */

import { defineTool } from '../../interface/ToolDefinition.js';
import { registerToolBatch } from '../../registry/ToolRegistry.js';
import fs from 'node:fs';
import path from 'node:path';

export function registerFilesystemTools(engines = {}) {
  const base = {
    read: defineTool({
      name: 'fs_read', description: 'Read a file from the workspace root.', riskLevel: 'low', runtimeRing: 0, idempotent: true,
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      sideEffects: [], failureTypes: ['not_found', 'permission_denied'],
    }),
    write: defineTool({
      name: 'fs_write', description: 'Write a file (creates parents).', riskLevel: 'medium', runtimeRing: 1,
      parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
      sideEffects: ['write'], idempotent: true,
    }),
    glob: defineTool({
      name: 'fs_glob', description: 'List files matching a pattern under a root.', riskLevel: 'low', runtimeRing: 0, idempotent: true,
      parameters: { type: 'object', properties: { root: { type: 'string' }, pattern: { type: 'string' } }, required: ['pattern'] },
    }),
    grep: defineTool({
      name: 'fs_grep', description: 'Search file contents for a regex within a root.', riskLevel: 'low', runtimeRing: 0, idempotent: true,
      parameters: { type: 'object', properties: { root: { type: 'string' }, pattern: { type: 'string' } }, required: ['pattern'] },
    }),
    ls: defineTool({
      name: 'fs_ls', description: 'List a directory.', riskLevel: 'low', runtimeRing: 0, idempotent: true,
      parameters: { type: 'object', properties: { path: { type: 'string' } } },
    }),
  };

  const unreg = registerToolBatch(Object.values(base));

  const defaultEngines = {
    fs_read: async ({ path: p }, { root = process.cwd() } = {}) => {
      const full = path.resolve(root, p);
      if (!full.startsWith(path.resolve(root))) throw new Error('path escapes root');
      return fs.readFileSync(full, 'utf8');
    },
    fs_write: async ({ path: p, content }, { root = process.cwd() } = {}) => {
      const full = path.resolve(root, p);
      if (!full.startsWith(path.resolve(root))) throw new Error('path escapes root');
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
      return { ok: true, path: full };
    },
    fs_glob: async ({ root: r = '.', pattern }) => {
      throw new Error('fs_glob requires a glob engine; pass engines.fs_glob in makeExecutor');
    },
    fs_grep: async ({ root: r = '.', pattern }) => {
      throw new Error('fs_grep requires a search engine; pass engines.fs_grep in makeExecutor');
    },
    fs_ls: async ({ path: p = '.' }, { root = process.cwd() } = {}) => {
      const full = path.resolve(root, p);
      if (!full.startsWith(path.resolve(root))) throw new Error('path escapes root');
      return fs.readdirSync(full, { withFileTypes: true }).map((e) => e.name + (e.isDirectory() ? '/' : ''));
    },
  };

  return { unreg, engines: { ...defaultEngines, ...engines } };
}