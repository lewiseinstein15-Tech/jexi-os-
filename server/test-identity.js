/**
 * JEXI OS — identity regression suite.
 * JEXI must always know her name, who built her, and what she can do —
 * deterministically, with no AI key required.
 */

import { JEXI_IDENTITY, IDENTITY_ANSWER, buildCapabilityLines, buildLimitationLines, buildIdentityPrompt } from './src/services/JexiIdentity.js';

let passed = 0;
let failed = 0;
const ok = (cond, name) => {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
};

console.log('\n== Identity facts ==');
ok(JEXI_IDENTITY.name === 'JEXI', 'name is JEXI');
ok(JEXI_IDENTITY.fullName === 'JEXI OS', 'full name is JEXI OS');
ok(JEXI_IDENTITY.createdBy && JEXI_IDENTITY.createdBy.length > 0, 'creator is set');
ok(JEXI_IDENTITY.createdBy === 'Lewis Einstein', 'creator is Lewis Einstein');
ok(JEXI_IDENTITY.tagline && JEXI_IDENTITY.tagline.length > 20, 'tagline present');

console.log('\n== Deterministic answer (no keys needed) ==');
ok(IDENTITY_ANSWER.includes('JEXI OS'), 'answer names JEXI OS');
ok(IDENTITY_ANSWER.includes('Lewis Einstein'), 'answer names the creator');
ok(IDENTITY_ANSWER.includes('created by'), 'answer says who built her');
ok(/specialist agent/.test(IDENTITY_ANSWER), 'answer mentions the agent roster');

console.log('\n== Live capabilities ==');
const caps = buildCapabilityLines();
ok(Array.isArray(caps) && caps.length >= 3, 'capability lines generated from registries');
ok(caps.some((l) => /Total: \d+ specialist agents/.test(l)), 'capability totals match the live registries');

console.log('\n== Honest limitations ==');
const limits = buildLimitationLines();
ok(Array.isArray(limits) && limits.length >= 3, 'limitations generated from real guardrails');
ok(limits.some((l) => /RiskGuard/.test(l)), 'limitations mention the real risk gate');

console.log('\n== System-prompt embedding ==');
const prompt = buildIdentityPrompt();
ok(prompt.includes('You are **JEXI OS**'), 'system prompt embeds identity');
ok(prompt.includes('WHO BUILT YOU: Lewis Einstein'), 'system prompt names the builder');
ok(prompt.includes('WHAT YOU CAN DO'), 'system prompt lists capabilities');
ok(prompt.includes('WHAT YOU WON\'T DO'), 'system prompt lists limitations');

console.log('\n== B103 — normal-mode prompt carries the SAME identity ==');
const { JEXI_NORMAL_PROMPT, JEXI_SYSTEM_PROMPT, IDENTITY_QUESTION_RE } = await import('./src/services/JexiPrompt.js');
ok(JEXI_NORMAL_PROMPT.includes('You are **JEXI OS**'), 'normal prompt embeds the canonical identity');
ok(JEXI_NORMAL_PROMPT.includes('WHO BUILT YOU: Lewis Einstein'), 'normal prompt names the builder');
ok(JEXI_NORMAL_PROMPT.includes('WHAT YOU CAN DO'), 'normal prompt lists live capabilities');
ok(JEXI_NORMAL_PROMPT.includes('WHAT YOU WON\'T DO'), 'normal prompt lists real limitations');
ok(/ANSWER THE QUESTION|answer the user's question directly/i.test(JEXI_NORMAL_PROMPT), 'normal prompt answers directly');
ok(JEXI_NORMAL_PROMPT.includes('Agent mode') && !/say you can do it in Agent mode/.test(JEXI_NORMAL_PROMPT), 'normal prompt offers Agent mode honestly, does not deflect every question');
ok(JEXI_SYSTEM_PROMPT.includes('ANSWER QUESTIONS DIRECTLY'), 'agent prompt has the question-vs-task rule');
ok(JEXI_SYSTEM_PROMPT.includes('Questions about you'), 'agent prompt answers identity from the IDENTITY section');

console.log('\n== B103 — deterministic identity-question detection ==');
const MATCHES = [
  'who are you', 'who is jexi', 'what are you', 'what is jexi', 'what are u',
  'who built you', 'what created you', 'who made you', 'tell me about yourself',
  'introduce yourself', 'what can you do', 'what are you capable of', 'what do you do',
  'what is your name', 'what is your purpose', 'your name?', 'are you an ai',
  'are you a robot', 'are you real', 'how do you work', 'Who are you?',
];
for (const q of MATCHES) ok(IDENTITY_QUESTION_RE.test(q), `matches: "${q}"`);
const REJECTS = [
  'what can you do about my roof leaking', 'who are you going to vote for',
  'what are you doing', 'who is your friend', 'what can you do for me today',
  'tell me about yourself and your family', 'who built the pyramids',
];
for (const q of REJECTS) ok(!IDENTITY_QUESTION_RE.test(q), `rejects: "${q}"`);

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
