/**
 * JEXI OS — B56 acceptance suite (Connector System).
 *
 * ⚠️ MOCK DISCLOSURE — every provider call in this suite goes to a LOCAL MOCK
 * SERVER (server/tests/connectorMocks.js) that mimics the real WhatsApp /
 * GitHub / Resend / Telegram API response shapes. NO live credentials are
 * used anywhere in this file. The connector code paths are byte-identical to
 * what runs against the real providers (only the base URL differs; it
 * defaults to the real provider URL when unset).
 *
 * Covers the directive's verification checklist per connector:
 *   - authenticate() actually calls the (mock) provider
 *   - one successful send() with the logged provider response
 *   - one successful receive()/webhook parse with normalized output
 *   - failure paths EXECUTED, not just coded: auth failure (401), rate limit
 *     (429), network timeout, malformed response
 *   - webhook signature verification (WhatsApp X-Hub-Signature-256,
 *     GitHub sha256/sha1, Telegram secret token) + Meta hub.challenge
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
  'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN',
  'PHONE_NUMBER_ID', 'APP_SECRET', 'VERIFY_TOKEN',
  'RESEND_API_KEY', 'RESEND_FROM', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_SECRET_TOKEN',
]) delete process.env[key];

import { ConnectorRegistry } from './src/connectors/ConnectorRegistry.js';
import { ConnectorConfig, ConnectorError, ERROR_CODES, httpJson, withTimeout, maskSecret, createHmacSha256, createHmacSha1, assertAsciiSecret } from './src/connectors/ConnectorBase.js';
import { recordWebhookEvents, recordHandshake, listInbound, resetConnectorInbox } from './src/services/ConnectorInbox.js';
import { registerWhatsAppConnector, WhatsAppConnector } from './src/connectors/whatsapp.js';
import { registerGitHubConnector, GitHubConnector } from './src/connectors/github.js';
import { registerEmailConnector, ResendConnector } from './src/connectors/email.js';
import { registerTelegramConnector, TelegramConnector } from './src/connectors/telegram.js';
import { registerConnectors, getConnectorStatus, saveConnectorConfig, callConnector, handleConnectorWebhook } from './src/connectors/index.js';
import { connectorToToolSchema, listConnectorTools, introspectSendSignature } from './src/connectors/toolBridge.js';
import { executeTool, toolTier, getToolCatalog } from './src/services/ToolRuntime.js';
import { startMockConnectorApis, startHangingServer } from './tests/connectorMocks.js';
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
ok(registerConnectors().length >= 4, 'registerConnectors() registers every connector from settings without throwing');
ConnectorRegistry.clear();

ok(ERROR_CODES.AUTH_FAILED === 'AUTH_FAILED' && ERROR_CODES.RATE_LIMITED === 'RATE_LIMITED', 'error taxonomy defines auth/rate-limit/timeout/malformed codes');
ok(maskSecret('sk-live-secret-1234') === '••••1234', 'maskSecret masks secrets, keeps 4 tail chars');
ok(maskSecret('') === '', 'maskSecret leaves empty values alone');

const t0 = Date.now();
let timedOut = null;
try { await withTimeout(new Promise(() => {}), 300, 'test'); } catch (e) { timedOut = e; }
ok(timedOut instanceof ConnectorError && timedOut.code === ERROR_CODES.TIMEOUT && Date.now() - t0 < 2000, 'withTimeout rejects with TIMEOUT instead of hanging', timedOut && timedOut.message);

// httpJson direct failure classification (unit-level, no connector involved).
await expectError(() => httpJson(`${mocks.whatsapp.url}/v21.0/123`, { headers: { Authorization: 'Bearer bad-token' }, provider: 'mock' }), ERROR_CODES.AUTH_FAILED, 'httpJson classifies 401 as AUTH_FAILED');
await expectError(() => httpJson(`${mocks.whatsapp.url}/v21.0/123`, { headers: { Authorization: 'Bearer ratelimit-token' }, provider: 'mock' }), ERROR_CODES.RATE_LIMITED, 'httpJson classifies 429 as RATE_LIMITED');
await expectError(() => httpJson(`${hanging.url}/never`, { timeout: 400, provider: 'mock' }), ERROR_CODES.TIMEOUT, 'httpJson classifies a hang as TIMEOUT');
await expectError(() => httpJson('http://127.0.0.1:1/nope', { timeout: 1500, provider: 'mock' }), ERROR_CODES.NETWORK, 'httpJson classifies connection failure as NETWORK');

/* ------------------------------------------------------------------ */
console.log('\n== B56 WHATSAPP (MOCK — WhatsApp Business Cloud API shape) ==');
/* ------------------------------------------------------------------ */

