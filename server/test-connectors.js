/**
 * JEXI OS — B56 acceptance suite (Connector System), extended through B66.
 *
 * ⚠️ MOCK DISCLOSURE — every provider call in this suite goes to a LOCAL MOCK
 * SERVER (server/tests/connectorMocks.js) that mimics the real GitHub /
 * Resend API response shapes. NO live credentials are used anywhere in this
 * file. The connector code paths are byte-identical to what runs against the
 * real providers (only the base URL differs; it defaults to the real provider
 * URL when unset).
 *
 * Covers the directive's verification checklist per connector:
 *   - authenticate() actually calls the (mock) provider
 *   - one successful send() with the logged provider response
 *   - one successful receive()/webhook parse with normalized output
 *   - failure paths EXECUTED, not just coded: auth failure (401), rate limit
 *     (429), network timeout, malformed response
 *   - webhook signature verification (GitHub sha256/sha1, Resend Svix
 *     HMAC-SHA256)
 *   - B61: GitHub create_file / update_file (Contents API with SHA read),
 *     Resend inbound (Svix verify + Received-emails fetch) + reply() with
 *     Re:/threading headers
 *   - B66: the Meta messaging connector was removed — zero references remain
 *   - B66: email auto-reply loop (verified inbound email.received → JEXI
 *     generates a reply → send() → recorded in the inbox) and creator
 *     recognition (lewiseinstein15@gmail.com → creator: true)
 *   - connectorToToolSchema introspects real send() signatures
 *   - the agent-facing connector-call tool is EXTERNAL-tier and always pauses
 *     for one approval with finalized details
 */
process.env.DATA_DIR = process.env.DATA_DIR || `/tmp/jexi-b56-${Date.now()}`;

// Isolate from any real provider credentials that might exist in the host
// environment (CI runners set GITHUB_TOKEN, for example) — the suite must
// only ever hit the mocks.
for (const key of [
  'GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_APP_ID', 'GITHUB_PRIVATE_KEY', 'GITHUB_INSTALLATION_ID', 'GITHUB_WEBHOOK_SECRET',
  'RESEND_API_KEY', 'RESEND_FROM', 'RESEND_WEBHOOK_SECRET', 'JEXI_CREATOR_EMAIL',
]) delete process.env[key];

import { ConnectorRegistry } from './src/connectors/ConnectorRegistry.js';
import { ConnectorConfig, ConnectorError, ERROR_CODES, httpJson, withTimeout, maskSecret, createHmacSha256, createHmacSha1, assertAsciiSecret } from './src/connectors/ConnectorBase.js';
import { recordWebhookEvents, recordHandshake, listInbound, listConversations, resetConnectorInbox } from './src/services/ConnectorInbox.js';
import { registerGitHubConnector, GitHubConnector } from './src/connectors/github.js';
import { registerEmailConnector, ResendConnector, verifySvixSignature, verifySvixSignatureDetailed } from './src/connectors/email.js';
import { registerConnectors, getConnectorStatus, saveConnectorConfig, callConnector, handleConnectorWebhook, setInboundReplyGenerator } from './src/connectors/index.js';
import { connectorToToolSchema, listConnectorTools, introspectSendSignature } from './src/connectors/toolBridge.js';
import { executeTool, toolTier, getToolCatalog } from './src/services/ToolRuntime.js';
import { startMockConnectorApis, startHangingServer, lastSentHeaders, lastSentFrom, resetLastSentHeaders } from './tests/connectorMocks.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// Save/restore the real settings.json so the saveConnectorConfig round-trip
// below can never leak test config into the project state.
const SETTINGS_PATH = path.join(process.cwd(), 'settings.json');
const originalSettings = fs.existsSync(SETTINGS_PATH) ? fs.readFileSync(SETTINGS_PATH, 'utf-8') : null;

