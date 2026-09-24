// Phase 11 Scope B — CBM tool domain registration.
//
// Registers the 15 CBM tools into the REAL ToolRegistry
// (server/src/tools/registry/ToolRegistry.js) via registerToolBatch, and
// exposes an engines map in the same shape as every server domain module
// ({ unreg, engines }) so they flow through the same executor pipeline
// (schema → permission → risk → engine) used by runToolCalls/domainDispatch.
//
// Registration line is below — `registerToolBatch(defs)`.

import { registerToolBatch, hasTool } from '../../../server/src/tools/registry/ToolRegistry.js';
import * as indexRepository from './index-repository.tool.js';
import * as listProjects from './list-projects.tool.js';
import * as deleteProject from './delete-project.tool.js';
import * as indexStatus from './index-status.tool.js';
import * as checkIndexCoverage from './check-index-coverage.tool.js';
import * as searchGraph from './search-graph.tool.js';
import * as searchCode from './search-code.tool.js';
import * as tracePath from './trace-path.tool.js';
import * as queryGraph from './query-graph.tool.js';
import * as getGraphSchema from './get-graph-schema.tool.js';
import * as getCodeSnippet from './get-code-snippet.tool.js';
import * as getArchitecture from './get-architecture.tool.js';
import * as manageAdr from './manage-adr.tool.js';
import * as ingestTraces from './ingest-traces.tool.js';
import * as detectChanges from './detect-changes.tool.js';

const TOOL_MODULES = [
  indexRepository, listProjects, deleteProject, indexStatus,
  checkIndexCoverage, searchGraph, searchCode, tracePath, queryGraph,
  getGraphSchema, getCodeSnippet, getArchitecture, manageAdr, ingestTraces,
  detectChanges,
];

export const CBM_TOOL_NAMES = TOOL_MODULES.map((m) => m.def.name);

export function registerCbmTools() {
  const defs = TOOL_MODULES.map((m) => m.def);
  const unreg = registerToolBatch(defs); // ← registration into the real ToolRegistry
  const engines = Object.fromEntries(TOOL_MODULES.map((m) => [m.def.name, m.handler]));
  return { unreg, engines, defs };
}

/** True when every CBM tool is present in the real registry. */
export function allRegistered() {
  return CBM_TOOL_NAMES.every((n) => hasTool(n));
}
