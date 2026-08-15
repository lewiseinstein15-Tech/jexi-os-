/**
 * JEXI OS — connector tests (offline: no external API calls).
 *
 * Covers the parts that must never depend on network or live keys:
 *   - exact request payloads (Resend / WhatsApp / GitHub) match provider docs
 *   - WhatsApp verification handshake (hub.challenge + VERIFY_TOKEN)
 *   - HMAC signature verification (WhatsApp APP_SECRET, GitHub token secret)
 *   - receive() parsing of real-shaped webhook payloads
 *   - graceful BLOCKED behavior when a key is missing
 *
 * The live end-to-end proof (real health checks + sends) lives in
 * scripts/test-connectors-live.js and must run where the keys exist (Render).
 */
import crypto from 'crypto';
import express from 'express';
import { CONNECTORS, connectorStatus, runHealthCheck, runSend, mountConnectorWebhooks } from './src/services/connectors/index.js';
import * as email from './src/services/connectors/email.js';
import * as whatsapp from './src/services/connectors/whatsapp.js';
import * as github from './src/services/connectors/github.js';

let passed = 0;
let failed = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { passed++; console.log(`  ✅ ${name}${extra ? ` — ${extra}` : ''}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
};

/* ------------------------------------------------------------------ */
console.log('\n== Connector registry ==');
/* ------------------------------------------------------------------ */
ok(Object.keys(CONNECTORS).length === 3, 'three connectors registered (whatsapp, github, email)');
ok(['whatsapp', 'github', 'email'].every((k) => CONNECTORS[k] && typeof CONNECTORS[k].healthCheck === 'function'), 'every connector exposes healthCheck()');
ok(['whatsapp', 'github', 'email'].every((k) => CONNECTORS[k] && typeof CONNECTORS[k].send === 'function'), 'every connector exposes send()');
ok(['whatsapp', 'github', 'email'].every((k) => CONNECTORS[k] && typeof CONNECTORS[k].receive === 'function'), 'every connector exposes receive()');
const status = connectorStatus();
ok(status.whatsapp && status.github && status.email, 'connectorStatus covers all three');
ok(status.whatsapp.env && status.whatsapp.env.envVars.includes('WHATSAPP_ACCESS_TOKEN'), 'whatsapp env vars listed (masked, no values)');
const serialized = JSON.stringify(status);
ok(!/sk-|ghp_|EAAG|re_|eyJ/.test(serialized), 'status output contains no key material');

/* ------------------------------------------------------------------ */
console.log('\n== Email (Resend) ==');
/* ------------------------------------------------------------------ */
const resendPayload = email.buildResendPayload({ from: 'Acme <onboarding@resend.dev>', to: ['delivered@resend.dev'], subject: 'hello world', html: '<p>it works!</p>' });
ok(resendPayload.from === 'Acme <onboarding@resend.dev>', 'Resend payload from = sender string');
ok(Array.isArray(resendPayload.to) && resendPayload.to[0] === 'delivered@resend.dev', 'Resend payload to = array (docs schema)');
ok(resendPayload.subject === 'hello world', 'Resend payload subject');
ok(resendPayload.html === '<p>it works!</p>' && resendPayload.text === undefined, 'Resend payload html (text omitted)');
const resendText = email.buildResendPayload({ from: 'a@b.c', to: 'x@y.z', subject: 's', text: 'plain' });
ok(resendText.text === 'plain' && resendText.html === undefined, 'Resend payload text variant');
ok(email.RESEND_API === 'https://api.resend.com', 'Resend endpoint is api.resend.com (no api.sendgrid.com anywhere)');

const emailNoKey = await email.send({ to: 'x@y.z', subject: 's', html: '<p>h</p>' });
ok(emailNoKey.ok === false && emailNoKey.code === 'MISSING_KEY', 'Resend send() without key fails closed with MISSING_KEY');
const emailBadArgs = await email.send({ to: 'x@y.z' });
ok(emailBadArgs.ok === false && emailBadArgs.code === 'BAD_REQUEST', 'Resend send() validates required args');

const emailHealth = await email.healthCheck();
ok(['BLOCKED', 'PASS', 'FAIL'].includes(emailHealth.status), `Resend healthCheck() returns a real verdict (${emailHealth.status})`);
if (emailHealth.status === 'BLOCKED') ok(/RESEND_API_KEY/.test(emailHealth.reason), 'BLOCKED reason names the missing env var');

/* ------------------------------------------------------------------ */
console.log('\n== WhatsApp ==');
/* ------------------------------------------------------------------ */
const waPayload = whatsapp.buildWhatsAppMessage({ to: '+15551234567', body: 'Hello from JEXI!' });
ok(waPayload.messaging_product === 'whatsapp', 'WhatsApp payload messaging_product');
ok(waPayload.recipient_type === 'individual', 'WhatsApp payload recipient_type');
ok(waPayload.to === '15551234567', 'WhatsApp payload to normalized to digits');
ok(waPayload.type === 'text' && waPayload.text.body === 'Hello from JEXI!', 'WhatsApp payload text.body');

// Verification handshake
const waEnv = { token: '', phoneNumberId: '', appSecret: 'app-secret-123', verifyToken: 'jexi-verify-2026' };
ok(whatsapp.verifyWebhook({ mode: 'subscribe', verifyToken: 'jexi-verify-2026', challenge: 'challenge-abc' }, waEnv).ok === true, 'handshake passes with matching VERIFY_TOKEN');
ok(whatsapp.verifyWebhook({ mode: 'subscribe', verifyToken: 'wrong', challenge: 'challenge-abc' }, waEnv).ok === false, 'handshake rejects wrong VERIFY_TOKEN');
ok(whatsapp.verifyWebhook({ mode: 'unsubscribe', verifyToken: 'jexi-verify-2026', challenge: 'c' }, waEnv).ok === false, 'handshake rejects non-subscribe mode');

// HMAC signature (raw body, APP_SECRET)
const waBody = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [] }));
const waSig = `sha256=${crypto.createHmac('sha256', 'app-secret-123').update(waBody).digest('hex')}`;
ok(whatsapp.verifySignature(waBody, waSig, waEnv) === true, 'WhatsApp HMAC verifies with correct APP_SECRET');
ok(whatsapp.verifySignature(waBody, waSig.replace(/0/, '1'), waEnv) === false, 'WhatsApp HMAC rejects tampered signature');
ok(whatsapp.verifySignature(waBody, null, waEnv) === false, 'WhatsApp HMAC rejects missing header');

// receive() — real-shaped Meta payload
const waInbound = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [{
    id: 'WHATSAPP_BUSINESS_ACCOUNT_ID',
    changes: [{
      value: {
        messaging_product: 'whatsapp',
        metadata: { display_phone_number: '15551234567', phone_number_id: 'PHONE_NUMBER_ID' },
        contacts: [{ profile: { name: 'Jane' }, wa_id: '15559998888' }],
        messages: [{ from: '15559998888', id: 'wamid.ABGGV1V1', timestamp: '1720000000', type: 'text', text: { body: 'Hello JEXI, test from my phone' } }],
      },
      field: 'messages',
    }],
  }],
});
const waParsed = whatsapp.receive(waInbound);
ok(waParsed.received === true, 'WhatsApp receive() detects an inbound message');
ok(waParsed.from === '15559998888', 'WhatsApp receive() parses sender');
ok(waParsed.text === 'Hello JEXI, test from my phone', 'WhatsApp receive() parses text body');
ok(waParsed.messageId === 'wamid.ABGGV1V1', 'WhatsApp receive() parses message id');
const waStatusOnly = whatsapp.receive(JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { statuses: [{ status: 'delivered' }] }, field: 'messages' }] }] }));
ok(waStatusOnly.received === false && /status update/.test(waStatusOnly.reason), 'WhatsApp receive() handles status-only payloads');

const waSendNoKey = await whatsapp.send({ to: '15551234567', body: 'hi' });
ok(waSendNoKey.ok === false && waSendNoKey.code === 'MISSING_KEY', 'WhatsApp send() without key fails closed');
const waHealth = await whatsapp.healthCheck();
ok(['BLOCKED', 'PASS', 'FAIL'].includes(waHealth.status), `WhatsApp healthCheck() returns a real verdict (${waHealth.status})`);

/* ------------------------------------------------------------------ */
console.log('\n== GitHub ==');
/* ------------------------------------------------------------------ */
const ghIssue = github.buildGitHubIssue({ title: 'Test issue from JEXI OS', body: 'Verification payload' });
ok(ghIssue.title === 'Test issue from JEXI OS', 'GitHub issue payload title');
ok(ghIssue.body === 'Verification payload', 'GitHub issue payload body');

// HMAC — secret = GITHUB_WEBHOOK_SECRET || token
const ghBody = Buffer.from(JSON.stringify({ action: 'opened', issue: { number: 1 } }));
const ghSig = `sha256=${crypto.createHmac('sha256', 'ghp_test-secret-token').update(ghBody).digest('hex')}`;
ok(github.verifySignature(ghBody, ghSig, 'ghp_test-secret-token') === true, 'GitHub HMAC verifies with the webhook secret');
ok(github.verifySignature(ghBody, ghSig, 'wrong-secret') === false, 'GitHub HMAC rejects wrong secret');
ok(github.verifySignature(ghBody, null, 'ghp_test-secret-token') === false, 'GitHub HMAC rejects missing header');

// receive() — issue_comment event
const ghComment = JSON.stringify({
  action: 'created',
  issue: { number: 7, title: 'Test issue from JEXI OS', html_url: 'https://github.com/owner/repo/issues/7', state: 'open' },
  comment: { id: 123456, body: 'Webhook triggered by JEXI OS', html_url: 'https://github.com/owner/repo/issues/7#issuecomment-123456' },
  repository: { full_name: 'owner/repo' },
  sender: { login: 'octocat' },
});
const ghParsed = github.receive(ghComment, 'issue_comment');
ok(ghParsed.event === 'issue_comment', 'GitHub receive() event from header');
ok(ghParsed.issue.number === 7 && ghParsed.issue.title === 'Test issue from JEXI OS', 'GitHub receive() parses issue');
ok(ghParsed.comment.body === 'Webhook triggered by JEXI OS', 'GitHub receive() parses comment');
ok(ghParsed.repository === 'owner/repo' && ghParsed.sender === 'octocat', 'GitHub receive() parses repo + sender');

const ghSendNoKey = await github.send({ owner: 'o', repo: 'r', title: 't' });
ok(ghSendNoKey.ok === false && ghSendNoKey.code === 'MISSING_KEY', 'GitHub send() without key fails closed');
const ghHealth = await github.healthCheck();
ok(['BLOCKED', 'PASS', 'FAIL'].includes(ghHealth.status), `GitHub healthCheck() returns a real verdict (${ghHealth.status})`);

/* ------------------------------------------------------------------ */
console.log('\n== Connector layer (registry dispatch) ==');
/* ------------------------------------------------------------------ */
const unknown = await runHealthCheck('nope');
ok(unknown.ok === false && /Unknown connector/.test(unknown.error), 'unknown connector rejected');
const unknownSend = await runSend('nope', {});
ok(unknownSend.ok === false && /Unknown connector/.test(unknownSend.error), 'unknown connector send rejected');
const whatsappDispatch = await runHealthCheck('whatsapp');
ok(whatsappDispatch.connector === 'whatsapp' && ['BLOCKED', 'PASS', 'FAIL'].includes(whatsappDispatch.status), 'registry dispatches to the right connector');

/* ------------------------------------------------------------------ */
console.log('\n== Webhook routes (in-process HTTP, no network) ==');
/* ------------------------------------------------------------------ */
// Set test-only secrets so the routes' real code paths run (values restored after).
const withEnv = async (key, value, fn) => {
  const prev = process.env[key];
  process.env[key] = value;
  try { return await fn(); } finally { if (prev === undefined) delete process.env[key]; else process.env[key] = prev; }
};

const probe = express();
mountConnectorWebhooks(probe);
const server = await new Promise((resolve) => { const s = probe.listen(0, '127.0.0.1', () => resolve(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
try {
  // WhatsApp handshake
  const badHandshake = await fetch(`${base}/webhooks/connectors/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc`);
  ok(badHandshake.status === 403, 'whatsapp handshake route rejects wrong VERIFY_TOKEN (403)');
  const goodHandshake = await withEnv('VERIFY_TOKEN', 'test-verify-123', () =>
    fetch(`${base}/webhooks/connectors/whatsapp?hub.mode=subscribe&hub.verify_token=test-verify-123&hub.challenge=challenge-42`));
  const hsText = await goodHandshake.text();
  console.log('    → route response:', goodHandshake.status, JSON.stringify(hsText));
  ok(goodHandshake.status === 200 && hsText === 'challenge-42', 'whatsapp handshake route echoes hub.challenge on valid VERIFY_TOKEN');

  // WhatsApp POST — HMAC gate
  const waInboundBody = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: 'PN1' }, messages: [{ from: '15551234567', id: 'wamid.X', timestamp: '1720000000', type: 'text', text: { body: 'hi' } }] }, field: 'messages' }] }] });
  const noSig = await fetch(`${base}/webhooks/connectors/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: waInboundBody });
  ok(noSig.status === 403, 'whatsapp webhook route rejects missing signature (403)');
  const goodWaSig = `sha256=${crypto.createHmac('sha256', 'test-app-secret').update(waInboundBody).digest('hex')}`;
  const waResp = await withEnv('APP_SECRET', 'test-app-secret', () =>
    fetch(`${base}/webhooks/connectors/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': goodWaSig }, body: waInboundBody }));
  const waJson = await waResp.json();
  console.log('    → route response:', waResp.status, JSON.stringify({ received: waJson.received, parsed: waJson.parsed && { from: waJson.parsed.from, text: waJson.parsed.text, messageId: waJson.parsed.messageId } }));
  ok(waResp.status === 200 && waJson.parsed.received === true && waJson.parsed.from === '15551234567', 'whatsapp webhook route verifies HMAC and returns parsed payload');

  // GitHub POST — HMAC gate
  const ghBody = JSON.stringify({ action: 'opened', issue: { number: 3, title: 'T', html_url: 'https://github.com/o/r/issues/3' }, repository: { full_name: 'o/r' }, sender: { login: 'octocat' } });
  const ghNoSig = await fetch(`${base}/webhooks/connectors/github`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-github-event': 'issues' }, body: ghBody });
  ok(ghNoSig.status === 403, 'github webhook route rejects missing signature (403)');
  const goodGhSig = `sha256=${crypto.createHmac('sha256', 'gh-test-secret').update(ghBody).digest('hex')}`;
  const ghResp = await withEnv('GITHUB_WEBHOOK_SECRET', 'gh-test-secret', () =>
    fetch(`${base}/webhooks/connectors/github`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': goodGhSig, 'x-github-event': 'issues' }, body: ghBody }));
  const ghJson = await ghResp.json();
  console.log('    → route response:', ghResp.status, JSON.stringify({ received: ghJson.received, event: ghJson.event, parsed: ghJson.parsed && { issue: ghJson.parsed.issue, sender: ghJson.parsed.sender } }));
  ok(ghResp.status === 200 && ghJson.event === 'issues' && ghJson.parsed.issue.number === 3, 'github webhook route verifies HMAC and returns parsed payload');
} finally {
  server.close();
}

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
