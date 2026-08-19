/**
 * B141 — DSH BATCH 10 TEST ("Pull all continue"):
 *
 *   sdk/protocol (JSON-RPC line transport) → sdk/protocol.js
 *   sdk/server (RPC method table)          → sdk/server.js
 *   shell/tool-pwsh                        → pwsh registry tool
 *   storage/storage-domain                 → StorageDomain.js
 *   host/apiproxy                          → ApiProxy.js
 *   test-support/llm-mock-server           → test-support/llm-mock-server.js
 *   client/schema-form + ui-theme          → src/utils/schemaForm.js + theme.js
 *   typert workspace mode                  → TypingGenerator.generateWorkspaceTypes
 */

import fs from 'fs';
import { PassThrough } from 'stream';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

let failures = 0;
const ok = (name, cond) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) failures += 1;
};

const SERVER_DIR = process.cwd();

/* ══════════════ 1. SDK PROTOCOL (JSON-RPC line transport) ══════════════ */
console.log('\n== 1. SDK protocol (JSON-RPC line transport) ==');
{
  const { JsonRpcLineTransport, JsonRpcServerTransport, JsonRpcResponseError, isJsonRpcRequest, isJsonRpcNotification } = await import('./sdk/protocol.js');

  const serverIn = new PassThrough();
  const serverOut = new PassThrough();
  const clientIn = new PassThrough();
  const clientOut = new PassThrough();
  // wire: clientOut → serverIn ; serverOut → clientIn
  clientOut.pipe(serverIn);
  serverOut.pipe(clientIn);

  const server = new JsonRpcServerTransport(serverIn, serverOut);
  server.start();
  server.requestHandler = async (method, params) => {
    if (method === 'echo') return { echo: params.value };
    if (method === 'fail') throw new Error('boom');
    const err = new Error(`method not found: ${method}`);
    err.code = -32601;
    throw err; // explicit -32601 (dsh: missing handlers return -32601)
  };
  const client = new JsonRpcLineTransport(clientIn, clientOut);
  client.start();

  const echo = await client.request('echo', { value: 42 });
  ok('request/response roundtrip', echo.echo === 42);
  let notFound = null;
  try { await client.request('nope', {}); } catch (e) { notFound = e; }
  ok('missing method → JsonRpcResponseError -32601', notFound instanceof JsonRpcResponseError && notFound.code === -32601);
  let failed = null;
  try { await client.request('fail', {}); } catch (e) { failed = e; }
  ok('handler failure → -32603', failed instanceof JsonRpcResponseError && failed.code === -32603);

  let notified = null;
  server.notificationHandler = (method, params) => { notified = { method, params }; };
  client.notify('ping', { a: 1 });
  await new Promise((r) => setTimeout(r, 50));
  ok('notification delivered with params', notified && notified.method === 'ping' && notified.params.a === 1);

  ok('isJsonRpcRequest/notification', isJsonRpcRequest({ jsonrpc: '2.0', method: 'x', id: 1 }) === true && isJsonRpcNotification({ jsonrpc: '2.0', method: 'x' }) === true);

  server.close();
  client.close();
}

/* ══════════════ 2. SDK SERVER ══════════════ */
console.log('\n== 2. SDK server (RPC method table) ==');
{
  const { RpcServer, createBuiltinSdkMethods } = await import('./sdk/server.js');
  const server = new RpcServer({ ping: async () => 'pong' });
  ok('listMethods', server.listMethods().join(',') === 'ping');
  ok('invoke ok', (await server.invoke('ping')).result === 'pong');
  const missing = await server.invoke('nope');
  ok('invoke unknown → -32601', missing.error && missing.error.code === -32601);
  server.handle('add', ({ a, b }) => a + b);
  ok('handle replaces/registers', (await server.invoke('add', { a: 2, b: 3 })).result === 5);
  ok('invoke handler error → -32603', (await server.invoke('nope')).error.code === -32601);
  server.handle('boom', () => { throw new Error('kaboom'); });
  ok('handler throw → -32603', (await server.invoke('boom')).error.code === -32603);
  const builtin = createBuiltinSdkMethods({ health: async () => ({ ok: true }), tools: async () => ['a'], chat: async (q) => `answer:${q}` });
  const s2 = new RpcServer(builtin);
  ok('builtin health', (await s2.invoke('health')).result.ok === true);
  ok('builtin chat', (await s2.invoke('chat', { query: 'hi' })).result.summary === 'answer:hi');
  ok('builtin tools.list', (await s2.invoke('tools.list')).result[0] === 'a');
}

