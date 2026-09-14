/**
 * JEXI OS — LSP subsystem public API.
 *
 * A stateful runtime over real language servers: one manager spawns and tracks
 * many servers (tsserver / pyright / gopls), a router maps a file to its
 * server, and the workspace index opens source files at mission start so
 * diagnostics populate without the caller touching each one.
 *
 * Tools: diagnostics, definition, references, hover, symbols — each routes
 * through the manager. A language whose server is not installed is skipped
 * honestly (`{ available: false }`), never faked.
 */

export { LspClient, decodeMessages, encodeMessage } from './client.js';
export { LspManager, lspManager, _resetManager } from './manager.js';
export { route, serverForPath, serverStatus, _servers } from './router.js';
export { walkWorkspace, buildIndex, languageIdFor } from './index/workspace.js';
export { diagnostics, normalizeDiagnostics, severityLabel } from './tools/diagnostics.js';
export { definition, normalizeLocations } from './tools/definition.js';
export { references } from './tools/references.js';
export { hover, hoverText } from './tools/hover.js';
export { symbols, flattenSymbols, SYMBOL_KINDS } from './tools/symbols.js';
