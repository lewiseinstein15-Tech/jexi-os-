#!/usr/bin/env node
/**
 * JEXI OS — LIVE connector verification (real API calls, real sends).
 *
 * Run this WHERE THE KEYS LIVE (Render shell / SSH console, or any host with
 * the env vars set):
 *
 *   cd server
 *   RESEND_TEST_TO="you@example.com" \
 *   GITHUB_TEST_REPO="owner/disposable-test-repo" \
 *   node scripts/test-connectors-live.js
 *
 * It registers the real connectors (env vars win), then performs the REAL
 * health_check() + send() for every connector and prints the exact payloads
 * and raw provider responses (email id / GitHub issue number). It NEVER
 * prints key values — only ✅/❌ presence.
 *
 * Webhook handshake + HMAC verification are also demonstrated locally so you
 * can see verification RUNNING, then printed curl commands to hit the live
 * /webhooks/connectors/* endpoints on the deployed server.
 */
import crypto from 'crypto';
import { registerConnectors } from '../src/connectors/index.js';
import { ConnectorRegistry } from '../src/connectors/ConnectorRegistry.js';

// Register every connector from settings; env vars win at call time and the
// default base URLs point at the real providers.
registerConnectors();
const gh = ConnectorRegistry.get('github');
const em = ConnectorRegistry.get('email');

const masked = (v) => (v ? '✅ set' : '❌ not set');

console.log('═'.repeat(70));
console.log('JEXI OS — LIVE CONNECTOR VERIFICATION');
console.log('═'.repeat(70));

// ---- Environment presence (masked — values are never printed) ----
console.log('\n── Env vars found (masked confirmation only) ──');
console.log(`  GITHUB_TOKEN                     ${masked(process.env.GITHUB_TOKEN || process.env.GH_TOKEN)}`);
console.log(`  GITHUB_WEBHOOK_SECRET            ${masked(process.env.GITHUB_WEBHOOK_SECRET)}`);
console.log(`  RESEND_API_KEY                   ${masked(process.env.RESEND_API_KEY)}`);
console.log(`  RESEND_FROM                      ${masked(process.env.RESEND_FROM)}`);

// ---- Email (Resend) ----
console.log('\n── EMAIL (RESEND) ──');
console.log('\n1) health_check() → GET https://api.resend.com/domains (real call)');
console.log('   ', JSON.stringify(await em.healthCheck()));
const to = process.env.RESEND_TEST_TO;
if (to) {
  const payload = {
    from: process.env.RESEND_FROM || 'JEXI OS <onboarding@resend.dev>',
    to,
    subject: 'JEXI OS connector test',
    html: '<p>This is a real test email from the JEXI OS Resend connector.</p>',
  };
  console.log('\n2) send() → POST https://api.resend.com/emails');
  console.log('   Payload sent:', JSON.stringify(payload, null, 2));
  console.log('   Raw response:', JSON.stringify(await em.send(payload), null, 2));
} else {
  console.log('\n2) send() SKIPPED — set RESEND_TEST_TO=you@example.com to send a real test email');
}

// ---- Email inbound webhook (Svix HMAC verification actually running) ----
console.log('\n3) Webhook verification (local proof — no network)');
const emSample = Buffer.from(JSON.stringify({
  type: 'email.received',
  data: {
    email_id: 'mock-123',
    from: 'you@example.com',
    to: ['jexi-test@talowoi.resend.app'],
    subject: 'Test',
    created_at: new Date().toISOString(),
  },
}));
const emSecret = process.env.RESEND_WEBHOOK_SECRET || '(unset)';
const emSig = `v1,${crypto.createHmac('sha256', emSecret.replace(/^whsec_/, '')).update('msg_1.' + Math.floor(Date.now() / 1000) + '.' + emSample.toString()).digest('base64')}`;
console.log('   POST /webhooks/connectors/email with svix-id/svix-timestamp/svix-signature');
console.log('   HMAC verify (secret = RESEND_WEBHOOK_SECRET):', em.verifyWebhookSignature(emSample, { 'svix-id': 'msg_1', 'svix-timestamp': String(Math.floor(Date.now() / 1000)), 'svix-signature': emSig }));
console.log('   receive() parsed payload:', JSON.stringify(em.receive(JSON.parse(emSample.toString())), null, 2));

// ---- GitHub ----
console.log('\n── GITHUB ──');
console.log('\n1) health_check() → GET https://api.github.com/user (real call)');
console.log('   ', JSON.stringify(await gh.healthCheck()));
const ghRepo = process.env.GITHUB_TEST_REPO;
if (ghRepo && ghRepo.includes('/')) {
  const [owner, repo] = ghRepo.split('/');
  const payload = { action: 'create_issue', owner, repo, title: `JEXI OS connector test ${new Date().toISOString()}`, body: 'Real test issue created by the JEXI OS GitHub connector.' };
  console.log('\n2) send() → POST https://api.github.com/repos/{owner}/{repo}/issues');
  console.log('   Payload sent:', JSON.stringify(payload, null, 2));
  console.log('   Raw response:', JSON.stringify(await gh.send(payload), null, 2));
} else {
  console.log('\n2) send() SKIPPED — set GITHUB_TEST_REPO=owner/disposable-test-repo to create a real test issue');
}

// ---- GitHub webhook HMAC (verification actually running) ----
console.log('\n3) Webhook verification (local proof — no network)');
const ghSample = Buffer.from(JSON.stringify({ action: 'opened', issue: { number: 1, title: 'Test', html_url: 'https://github.com/o/r/issues/1' }, repository: { full_name: 'o/r' }, sender: { login: 'octocat' } }));
const ghSecret = process.env.GITHUB_WEBHOOK_SECRET || process.env.GITHUB_TOKEN || '(unset)';
const ghSig = `sha256=${crypto.createHmac('sha256', ghSecret).update(ghSample).digest('hex')}`;
console.log('   POST /webhooks/connectors/github with x-github-event=issues');
console.log('   HMAC verify (secret = GITHUB_WEBHOOK_SECRET || GITHUB_TOKEN):', gh.verifyWebhookSignature(ghSample, { 'x-hub-signature-256': ghSig }));
console.log('   receive() parsed payload:', JSON.stringify(gh.receive(JSON.parse(ghSample.toString())), null, 2));

// ---- How to hit the live endpoints ----
console.log('\n── Hit the deployed endpoints (replace BASE with your Render URL) ──');
console.log(`
  # Connector status / health (open GETs, no key) + test sends (need
  # x-jexi-key header only if JEXI_API_KEY is set):
  curl https://BASE/api/connectors
  curl https://BASE/api/connectors/github/health
  curl https://BASE/api/connectors/email/health
  curl -X POST https://BASE/api/connectors/email/call -H 'Content-Type: application/json' -H 'x-jexi-key: KEY' \\
    -d '{"method":"send","payload":{"to":"you@example.com","subject":"test","html":"<p>hi</p>"}}'
`);

console.log('═'.repeat(70));
console.log('Done. PASS lines above = real provider responses; FAIL lines include the exact provider error.');