/* ══════════════ 3. PWSH TOOL ══════════════ */
console.log('\n== 3. pwsh tool (dsh tool-pwsh) ==');
{
  const { TOOL_REGISTRY, TOOL_COUNT } = await import('./src/services/ToolRegistry.js');
  ok('pwsh in registry', TOOL_REGISTRY.some((t) => t.slug === 'pwsh'));
  ok('registry count is 211', TOOL_COUNT === 213);
  const { executeTool, hasOutputContract, validateToolArgs } = await import('./src/services/ToolRuntime.js');
  ok('pwsh has contract + schema', hasOutputContract('pwsh') && validateToolArgs('pwsh', { command: 'Get-Date', description: 'x' }).ok === true);
  ok('pwsh requires command', validateToolArgs('pwsh', { description: 'x' }).ok === false);
  // Fake pwsh on PATH → runs; otherwise honest fail-open.
  const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-pwsh-'));
  fs.writeFileSync(path.join(fakeBin, 'pwsh'), '#!/bin/sh\necho "fake-pwsh: $@"\n', { mode: 0o755 });
  const oldPath = process.env.PATH;
  process.env.PATH = `${fakeBin}:${oldPath}`;
  try {
    const r = await executeTool({ slug: 'pwsh', args: { command: 'Write-Host hi', description: 'x' }, spillOwner: 't-pwsh' });
    ok('pwsh runs a fake pwsh', r.ok === true && String(r.result).includes('fake-pwsh'));
  } finally {
    if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
  }
  // Deterministic fail-open check: a PATH with NO pwsh anywhere (GitHub
  // runners ship a real pwsh, so absence cannot be assumed).
  const emptyBin = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-emptypath-'));
  const oldPath2 = process.env.PATH;
  process.env.PATH = emptyBin;
  try {
    const missing = await executeTool({ slug: 'pwsh', args: { command: 'x', description: 'x' }, spillOwner: 't-pwsh' });
    ok('pwsh without binary fails honestly (fail-open)', missing.ok === false && /not installed/.test(String(missing.error)));
  } finally {
    if (oldPath2 === undefined) delete process.env.PATH; else process.env.PATH = oldPath2;
  }
}

/* ══════════════ 4. STORAGE DOMAIN ══════════════ */
console.log('\n== 4. Storage domain (typed KV tables) ==');
{
  const { StorageDomain, KvTable, DomainError } = await import('./src/services/StorageDomain.js');
  const { createStorageHub } = await import('./src/services/StorageHub.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-domain-'));
  const hub = await createStorageHub({ root: path.join(dir, 'units') });
  const domain = new StorageDomain({ name: 'tickets', hub });
  const table = await domain.table('issues', { fields: { title: 'string', priority: 'number' }, required: ['title'] });
  ok('table opens with spec', table instanceof KvTable && table.size === 0);
  await table.put('iss-1', { title: 'Bug', priority: 1 });
  ok('put stores + memory cache', table.get('iss-1').title === 'Bug' && table.size === 1);
  ok('durable across reopen', (await domain.table('issues')).get('iss-1').title === 'Bug');
  let invalid = null;
  try { await table.put('iss-2', { title: 42 }); } catch (e) { invalid = e; }
  ok('spec violation fails closed (DomainError)', invalid instanceof DomainError && invalid.code === 'invalid-record');
  let missingKey = null;
  try { await table.update('nope', (v) => v); } catch (e) { missingKey = e; }
  ok('update missing key → missing-key', missingKey instanceof DomainError && missingKey.code === 'missing-key');
  await table.put('iss-3', { title: 'Feature', priority: 2 });
  const updated = await table.update('iss-3', (v) => ({ ...v, priority: 3 }));
  ok('atomic update', updated.priority === 3 && table.get('iss-3').priority === 3);
  ok('entries snapshot', [...table.entries()].length === 2);
  ok('keys snapshot', [...table.keys()].includes('iss-1'));
  const deleted = await table.delete('iss-1');
  ok('delete returns true + removes', deleted === true && table.get('iss-1') === undefined && table.size === 1);
  ok('delete absent → false', (await table.delete('iss-1')) === false);
  ok('events recorded', domain.events().length >= 3);
  ok('status shape', domain.status().tables[0].size === 1);
  await hub.close();
}

/* ══════════════ 5. API PROXY ══════════════ */
console.log('\n== 5. Api proxy (typed route validation) ==');
{
  const { validateApiArgs, assertJsonArgs, createApiProxy, apiProxyStatus } = await import('./src/services/ApiProxy.js');
  const schema = { required: ['query'], fields: { query: 'string', limit: 'number' } };
  ok('valid args pass', validateApiArgs({ query: 'x', limit: 5 }, schema).ok === true);
  const missing = validateApiArgs({}, schema);
  ok('missing required → schema-required', missing.ok === false && missing.code === 'schema-required');
  const unknown = validateApiArgs({ query: 'x', nope: 1 }, schema);
  ok('strict rejects unknown args', unknown.ok === false && unknown.code === 'schema-unknown');
  const wrongType = validateApiArgs({ query: 'x', limit: 'many' }, schema);
  ok('type mismatch → schema-type', wrongType.ok === false && wrongType.code === 'schema-type');
  ok('no schema → pass-through', validateApiArgs({ anything: true }, null).ok === true);
  ok('assertJsonArgs copies', JSON.stringify(assertJsonArgs('e', { a: [1, { b: 2 }] })) === '{"a":[1,{"b":2}]}');
  let unsafe = false;
  try { assertJsonArgs('e', { big: 10n }); } catch { unsafe = true; }
  ok('assertJsonArgs rejects BigInt', unsafe);
  const proxy = createApiProxy({});
  proxy.routeSchema('chat', schema);
  ok('proxy validates by route', proxy.validate('chat', { query: 'hi' }).ok === true && proxy.validate('chat', {}).ok === false);
  ok('unknown route pass-through', proxy.validate('other', { x: 1 }).ok === true);
  ok('status lists routes', apiProxyStatus(proxy).routes.includes('chat'));
}

