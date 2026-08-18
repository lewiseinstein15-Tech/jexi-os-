/**
 * B134 — DSH BATCH 3 suite: ACP, terminal sessions, credential store,
 * sandbox mode, goal rounds.
 *
 * Proves: ACP json-rpc initialize/session lifecycle/prompt (with the
 * deterministic seam); terminal open→send→read→signal→close with real
 * state; credentials (validation, precedence over env, keys-only listing,
 * delete); sandbox mode fold + denial matrix; goal rounds increment.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-b134-'));
process.env.DATA_DIR = path.join(TMP, 'data');
process.env.WORKSPACE_DIR = path.join(TMP, 'ws');
fs.mkdirSync(process.env.WORKSPACE_DIR, { recursive: true });

let passed = 0, failedCount = 0;
const ok = (c, n) => { if (c) { passed++; console.log(`  ✅ ${n}`); } else { failedCount++; console.log(`  ❌ ${n}`); } };

const { handleAcpRequest, acpSessionCount } = await import('./src/services/AcpServer.js');
const { terminalOpen, terminalSend, terminalRead, terminalSignal, terminalClose, terminalList } = await import('./src/services/TerminalSessions.js');
const { setCredential, resolveCredential, deleteCredential, listCredentialKeys, validateCredential } = await import('./src/services/CredentialStore.js');
const { effectiveSandboxMode, setSandboxMode, sandboxDenial, SANDBOX_MODES, DEFAULT_SANDBOX_MODE } = await import('./src/services/SandboxMode.js');
const { createGoal, getCurrentGoal, updateGoal } = await import('./src/services/GoalTools.js');
const { appendConversationEvent } = await import('./src/services/SessionConversations.js');

console.log('\n== 1. ACP (dsh acp — json-rpc) ==');
const init = await handleAcpRequest({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '0.1.0' } });
ok(init.result && init.result.protocolVersion === '0.1.0', 'initialize returns the protocol version');
ok(init.result.agentCapabilities.supportsPrompt === true, 'agent capabilities advertised');
const bad = await handleAcpRequest({ id: 2, method: 'nope' });
ok(bad.error && bad.error.code === -32600, 'missing jsonrpc → Invalid Request');
const nf = await handleAcpRequest({ jsonrpc: '2.0', id: 3, method: 'bogus' });
ok(nf.error && nf.error.code === -32601, 'unknown method → Method not found');
const sn = await handleAcpRequest({ jsonrpc: '2.0', id: 4, method: 'session/new', params: { id: 'ext-agent' } });
ok(sn.result && sn.result.sessionId === 'ext-agent', 'session/new creates');
const sn2 = await handleAcpRequest({ jsonrpc: '2.0', id: 5, method: 'session/new', params: { id: 'ext-agent' } });
ok(sn2.error && /already exists/.test(sn2.error.message), 'duplicate session rejected');
const noSess = await handleAcpRequest({ jsonrpc: '2.0', id: 6, method: 'session/prompt', params: { sessionId: 'nope', prompt: 'hi' } });
ok(noSess.error && /not found/.test(noSess.error.message), 'prompt on missing session fails honestly');
const del = await handleAcpRequest({ jsonrpc: '2.0', id: 7, method: 'session/delete', params: { sessionId: 'ext-agent' } });
ok(del.result && del.result.sessionId === 'ext-agent', 'session/delete works');
ok(acpSessionCount() === 0, 'session count reflects deletes');

console.log('\n== 2. Terminal sessions (dsh tool-terminal) ==');
const t = terminalOpen({ type: 'shell', name: 'test' });
ok(t.ok === true && t.sessionId, 'terminal_open spawns a session');
const t2 = terminalOpen({ type: 'shell' });
ok(t2.ok === true, 'second session opens');
const t3 = terminalOpen({ type: 'bogus' });
ok(t3.ok === false && /shell/.test(t3.error), 'unsupported backend fails honestly');
const snd = terminalSend(t.sessionId, 'echo hello-from-term');
ok(snd.ok === true, 'terminal_send writes stdin');
await new Promise((r) => setTimeout(r, 400));
const rd = terminalRead(t.sessionId);
ok(rd.ok === true && /hello-from-term/.test(rd.output), 'terminal_read drains real output');
const sig = terminalSignal(t.sessionId, 'SIGINT');
ok(sig.ok === true && sig.accepted === true, 'terminal_signal accepted');
const cl = terminalClose(t.sessionId);
ok(cl.ok === true && cl.closed === true, 'terminal_close ends the session');
ok(terminalRead(t.sessionId).ok === false, 'read on closed session fails honestly');
ok(terminalList().length === 1, 'terminal_list shows the remaining session');
terminalClose(t2.sessionId);

console.log('\n== 3. Credential store (dsh credentials-local) ==');
ok(validateCredential('API_KEY', 'x').ok === true, 'valid key accepted');
ok(validateCredential('bad key!', 'x').ok === false, 'invalid key rejected');
ok(validateCredential('EMPTY', '').ok === false, 'empty value rejected');
process.env.JEXI_TEST_CRED = 'from-env';
ok(resolveCredential('JEXI_TEST_CRED') === 'from-env', 'env fallback works');
ok(setCredential('JEXI_TEST_CRED', 'from-store').ok === true, 'managed set works');
ok(resolveCredential('JEXI_TEST_CRED') === 'from-store', 'managed store WINS over env (DSH precedence)');
ok(listCredentialKeys().includes('JEXI_TEST_CRED'), 'keys listed (values never)');
ok(setCredential('BAD KEY', 'x').ok === false, 'invalid key fails on set');
ok(deleteCredential('JEXI_TEST_CRED').ok === true, 'delete works');
ok(resolveCredential('JEXI_TEST_CRED') === 'from-env', 'after delete → env fallback again');

console.log('\n== 4. Sandbox mode (dsh sandbox-policy) ==');
ok(effectiveSandboxMode('sandbox-conv') === DEFAULT_SANDBOX_MODE, 'default mode is workspace-write');
setSandboxMode('sandbox-conv', 'read-only');
ok(effectiveSandboxMode('sandbox-conv') === 'read-only', 'mode folds from the log');
setSandboxMode('sandbox-conv', 'danger-full-access');
ok(effectiveSandboxMode('sandbox-conv') === 'danger-full-access', 'last one wins (replayable)');
ok(setSandboxMode('sandbox-conv', 'nope').ok === false, 'invalid mode rejected');
ok(SANDBOX_MODES.length === 3, 'three modes advertised');
const deny1 = sandboxDenial('read-only', 'exec');
ok(deny1 && deny1.blocked && /read-only/.test(deny1.reason), 'read-only blocks exec with guidance');
ok(sandboxDenial('read-only', 'read') === null, 'read-only allows read tools');
ok(sandboxDenial('workspace-write', 'exec') !== null, 'workspace-write blocks exec');
ok(sandboxDenial('danger-full-access', 'exec') === null, 'full access allows everything');
// log-backed: a conversation record carries the fold
appendConversationEvent('sb-conv', { role: 'system', kind: 'sandbox/mode', text: 'x', meta: { mode: 'read-only' } });
ok(effectiveSandboxMode('sb-conv') === 'read-only', 'fold works from real conversation events');

console.log('\n== 5. Goal rounds (dsh goal-round-driver) ==');
await createGoal({ objective: 'fix the bug', max_goal_rounds: 1 });
let g = getCurrentGoal();
ok(g.goal.round === 1 && g.goal.canContinue === true, 'round 1, can continue');
updateGoal({ goal_id: 'jexi-active-goal', revision: 1, action: 'edit', objective: 'fix the bug and test' });
g = getCurrentGoal();
ok(g.goal.round === 2 && g.goal.canContinue === false && g.goal.complete === true, 'round 2 hits the 1-round cap → done (no more auto rounds)');

console.log(`\nB134 dsh-batch3: ${passed} passed, ${failedCount} failed`);
process.exit(failedCount ? 1 : 0);
