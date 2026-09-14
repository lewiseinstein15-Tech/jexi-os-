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
import { registerBrowserTools } from './browser/index.js';
import { registerGitTools } from './git/index.js';
import { registerGithubTools } from './github/index.js';
import { registerTestingTools } from './testing/index.js';
import { registerDataTools } from './data/index.js';
import { registerDelegationTools } from './delegation/index.js';
import { registerLspTools } from './lsp/index.js';
import { registerCommunicationTools } from './communication/index.js';

export function registerAllDomains(extras = {}) {
  const fs = registerFilesystemTools();
  const term = registerTerminalTools();
  const web = registerWebTools();
  const mem = registerMemTools();
  const browser = registerBrowserTools();
  const git = registerGitTools();
  const github = registerGithubTools();
  const testing = registerTestingTools();
  const data = registerDataTools();
  const delegation = registerDelegationTools();
  const lsp = registerLspTools();
  const communication = registerCommunicationTools();
  return {
    unreg: () => { fs.unreg(); term.unreg(); web.unreg(); mem.unreg(); browser.unreg(); git.unreg(); github.unreg(); testing.unreg(); data.unreg(); delegation.unreg(); lsp.unreg(); communication.unreg(); },
    engines: {
      ...fs.engines,
      ...term.engines,
      ...web.engines,
      ...mem.engines,
      ...browser.engines,
      ...git.engines,
      ...github.engines,
      ...testing.engines,
      ...data.engines,
      ...delegation.engines,
      ...lsp.engines,
      ...communication.engines,
      ...extras,
    },
  };
}