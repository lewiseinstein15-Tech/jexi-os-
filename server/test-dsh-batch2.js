/**
 * B133 — DSH BATCH 2 suite: commands, llm-retry, anonymous-user-id,
 * attachment policy, session invariants.
 *
 * Proves: the command registry validates + executes (and /help lists),
 * retry backoff fires on transient errors and skips permanent ones,
 * the anonymous id is stable + UUID + resets on file delete, attachments
 * are validated (allowlist, executables blocked, size cap), and session
 * invariants detect unbalanced lifecycle brackets.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-b133-'));
process.env.DATA_DIR = path.join(TMP, 'data');
process.env.WORKSPACE_DIR = path.join(TMP, 'ws');
fs.mkdirSync(process.env.WORKSPACE_DIR, { recursive: true });

let passed = 0, failedCount = 0;
const ok = (c, n) => { if (c) { passed++; console.log(`  ✅ ${n}`); } else { failedCount++; console.log(`  ❌ ${n}`); } };

const { registerCommand, listCommands, tryExecuteCommand, helpText } = await import('./src/services/CommandRegistry.js');
const { withRetry, retryDelayMs, isRetryableError } = await import('./src/services/RetryPolicy.js');
const { anonymousUserId, resetAnonymousUserId } = await import('./src/services/AnonymousId.js');
const { validateAttachment, validateAttachmentName, MAX_ATTACHMENT_BYTES } = await import('./src/services/AttachmentPolicy.js');
const { checkConversationInvariants, invariantStatus } = await import('./src/services/SessionInvariants.js');
const { appendConversationEvent, loadConversationEvents } = await import('./src/services/SessionConversations.js');

console.log('\n== 1. Command registry (dsh commands) ==');
const unreg = registerCommand({ name: 'ping', description: 'Reply pong.', run: async () => ({ summary: 'pong' }) });
ok(listCommands().some((c) => c.name === 'ping'), 'command registered + listed');
let threw = false;
try { registerCommand({ name: 'ping', description: 'dup' }); } catch { threw = true; }
ok(threw, 'duplicate name rejected');
threw = false;
try { registerCommand({ name: '', description: 'x' }); } catch { threw = true; }
ok(threw, 'empty name rejected');
const r = await tryExecuteCommand('/ping');
ok(r && r.ok && r.result.summary === 'pong', '/ping executes');
const r2 = await tryExecuteCommand('/nope');
ok(r2 && r2.ok === false && /unknown command/.test(r2.error), 'unknown command fails honestly');
ok(await tryExecuteCommand('hello') === null, 'non-command passes through (null)');
ok(helpText().includes('/ping'), 'helpText lists registered commands');
unreg();
ok(!listCommands().some((c) => c.name === 'ping'), 'unregister is reversible');

console.log('\n== 2. Retry policy (dsh llm-retry) ==');
ok(retryDelayMs(1) >= 400 && retryDelayMs(2) >= 800 && retryDelayMs(3) >= 1500, 'backoff grows');
ok(isRetryableError(new Error('HTTP 429 rate limit')) === true, '429 retryable');
ok(isRetryableError(new Error('HTTP 503 service unavailable')) === true, '503 retryable');
ok(isRetryableError(new Error('fetch failed: ECONNRESET')) === true, 'network retryable');
ok(isRetryableError(new Error('HTTP 401 unauthorized')) === false, '401 NOT retryable');
let attempts = 0;
let thrownErr = null;
try {
  await withRetry(async () => {
    attempts += 1;
    if (attempts < 3) throw new Error('HTTP 503 temporary');
    return 'ok';
  }, { attempts: 3 });
} catch (e) { thrownErr = e; }
ok(attempts === 3 && !thrownErr, `retries until success (${attempts} attempts)`);
let permAttempts = 0;
try {
  await withRetry(async () => { permAttempts += 1; throw new Error('HTTP 400 bad request'); }, { attempts: 3 });
} catch { /* expected */ }
ok(permAttempts === 1, 'permanent error fails fast (no retries)');

