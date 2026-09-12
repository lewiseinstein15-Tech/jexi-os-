/**
 * JEXI OS — test suite for the notification center (stage 23 remainder)
 * and model routing (stage 24).
 */
import { notify, listNotifications, unreadCount, markAllRead, markRead, clearNotifications } from './src/services/NotificationCenter.js';
import { INTENT_PREFERENCE, providerPreferenceForIntent, modelRoutingTable } from './src/providers/catalog/ModelRouting.js';

let passed = 0;
let failed = 0;
const ok = (cond, name) => {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
};

// --- NotificationCenter ---
console.log('\n== Notifications ==');
clearNotifications();
ok(listNotifications().length === 0, 'starts empty');

const a = notify({ title: 'Mission done', body: 'Research report ready', kind: 'success' });
const b = notify({ title: 'Task failed', kind: 'error' });
ok(listNotifications().length === 2, 'notify appends');
ok(listNotifications()[0].id === b.id, 'newest first');
ok(unreadCount() === 2, 'unread count = 2');
ok(a.kind === 'success' && b.kind === 'error', 'kinds preserved');
ok(notify({ kind: 'bogus' }).kind === 'info', 'invalid kind falls back to info');

markRead(a.id);
ok(unreadCount() === 2, 'markRead drops unread by one (3 → 2)');
ok(listNotifications().find((n) => n.id === a.id).read === true, 'entry marked read');

markAllRead();
ok(unreadCount() === 0, 'markAllRead clears unread');
clearNotifications();
ok(listNotifications().length === 0, 'clear empties ring');

// ring cap
for (let i = 0; i < 60; i++) notify({ title: `n${i}` });
ok(listNotifications().length === 50, 'ring capped at 50');
clearNotifications();

// --- ModelRouting: capability lanes, never provider names ---
console.log('\n== Model Routing (capability lanes) ==');
ok(providerPreferenceForIntent('math_solve') === 'code', 'math → code lane');
ok(providerPreferenceForIntent('research') === 'research', 'research → research lane');
ok(providerPreferenceForIntent('code_task') === 'code', 'code → code lane');
ok(providerPreferenceForIntent('image_recognition') === 'vision', 'vision → vision lane');
ok(providerPreferenceForIntent('vision') === 'vision', 'vision intent → vision lane');
ok(providerPreferenceForIntent('conversation') === '', 'conversation → default order');
ok(providerPreferenceForIntent('no_such_intent') === '', 'unknown intent → default order');

// The routing layer must never leak a provider name into business logic.
const LANE_VALUES = new Set(['code', 'research', 'vision', 'fast', '']);
for (const lane of Object.values(INTENT_PREFERENCE)) {
  ok(LANE_VALUES.has(lane), `lane value is a capability lane (got: ${JSON.stringify(lane)})`);
}
const PROVIDER_WORDS = /\b(gemini|groq|openrouter|cerebras|deepinfra|mistral|xai|huggingface|nvidia|cloudflare|ollama|openai|anthropic|google|deepseek)\b/i;
ok(!PROVIDER_WORDS.test(JSON.stringify(INTENT_PREFERENCE)), 'INTENT_PREFERENCE contains no provider name');

const table = modelRoutingTable();
ok(Array.isArray(table) && table.length === Object.keys(INTENT_PREFERENCE).length, 'table covers every intent');
const mathRow = table.find((r) => r.intent === 'math_solve');
ok(mathRow && mathRow.lane === 'code' && mathRow.providerLabel === 'Code/structured reasoning', 'table labels lanes, not providers');
const autoRow = table.find((r) => r.intent === 'conversation');
ok(autoRow && autoRow.lane === '(auto)' && autoRow.providerLabel === 'Automatic failover', 'auto intents labeled');

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
