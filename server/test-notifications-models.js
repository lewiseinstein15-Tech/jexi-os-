/**
 * JEXI OS — test suite for the notification center (stage 23 remainder)
 * and model routing (stage 24).
 */
import { notify, listNotifications, unreadCount, markAllRead, markRead, clearNotifications } from './src/services/NotificationCenter.js';
import { INTENT_PREFERENCE, providerPreferenceForIntent, modelRoutingTable } from './src/services/ModelRouting.js';

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

// --- ModelRouting ---
console.log('\n== Model Routing ==');
ok(providerPreferenceForIntent('math_solve') === 'gemini', 'math → gemini');
ok(providerPreferenceForIntent('research') === 'openrouter', 'research → openrouter');
ok(providerPreferenceForIntent('code_task') === 'groq', 'code → groq');
ok(providerPreferenceForIntent('image_recognition') === 'gemini', 'vision → gemini');
ok(providerPreferenceForIntent('conversation') === '', 'conversation → default order');
ok(providerPreferenceForIntent('no_such_intent') === '', 'unknown intent → default order');

const table = modelRoutingTable();
ok(Array.isArray(table) && table.length === Object.keys(INTENT_PREFERENCE).length, 'table covers every intent');
const mathRow = table.find((r) => r.intent === 'math_solve');
ok(mathRow && mathRow.provider === 'gemini' && mathRow.providerLabel === 'Gemini', 'table labels providers');
const autoRow = table.find((r) => r.intent === 'conversation');
ok(autoRow && autoRow.provider === '(auto)' && autoRow.providerLabel === 'Automatic failover', 'auto intents labeled');

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