console.log('\n== 3. Anonymous user id (dsh anonymous-user-id) ==');
resetAnonymousUserId();
const id1 = anonymousUserId();
ok(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id1), 'id is a UUID');
ok(anonymousUserId() === id1, 'memoized per process');
const file = path.join(process.env.DATA_DIR, '.anonymous-user-id');
ok(fs.readFileSync(file, 'utf-8').trim() === id1, 'persisted as a bare line');
fs.unlinkSync(file);
resetAnonymousUserId();
ok(anonymousUserId() !== id1, 'deleting the file mints a fresh identity');

console.log('\n== 4. Attachment policy (dsh attachment) ==');
ok(validateAttachmentName('report.pdf').ok === true, 'pdf allowed');
ok(validateAttachmentName('notes.md').ok === true, 'md allowed');
ok(validateAttachmentName('app.js').ok === true, 'js allowed (text)');
ok(validateAttachmentName('virus.exe').ok === false, 'exe blocked');
ok(validateAttachmentName('script.sh').ok === true, 'sh allowed (text — never executed)');
ok(validateAttachmentName('../escape.pdf').ok === false, 'path traversal rejected');
ok(validateAttachmentName('').ok === false, 'empty name rejected');
const big = validateAttachment({ name: 'big.pdf', data: 'A'.repeat(MAX_ATTACHMENT_BYTES * 2), size: MAX_ATTACHMENT_BYTES * 2 });
ok(big.ok === false && /too large/.test(big.error), 'oversize rejected');
const okAtt = validateAttachment({ name: 'doc.pdf', data: 'aGVsbG8=', size: 5 });
ok(okAtt.ok === true && okAtt.ext === 'pdf', 'valid attachment passes with ext');

console.log('\n== 5. Session invariants (dsh runtime-diagnostics) ==');
const good = checkConversationInvariants('missing-conv');
ok(good.ok === true, 'missing/empty conversation → ok');
appendConversationEvent('inv-conv', { role: 'user', text: 'hi', kind: 'chat' });
appendConversationEvent('inv-conv', { role: 'system', text: '', kind: 'turn/start', meta: { turn: 1 } });
appendConversationEvent('inv-conv', { role: 'system', text: '', kind: 'step/start', meta: { turn: 1, step: 1 } });
appendConversationEvent('inv-conv', { role: 'system', text: '', kind: 'tool/call', meta: { callId: 'c1', name: 'web-search' } });
// leave turn/step open + call unanswered → problems
const bad = checkConversationInvariants('inv-conv');
ok(bad.ok === false, 'unbalanced log detected');
ok(bad.problems.some((p) => p.kind === 'unclosed-turn'), 'unclosed turn flagged');
ok(bad.problems.some((p) => p.kind === 'unclosed-step'), 'unclosed step flagged');
ok(bad.problems.some((p) => p.kind === 'unanswered-tool-call'), 'unanswered tool call flagged');
// close everything → clean
appendConversationEvent('inv-conv', { role: 'system', text: '', kind: 'tool/result', meta: { callId: 'c1', name: 'web-search', ok: true } });
appendConversationEvent('inv-conv', { role: 'system', text: '', kind: 'step/end', meta: { turn: 1, step: 1 } });
appendConversationEvent('inv-conv', { role: 'system', text: '', kind: 'turn/end', meta: { turn: 1, reason: 'completed' } });
const clean = checkConversationInvariants('inv-conv');
ok(clean.ok === true, 'balanced log → clean');
const st = invariantStatus(10);
ok(typeof st.checked === 'number' && typeof st.failed === 'number', 'aggregate status shape');

console.log(`\nB133 dsh-batch2: ${passed} passed, ${failedCount} failed`);
process.exit(failedCount ? 1 : 0);