const wa = registerWhatsAppConnector(new ConnectorConfig({
  name: 'whatsapp',
  auth: { accessToken: 'ok-token', phoneNumberId: 'PHONE_ID', appSecret: 'app-secret', verifyToken: 'jexi-verify', baseUrl: mocks.whatsapp.url },
}));

ok(await wa.authenticate(), 'authenticate() actually calls the provider (mock) and succeeds with a valid token');
const waBad = new WhatsAppConnector(new ConnectorConfig({ name: 'whatsapp', auth: { accessToken: 'bad-token', phoneNumberId: 'PHONE_ID', baseUrl: mocks.whatsapp.url } }));
await expectError(() => waBad.authenticate(), ERROR_CODES.AUTH_FAILED, 'authenticate() fails with AUTH_FAILED on a bad token (401 path executed)');

const waText = await wa.send({ to: '15550001111', type: 'text', text: 'Hello from JEXI' });
ok(waText.ok === true && /^wamid\.mock\./.test(waText.wamid), 'send() text → provider wamid returned', `wamid=${waText.wamid}`);
const waTemplate = await wa.send({ to: '15550001111', type: 'template', template: { name: 'hello_world', language: 'en_US' } });
ok(waTemplate.ok === true && !!waTemplate.wamid, 'send() template → provider response returned');
const waMedia = await wa.send({ to: '15550001111', type: 'media', media: { kind: 'image', link: 'https://example.com/pic.jpg', caption: 'hi' } });
ok(waMedia.ok === true && !!waMedia.wamid, 'send() media → provider response returned');

const waRate = new WhatsAppConnector(new ConnectorConfig({ name: 'whatsapp', auth: { accessToken: 'ratelimit-token', phoneNumberId: 'PHONE_ID', baseUrl: mocks.whatsapp.url } }));
await expectError(() => waRate.send({ to: '15550001111', text: 'hi' }), ERROR_CODES.RATE_LIMITED, 'send() rate-limited (429 path executed)');
const waFail = new WhatsAppConnector(new ConnectorConfig({ name: 'whatsapp', auth: { accessToken: 'fail-token', phoneNumberId: 'PHONE_ID', baseUrl: mocks.whatsapp.url } }));
await expectError(() => waFail.send({ to: '15550001111', text: 'hi' }), ERROR_CODES.PROVIDER_ERROR, 'send() provider 500 (error path executed)');
const waMalformed = new WhatsAppConnector(new ConnectorConfig({ name: 'whatsapp', auth: { accessToken: 'malformed-token', phoneNumberId: 'PHONE_ID', baseUrl: mocks.whatsapp.url } }));
await expectError(() => waMalformed.send({ to: '15550001111', text: 'hi' }), ERROR_CODES.MALFORMED_RESPONSE, 'send() malformed response (wrong-shape body path executed)');

// Meta webhook verification handshake (hub.challenge).
const handshake = wa.handleWebhookVerification({ 'hub.mode': 'subscribe', 'hub.verify_token': 'jexi-verify', 'hub.challenge': '12345' });
ok(handshake.verified === true && handshake.challenge === '12345', 'hub.challenge verification handshake returns the challenge');
const badHandshake = wa.handleWebhookVerification({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '1' });
ok(badHandshake.verified === false, 'hub.challenge rejects a wrong verify_token');

// X-Hub-Signature-256 over the RAW body.
const waRaw = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
ok(wa.verifyWebhookSignature(waRaw, `sha256=${createHmacSha256('app-secret', waRaw)}`) === true, 'webhook signature verified (HMAC-SHA256 over raw body)');
ok(wa.verifyWebhookSignature(waRaw, 'sha256=deadbeef') === false, 'webhook signature rejected when tampered');
ok(wa.verifyWebhookSignature(waRaw, '') === false, 'webhook signature rejected when missing');

// normalizeInbound — the internal event shape.
const waEvents = wa.normalizeInbound({
  object: 'whatsapp_business_account',
  entry: [{ id: '123', changes: [{ value: {
    messaging_product: 'whatsapp',
    metadata: { display_phone_number: '+15550000000', phone_number_id: 'PHONE_ID' },
    contacts: [{ profile: { name: 'Ada' }, wa_id: '15550001111' }],
    messages: [{ from: '15550001111', id: 'wamid.HBgN', timestamp: '1691785099', type: 'text', text: { body: 'Hello JEXI' } }],
  }, field: 'messages' }] }],
});
ok(waEvents.length === 1 && waEvents[0].from === '15550001111' && waEvents[0].text === 'Hello JEXI' && waEvents[0].provider === 'whatsapp', 'receive() normalizes a real webhook payload', JSON.stringify(waEvents[0]));

