/**
 * JEXI OS — Push Manager regression suite (B84: web push).
 * Subscription CRUD, VAPID key persistence, broadcast with a mocked sender,
 * dead-subscription pruning, and the NotificationCenter broadcaster hook.
 */

import {
  addSubscription, removeSubscription, listSubscriptions, getVapidPublicKey,
  broadcastPush, setPushSender, resetPushManager, recordPushDiag, listPushDiag,
} from './src/services/PushManager.js';
import { notify, clearNotifications, setNotifyBroadcaster } from './src/services/NotificationCenter.js';

let passed = 0;
let failed = 0;
const ok = (cond, name) => {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
};

console.log('\n== VAPID keys ==');
const pub = getVapidPublicKey();
ok(typeof pub === 'string' && pub.length > 20, 'VAPID public key generated');
const pub2 = getVapidPublicKey();
ok(pub === pub2, 'key is stable within the process');

console.log('\n== Subscription validation + CRUD ==');
resetPushManager();
ok(addSubscription({ endpoint: 'http://insecure.example.com/x', keys: { p256dh: 'a', auth: 'b' } }).ok === false, 'http endpoint rejected');
ok(addSubscription({ endpoint: 'https://up.example.com/x', keys: {} }).ok === false, 'missing keys rejected');
ok(addSubscription({ endpoint: 'https://up.example.com/1', keys: { p256dh: 'a', auth: 'b' } }).ok === true, 'valid subscription added');
ok(addSubscription({ endpoint: 'https://up.example.com/2', keys: { p256dh: 'c', auth: 'd' }, ua: 'Chrome' }).ok === true, 'second subscription added');
ok(listSubscriptions().length === 2, 'two subscriptions listed');
ok(addSubscription({ endpoint: 'https://up.example.com/1', keys: { p256dh: 'x', auth: 'y' } }).ok === true, 're-subscribe upserts (no duplicate)');
ok(listSubscriptions().length === 2, 'still two after upsert');
ok(removeSubscription('https://up.example.com/2').removed === 1, 'unsubscribe removes one');
ok(listSubscriptions().length === 1, 'one left');

console.log('\n== Broadcast with mocked sender ==');
resetPushManager();
addSubscription({ endpoint: 'https://up.example.com/1', keys: { p256dh: 'a', auth: 'b' } });
addSubscription({ endpoint: 'https://up.example.com/2', keys: { p256dh: 'c', auth: 'd' } });
const sentTo = [];
setPushSender(async (sub, payload) => { sentTo.push({ endpoint: sub.endpoint, payload }); });
const res = await broadcastPush('✅ Goal complete', 'Your report is ready', '/api/goals/1');
ok(res.sent === 2 && res.failed === 0 && res.pruned === 0, 'sent to both subscriptions');
ok(sentTo[0].payload.title === '✅ Goal complete' && sentTo[0].payload.body === 'Your report is ready' && sentTo[0].payload.link === '/api/goals/1', 'payload shape correct');

console.log('\n== Dead subscriptions pruned ==');
resetPushManager();
addSubscription({ endpoint: 'https://dead.example.com/1', keys: { p256dh: 'a', auth: 'b' } });
addSubscription({ endpoint: 'https://live.example.com/2', keys: { p256dh: 'c', auth: 'd' } });
setPushSender(async (sub) => {
  if (sub.endpoint.includes('dead')) { const e = new Error('gone'); e.statusCode = 410; throw e; }
});
const res2 = await broadcastPush('t', 'b');
ok(res2.sent === 1 && res2.pruned === 1, 'dead subscription pruned, live one delivered');
ok(listSubscriptions().length === 1 && listSubscriptions()[0].endpoint.includes('live'), 'only the live subscription remains');

console.log('\n== Broadcast never throws (sender throws) ==');
resetPushManager();
addSubscription({ endpoint: 'https://bad.example.com/1', keys: { p256dh: 'a', auth: 'b' } });
setPushSender(async () => { throw new Error('network down'); });
const res3 = await broadcastPush('t', 'b');
ok(res3.failed === 1 && res3.sent === 0, 'failure counted, no throw');

console.log('\n== NotificationCenter broadcaster hook ==');
resetPushManager();
setPushSender(null);
clearNotifications();
const pushed = [];
setNotifyBroadcaster((n) => pushed.push(n));
const n = notify({ title: 'Mission done', body: 'Report ready', kind: 'success' });
ok(pushed.length === 1, 'broadcaster fired on notify');
ok(pushed[0].title === 'Mission done' && pushed[0].body === 'Report ready', 'broadcaster got the notification');
ok(pushed[0].id === n.id, 'broadcaster got the same notification object');
setNotifyBroadcaster(() => { throw new Error('boom'); });
ok(notify({ title: 'x' }).id, 'broadcaster throw does not break notify');
setNotifyBroadcaster(null);


console.log('\n== Client diagnostics store ==');
{
  resetPushManager();
  recordPushDiag({ step: 'registered', platform: 'native', permission: 'granted' });
  recordPushDiag({ step: 'get-token-error', error: 'Play services not ready', platform: 'native' });
  const d = listPushDiag();
  ok(d.length === 2, 'diag entries recorded');
  ok(d[0].step === 'get-token-error' && /Play services/.test(d[0].error), 'newest first with error text');
  ok(d[1].permission === 'granted', 'permission captured');
  ok(typeof d[0].at === 'number', 'timestamp present');
}

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
