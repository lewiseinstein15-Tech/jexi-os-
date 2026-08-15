#!/usr/bin/env node
/**
 * JEXI OS — LIVE connector verification (real API calls, real sends).
 *
 * Run this WHERE THE KEYS LIVE (Render shell / SSH console, or any host with
 * the env vars set):
 *
 *   cd server
 *   RESEND_TEST_TO="you@example.com" \
 *   WHATSAPP_TEST_TO="15551234567" \
 *   GITHUB_TEST_REPO="owner/disposable-test-repo" \
 *   node scripts/test-connectors-live.js
 *
 * It performs the REAL health_check() + send() for every connector and prints
 * the exact payloads and raw provider responses (message ids, issue numbers).
 * It never prints key values — only masked confirmation.
 *
 * Webhook handshake + HMAC verification are also demonstrated locally so you
 * can see verification RUNNING, then printed curl commands to hit the live
 * /webhooks/connectors/* endpoints on the deployed server.
 */
import crypto from 'crypto';
import * as email from '../src/services/connectors/email.js';
import * as whatsapp from '../src/services/connectors/whatsapp.js';
import * as github from '../src/services/connectors/github.js';
import { connectorStatus } from '../src/services/connectors/index.js';

// Secret values are NEVER printed — only configured/source presence.

console.log('═'.repeat(70));
console.log('JEXI OS — LIVE CONNECTOR VERIFICATION');
console.log('═'.repeat(70));

// ---- Environment presence (masked) ----
console.log('\n── Env vars found (masked confirmation only — never the values) ──');
const env = connectorStatus();
const show = (name, v) => console.log(`  ${v.configured ? '✅' : '❌'} ${name.padEnd(28)} ${v.configured ? `configured (${v.source})` : 'not set'}`);
show('WHATSAPP_ACCESS_TOKEN', env.whatsapp.env.token);
show('PHONE_NUMBER_ID', env.whatsapp.env.phoneNumberId);
show('APP_SECRET', env.whatsapp.env.appSecret);
show('VERIFY_TOKEN', env.whatsapp.env.verifyToken);
show('GITHUB_TOKEN', env.github.env);
show('RESEND_API_KEY', env.email.env);

// ---- Email (Resend) ----
console.log('\n── EMAIL (RESEND) ──');
console.log('\n1) health_check() → GET https://api.resend.com/domains (real call)');
console.log('   ', JSON.stringify(await email.healthCheck()));
const to = process.env.RESEND_TEST_TO;
if (to) {
  const from = process.env.RESEND_FROM || email.DEFAULT_FROM;
  const args = { from, to, subject: 'JEXI OS connector test', html: '<p>This is a real test email from the JEXI OS Resend connector.</p>' };
  const payload = email.buildResendPayload(args);
  console.log('\n2) send() → POST https://api.resend.com/emails');
  console.log('   Payload sent:', JSON.stringify(payload, null, 2));
  console.log('   Raw response:', JSON.stringify(await email.send(args), null, 2));
} else {
  console.log('\n2) send() SKIPPED — set RESEND_TEST_TO=you@example.com to send a real test email');
}

// ---- WhatsApp ----
console.log('\n── WHATSAPP ──');
console.log('\n1) health_check() → GET https://graph.facebook.com/v21.0/{PHONE_NUMBER_ID} (real call)');
console.log('   ', JSON.stringify(await whatsapp.healthCheck()));
const waTo = process.env.WHATSAPP_TEST_TO;
if (waTo) {
  const args = { to: waTo, body: 'Hello! This is a real test message from the JEXI OS WhatsApp connector.' };
  const payload = whatsapp.buildWhatsAppMessage(args);
  console.log('\n2) send() → POST https://graph.facebook.com/v21.0/{PHONE_NUMBER_ID}/messages');
  console.log('   Payload sent:', JSON.stringify(payload, null, 2));
  console.log('   Raw response:', JSON.stringify(await whatsapp.send(args), null, 2));
} else {
  console.log('\n2) send() SKIPPED — set WHATSAPP_TEST_TO=15551234567 (your test recipient) to send a real message');
}

