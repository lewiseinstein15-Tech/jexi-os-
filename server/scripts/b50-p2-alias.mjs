/**
 * B50 P2 — tool alias resolution. `knowledge_load` (the directive's name)
 * resolves to the registry slug `knowledge-load` so both spellings work.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

/* 1. ToolRegistry — TOOL_ALIASES export */
{
  const p = path.join(root, 'src/services/ToolRegistry.js');
  let s = fs.readFileSync(p, 'utf-8');
  const oldAnchor = 'export const TOOL_COUNT = TOOL_REGISTRY.length;';
  if (!s.includes(oldAnchor)) throw new Error('ToolRegistry anchor missing');
  s = s.split(oldAnchor).join(
    'export const TOOL_COUNT = TOOL_REGISTRY.length;\n' +
    '\n' +
    '/** B50 P2 — aliases so a tool can be called by its documented name too\n' +
    " *  (knowledge_load is the directive's name; the registry slug uses hyphens). */\n" +
    "export const TOOL_ALIASES = { knowledge_load: 'knowledge-load' };\n"
  );
  fs.writeFileSync(p, s, 'utf-8');
  console.log('[ok] ToolRegistry TOOL_ALIASES');
}

/* 2. ToolRuntime — resolve the alias at the top of executeTool */
{
  const p = path.join(root, 'src/services/ToolRuntime.js');
  let s = fs.readFileSync(p, 'utf-8');

  const impOld = "import { TOOL_REGISTRY, getTool } from './ToolRegistry.js';";
  if (!s.includes(impOld)) throw new Error('ToolRuntime import anchor missing');
  s = s.split(impOld).join("import { TOOL_REGISTRY, getTool, TOOL_ALIASES } from './ToolRegistry.js';");

  const toolOld = "  const tool = getTool(slug);\n  if (!tool) return { ok: false, error: `Unknown tool: ${slug}`, durationMs: 0 };\n  const perm = toolPermission(slug);";
  if (!s.includes(toolOld)) throw new Error('ToolRuntime tool anchor missing');
  s = s.split(toolOld).join(
    "  const realSlug = TOOL_ALIASES[slug] || slug;\n" +
    "  const tool = getTool(realSlug);\n" +
    "  if (!tool) return { ok: false, error: `Unknown tool: ${slug}`, durationMs: 0 };\n" +
    "  const perm = toolPermission(realSlug);"
  );

  const schemaOld = "  const schema = TOOL_SCHEMAS[slug] || {};";
  if (!s.includes(schemaOld)) throw new Error('schema anchor missing');
  s = s.split(schemaOld).join("  const schema = TOOL_SCHEMAS[realSlug] || {};");

  const riskOld = "  const risk = classifyRisk(slug, args);";
  if (!s.includes(riskOld)) throw new Error('risk anchor missing');
  s = s.split(riskOld).join("  const risk = classifyRisk(realSlug, args);");

  const runOld = "    const result = await withTimeout(runEngine(slug, args), 60000);";
  if (!s.includes(runOld)) throw new Error('run anchor missing');
  s = s.split(runOld).join("    const result = await withTimeout(runEngine(realSlug, args), 60000);");

  fs.writeFileSync(p, s, 'utf-8');
  console.log('[ok] ToolRuntime alias resolution');
}
console.log('B50 P2 alias edits applied.');