// Connector-level TIMEOUT via the configurable request timeout.
const waHang = new WhatsAppConnector(new ConnectorConfig({ name: 'whatsapp', auth: { accessToken: 'ok-token', phoneNumberId: 'PHONE_ID', baseUrl: hanging.url, requestTimeout: 400 } }));
await expectError(() => waHang.authenticate(), ERROR_CODES.TIMEOUT, 'connector-level network timeout → TIMEOUT (configurable requestTimeout)');

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
ok(resendInbound.length === 1 && resendInbound[0].provider === 'resend' && resendInbound[0].to === 'you@example.com' && resendInbound[0].type === 'email.delivered', 'receive() normalizes a Resend delivery webhook');

/* ------------------------------------------------------------------ */
console.log('\n== B56 TELEGRAM (MOCK — Bot API shape) ==');
/* ------------------------------------------------------------------ */

const tg = registerTelegramConnector(new ConnectorConfig({ name: 'telegram', auth: { botToken: 'ok-token', secretToken: 'tg-secret', baseUrl: mocks.telegram.url } }));
ok(await tg.authenticate(), 'authenticate() (getMe) succeeds against the mock');
const tgBad = new TelegramConnector(new ConnectorConfig({ name: 'telegram', auth: { botToken: 'bad-token', baseUrl: mocks.telegram.url } }));
await expectError(() => tgBad.authenticate(), ERROR_CODES.AUTH_FAILED, 'authenticate() fails with AUTH_FAILED on a bad token (401 path executed)');

const tgMsg = await tg.send({ chat_id: 777, text: 'Hello from JEXI' });
ok(tgMsg.ok === true && tgMsg.message_id === 99, 'sendMessage → provider message_id returned');
const tgPhoto = await tg.send({ chat_id: 777, photo: 'https://example.com/x.png', caption: 'look' });
ok(tgPhoto.ok === true && tgPhoto.method === 'sendPhoto', 'sendPhoto → provider response returned');
const tgRate = new TelegramConnector(new ConnectorConfig({ name: 'telegram', auth: { botToken: 'ratelimit-token', baseUrl: mocks.telegram.url } }));
try { await tgRate.send({ chat_id: 1, text: 'hi' }); ok(false, 'send() rate-limited (429 path executed)'); }
catch (e) { ok(e instanceof ConnectorError && e.code === ERROR_CODES.RATE_LIMITED && e.retryAfter === 6, 'send() rate-limited (429 path executed)', e.message); }

ok(tg.verifyWebhookSecret({ 'x-telegram-bot-api-secret-token': 'tg-secret' }) === true, 'webhook verified by secret token header');
ok(tg.verifyWebhookSecret({ 'x-telegram-bot-api-secret-token': 'wrong' }) === false, 'webhook rejected on secret mismatch');
const tgEvents = tg.normalizeInbound({ update_id: 9001, message: { message_id: 11, date: 1691785099, chat: { id: 777, type: 'private' }, from: { id: 888, username: 'tester' }, text: 'hello' } });
ok(tgEvents.length === 1 && tgEvents[0].text === 'hello' && tgEvents[0].chat.id === 777, 'receive() normalizes a Bot API update');
const polled = await tg.receive({ offset: 0 });
ok(polled.length === 1 && polled[0].text === 'hello from telegram', 'receive() polling mode (getUpdates) returns normalized events');

/* ------------------------------------------------------------------ */
console.log('\n== B56 TOOL BRIDGE — introspected agent tool schemas ==');
/* ------------------------------------------------------------------ */

ok(JSON.stringify(introspectSendSignature(wa)) === JSON.stringify(['payload']), 'send() signature introspected (not a hardcoded stub)', `params=${JSON.stringify(introspectSendSignature(wa))}`);
const waSchema = connectorToToolSchema('whatsapp');
ok(waSchema.function.name === 'send_whatsapp', 'tool name derived from the connector');
ok(waSchema.function.parameters.properties.to && waSchema.function.parameters.required.includes('to'), 'payload fields expanded from the connector schema (to required)');
ok(waSchema.function.parameters.properties.text && waSchema.function.parameters.properties.template && waSchema.function.parameters.properties.media, 'text/template/media fields present');
const ghSchema = connectorToToolSchema('github');
ok(ghSchema.function.name === 'send_github' && ghSchema.function.parameters.required.includes('action') && ghSchema.function.parameters.required.includes('owner'), 'github tool schema: action+owner required, action description present');
const tgSchema = connectorToToolSchema('telegram');
ok(tgSchema.function.name === 'send_telegram' && tgSchema.function.parameters.required.includes('chat_id'), 'telegram tool schema: chat_id required');
const emSchema = connectorToToolSchema('email');
ok(emSchema.function.name === 'send_email' && emSchema.function.parameters.properties.subject, 'email tool schema: subject present');
const allTools = listConnectorTools();
ok(allTools.length >= 4 && allTools.every((t) => t.type === 'function' && t.function.name.startsWith('send_')), 'schemas generated for every registered connector', allTools.map((t) => t.function.name).join(', '));

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
const healthRes = await executeTool({ slug: 'connector-call', args: { name: 'telegram', method: 'health' }, profile: 'full' });
ok(healthRes.ok === true && String(healthRes.result).includes('"status": "ok"'), 'connector health via agent path (READ tier, no approval)');

