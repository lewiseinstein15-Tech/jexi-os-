// Capability/Code — node label registry (CBM codebase-memory-mcp graph model).
// Labels: Function, Class, File, Route, Resource, Module.
import * as functionNode from './function.js';
import * as classNode from './class.js';
import * as fileNode from './file.js';
import * as routeNode from './route.js';
import * as resourceNode from './resource.js';
import * as moduleNode from './module.js';

export const NODE_LABELS = {
  FUNCTION: functionNode.LABEL,
  CLASS: classNode.LABEL,
  FILE: fileNode.LABEL,
  ROUTE: routeNode.LABEL,
  RESOURCE: resourceNode.LABEL,
  MODULE: moduleNode.LABEL,
};

const CREATORS = {
  [functionNode.LABEL]: functionNode.create,
  [classNode.LABEL]: classNode.create,
  [fileNode.LABEL]: fileNode.create,
  [routeNode.LABEL]: routeNode.create,
  [resourceNode.LABEL]: resourceNode.create,
  [moduleNode.LABEL]: moduleNode.create,
};

/** Normalized node record: { label, name, qualname, file, line, endLine, language, props } */
export function makeNode(label, spec) {
  const create = CREATORS[label];
  if (!create) throw new Error(`unknown node label: ${label}`);
  return create(spec);
}