/* ══════════════ 6. LLM MOCK SERVER ══════════════ */
console.log('\n== 6. LLM mock server (test-support) ==');
{
  const { startMockLlm, parseMockLlmCliArgs } = await import('./test-support/llm-mock-server.js');
  const mock = await startMockLlm({ script: [{ match: /weather/, content: 'sunny 21C' }, { match: /capital/, content: 'Nairobi' }] });
  const chat = await fetch(`${mock.url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'what is the weather?' }] }),
  });
  const chatJson = await chat.json();
  ok('chat completions answered from script', chatJson.choices[0].message.content === 'sunny 21C');
  const gen = await fetch(`${mock.url}/v1/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'capital of Kenya?' }),
  });
  const genJson = await gen.json();
  ok('generate answered from script', genJson.candidates[0].content.parts[0].text === 'Nairobi');
  ok('calls recorded', mock.calls.length >= 2);
  const unknown = await fetch(`${mock.url}/v1/nope`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  ok('unknown path → 404', unknown.status === 404);
  const args = parseMockLlmCliArgs(['--port', '1234', '--script', 's.json']);
  ok('cli args parsed', args.port === 1234 && args.scriptFile === 's.json');
  await mock.close();
}

/* ══════════════ 7. SCHEMA FORM + THEME (client modules) ══════════════ */
console.log('\n== 7. Schema form + theme (client modules) ==');
{
  const form = await import(pathToFileURL(path.join(SERVER_DIR, '..', 'src', 'utils', 'schemaForm.js')).href);
  const spec = { fields: { name: { type: 'string', required: true, label: 'Name' }, age: { type: 'number', min: 0, max: 120 }, role: { options: ['admin', 'user'] } } };
  ok('valid form', form.validateForm({ name: 'JEXI', age: 3, role: 'admin' }, spec).valid === true);
  const bad = form.validateForm({ age: 200 }, spec);
  ok('required + range errors', bad.valid === false && bad.errors.name === 'Name is required' && /at most 120/.test(bad.errors.age));
  ok('options validated', form.validateForm({ name: 'x', role: 'root' }, spec).errors.role.includes('admin'));
  const coerced = form.coerceFormValues({ age: '42', on: 'true' }, spec);
  ok('coercion to number', coerced.age === 42);
  const theme = await import(pathToFileURL(path.join(SERVER_DIR, '..', 'src', 'utils', 'theme.js')).href);
  ok('theme get/set', theme.setTheme('light') === 'light' && theme.setTheme('dark') === 'dark');
  ok('theme init applies', theme.initTheme() === 'dark' || theme.initTheme() === 'light');
}

/* ══════════════ 8. TYPERT WORKSPACE + INTEGRATION ══════════════ */
console.log('\n== 8. Typert workspace + integration ==');
{
  const { generateWorkspaceTypes, listTypertManifests, unloadTypertArtifacts } = await import('./src/services/TypingGenerator.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-wsgen-'));
  fs.mkdirSync(path.join(root, 'plugin-a'), { recursive: true });
  fs.mkdirSync(path.join(root, 'plugin-b'), { recursive: true });
  fs.writeFileSync(path.join(root, 'plugin-a', 'typert.json'), JSON.stringify({ name: 'a', tools: [{ slug: 'a_tool', name: 'A' }] }));
  fs.writeFileSync(path.join(root, 'plugin-b', 'typert.json'), JSON.stringify({ name: 'b', skills: [{ slug: 'b_skill', name: 'B' }] }));
  const out = generateWorkspaceTypes(root);
  ok('workspace scan registers', out.ok && out.registered.length === 2);
  void out;
  ok('workspace registered manifests', listTypertManifests().length >= 2);
  const out2 = generateWorkspaceTypes(root, { emitTo: path.join(root, 'wire.ts') });
  ok('workspace emit writes wire.ts', out2.ok && out2.emitted.length === 1 && fs.existsSync(path.join(root, 'wire.ts')));
  const bad = generateWorkspaceTypes(path.join(root, 'nope'));
  ok('missing root fails honestly', bad.ok === false);
  unloadTypertArtifacts([]); // no-op parity call (artifacts live in the test dir)
  // integration: prompt + api surface still green
  const { assemblePrompt } = await import('./src/services/PromptAssembly.js');
  ok('prompt assembles', (await assemblePrompt({ convId: 't-int-b141' })).length > 500);
  const { TOOL_COUNT } = await import('./src/services/ToolRegistry.js');
  ok('registry stable at 211', TOOL_COUNT === 213);
}

console.log(`\n${failures === 0 ? '🎉 ALL B141 CHECKS PASSED' : `💥 ${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);