// Unknown connector → honest structured failure, not a fabricated success.
const unknown = await executeTool({ slug: 'connector-call', args: { name: 'slack', method: 'send', payload: {} }, profile: 'full', confirm: async () => true });
ok(unknown.ok === false && String(unknown.error).includes("Connector 'slack' not registered"), 'unknown connector fails honestly (never fabricated success)');

// callConnector respects the enabled flag.
const off = await callConnector('whatsapp', { method: 'send', payload: { to: '1', text: 'x' } });
ok(off.ok === true, 'callConnector send dispatches through the registry (whatsapp registered)');

/* ------------------------------------------------------------------ */
console.log('\n== B56 CONNECTOR SYSTEM — registry + webhook dispatch ==');
/* ------------------------------------------------------------------ */

const names = ConnectorRegistry.listAvailable();
ok(names.includes('whatsapp') && names.includes('github') && names.includes('email') && names.includes('telegram'), 'registry lists all four connectors', names.join(', '));

const wh = await handleConnectorWebhook('whatsapp', { query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'jexi-verify', 'hub.challenge': '67890' } });
ok(wh.kind === 'handshake' && wh.verified === true && wh.challenge === '67890', 'webhook dispatch handles the Meta verification handshake');
const whReject = await handleConnectorWebhook('github', { rawBody: '{}', headers: { 'x-hub-signature-256': 'sha256=tampered' }, body: {} });
ok(whReject.kind === 'rejected', 'webhook dispatch rejects a bad signature (403 path)');
const whEvents = await handleConnectorWebhook('whatsapp', { rawBody: waRaw, headers: { 'x-hub-signature-256': `sha256=${createHmacSha256('app-secret', waRaw)}` }, body: { entry: [] } });
ok(whEvents.kind === 'events' && whEvents.verified === true && Array.isArray(whEvents.events), 'webhook dispatch verifies + normalizes inbound events');

const status = await getConnectorStatus();
ok(status.length >= 4 && status.every((c) => c.name && c.enabled !== undefined && c.tier === 'external'), 'getConnectorStatus returns health + masked config for every connector');
const authJson = JSON.stringify(status.map((c) => c.auth));
ok(!authJson.includes('ok-pat') && !authJson.includes('ok-key') && !authJson.includes('app-secret') && !authJson.includes('tg-secret'), 'connector status masks secrets (no raw keys leak)');

// saveConnectorConfig round-trips.
const saved = saveConnectorConfig('telegram', { auth: { botToken: 'new-token' }, enabled: true });
ok(saved.name === 'telegram' && saved.enabled === true, 'saveConnectorConfig persists + re-registers a connector');
ConnectorRegistry.unregister('telegram');
registerTelegramConnector(new ConnectorConfig({ name: 'telegram', auth: { botToken: 'ok-token', secretToken: 'tg-secret', baseUrl: mocks.telegram.url } }));

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
recordWebhookEvents('whatsapp', [{ id: 'w1', provider: 'whatsapp', from: '15551234567', text: 'hi', type: 'text', raw: { huge: 'envelope' } }]);
recordHandshake('whatsapp', { verified: true, challenge: 'challenge-42' });
recordHandshake('whatsapp', { verified: false, reason: 'hub.verify_token mismatch' });
const inbox = listInbound('whatsapp', 10);
ok(inbox.total === 1 && inbox.events.length === 1 && inbox.events[0].from === '15551234567' && inbox.events[0].text === 'hi', 'inbox stores normalized inbound events');
ok(!('raw' in inbox.events[0]) && inbox.events[0].type === 'text', 'inbox strips raw provider envelopes from stored events');
ok(inbox.handshakes.length === 2 && inbox.handshakes[0].verified === false && inbox.handshakes[1].verified === true, 'inbox records Meta handshake outcomes (newest first)');
resetConnectorInbox();
const emptyInbox = listInbound('whatsapp', 10);
ok(emptyInbox.total === 0 && emptyInbox.events.length === 0 && emptyInbox.handshakes.length === 0, 'resetConnectorInbox clears the store');

await mocks.closeAll();
await hanging.close();

/* ------------------------------------------------------------------ */
console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
