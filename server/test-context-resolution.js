// Tests for conversational continuity — JEXI must never forget the thread:
//  - hasConversationalReference() detects follow-up messages that depend on
//    the prior conversation ("this course", "continue", "go on", …)
//  - conversationTranscript() builds a compact recent-thread block
//  - resolveConversationalQuery() rewrites a context-dependent message into a
//    self-contained query against the prior turns, with a deterministic
//    topic-anchor fallback when no AI key is available.
// No network, no AI calls, no writes outside a temp DATA_DIR.
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-ctx-test-'));
process.env.DATA_DIR = tmp;
process.env.WORKSPACE_DIR = path.join(tmp, 'ws');
delete process.env.GROQ_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.OPENROUTER_API_KEY;

let failures = 0;
const ok = (cond, label) => {
  if (!cond) failures++;
  console.log(`${cond ? '✅' : '❌'} ${label}`);
};

const {
  hasConversationalReference, conversationTranscript, resolveConversationalQuery,
  addChat, clearMemory,
} = await import('./src/services/MemoryManager.js');

/* ---------------- 1. anaphora detection ---------------- */
ok(hasConversationalReference('give me a roadmap for a beginner in this course'), 'detects "this course" reference');
ok(hasConversationalReference('continue building the app from where we left off'), 'detects "continue … the app"');
ok(hasConversationalReference('go on'), 'detects short continuation "go on"');
ok(hasConversationalReference('what about the second option you mentioned'), 'detects "what about … you mentioned"');
ok(hasConversationalReference('yes'), 'detects one-word continuation');
ok(hasConversationalReference('elaborate on the part about memory'), 'detects "elaborate"');
ok(!hasConversationalReference('what is the capital of France'), 'self-contained question passes through');
ok(!hasConversationalReference('build me a weather app in React'), 'new self-contained task passes through');
ok(!hasConversationalReference(''), 'empty message is not a reference');

/* ---------------- 2. no prior turns → no resolution ---------------- */
clearMemory();
const alone = await resolveConversationalQuery('give me a roadmap for a beginner in this course');
ok(alone.resolved === false, 'no prior turns → left untouched');
ok(alone.query === 'give me a roadmap for a beginner in this course', 'query unchanged with empty history');

/* ---------------- 3. self-contained query → untouched ---------------- */
addChat('user', 'What is computer science? Explain it simply.');
addChat('jexi', 'Computer science is the study of computation, algorithms and information.');
const selfContained = await resolveConversationalQuery('build me a weather app in React');
ok(selfContained.resolved === false, 'self-contained query after prior turns stays untouched');

/* ---------------- 4. transcript ---------------- */
const transcript = conversationTranscript(6);
ok(transcript.includes('computer science'), 'transcript contains the prior topic');
ok(transcript.includes('User:') && transcript.includes('JEXI:'), 'transcript labels roles');

/* ---------------- 5. deterministic anchor (no keys) ---------------- */
const followUp = await resolveConversationalQuery('give me a roadmap for a beginner in this course');
ok(followUp.resolved === true, 'context-dependent message is resolved');
ok(followUp.query.toLowerCase().includes('computer science'), `resolved query carries the prior topic ("${followUp.query}")`);
ok(followUp.query.toLowerCase().includes('roadmap'), 'resolved query keeps the user intent');
ok(followUp.original === 'give me a roadmap for a beginner in this course', 'original message is preserved in the result');

const cont = await resolveConversationalQuery('continue');
ok(cont.resolved === true && cont.query.length > 3, '"continue" resolves against the thread');

/* ---------------- 6. reference across several turns ---------------- */
addChat('user', 'What are the main data structures?');
addChat('jexi', 'Arrays, linked lists, stacks, queues, trees, hash tables and graphs.');
const acrossTurns = await resolveConversationalQuery('make a study plan for this topic');
ok(acrossTurns.resolved === true, 'references across several turns resolve');
ok(/data structures|computer science/.test(acrossTurns.query), 'resolved query is anchored to the actual topic');

clearMemory();

console.log(failures === 0
  ? '\nALL CONTEXT-RESOLUTION TESTS PASSED'
  : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
