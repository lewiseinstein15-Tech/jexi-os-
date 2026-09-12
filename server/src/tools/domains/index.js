/**
 * JEXI OS — tools — domain registry.
 *
 * Domain modules each register their ToolDefinitions and expose executors.
 * `registerAllDomains()` wires every domain's tool definitions + engines so a
 * single executor serves the full catalog. Kept keyless for deterministic
 * tests; real JEXI engines can be injected via engines override.
 */

import { registerFilesystemTools } from './filesystem/index.js';
import { registerTerminalTools } from './terminal/index.js';
import { registerWebTools } from './web/index.js';
import { registerMemTools } from './memory/index.js';

export function registerAllDomains(extras = {}) {
  const fs = registerFilesystemTools();
  const term = registerTerminalTools();
  const web = registerWebTools();
  const mem = registerMemTools();
  return {
    unreg: () => { fs.unreg(); term.unreg(); web.unreg(); mem.unreg(); },
    engines: {
      ...fs.engines,
      ...term.engines,
      ...web.engines,
      ...mem.engines,
      ...extras,
    },
  };
}