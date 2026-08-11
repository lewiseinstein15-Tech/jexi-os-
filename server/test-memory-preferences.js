// Tests for the Mem0-style preference learner (PreferenceLearner.js):
//  - defensive JSON parsing of LLM extraction output
//  - dedupe against existing memories (exact + tf-idf cosine)
//  - storage + recall through the existing memory core (userFacts)
//  - no-key safety: learnFromExchange is a strict no-op without AI keys
// No network, no AI calls, no writes outside a temp DATA_DIR.
import fs from 'fs';
import os from 'os';
import path from 'path';

// Redirect memory BEFORE the services load their config.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-pref-test-'));
process.env.DATA_DIR = tmp;
process.env.WORKSPACE_DIR = path.join(tmp, 'ws');
delete process.env.GROQ_API_KEY;
delete process.env.GEMINI_API_KEY;

let failures = 0;
const ok = (cond, label) => {
  if (!cond) failures++;
  console.log(`${cond ? '✅' : '❌'} ${label}`);
};

const { parseMemoriesJson, dedupeMemory, recallPreferences, preferencesBlock, learnFromExchange } =
  await import('./src/services/PreferenceLearner.js');
const { rememberUserFact, resetCache, loadMemory, topUserFacts } =
  await import('./src/services/MemoryManager.js');

/* ---------------- 1. parseMemoriesJson ---------------- */
const parsed = parseMemoriesJson('[{"type":"preference","content":"User always writes tests first"}]');
ok(parsed.length === 1 && parsed[0].type === 'preference' && parsed[0].content.includes('tests first'), 'parses plain JSON array');

const fenced = parseMemoriesJson('```json\n[{"type":"fact","content":"User is building JEXI OS"}]\n```');
ok(fenced.length === 1 && fenced[0].type === 'fact', 'parses fenced JSON');

const inProse = parseMemoriesJson('Here you go: [{"type":"preference","content":"User prefers short answers"}] — done!');
ok(inProse.length === 1 && inProse[0].content.includes('short answers'), 'parses JSON embedded in prose');

ok(parseMemoriesJson('no json here at all').length === 0, 'garbage returns empty');
ok(parseMemoriesJson('[]').length === 0, 'empty array returns empty');

const coerced = parseMemoriesJson('[{"type":"bogus","content":"A durable fact about the user that is long enough"},{"type":"PREFERENCE","content":"User likes dark mode everywhere"}]');
ok(coerced[0].type === 'fact', 'invalid type coerced to fact');
ok(coerced[1].type === 'preference', 'type is lowercased');

const capped = parseMemoriesJson(JSON.stringify(Array.from({ length: 8 }, (_, i) => ({ type: 'fact', content: `User fact number ${i} that is long enough to store` }))));
ok(capped.length <= 4, 'extraction capped at 4 memories');

const shortFiltered = parseMemoriesJson('[{"type":"preference","content":"hi"}]');
ok(shortFiltered.length === 0, 'too-short content filtered out');

/* ---------------- 2. dedupeMemory ---------------- */
const existing = [{ fact: 'User always writes tests first' }, { fact: 'User lives in Accra' }];
ok(dedupeMemory('User always writes tests first', existing) === true, 'exact duplicate detected');
ok(dedupeMemory('User always writes tests first.', existing) === true, 'near-duplicate detected via cosine');
ok(dedupeMemory('User prefers dark mode for apps', existing) === false, 'fresh memory passes dedupe');

/* ---------------- 3. store + recall via memory core ---------------- */
resetCache();
rememberUserFact('User prefers short, direct answers', 5, 'preference');
rememberUserFact('User is building an AI operating system called JEXI', 5, 'identity');
rememberUserFact('User lives in Accra', 4, 'fact');

const recalled = recallPreferences(2);
ok(recalled.some((p) => p.includes('short, direct')), 'recallPreferences returns the stored preference');

const block = preferencesBlock(2);
ok(block.includes('USER PREFERENCES'), 'preferencesBlock renders its header');
ok(block.includes('short, direct'), 'preferencesBlock contains the preference text');
ok(!block.includes('Accra'), 'preferencesBlock ranks preferences above plain facts');

const top = topUserFacts(10);
ok(top.length >= 3, 'learned items flow into topUserFacts (conversation context)');

/* ---------------- 4. no-key safety ---------------- */
const originalCwd = process.cwd();
const before = loadMemory().userFacts.length;
process.chdir(tmp); // cwd has no settings.json → resolveKeys finds no keys
try {
  await learnFromExchange('I really prefer that you always write tests first before anything else you do');
  const after = loadMemory().userFacts.length;
  ok(after === before, 'no-key learnFromExchange is a strict no-op');
} catch (e) {
  ok(false, `no-key learnFromExchange must never throw: ${e.message}`);
} finally {
  process.chdir(originalCwd);
}

console.log(`\n${failures === 0 ? 'ALL MEMORY-PREFERENCE TESTS PASSED' : `${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);
