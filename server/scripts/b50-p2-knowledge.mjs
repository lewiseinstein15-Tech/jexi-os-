/**
 * B50 P2 — always-on knowledge + progressive knowledge_load tool.
 * Edits: JexiPrompt.js (inject JEXI.md), ToolRegistry.js (register tool),
 * ToolRuntime.js (schema + handler + safe set), test counts (152 → 153).
 * Fail-fast on anchor mismatch.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function edit(rel, replacements) {
  const p = path.join(root, rel);
  let s = fs.readFileSync(p, 'utf-8');
  for (const { old, neu } of replacements) {
    if (!s.includes(old)) throw new Error(`[${rel}] anchor missing:\n${old.slice(0, 160)}`);
    if (s.split(old).length - 1 > 1) throw new Error(`[${rel}] anchor matched ${s.split(old).length - 1}x:\n${old.slice(0, 120)}`);
    s = s.split(old).join(neu);
  }
  fs.writeFileSync(p, s, 'utf-8');
  console.log(`[ok] ${rel}`);
}

/* 1. JexiPrompt.js — inject always-on project knowledge */
edit('src/services/JexiPrompt.js', [
  {
    old: "import { buildIdentityPrompt, JEXI_IDENTITY } from './JexiIdentity.js';\nimport { VOICE_RULES } from './Groundedness.js'; // B48 P2b/P7.3 — single source of the voice rules",
    neu: "import { buildIdentityPrompt, JEXI_IDENTITY } from './JexiIdentity.js';\nimport { VOICE_RULES } from './Groundedness.js'; // B48 P2b/P7.3 — single source of the voice rules\nimport { loadAlwaysOnKnowledge } from './KnowledgeFiles.js'; // B50 P2 — always-on project knowledge (CLAUDE.md equivalent)",
  },
  {
    old: "- Keep answers proportionate: simple questions get simple answers; complex questions get deep structure.\n`;",
    neu: "- Keep answers proportionate: simple questions get simple answers; complex questions get deep structure.\n\n# PROJECT KNOWLEDGE (always-on — short by design; progressive folders load on demand via the knowledge-load tool)\n${loadAlwaysOnKnowledge()}\n`;",
  },
]);

/* 2. ToolRegistry.js — knowledge-load tool (accepts knowledge_load alias) */
edit('src/services/ToolRegistry.js', [
  {
    old: "  { slug: 'knowledge-save', name: 'Knowledge Save', type: 'Knowledge', desc: 'Save studied topics and notes into the knowledge library.', agents: ['researcher', 'study', 'scholar', 'document-analyst'], engine: 'MemoryManager' },",
    neu: "  { slug: 'knowledge-save', name: 'Knowledge Save', type: 'Knowledge', desc: 'Save studied topics and notes into the knowledge library.', agents: ['researcher', 'study', 'scholar', 'document-analyst'], engine: 'MemoryManager' },\n  // B50 P2 — progressive knowledge folders (CLAUDE.md pattern): load a category\n  // from server/knowledge/ ONLY when the task needs it. Slug uses the registry's\n  // hyphen convention; the tool handler also accepts 'knowledge_load'.\n  { slug: 'knowledge-load', name: 'Knowledge Load', type: 'Knowledge', desc: 'Load a progressive knowledge folder (conventions, architecture, …) from server/knowledge/ — returns the full category content on demand.', agents: ['researcher', 'scholar', 'document-analyst', 'memory', 'jexi', 'context-manager'], engine: 'KnowledgeFiles' },",
  },
]);

/* 3. ToolRuntime.js — schema + handler + safe set */
edit('src/services/ToolRuntime.js', [
  {
    old: "  'knowledge-save': { category: { type: 'string', required: true, desc: 'Category folder' }, filename: { type: 'string', required: true, desc: 'File name' }, content: { type: 'string', required: true, desc: 'Content to save' } },",
    neu: "  'knowledge-save': { category: { type: 'string', required: true, desc: 'Category folder' }, filename: { type: 'string', required: true, desc: 'File name' }, content: { type: 'string', required: true, desc: 'Content to save' } },\n  'knowledge-load': { category: { type: 'string', required: true, desc: 'Knowledge category folder (conventions, architecture, …)' } },",
  },
  {
    old: "    case 'knowledge-save': {\n      await saveKnowledgeFile(args.category, args.filename, args.content);\n      return { kind: 'stored', file: `${args.category}/${args.filename}` };\n    }",
    neu: "    case 'knowledge-save': {\n      await saveKnowledgeFile(args.category, args.filename, args.content);\n      return { kind: 'stored', file: `${args.category}/${args.filename}` };\n    }\n    case 'knowledge-load':\n    case 'knowledge_load': {\n      const { knowledgeLoad } = await import('./KnowledgeFiles.js');\n      return knowledgeLoad(args.category);\n    }",
  },
  {
    old: "  'memory-recall', 'knowledge-search', 'profile-read', 'semantic-search', 'summarize-doc',\n  'video-analyze', 'video-transcript', 'data-crunch', 'stats-compute', 'self-diagnose',\n]);",
    neu: "  'memory-recall', 'knowledge-search', 'knowledge-load', 'knowledge_load', 'profile-read', 'semantic-search', 'summarize-doc',\n  'video-analyze', 'video-transcript', 'data-crunch', 'stats-compute', 'self-diagnose',\n]);",
  },
]);

/* 4. Tool-count tests: 152 → 153 */
edit('test-tools.js', [
  {
    old: "check('registry count is 152', TOOL_COUNT === 152); // +1: mcp-call (Priority 7)",
    neu: "check('registry count is 153', TOOL_COUNT === 153); // +1: mcp-call (P7), +1: knowledge-load (B50 P2)",
  },
]);
edit('test-b49.js', [
  {
    old: "check('P1: 206 agents · 492 skills · 152 tools', report.counts.agents === 206 && report.counts.skills === 492 && report.counts.tools === 152);",
    neu: "check('P1: 206 agents · 492 skills · 153 tools', report.counts.agents === 206 && report.counts.skills === 492 && report.counts.tools === 153);",
  },
]);

console.log('B50 P2 edits applied.');