// ---- WhatsApp webhook handshake + HMAC (verification actually running) ----
console.log('\n3) Webhook verification (local proof — no network)');
const waEnv = { ...whatsapp.getWhatsAppEnv() };
const handshake = whatsapp.verifyWebhook({ mode: 'subscribe', verifyToken: waEnv.verifyToken, challenge: 'test-challenge-123' }, waEnv);
console.log('   GET /webhooks/connectors/whatsapp?hub.mode=subscribe&hub.verify_token=***&hub.challenge=test-challenge-123');
console.log('   handshake result:', JSON.stringify(handshake));
const sampleBody = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: 'PHONE_NUMBER_ID' }, messages: [{ from: '15551234567', id: 'wamid.TEST', timestamp: '1720000000', type: 'text', text: { body: 'Test from my phone' } }] }, field: 'messages' }] }] }));
const sig = `sha256=${crypto.createHmac('sha256', waEnv.appSecret).update(sampleBody).digest('hex')}`;
console.log('   HMAC verify (x-hub-signature-256) over raw body:', whatsapp.verifySignature(sampleBody, sig, waEnv));
console.log('   receive() parsed payload:', JSON.stringify(whatsapp.receive(sampleBody), null, 2));

// ---- GitHub ----
console.log('\n── GITHUB ──');
console.log('\n1) health_check() → GET https://api.github.com/user (real call)');
console.log('   ', JSON.stringify(await github.healthCheck()));
const ghRepo = process.env.GITHUB_TEST_REPO;
if (ghRepo && ghRepo.includes('/')) {
  const [owner, repo] = ghRepo.split('/');
  const payload = github.buildGitHubIssue({ title: `JEXI OS connector test ${new Date().toISOString()}`, body: 'Real test issue created by the JEXI OS GitHub connector.' });
  console.log('\n2) send() → POST https://api.github.com/repos/{owner}/{repo}/issues');
  console.log('   Payload sent:', JSON.stringify(payload, null, 2));
  console.log('   Raw response:', JSON.stringify(await github.send({ owner, repo, ...payload }), null, 2));
} else {
  console.log('\n2) send() SKIPPED — set GITHUB_TEST_REPO=owner/disposable-test-repo to create a real test issue');
}

// ---- GitHub webhook HMAC (verification actually running) ----
console.log('\n3) Webhook verification (local proof — no network)');
const ghSample = Buffer.from(JSON.stringify({ action: 'opened', issue: { number: 1, title: 'Test', html_url: 'https://github.com/o/r/issues/1' }, repository: { full_name: 'o/r' }, sender: { login: 'octocat' } }));
const ghSecret = process.env.GITHUB_WEBHOOK_SECRET || process.env.GITHUB_TOKEN || '(unset)';
const ghSig = `sha256=${crypto.createHmac('sha256', ghSecret).update(ghSample).digest('hex')}`;
console.log('   POST /webhooks/connectors/github with x-github-event=issues');
console.log('   HMAC verify (secret = GITHUB_WEBHOOK_SECRET || GITHUB_TOKEN):', github.verifySignature(ghSample, ghSig, ghSecret));
console.log('   receive() parsed payload:', JSON.stringify(github.receive(ghSample, 'issues'), null, 2));

// ---- How to hit the live endpoints ----
console.log('\n── Hit the deployed endpoints (replace BASE with your Render URL) ──');
console.log(`
  # WhatsApp webhook registration (Meta will call this; you paste it into
  # Meta App Dashboard → WhatsApp → Configuration → Webhook):
  #   Callback URL:  https://BASE/webhooks/connectors/whatsapp
  #   Verify token:  (your VERIFY_TOKEN value)
  curl "https://BASE/webhooks/connectors/whatsapp?hub.mode=subscribe&hub.verify_token=YOUR_VERIFY_TOKEN&hub.challenge=12345678"

  # Connector status / health / test sends (require x-jexi-key if JEXI_API_KEY is set):
  curl https://BASE/api/connectors
  curl https://BASE/api/connectors/whatsapp/health
  curl https://BASE/api/connectors/github/health
  curl https://BASE/api/connectors/email/health
  curl -X POST https://BASE/api/connectors/email/send -H 'Content-Type: application/json' \\
    -d '{"to":"you@example.com","subject":"test","html":"<p>hi</p>"}'
`);

console.log('═'.repeat(70));
console.log('Done. PASS lines above = real provider responses; FAIL lines include the exact provider error.');
