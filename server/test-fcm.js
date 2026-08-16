/**
 * JEXI OS — FCM Manager regression suite (B86).
 * Token store CRUD, OAuth token caching, send/prune with mocked fetchers —
 * no live Firebase calls.
 */

import {
  addFcmToken, removeFcmToken, listFcmTokens, fcmStatus,
  getFcmAccessToken, broadcastFcm, setFcmTokenFetcher, setFcmSender,
  resetFcmManager, isFcmConfigured,
} from './src/services/FcmManager.js';

let passed = 0;
let failed = 0;
const ok = (cond, name) => {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
};

// Fake service account via env — with a REAL generated RSA key so the JWT
// signing path works (the OAuth fetch itself is still mocked).
import crypto from 'crypto';
const { privateKey: testPrivateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, // PEM string, not a KeyObject
});
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
  project_id: 'jexi-os',
  client_email: 'firebase-adminsdk@jexi-os.iam.gserviceaccount.com',
  private_key: testPrivateKey,
});

console.log('\n== Configuration detection ==');
ok(isFcmConfigured() === true, 'configured from env service account');
const st = fcmStatus();
ok(st.projectId === 'jexi-os' && st.deviceTokens === 0, 'status reports project + zero devices');

console.log('\n== Token store CRUD ==');
resetFcmManager();
ok(addFcmToken('short').ok === false, 'invalid token rejected');
ok(addFcmToken('fcm-device-token-aaaaaaaaaaaaaaaaaaaaaaaa').ok === true, 'valid token added');
ok(addFcmToken('fcm-device-token-bbbbbbbbbbbbbbbbbbbbbbbbb').ok === true, 'second device added');
ok(addFcmToken('fcm-device-token-aaaaaaaaaaaaaaaaaaaaaaaa', 'Pixel 9').ok === true, 're-register upserts');
ok(listFcmTokens().length === 2, 'two devices after upsert');
ok(removeFcmToken('fcm-device-token-bbbbbbbbbbbbbbbbbbbbbbbbb').removed === 1, 'unregister removes');
ok(listFcmTokens().length === 1, 'one device left');

console.log('\n== OAuth token caching ==');
resetFcmManager();
let fetchCount = 0;
setFcmTokenFetcher(async () => { fetchCount += 1; return `token-${fetchCount}`; });
const t1 = await getFcmAccessToken();
const t2 = await getFcmAccessToken();
ok(t1 === 'token-1' && t2 === 'token-1', 'token cached');
ok(fetchCount === 1, 'fetched exactly once');

console.log('\n== Broadcast sends to all devices, prunes dead ==');
resetFcmManager();
addFcmToken('fcm-live-token-111111111111111111111111');
addFcmToken('fcm-dead-token-222222222222222222222222');
const sentTo = [];
setFcmSender(async (token, payload) => {
  if (token.includes('dead')) { const e = new Error('UNREGISTERED'); e.statusCode = 404; throw e; }
  sentTo.push({ token, payload });
});
const res = await broadcastFcm('✅ Goal complete', 'Your report is ready', '/api/goals/1');
ok(res.sent === 1 && res.pruned === 1 && res.failed === 0, 'live delivered, dead pruned');
ok(sentTo[0].payload.title === '✅ Goal complete' && sentTo[0].payload.body === 'Your report is ready' && sentTo[0].payload.link === '/api/goals/1', 'payload shape correct');
ok(listFcmTokens().length === 1 && listFcmTokens()[0].token.includes('live'), 'only live token remains');

console.log('\n== Broadcast never throws (sender fails) ==');
resetFcmManager();
addFcmToken('fcm-bad-token-333333333333333333333333');
setFcmSender(async () => { const e = new Error('network'); e.statusCode = 500; throw e; });
const res2 = await broadcastFcm('t', 'b');
ok(res2.failed === 1 && res2.sent === 0 && res2.pruned === 0, 'failure counted, no throw');

console.log('\n== Redis hydration is a graceful no-op without REDIS_URL ==');
{
  delete process.env.REDIS_URL;
  resetFcmManager();
  const h = await (await import('./src/services/FcmManager.js')).hydrateFcmTokensFromRedis();
  ok(h === false, 'no REDIS_URL → hydrate no-op (never throws)');
}

console.log('\n== No tokens / not configured → no-op ==');
resetFcmManager();
ok((await broadcastFcm('t', 'b')).sent === 0, 'no tokens → 0 sent');
// Move the local dev service-account file aside so "unconfigured" is
// deterministic (dev file exists in the workspace, not in CI).
import fs from 'fs';
const SA_FILE = 'firebase-service-account.json';
const hadFile = fs.existsSync(SA_FILE);
if (hadFile) fs.renameSync(SA_FILE, `${SA_FILE}.testbak`);
try {
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  resetFcmManager(); // clear the cached service account
  ok(isFcmConfigured() === false, 'unconfigured detected');
  ok((await broadcastFcm('t', 'b')).sent === 0, 'unconfigured → no-op');
} finally {
  if (hadFile) fs.renameSync(`${SA_FILE}.testbak`, SA_FILE);
  process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: 'jexi-os', client_email: 'x@y', private_key: 'k' });
}

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