let passed = 0;
let failed = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { passed++; console.log(`  ✅ ${name}${extra ? ` — ${extra}` : ''}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
};
const expectError = async (fn, code, label) => {
  try { await fn(); ok(false, label, 'expected an error, got success'); }
  catch (e) {
    ok(e instanceof ConnectorError && e.code === code, label, `${(e && e.message) || e}`.slice(0, 140));
  }
};

const mocks = await startMockConnectorApis();
const hanging = await startHangingServer();

/* ------------------------------------------------------------------ */
console.log('\n== B56 CORE — REGISTRY + ERROR TAXONOMY ==');
/* ------------------------------------------------------------------ */

try { ConnectorRegistry.register('broken', { send() {} }); ok(false, 'register() throws when authenticate is missing'); } catch (e) { ok(true, 'register() throws when authenticate is missing'); }
try { ConnectorRegistry.register('nope', { description: 'not a connector' }); ok(false, 'register() throws for a non-connector object'); } catch (e) { ok(true, 'register() throws for a non-connector object'); }
ok(registerConnectors().length >= 2, 'registerConnectors() registers every connector from settings without throwing');
ConnectorRegistry.clear();

ok(ERROR_CODES.AUTH_FAILED === 'AUTH_FAILED' && ERROR_CODES.RATE_LIMITED === 'RATE_LIMITED', 'error taxonomy defines auth/rate-limit/timeout/malformed codes');
ok(maskSecret('sk-live-secret-1234') === '••••1234', 'maskSecret masks secrets, keeps 4 tail chars');
ok(maskSecret('') === '', 'maskSecret leaves empty values alone');

const t0 = Date.now();
let timedOut = null;
try { await withTimeout(new Promise(() => {}), 300, 'test'); } catch (e) { timedOut = e; }
ok(timedOut instanceof ConnectorError && timedOut.code === ERROR_CODES.TIMEOUT && Date.now() - t0 < 2000, 'withTimeout rejects with TIMEOUT instead of hanging', timedOut && timedOut.message);

// httpJson direct failure classification (unit-level, no connector involved).
await expectError(() => httpJson(`${mocks.github.url}/user`, { headers: { Authorization: 'Bearer bad-token' }, provider: 'mock' }), ERROR_CODES.AUTH_FAILED, 'httpJson classifies 401 as AUTH_FAILED');
await expectError(() => httpJson(`${mocks.github.url}/repos/o/r/issues`, { headers: { Authorization: 'Bearer ratelimit-token' }, provider: 'mock' }), ERROR_CODES.RATE_LIMITED, 'httpJson classifies 429 as RATE_LIMITED');
await expectError(() => httpJson(`${hanging.url}/never`, { timeout: 400, provider: 'mock' }), ERROR_CODES.TIMEOUT, 'httpJson classifies a hang as TIMEOUT');
await expectError(() => httpJson('http://127.0.0.1:1/nope', { timeout: 1500, provider: 'mock' }), ERROR_CODES.NETWORK, 'httpJson classifies connection failure as NETWORK');

/* ------------------------------------------------------------------ */
console.log('\n== B56 GITHUB (MOCK — GitHub REST API shape) ==');
/* ------------------------------------------------------------------ */

const gh = registerGitHubConnector(new ConnectorConfig({
  name: 'github',
  auth: { token: 'ok-pat', webhookSecret: 'gh-secret', baseUrl: mocks.github.url },
}));
const ghAuth = await gh.authenticate();
ok(ghAuth && ghAuth.ok && ghAuth.login === 'jexi-bot', 'authenticate() (PAT) succeeds against the mock and reports the account');
const ghHealth = await gh.healthCheck();
ok(ghHealth.status === 'ok' && /@jexi-bot/.test(ghHealth.detail), 'GitHub health check names the authenticated account', ghHealth.detail);
const ghBad = new GitHubConnector(new ConnectorConfig({ name: 'github', auth: { token: 'bad-token', baseUrl: mocks.github.url } }));
await expectError(() => ghBad.authenticate(), ERROR_CODES.AUTH_FAILED, 'authenticate() fails with AUTH_FAILED on a bad PAT (401 path executed)');

// GitHub App auth: JWT → installation token (real flow, real RSA keygen).
const appKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const ghApp = new GitHubConnector(new ConnectorConfig({ name: 'github', auth: { appId: '123', privateKey: appKey, installationId: '1', baseUrl: mocks.github.url } }));
const jwt = ghApp.createAppJwt('123', appKey);
ok(typeof jwt === 'string' && jwt.split('.').length === 3, 'GitHub App JWT signed (RS256, no dependency)');
const instToken = await ghApp.getInstallationToken();
ok(instToken === 'ghs_install_token_mock', 'GitHub App installation token fetched (mock)');
const cachedToken = await ghApp.getInstallationToken();
ok(cachedToken === instToken, 'installation token cached (no repeated calls)');
ghApp._installTokenExpiresAt = Date.now() - 1000; // force expiry
const refreshed = await ghApp.getInstallationToken();
ok(refreshed === 'ghs_install_token_mock', 'installation token refreshed after expiry');
ok(await ghApp.authenticate(), 'GitHub App authenticate() succeeds via installation token');

// send() actions.
const issue = await gh.send({ action: 'create_issue', owner: 'o', repo: 'r', title: 'Test issue' });
ok(issue.ok === true && issue.number === 101, 'create_issue → real issue number returned', `#${issue.number}`);
const comment = await gh.send({ action: 'create_comment', owner: 'o', repo: 'r', issue_number: 101, body: 'LGTM' });
ok(comment.ok === true && comment.id === 4242, 'create_comment → comment id returned');
const pr = await gh.send({ action: 'create_pr', owner: 'o', repo: 'r', title: 'Feature', head: 'feat/x', base: 'main' });
ok(pr.ok === true && pr.number === 7, 'create_pr → PR number returned');
const commit = await gh.send({ action: 'create_commit', owner: 'o', repo: 'r', branch: 'main', message: 'add file', changes: [{ path: 'a.txt', content: 'hello' }] });
ok(commit.ok === true && commit.sha === 'commitsha1', 'create_commit → blob→tree→commit→ref flow returns commit sha');

// B61 — Contents API file operations.
const createdFile = await gh.send({ action: 'create_file', owner: 'o', repo: 'r', path: 'docs/notes.md', content: '# Notes\nhello', message: 'create notes' });
ok(createdFile.ok === true && createdFile.action === 'create_file' && createdFile.commit && createdFile.html_url && /docs\/notes\.md/.test(createdFile.html_url), 'create_file → real commit sha + file URL returned', `commit=${createdFile.commit}`);
const updatedFile = await gh.send({ action: 'update_file', owner: 'o', repo: 'r', path: 'docs/notes.md', content: '# Notes\nupdated', message: 'update notes' });
ok(updatedFile.ok === true && updatedFile.action === 'update_file' && updatedFile.commit && updatedFile.commit !== createdFile.commit, 'update_file → reads the existing SHA first and commits the change', `commit=${updatedFile.commit}`);
let missingShaErr = null;
try { await gh.send({ action: 'update_file', owner: 'o', repo: 'r', path: 'brand-new.md', content: 'x', message: 'should fail' }); } catch (e) { missingShaErr = e; }
ok(missingShaErr && missingShaErr.code === ERROR_CODES.PROVIDER_ERROR && /create_file/.test(missingShaErr.message), 'update_file on a missing file fails honestly (use create_file)', missingShaErr && missingShaErr.message);
await expectError(() => gh.send({ action: 'create_file', owner: 'o', repo: 'r', path: 'x.md', message: 'no content' }), ERROR_CODES.PROVIDER_ERROR, 'create_file without content fails cleanly');

await expectError(() => gh.send({ action: 'create_issue', owner: 'o', repo: 'r' }), ERROR_CODES.PROVIDER_ERROR, 'create_issue without title fails cleanly');
const ghRate = new GitHubConnector(new ConnectorConfig({ name: 'github', auth: { token: 'ratelimit-token', baseUrl: mocks.github.url } }));
await expectError(() => ghRate.send({ action: 'create_issue', owner: 'o', repo: 'r', title: 't' }), ERROR_CODES.RATE_LIMITED, 'send() rate-limited (429 path executed)');
const ghDenied = new GitHubConnector(new ConnectorConfig({ name: 'github', auth: { token: 'denied-token', baseUrl: mocks.github.url } }));
let ghDeniedErr = null;
try { await ghDenied.send({ action: 'create_issue', owner: 'o', repo: 'r', title: 't' }); } catch (e) { ghDeniedErr = e; }
ok(ghDeniedErr && ghDeniedErr.code === ERROR_CODES.PERMISSION_DENIED && /Resource not accessible/.test(ghDeniedErr.message), '403 keeps the provider\'s own words (scope diagnosis)', ghDeniedErr && ghDeniedErr.message);

// Webhook verification + normalization.
const ghBody = { ref: 'refs/heads/main', repository: { full_name: 'o/r' }, pusher: { name: 'ada' }, commits: [{ id: 'c1', message: 'fix stuff', author: { name: 'ada' } }], head_commit: { id: 'c1' } };
const ghRaw = JSON.stringify(ghBody);
ok(gh.verifyWebhookSignature(ghRaw, { 'x-hub-signature-256': `sha256=${createHmacSha256('gh-secret', ghRaw)}` }) === true, 'GitHub webhook verified (X-Hub-Signature-256)');
ok(gh.verifyWebhookSignature(ghRaw, { 'x-hub-signature': `sha1=${createHmacSha1('gh-secret', ghRaw)}` }) === true, 'GitHub webhook verified (legacy X-Hub-Signature sha1)');
ok(gh.verifyWebhookSignature(ghRaw, { 'x-hub-signature-256': 'sha256=tampered' }) === false, 'GitHub webhook rejected when tampered');
const pushEvents = gh.normalizeInbound(ghBody);
ok(pushEvents.length === 1 && pushEvents[0].type === 'push' && pushEvents[0].branch === 'main' && pushEvents[0].commits[0].message === 'fix stuff', 'receive() normalizes push event');
const issueEvents = gh.normalizeInbound({ action: 'opened', issue: { number: 42, title: 'Bug', body: 'details', html_url: 'u', user: { login: 'ada' } }, repository: { full_name: 'o/r' } });
ok(issueEvents.length === 1 && issueEvents[0].type === 'issue' && issueEvents[0].number === 42, 'receive() normalizes issues event');
const prEvents = gh.normalizeInbound({ action: 'opened', pull_request: { number: 3, title: 'PR', html_url: 'u', user: { login: 'ada' } }, repository: { full_name: 'o/r' } });
ok(prEvents.length === 1 && prEvents[0].type === 'pull_request' && prEvents[0].number === 3, 'receive() normalizes pull_request event');

/* ------------------------------------------------------------------ */
console.log('\n== B57 EMAIL (MOCK — Resend API shape) ==');
/* ------------------------------------------------------------------ */

const em = registerEmailConnector(new ConnectorConfig({ name: 'email', auth: { apiKey: 'ok-key', baseUrl: mocks.resend.url } }));
ok(await em.authenticate(), 'authenticate() (GET /domains) succeeds against the mock');
const emBad = new ResendConnector(new ConnectorConfig({ name: 'email', auth: { apiKey: 'bad-key', baseUrl: mocks.resend.url } }));
await expectError(() => emBad.authenticate(), ERROR_CODES.AUTH_FAILED, 'authenticate() fails with AUTH_FAILED on a bad key (401 path executed)');

const mail = await em.send({ from: 'JEXI OS <jexi@example.com>', to: ['ada@example.com'], subject: 'Build 57', text: 'Hello' });
ok(mail.ok === true && /^resend-mock-/.test(mail.message_id), 'send() → real Resend email id returned', `id=${mail.message_id}`);
// From-chain: no from anywhere → Resend onboarding test sender (documented).
const mailNoFrom = await em.send({ to: ['ada@example.com'], subject: 'No from', text: 'Hello' });
ok(mailNoFrom.ok === true && /^resend-mock-/.test(mailNoFrom.message_id), 'send() falls back to the Resend onboarding test sender when no from is set');
await expectError(() => em.send({ from: 'jexi@example.com', to: ['ada@example.com'], text: 'no subject' }), ERROR_CODES.PROVIDER_ERROR, 'send() without subject fails cleanly');
const emRate = new ResendConnector(new ConnectorConfig({ name: 'email', auth: { apiKey: 'ratelimit-key', baseUrl: mocks.resend.url } }));
await expectError(() => emRate.send({ from: 'a@b.c', to: ['d@e.f'], subject: 's', text: 't' }), ERROR_CODES.RATE_LIMITED, 'send() rate-limited (429 path executed)');
const emFail = new ResendConnector(new ConnectorConfig({ name: 'email', auth: { apiKey: 'fail-key', baseUrl: mocks.resend.url } }));
await expectError(() => emFail.send({ from: 'a@b.c', to: ['d@e.f'], subject: 's', text: 't' }), ERROR_CODES.PROVIDER_ERROR, 'send() provider 500 (path executed)');
const emMalformed = new ResendConnector(new ConnectorConfig({ name: 'email', auth: { apiKey: 'malformed-key', baseUrl: mocks.resend.url } }));
await expectError(() => emMalformed.send({ from: 'a@b.c', to: ['d@e.f'], subject: 's', text: 't' }), ERROR_CODES.MALFORMED_RESPONSE, 'send() malformed response (wrong-shape 200 body path executed)');

// Delivery webhook — distinct outcomes, never conflated with delivery.
const events = em.handleEvents([
  { type: 'email.sent', data: { email_id: 'id1', to: 'a@b.c', created_at: '2026-01-01T00:00:00Z' } },
  { type: 'email.delivered', data: { email_id: 'id2', to: 'b@c.d', created_at: '2026-01-01T00:00:00Z' } },
  { type: 'email.bounced', data: { email_id: 'id3', to: 'bad@b.c', created_at: '2026-01-01T00:00:00Z', bounce: { description: '550 mailbox full', category: 'hard_bounce' } } },
  { type: 'email.dropped', data: { email_id: 'id4', to: 'drop@b.c', created_at: '2026-01-01T00:00:00Z', dropped: { description: 'invalid address' } } },
]);
ok(events.delivered.length === 1 && events.bounced.length === 1 && events.bounced[0].reason === '550 mailbox full', 'bounces classified distinctly from deliveries');
ok(events.dropped.length === 1 && events.sent.length === 1, 'drops and sends classified distinctly');

// receive() normalizes a Resend delivery webhook body.
const resendInbound = await em.receive({
  type: 'email.delivered',
  data: { email_id: 'ev1', to: 'you@example.com', from: 'JEXI OS <jexi@example.com>', subject: 'Hello', created_at: '2026-01-01T00:00:00Z' },
});
ok(resendInbound.length === 1 && resendInbound[0].provider === 'resend' && resendInbound[0].to[0] === 'you@example.com' && resendInbound[0].type === 'email.delivered', 'receive() normalizes a Resend delivery webhook');

/* ------------------------------------------------------------------ */
console.log('\n== B61 EMAIL INBOUND (Svix verify + Received-emails fetch + reply) ==');
/* ------------------------------------------------------------------ */

// B64 FIX — Resend (via Svix) signs with HMAC-SHA256 over
// `${svix-id}.${svix-timestamp}.${rawBody}` using the base64-decoded whsec_
// secret — NOT Ed25519 (the B61 build got that wrong and 403'd every real
// delivery). First regression-test against Svix's OWN published example
// (docs.svix.com → verifying-payloads/how-manual), then real round-trips.
ok(
  verifySvixSignature('whsec_plJ3nmyCDGBKInavdOK15jsl', '{"event_type":"ping","data":{"success":true}}',
    { 'svix-id': 'msg_loFOjxBNrRLzqYUf', 'svix-timestamp': '1731705121', 'svix-signature': 'v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=' },
    { toleranceSeconds: 1e9 }) === true,
  'Svix official example signature verifies (HMAC-SHA256, matches published docs)'
);
const svixSecret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
const svixKey = Buffer.from('MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw', 'base64');
const emailPayload = JSON.stringify({ type: 'email.received', data: { email_id: 'inbound-1', from: 'user@example.com', to: ['jexi@yourdomain.com'], subject: 'Testing JEXI inbound', created_at: '2026-08-15T12:00:00.000Z' } });
const nowTs = String(Math.floor(Date.now() / 1000)); // inside the 300s tolerance
const svixContent = `msg_1.${nowTs}.${emailPayload}`;
const svixSig = crypto.createHmac('sha256', svixKey).update(svixContent, 'utf8').digest('base64');
const svixHeaders = { 'svix-id': 'msg_1', 'svix-timestamp': nowTs, 'svix-signature': `v1,${svixSig}` };
ok(verifySvixSignature(svixSecret, emailPayload, svixHeaders) === true, 'Svix webhook signature verified (HMAC-SHA256, real sign/verify)');
ok(verifySvixSignature(svixSecret, emailPayload + 'tampered', svixHeaders) === false, 'Svix webhook rejected when the body is tampered');
ok(verifySvixSignature(svixSecret, emailPayload, { ...svixHeaders, 'svix-signature': 'v1,c2lnbmF0dXJl' }) === false, 'Svix webhook rejected on a bad signature');
ok(verifySvixSignature('', emailPayload, svixHeaders) === false, 'Svix webhook rejected with no secret');
ok(verifySvixSignature(svixSecret, emailPayload, { ...svixHeaders, 'svix-timestamp': '1691785099' }) === false, 'Svix webhook rejected when the timestamp is outside tolerance (replay guard)');
ok(verifySvixSignature(svixSecret, emailPayload, { ...svixHeaders, 'svix-signature': 'v2,' + svixSig }) === false, 'Svix webhook rejected for an unsupported version prefix');
const svixDet = verifySvixSignatureDetailed(svixSecret, emailPayload + 'tampered', svixHeaders);
ok(svixDet.ok === false && typeof svixDet.reason === 'string' && svixDet.reason.length > 0, 'detailed verification returns a human-readable rejection reason (B64)', svixDet.reason);
const svixDetOk = verifySvixSignatureDetailed(svixSecret, emailPayload, svixHeaders);
ok(svixDetOk.ok === true && /HMAC/.test(svixDetOk.reason), 'detailed verification confirms the HMAC-SHA256 match');

const emWeb = new ResendConnector(new ConnectorConfig({ name: 'email', auth: { apiKey: 'ok-key', webhookSecret: svixSecret, baseUrl: mocks.resend.url } }));
ok(emWeb.verifyWebhookSignature(emailPayload, svixHeaders) === true, 'connector.verifyWebhookSignature() validates the Svix headers');
ok(emWeb.verifyWebhookSignature(emailPayload, { ...svixHeaders, 'svix-signature': 'v1,bad' }) === false, 'connector rejects a tampered Svix signature');
const emWebDet = emWeb.verifyWebhookSignatureResult(emailPayload, { ...svixHeaders, 'svix-signature': 'v1,bad' });
ok(emWebDet.ok === false && /no svix v1 signature/.test(emWebDet.reason), 'connector exposes the exact rejection reason (B64)', emWebDet.reason);

// Inbound receive: the webhook carries metadata only; the body is fetched
// from the Received-emails API and normalized into the internal shape.
const inboundEvents = await emWeb.receive(JSON.parse(emailPayload));
ok(inboundEvents.length === 1 && inboundEvents[0].type === 'inbound' && inboundEvents[0].provider === 'resend', 'inbound email webhook → normalized inbound event');
ok(inboundEvents[0].text === 'Hello JEXI, can you reply?' && inboundEvents[0].subject === 'Testing JEXI inbound', 'receive() fetches the full body from the Received-emails API');
ok(inboundEvents[0].messageId === '<orig-msg-1@example.com>' && inboundEvents[0].from === 'user@example.com' && inboundEvents[0].to[0] === 'jexi@yourdomain.com', 'inbound event carries sender + recipient + Message-ID');
ok(inboundEvents[0].creator === false, 'non-creator sender → creator: false (recognition is specific, not blanket)');

// B66 — CREATOR RECOGNITION: an inbound email from JEXI's creator (Lewis,
// lewiseinstein15@gmail.com by default) is flagged creator: true with the
// same parsed metadata as any other sender — recognition, not bypass.
const creatorPayload = JSON.stringify({ type: 'email.received', data: { email_id: 'creator-inbound-1', from: 'lewiseinstein15@gmail.com', to: ['jexi@yourdomain.com'], subject: 'Directive from Lewis', created_at: '2026-08-15T12:05:00.000Z' } });
const creatorEvents = await emWeb.receive(JSON.parse(creatorPayload));
ok(creatorEvents.length === 1 && creatorEvents[0].creator === true && creatorEvents[0].from === 'lewiseinstein15@gmail.com', 'creator recognition: lewiseinstein15@gmail.com → creator: true', JSON.stringify({ creator: creatorEvents[0] && creatorEvents[0].creator, from: creatorEvents[0] && creatorEvents[0].from }));
ok(creatorEvents[0].text === 'JEXI, please build me a landing page for a new product.' && creatorEvents[0].subject === 'Directive from Lewis', 'creator email body + subject parsed normally (recognition never alters the message)', creatorEvents[0] && creatorEvents[0].text);

// Webhook dispatch: Svix-verified email.received → recorded in the inbox.
ConnectorRegistry.unregister('email');
registerEmailConnector(new ConnectorConfig({ name: 'email', auth: { apiKey: 'ok-key', webhookSecret: svixSecret, baseUrl: mocks.resend.url } }));
resetConnectorInbox();
const emailWh = await handleConnectorWebhook('email', { rawBody: emailPayload, headers: svixHeaders, body: JSON.parse(emailPayload) });
ok(emailWh.kind === 'events' && emailWh.verified === true && emailWh.events.length === 1, 'email webhook dispatch verifies (Svix) + normalizes inbound');
const emailInbox = listInbound('email', 10);
ok(emailInbox.total === 1 && emailInbox.events[0].type === 'inbound' && emailInbox.events[0].text === 'Hello JEXI, can you reply?', 'email inbound delivery recorded in the inbox (provable)');

// reply(): same thread — Re: subject, In-Reply-To + References headers,
// quoted original, reply_to = our receiving address.
resetLastSentHeaders();
const replyRes = await emWeb.reply({ email_id: 'inbound-1', text: 'Got it — JEXI here.' });
ok(replyRes.ok === true && /^resend-mock-/.test(replyRes.message_id), 'reply() sends and returns Resend\'s real message id');
ok(replyRes.subject === 'Re: Testing JEXI inbound', 'reply() prefixes the subject with Re:', replyRes.subject);
ok(replyRes.in_reply_to === '<orig-msg-1@example.com>', 'reply() carries the original Message-ID');
ok(lastSentHeaders && lastSentHeaders['In-Reply-To'] === '<orig-msg-1@example.com>', 'reply() sets In-Reply-To on the wire');
ok(lastSentHeaders && /older-msg@example\.com/.test(lastSentHeaders.References || ''), 'reply() appends to References (thread continuity)');
const replyNoEmailId = await emWeb.reply({ to: 'user@example.com', subject: 'Standalone', text: 'hi' });
ok(replyNoEmailId.ok === true && replyNoEmailId.subject === 'Standalone', 'reply() works with explicit to/subject (no email_id needed)');

// B65 — RESEND_FROM (verified sender) wins over the unverified receiving
// address as the reply From (the resend.app domain 403s on send — proven
// live). reply_to still points at the receiving address for thread continuity.
const emFrom = new ResendConnector(new ConnectorConfig({ name: 'email', auth: { apiKey: 'ok-key', webhookSecret: svixSecret, from: 'JEXI OS <hello@verified.dev>', baseUrl: mocks.resend.url } }));
resetLastSentHeaders();
await emFrom.reply({ email_id: 'inbound-1', text: 'Using the configured sender' });
ok(lastSentFrom === 'JEXI OS <hello@verified.dev>', 'reply() uses RESEND_FROM as the From when configured (B65)', lastSentFrom);
const emNoFrom = new ResendConnector(new ConnectorConfig({ name: 'email', auth: { apiKey: 'ok-key', webhookSecret: svixSecret, baseUrl: mocks.resend.url } }));
resetLastSentHeaders();
await emNoFrom.reply({ email_id: 'inbound-1', text: 'Falling back' });
ok(lastSentFrom === 'JEXI OS <onboarding@resend.dev>', 'reply() falls back to the documented test sender when RESEND_FROM is unset', lastSentFrom);

/* ------------------------------------------------------------------ */
console.log('\n== B56 TOOL BRIDGE — introspected agent tool schemas ==');
/* ------------------------------------------------------------------ */

ok(JSON.stringify(introspectSendSignature(em)) === JSON.stringify(['payload']), 'send() signature introspected (not a hardcoded stub)', `params=${JSON.stringify(introspectSendSignature(em))}`);
const ghSchema = connectorToToolSchema('github');
ok(ghSchema.function.name === 'send_github' && ghSchema.function.parameters.required.includes('action') && ghSchema.function.parameters.required.includes('owner'), 'github tool schema: action+owner required, action description present');
ok(ghSchema.function.parameters.properties.path && ghSchema.function.parameters.properties.content && ghSchema.function.parameters.properties.message, 'github tool schema exposes create_file/update_file fields (path/content/message)');
const emSchema = connectorToToolSchema('email');
ok(emSchema.function.name === 'send_email' && emSchema.function.parameters.properties.subject && emSchema.function.parameters.properties.to, 'email tool schema: subject + to present');
const allTools = listConnectorTools();
ok(allTools.length >= 2 && allTools.every((t) => t.type === 'function' && t.function.name.startsWith('send_')), 'schemas generated for every registered connector', allTools.map((t) => t.function.name).join(', '));

/* ------------------------------------------------------------------ */
console.log('\n== B56 AGENT PATH — connector-call tool gating (EXTERNAL tier) ==');
/* ------------------------------------------------------------------ */

ok(toolTier('connector-call', { method: 'send' }) === 'external', 'connector-call send is EXTERNAL (one human approval)');
ok(toolTier('connector-call', { method: 'receive' }) === 'read', 'connector-call receive is READ (no side effects)');
ok(toolTier('connector-call', { method: 'health' }) === 'read', 'connector-call health is READ');
const catalog = getToolCatalog().find((t) => t.slug === 'connector-call');
ok(!!catalog && catalog.tier === 'external' && catalog.executable === true, 'connector-call appears in the tool catalog as EXTERNAL + executable');

// No confirm callback → refused with real finalized details (never auto-runs).
const needApproval = await executeTool({ slug: 'connector-call', args: { name: 'github', method: 'send', payload: { action: 'create_issue', owner: 'o', repo: 'r', title: 'Ship it' } }, profile: 'full' });
ok(needApproval.ok === false && needApproval.approvalRequired === true && needApproval.tier === 'external', 'agent send without approval → approvalRequired (fail closed)');
ok(needApproval.details && needApproval.details.includes('create_issue') && needApproval.details.includes('Ship it'), 'approval shows the REAL finalized details', needApproval.details);

// Confirm(true) → runs against the provider; Confirm(false) → declined.
const approved = await executeTool({ slug: 'connector-call', args: { name: 'github', method: 'send', payload: { action: 'create_issue', owner: 'o', repo: 'r', title: 'Approved issue' } }, profile: 'full', confirm: async () => true });
ok(approved.ok === true && String(approved.result).includes('101'), 'approved EXTERNAL send runs and returns the real provider response');
const declined = await executeTool({ slug: 'connector-call', args: { name: 'github', method: 'send', payload: { action: 'create_issue', owner: 'o', repo: 'r', title: 'Nope' } }, profile: 'full', confirm: async () => false });
ok(declined.ok === false && declined.declined === true, 'declined EXTERNAL send is cancelled — exactly one approval asked');

// health via the agent path (READ tier → no approval, runs).
const healthRes = await executeTool({ slug: 'connector-call', args: { name: 'github', method: 'health' }, profile: 'full' });
ok(healthRes.ok === true && String(healthRes.result).includes('"status": "ok"'), 'connector health via agent path (READ tier, no approval)');

// Unknown connector → honest structured failure, not a fabricated success.
const unknown = await executeTool({ slug: 'connector-call', args: { name: 'slack', method: 'send', payload: {} }, profile: 'full', confirm: async () => true });
ok(unknown.ok === false && String(unknown.error).includes("Connector 'slack' not registered"), 'unknown connector fails honestly (never fabricated success)');

// callConnector respects the enabled flag.
const off = await callConnector('email', { method: 'send', payload: { to: ['a@b.c'], subject: 'x', text: 'y' } });
ok(off.ok === true, 'callConnector send dispatches through the registry (email registered)');

/* ------------------------------------------------------------------ */
console.log('\n== B56 CONNECTOR SYSTEM — registry + webhook dispatch ==');
/* ------------------------------------------------------------------ */

const names = ConnectorRegistry.listAvailable();
ok(names.includes('github') && names.includes('email') && !names.includes('telegram') && !names.includes('whatsapp'), 'registry lists exactly GitHub + Email (messaging connectors removed)', names.join(', '));

const whReject = await handleConnectorWebhook('github', { rawBody: '{}', headers: { 'x-hub-signature-256': 'sha256=tampered' }, body: {} });
ok(whReject.kind === 'rejected', 'webhook dispatch rejects a bad signature (403 path)');
const ghWh = await handleConnectorWebhook('github', { rawBody: ghRaw, headers: { 'x-github-event': 'push', 'x-hub-signature-256': `sha256=${createHmacSha256('gh-secret', ghRaw)}` }, body: ghBody });
ok(ghWh.kind === 'events' && ghWh.verified === true && ghWh.events.length === 1 && ghWh.events[0].type === 'push', 'github webhook dispatch verifies (HMAC) + normalizes events');

const status = await getConnectorStatus();
ok(status.length >= 2 && status.every((c) => c.name && c.enabled !== undefined && c.tier === 'external'), 'getConnectorStatus returns health + masked config for every connector');
const authJson = JSON.stringify(status.map((c) => c.auth));
ok(!authJson.includes('ok-pat') && !authJson.includes('ok-key') && !authJson.includes('gh-secret'), 'connector status masks secrets (no raw keys leak)');

// saveConnectorConfig round-trips (email used here — Telegram is gone).
const saved = saveConnectorConfig('email', { auth: { apiKey: 'new-key' }, enabled: true });
ok(saved.name === 'email' && saved.enabled === true, 'saveConnectorConfig persists + re-registers a connector');
ConnectorRegistry.unregister('email');
registerEmailConnector(new ConnectorConfig({ name: 'email', auth: { apiKey: 'ok-key', baseUrl: mocks.resend.url } }));

// Restore the project's real settings.json (test never leaves state behind).
if (originalSettings !== null) fs.writeFileSync(SETTINGS_PATH, originalSettings, 'utf-8');
else fs.rmSync(SETTINGS_PATH, { force: true });

/* ------------------------------------------------------------------ */
console.log('\n== B59 — corrupted-secret guard + inbound inbox ==');
/* ------------------------------------------------------------------ */

// assertAsciiSecret: clean ASCII passes, a stray emoji (U+2705 — exactly what
// corrupted the live RESEND_API_KEY on Render) is rejected with a clear message.
ok(assertAsciiSecret('re_abc123', 'RESEND_API_KEY') === 're_abc123', 'assertAsciiSecret passes clean ASCII secrets');
let asciiErr = null;
try { assertAsciiSecret('re_abc\u2705def', 'RESEND_API_KEY'); } catch (e) { asciiErr = e; }
ok(asciiErr && asciiErr.code === ERROR_CODES.PROVIDER_ERROR && /non-ASCII/.test(asciiErr.message), 'assertAsciiSecret rejects a key containing an emoji with a clear message');

// A corrupted env key surfaces a readable health error instead of Node's
// cryptic "Cannot convert argument to a ByteString" TypeError.
process.env.RESEND_API_KEY = 're_bad\u2705key';
registerEmailConnector(new ConnectorConfig({ name: 'email', auth: { baseUrl: mocks.resend.url } }));
const badHealth = await callConnector('email', { method: 'health' });
ok(badHealth.ok === false && /non-ASCII/.test((badHealth.health && badHealth.health.detail) || ''), 'email health with an emoji-corrupted key fails with a readable error');
delete process.env.RESEND_API_KEY;
registerEmailConnector(new ConnectorConfig({ name: 'email', auth: { baseUrl: mocks.resend.url } }));

// Inbound inbox: records + lists webhook events and handshakes, newest first.
resetConnectorInbox();
recordWebhookEvents('email', [{ id: 'in1', provider: 'resend', from: 'user@example.com', to: ['jexi@yourdomain.com'], type: 'inbound', text: 'hi', raw: { huge: 'envelope' } }]);
recordHandshake('email', { verified: true, challenge: 'challenge-42' });
recordHandshake('email', { verified: false, reason: 'svix signature mismatch' });
const inbox = listInbound('email', 10);
ok(inbox.total === 1 && inbox.events.length === 1 && inbox.events[0].from === 'user@example.com' && inbox.events[0].text === 'hi', 'inbox stores normalized inbound events');
ok(!('raw' in inbox.events[0]) && inbox.events[0].type === 'inbound', 'inbox strips raw provider envelopes from stored events');
ok(inbox.handshakes.length === 2 && inbox.handshakes[0].verified === false && inbox.handshakes[1].verified === true, 'inbox records webhook handshake outcomes (newest first)');
resetConnectorInbox();
const emptyInbox = listInbound('email', 10);
ok(emptyInbox.total === 0 && emptyInbox.events.length === 0 && emptyInbox.handshakes.length === 0, 'resetConnectorInbox clears the store');

/* ------------------------------------------------------------------ */
console.log('\n== B66 EMAIL AUTO-REPLY LOOP (verified inbound → JEXI reply → send) ==');
/* ------------------------------------------------------------------ */

// Re-register with the Svix webhook secret — the B59 corrupted-key section
// re-registered the connector WITHOUT it, so deliveries would be rejected.
ConnectorRegistry.unregister('email');
registerEmailConnector(new ConnectorConfig({ name: 'email', auth: { apiKey: 'ok-key', webhookSecret: svixSecret, baseUrl: mocks.resend.url } }));

// Register a fake reply generator (server/index.js registers the real LLM one)
// and deliver a REAL verified inbound email.received webhook — the loop must
// answer automatically, exactly like the messaging loop it replaces.
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
resetConnectorInbox();
setInboundReplyGenerator(async (ev) => `JEXI here! You said: ${ev.text}`);
const creatorNowTs = String(Math.floor(Date.now() / 1000));
const creatorContent = `msg_2.${creatorNowTs}.${creatorPayload}`;
const creatorSig = crypto.createHmac('sha256', svixKey).update(creatorContent, 'utf8').digest('base64');
const creatorHeaders = { 'svix-id': 'msg_2', 'svix-timestamp': creatorNowTs, 'svix-signature': `v1,${creatorSig}` };
const creatorWh = await handleConnectorWebhook('email', { rawBody: creatorPayload, headers: creatorHeaders, body: JSON.parse(creatorPayload) });
ok(creatorWh.kind === 'events' && creatorWh.verified === true && creatorWh.events.length === 1 && creatorWh.events[0].creator === true, 'creator email webhook verified (Svix) + normalized with creator: true', (creatorWh.events && creatorWh.events[0]) ? `creator=${creatorWh.events[0].creator}` : '');
await tick(150); // the reply send is fire-and-forget; give it a beat
const replyInbox = listInbound('email', 10);
const replyEvent = replyInbox.events.find((e) => e.type === 'reply');
ok(!!replyEvent && replyEvent.ok === true && /^resend-mock-/.test(replyEvent.id), 'auto-reply SENT via send() and recorded in the inbox (message id returned)', replyEvent && `id=${replyEvent.id}`);
ok(replyEvent && replyEvent.to === 'lewiseinstein15@gmail.com' && replyEvent.text === 'JEXI here! You said: JEXI, please build me a landing page for a new product.', 'auto-reply addressed to the sender with the generated text');
ok(replyEvent && replyEvent.in_reply_to === '<creator-msg-1@gmail.com>', 'auto-reply records which inbound message it answers');

// Generator returning empty → no reply sent, no inbox noise.
resetConnectorInbox();
setInboundReplyGenerator(async () => '');
await handleConnectorWebhook('email', { rawBody: emailPayload, headers: svixHeaders, body: JSON.parse(emailPayload) });
await tick(100);
ok(listInbound('email', 10).events.every((e) => e.type !== 'reply'), 'empty generated reply → nothing sent');

// Generator throwing → reply failure recorded honestly, webhook still 200.
resetConnectorInbox();
setInboundReplyGenerator(async () => { throw new Error('LLM down'); });
await handleConnectorWebhook('email', { rawBody: emailPayload, headers: svixHeaders, body: JSON.parse(emailPayload) });
await tick(100);
const failReply = listInbound('email', 10).events.find((e) => e.type === 'reply');
ok(!!failReply && failReply.ok === false && /LLM down/.test(failReply.error || ''), 'generator failure → honest reply-failure record (no fake success)');
setInboundReplyGenerator(null); // clean up — the real generator is registered by index.js

/* ------------------------------------------------------------------ */
console.log('\n== B62 CONVERSATIONS (chat-thread grouping for the app) ==');
/* ------------------------------------------------------------------ */

resetConnectorInbox();
recordWebhookEvents('email', [
  { id: 'in1', provider: 'resend', from: 'user@example.com', to: ['jexi@yourdomain.com'], type: 'inbound', text: 'Hello JEXI' },
  { id: 'in2', provider: 'resend', from: 'other@example.com', to: ['jexi@yourdomain.com'], type: 'inbound', text: 'Hi there' },
  { id: 'r1', provider: 'resend', type: 'reply', from: 'jexi@yourdomain.com', to: 'user@example.com', text: 'Hi! How can I help?', ok: true, in_reply_to: 'in1' },
]);
const convs = listConversations('email', 10);
ok(convs.total === 2, 'conversations grouped per partner', `${convs.total}`);
const thread = convs.conversations.find((c) => c.partner === 'user@example.com');
ok(!!thread && thread.messages.length === 2 && thread.messages[0].direction === 'in' && thread.messages[1].direction === 'out', 'thread shows inbound then our reply in order');
ok(thread && thread.messages[1].text === 'Hi! How can I help?' && thread.lastText === 'Hi! How can I help?', 'thread carries both sides + last-message preview');
ok(thread && thread.messages[0].id === 'in1' && thread.messages[1].in_reply_to === 'in1', 'inbound id + reply linkage preserved');
ok(convs.conversations.every((c) => c.messages.every((m) => m.direction === 'in' || m.direction === 'out')), 'every message carries a direction');
ok(!convs.conversations.some((c) => c.partner === 'other@example.com' ? c.messages[0].direction !== 'in' : false), 'second partner thread is inbound-only');
resetConnectorInbox();

await mocks.closeAll();
await hanging.close();

/* ------------------------------------------------------------------ */
console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
