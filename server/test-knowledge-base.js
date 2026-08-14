// B50 P2 — ALWAYS-ON KNOWLEDGE + PROGRESSIVE KNOWLEDGE LOADING.
// Proves: (1) the always-on JEXI.md is injected into every session's system
// prompt; (2) progressive knowledge folders are NOT in the always-on prompt
// and load only via knowledgeLoad(); (3) the knowledge-load tool is registered.
import { JEXI_SYSTEM_PROMPT } from './src/services/JexiPrompt.js';
import { loadProjectKnowledge, knowledgeLoad, listKnowledgeCategories } from './src/services/KnowledgeBase.js';
import { getTool } from './src/services/ToolRegistry.js';

let passed = 0;
let failed = 0;
const check = (name, ok) => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? '✅' : '❌'} ${name}`);
};

// 1. JEXI.md exists and is loaded.
const alwaysOn = loadProjectKnowledge();
check('JEXI.md loads (non-empty)', alwaysOn.length > 200);

// 2. Every session's system prompt contains the always-on knowledge.
check('system prompt contains JEXI.md "Non-negotiable rules"', JEXI_SYSTEM_PROMPT.includes('Non-negotiable rules'));
check('system prompt contains "Run tests" convention', JEXI_SYSTEM_PROMPT.includes('cd server && npm test'));

// 3. Progressive folders are NOT always-on (only pointers are).
check('system prompt does NOT include conventions body', !JEXI_SYSTEM_PROMPT.includes('Common failure classes and fixes'));
check('system prompt does NOT include architecture body', !JEXI_SYSTEM_PROMPT.includes('Where to add things'));

// 4. Progressive folders exist and load ONLY via the tool.
const cats = listKnowledgeCategories();
check('knowledge folders exist: conventions + architecture', cats.includes('conventions') && cats.includes('architecture'));
const conv = knowledgeLoad('conventions');
check('knowledgeLoad(conventions) returns content', !!conv && conv.md.includes('Common failure classes and fixes'));
const arch = knowledgeLoad('architecture');
check('knowledgeLoad(architecture) returns content', !!arch && arch.md.includes('Where to add things'));
check('knowledgeLoad(unknown) returns null', knowledgeLoad('nope') === null);
check('knowledgeLoad(path traversal) is rejected', knowledgeLoad('../../etc') === null);

// 5. The knowledge-load tool is registered for relevant agents.
const tool = getTool('knowledge-load');
check('knowledge-load tool registered', !!tool);
check('knowledge-load lists real agents', !!tool && tool.agents.length > 0);

// 6. B50 P7 — lean system prompt: procedural content moved out, prompt shrank.
check('P7: prompt is leaner than the pre-B50 baseline (12,429 chars)', JEXI_SYSTEM_PROMPT.length < 12429);
check('P7: math output template moved out (## FINAL ANSWER gone)', !JEXI_SYSTEM_PROMPT.includes('## FINAL ANSWER'));
check('P7: per-intent template moved out (## POSSIBLE IMPROVEMENTS gone)', !JEXI_SYSTEM_PROMPT.includes('## POSSIBLE IMPROVEMENTS'));
check('P7: formatting folder exists with the moved content', !!knowledgeLoad('formatting') && knowledgeLoad('formatting').md.includes('ANSWER REFRAMING METHOD'));
check('P7: formatting folder holds the per-intent templates', knowledgeLoad('formatting').md.includes('OUTPUT FORMAT BY INTENT'));
check('P7: prompt still carries the non-negotiable rules', JEXI_SYSTEM_PROMPT.includes('VERIFY BEFORE SUCCESS') && JEXI_SYSTEM_PROMPT.includes('NEVER invent sources'));

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
