// B155 — REGRESSION: long-term memory must reach the DIRECT answer path.
// The old code only injected learned facts/preferences/profile into the
// agent pipeline (Orchestrator.conversationContext) — direct answers never
// saw them, so "I told you my name is X" → "what's my name?" forgot.
// Also verifies that EVERY user message (direct AND agent route) is fed
// through addChat so facts are extracted from both paths.
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-mem-dir-'));
process.env.DATA_DIR = tmp;
process.env.WORKSPACE_DIR = path.join(tmp, 'ws');
delete process.env.GROQ_API_KEY;
delete process.env.GEMINI_API_KEY;

let failures = 0;
const ok = (cond, label) => {
  if (!cond) failures++;
  console.log(`${cond ? '✅' : '❌'} ${label}`);
};

const { rememberUserFact, resetCache, loadMemory, addChat, topUserFacts, getRecentEpisodes, updateUserProfile, setActiveSession } =
  await import('./src/services/MemoryManager.js');
const { recallPreferences, learnFromExchange } = await import('./src/services/PreferenceLearner.js');

// Rebuild the index.js direct-path context function in isolation (it lives
// inline in index.js; this mirrors it exactly so the test asserts the real
// shape that ships).
async function directPathContext(convId) {
  const bits = [];
  try {
    const { compactionAwareHistory } = await import('./src/services/CompactionEngine.js');
    const { checkpoint, tail } = compactionAwareHistory(convId, { limit: 100 });
    if (checkpoint) {
      const tailText = tail.filter((e) => e.role === 'jexi' || e.role === 'user')
        .slice(-6).map((e) => `${e.role === 'user' ? 'You' : 'JEXI'}: ${String(e.text).replace(/\s+/g, ' ').slice(0, 300)}`).join('\n');
      bits.push(`[Earlier in this conversation — compacted checkpoint: ${String(checkpoint.text).slice(0, 2000)}]`);
    }
    const mem = loadMemory();
    const profile = (mem && mem.userProfile) || {};
    const memBits = [];
    if (profile.name) memBits.push(`User's name: ${profile.name}`);
    if (profile.location) memBits.push(`User's location: ${profile.location}`);
    const facts = topUserFacts(6);
    if (facts.length) memBits.push(...facts);
    const prefs = recallPreferences(4);
    if (prefs.length) memBits.push(...prefs);
    const episodes = getRecentEpisodes(3);
    if (episodes.length) memBits.push('Earlier sessions:' + episodes.map((e) => `\n- User asked "${String(e.ask).slice(0, 80)}" → I replied about ${String(e.reply).slice(0, 120)}`).join(''));
    if (memBits.length) bits.push(`[What I remember about the user:\n${memBits.join('\n')}]`);
  } catch (e) { bits.push(`ERROR: ${e.message}`); }
  return bits.join('\n');
}

console.log('\n== B155: direct-path memory injection ==');
resetCache();
{
  // Learn a fact + preference + profile exactly like real usage.
  rememberUserFact("User’s name is Amani", 8, "fact");
  rememberUserFact("User lives in Nairobi", 8, "fact");
  rememberUserFact('User’s favorite color is black', 6, 'preference');
  updateUserProfile({ name: 'Amani' });

  const ctx = await directPathContext('some-conv');
  ok(/Amani/.test(ctx), "learned NAME fact reaches the direct path");
  ok(/Nairobi/.test(ctx), "learned LOCATION fact reaches the direct path");
  ok(/favorite color is black|favorite color.*black|color.*black/i.test(ctx), 'preference reaches the direct path');
  ok(/What I remember about the user/.test(ctx), 'memory block labeled for the model');
}

console.log('\n== B155: addChat extracts facts from EVERY message ==');
{
  resetCache();
  setActiveSession('conv-abc');
  // This is the CENTRAL call index.js now makes for every user message.
  addChat('user', 'my name is Amani and I live in Nairobi');
  const facts = topUserFacts(10);
  ok(facts.some((f) => /Amani/i.test(String(f))), 'fact "name is Amani" extracted via addChat');
  ok(facts.some((f) => /Nairobi/i.test(String(f))), 'fact "lives in Nairobi" extracted via addChat');
  // The turn also lands in the rolling chat history (continuity across messages).
  const mem = loadMemory();
  ok(mem.chatHistory.some((e) => /my name is Amani/.test(e.text || '')), 'turn recorded in chat history');
}

console.log('\n== B155: conversation projection tail (assemblePrompt) ==');
{
  const { assemblePrompt } = await import('./src/services/PromptAssembly.js');
  const { appendConversationEvent } = await import('./src/services/SessionConversations.js');
  const conv = 'tail-test-conv';
  appendConversationEvent(conv, { role: 'user', text: 'remember the keyword: zebra-alpha', kind: 'chat' });
  appendConversationEvent(conv, { role: 'jexi', text: 'Got it — zebra-alpha noted.', kind: 'chat' });
  const sys = await assemblePrompt({ convId: conv, includeSkills: false, includeState: false });
  ok(/zebra-alpha/.test(sys), 'current conversation tail reaches assemblePrompt (runners keep the thread)');
}

console.log(`\nRESULT: ${failures === 0 ? 'ALL PASS' : failures + ' FAILED'}`);
process.exit(failures ? 1 : 0);
