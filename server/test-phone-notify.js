/**
 * JEXI OS — phone-notification dedupe regression suite (B83).
 * Pure helpers only (no Capacitor/Notification available in tests).
 */

import {
  loadShownKeys, saveShownKeys, isNotificationShown, markNotificationShown,
  notificationKey, isNativePlatform,
} from '../src/utils/phoneNotify.js';

let passed = 0;
let failed = 0;
const ok = (cond, name) => {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
};

// In-memory storage shim (localStorage-compatible).
function makeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _map: m,
  };
}

console.log('\n== Dedupe helpers ==');
const storage = makeStorage();
ok(isNotificationShown('nc:abc', storage) === false, 'unknown key not shown');
markNotificationShown('nc:abc', storage);
ok(isNotificationShown('nc:abc', storage) === true, 'key marked shown');
markNotificationShown('nc:abc', storage); // idempotent
ok(loadShownKeys(storage).length === 1, 'no duplicate entries');

console.log('\n== Key builder ==');
ok(notificationKey({ id: 'n-123' }) === 'nc:n-123', 'notification key from id');
ok(notificationKey(null) === '', 'null → empty key');
ok(notificationKey({}) === '', 'no id → empty key');

console.log('\n== Cap cap at 200 ==');
const big = makeStorage();
for (let i = 0; i < 250; i++) markNotificationShown(`nc:${i}`, big);
ok(loadShownKeys(big).length <= 200, 'shown-keys list is bounded');

console.log('\n== Corrupt storage safe ==');
const corrupt = makeStorage();
corrupt.setItem('jexi:shown-notifications', '{not json');
ok(isNotificationShown('nc:x', corrupt) === false, 'corrupt storage → treated as empty');
markNotificationShown('nc:x', corrupt);
ok(isNotificationShown('nc:x', corrupt) === true, 'recovers after corrupt read');

console.log('\n== isNativePlatform safe on web ==');
ok(isNativePlatform() === false, 'reports non-native in this environment (no Capacitor runtime)');

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
