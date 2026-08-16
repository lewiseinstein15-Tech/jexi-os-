// Tests for the vector memory layer (TencentDB-Agent-Memory pattern):
//  - vectorCosine / fuseScore math
//  - hybridRank vector path (synthetic embeddings, NO network, NO API keys)
//  - hybridRank keyword fallback (no embeddings → pure tf-idf)
//  - searchInternetKnowledge / searchFreshInternetKnowledge async contracts
//  - backfillEmbeddings no-key no-op
//  - markProviderUnavailable long cooldown (402 payment-required)
// No network, no AI calls, no writes outside a temp DATA_DIR.
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-vec-test-'));
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
  vectorCosine, fuseScore, hybridRank, hybridSearch,
  saveInternetKnowledge, searchInternetKnowledge, searchFreshInternetKnowledge,
  resetCache, backfillEmbeddings,
} = await import('./src/services/MemoryManager.js');
const { resetProviderHealth, providerInCooldown, markProviderUnavailable } =
  await import('./src/services/ProviderRouter.js');

/* ---------------- 1. vector math ---------------- */
const v = [0.6, 0.8];
ok(Math.abs(vectorCosine(v, [0.6, 0.8]) - 1) < 1e-9, 'vectorCosine identical → 1');
ok(Math.abs(vectorCosine([1, 0], [0, 1])) < 1e-9, 'vectorCosine orthogonal → 0');
ok(Math.abs(vectorCosine([1, 0], [-1, 0]) + 1) < 1e-9, 'vectorCosine opposite → -1');
ok(vectorCosine([1, 2], [1, 2, 3]) === 0, 'vectorCosine mismatched lengths → 0');

/* ---------------- 2. fusion math ---------------- */
ok(Math.abs(fuseScore(0.8, 0.2) - (0.65 * 0.8 + 0.35 * 0.2)) < 1e-9, 'fuseScore blends vector + keyword');
ok(Math.abs(fuseScore(null, 0.5) - 0.5) < 1e-9, 'fuseScore falls back to keyword when vector missing');
ok(Math.abs(fuseScore(-0.5, 0.5) - (0 + 0.35 * 0.5)) < 1e-9, 'fuseScore clamps negative vectors to 0');

/* ---------------- 3. hybridRank — vector path (no API) ---------------- */
resetCache();
const e1 = { topic: 'neural networks and deep learning', answer: 'multi-layer models trained with backpropagation', date: new Date().toISOString(), lastAccess: new Date().toISOString(), accessCount: 0, importance: 3, emb: [0.9, 0.1, 0.4, 0.2] };
const e2 = { topic: 'cooking pasta recipes', answer: 'boil water and add salt', date: new Date().toISOString(), lastAccess: new Date().toISOString(), accessCount: 0, importance: 3, emb: [0.1, 0.9, 0.2, 0.8] };
// Query shares NO keywords with either entry — only the vector can find it.
const qEmb = [0.85, 0.15, 0.45, 0.25];
const vecHits = hybridRank([e1, e2], 'machine intelligence', qEmb, { relevanceFloor: 0.2, limit: 2 });
ok(vecHits.length === 2 && vecHits[0].entry === e1, 'vector path ranks the semantically related memory first');
ok(vecHits[0].score > 0.5, `vector match clears the floor (score=${vecHits[0].score?.toFixed(2)})`);
const kwOnly = hybridRank([e1, e2], 'machine intelligence', null, { relevanceFloor: 0.12, limit: 2 });
ok(kwOnly.length === 0, 'keyword-only finds NOTHING for a no-shared-word query (proves vector adds recall)');
const kwHit = hybridRank([e1, e2], 'deep learning training', null, { relevanceFloor: 0.12, limit: 2 });
ok(kwHit.length >= 1 && kwHit[0].entry === e1, 'keyword fallback still works when no embeddings exist');

/* ---------------- 4. async search contracts ---------------- */
resetCache();
saveInternetKnowledge('quantum computing', 'Quantum computers use qubits and superposition to explore many states at once.', ['quantum.example']);
const found = await searchInternetKnowledge('quantum computing');
ok(found && typeof found.answer === 'string' && found.answer.includes('qubit'), 'searchInternetKnowledge returns the entry object');
const fresh = await searchFreshInternetKnowledge('quantum computing', 60 * 60 * 1000);
ok(fresh && typeof fresh === 'object' && typeof fresh.answer === 'string', 'searchFreshInternetKnowledge returns an entry OBJECT (not an array)');
// The stale check needs the save to be visibly older than the 1ms window — the
// whole save+search sequence can otherwise complete inside one millisecond.
await new Promise((r) => setTimeout(r, 10));
const stale = await searchFreshInternetKnowledge('quantum computing', 1); // 1ms — too old
ok(stale === null, 'searchFreshInternetKnowledge respects maxAgeMs');
const miss = await searchInternetKnowledge('making pizza from scratch');
ok(miss === null, 'searchInternetKnowledge returns null on no match');

/* ---------------- 5. no-key safety ---------------- */
const backfilled = await backfillEmbeddings();
ok(backfilled === 0, 'backfillEmbeddings is a no-op without a Groq key');
const hybridNone = await hybridSearch([e1], 'machine intelligence', { relevanceFloor: 0.05, limit: 1 });
ok(Array.isArray(hybridNone), 'hybridSearch never throws without keys');

/* ---------------- 6. 402 hard cooldown ---------------- */
// B77 — cerebras is payment-gated and REMOVED from the router; the 402-park
// mechanism is provider-agnostic, so this tests it on a live free provider.
resetProviderHealth('nvidia');
ok(!providerInCooldown('nvidia'), 'provider healthy before 402');
markProviderUnavailable('nvidia', 60);
ok(providerInCooldown('nvidia'), '402 marks the provider as unavailable');
const { providerHealthSnapshot } = await import('./src/services/ProviderRouter.js');
const snap = providerHealthSnapshot().find(p => p.key === 'nvidia');
ok(snap.cooldownLeftSec >= 3500, `hour-long cooldown applied (${snap.cooldownLeftSec}s left)`);

console.log(`\n${failures === 0 ? 'ALL MEMORY-VECTOR TESTS PASSED' : `${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);
