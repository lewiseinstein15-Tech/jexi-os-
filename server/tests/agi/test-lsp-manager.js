/**
 * AGI Phase 6 Scope A — LSP MANAGER.
 *
 * Proves the LSP subsystem end-to-end with a REAL language server:
 *
 *   A1  JSON-RPC framing: encode/decode round-trips and splits partial reads.
 *   A2  Router: a .ts file routes to the typescript server; an unregistered
 *       extension and an uninstalled server resolve to `{ available: false }`.
 *   A3  Manager: spawning a REAL tsserver, initialize handshake negotiates
 *       capabilities, and diagnostics come back for a deliberate type error.
 *   A4  Multi-server routing: one manager owns the process and reuses it.
 *   A5  Workspace index: source files are opened (didOpen) at mission start.
 *   A6  Shutdown: `shutdown()` stops every server and the child exits.
 *
 * The typescript language server is a devDependency of the sandbox; when it is
 * NOT installed the LSP-specific assertions skip honestly rather than pretend.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const {
  LspManager,
  encodeMessage,
  decodeMessages,
  route,
  serverStatus,
  walkWorkspace,
} = await import('../../src/lsp/index.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agi-lsp-'));

function writeFile(name, content) {
  const full = path.join(TMP, name);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return full;
}

const BROKEN = writeFile('broken.ts', [
  'interface User {',
  '  id: number;',
  '  name: string;',
  '}',
  '',
  'export function greet(u: User): string {',
  '  return u.name.toUpperCase();',
  '}',
  '',
  'const bob: User = { id: 1, name: "Bob" };',
  'const count: number = bob.name;',
  'console.log(greet(bob));',
  '',
].join('\n'));

const DEFS = writeFile('defs.ts', [
  'export interface Point {',
  '  x: number;',
  '  y: number;',
  '}',
  '',
  'export function distance(p: Point): number {',
  '  return Math.sqrt(p.x * p.x + p.y * p.y);',
  '}',
  '',
  'export const origin: Point = { x: 0, y: 0 };',
  'const d1 = distance(origin);',
  'const d2 = distance({ x: 3, y: 4 });',
  'console.log(d1 + d2);',
  '',
].join('\n'));

const TS_INSTALLED = serverStatus().find((s) => s.id === 'typescript')?.installed === true;
const skipIfNoTs = TS_INSTALLED ? false : 'typescript language server not installed';

/* ── A1: JSON-RPC framing ─────────────────────────────────────────────── */

test('A1: encodeMessage frames a Content-Length header', () => {
  const framed = encodeMessage({ jsonrpc: '2.0', id: 1, method: 'x' }).toString('utf8');
  assert.match(framed, /^Content-Length: \d+\r\n\r\n/);
  const json = JSON.parse(framed.slice(framed.indexOf('\r\n\r\n') + 4));
  assert.equal(json.method, 'x');
});

test('A1: decodeMessages splits complete frames and keeps a partial tail', () => {
  const a = encodeMessage({ jsonrpc: '2.0', id: 1, result: 'a' });
  const b = encodeMessage({ jsonrpc: '2.0', id: 2, result: 'b' });
  const whole = Buffer.concat([a, b]);
  const full = decodeMessages(whole);
  assert.equal(full.messages.length, 2);
  assert.equal(full.messages[0].result, 'a');
  assert.equal(full.messages[1].result, 'b');
  assert.equal(full.rest.length, 0);

  // Split the second frame across two chunks.
  const first = decodeMessages(whole.subarray(0, a.length + 5));
  assert.equal(first.messages.length, 1);
  assert.ok(first.rest.length > 0, 'partial bytes retained');
});

/* ── A2: router ───────────────────────────────────────────────────────── */

test('A2: router maps source extensions to a language server', () => {
  assert.equal(route('a.ts').server, 'typescript');
  assert.equal(route('a.tsx').server, 'typescript');
  assert.equal(route('a.js').server, 'typescript');
  assert.equal(route('a.py').server, 'python');
  assert.equal(route('a.go').server, 'go');
});

test('A2: router reports unregistered extension and uninstalled server honestly', () => {
  const none = route('LICENSE.md');
  assert.equal(none.available, false);
  assert.match(none.reason, /no language server registered/);

  const py = route('a.py');
  if (!py.available) {
    assert.match(py.reason, /not installed/);
  } else {
    assert.ok(py.argv.cmd, 'installed python server exposes argv');
  }
});

/* ── A3: real spawn + initialize + diagnostics ────────────────────────── */

test('A3: manager spawns a real language server and negotiates capabilities', { skip: skipIfNoTs }, async () => {
  const manager = new LspManager();
  try {
    const r = route(BROKEN);
    await manager.ensureServer(r.server, r.argv, TMP);
    const running = manager.status().running;
    assert.equal(running.length, 1);
    assert.ok(running[0].pid > 0, 'child process has a pid');
    assert.ok(manager.servers.get('typescript').client.capabilities, 'capabilities negotiated');
  } finally {
    // ALWAYS release the tsserver child — a failing assertion must never
    // leak it (leaked stdio pipes keep node --test alive forever).
    await manager.shutdown();
  }
});

test('A3: diagnostics surface the real tsserver type error', { skip: skipIfNoTs }, async () => {
  const manager = new LspManager();
  try {
    const res = await manager.diagnosticsFor(BROKEN);
    assert.equal(res.available, true);
    assert.equal(res.server, 'typescript');
    const errors = res.diagnostics.filter((d) => d.severity === 1);
    assert.ok(errors.length >= 1, 'a real error diagnostic was published');
    const typeError = errors.find((d) => d.code === 2322);
    assert.ok(typeError, 'TS2322 (string not assignable to number) is reported');
    assert.match(typeError.message, /not assignable/);
    assert.equal(typeError.range.start.line + 1, 11, 'diagnostic points at the real line');
  } finally {
    await manager.shutdown();
  }
});

test('A3: definition/references/hover/symbols return real language-server data', { skip: skipIfNoTs }, async () => {
  const { definition, references, hover, symbols } = await import('../../src/lsp/index.js');
  const manager = (await import('../../src/lsp/index.js')).lspManager();
  try {
    await manager.startMission(TMP, { maxFiles: 20 });

    const def = await definition({ file: DEFS, line: 11, character: 15, root: TMP });
    assert.equal(def.available, true);
    assert.ok(def.locations.length >= 1, 'definition resolved');
    assert.equal(def.locations[0].file, DEFS);

    const ref = await references({ file: DEFS, line: 6, character: 15, root: TMP });
    assert.equal(ref.available, true);
    assert.ok(ref.locations.length >= 2, 'references include declaration + usages');
    assert.ok(ref.locations.some((l) => l.line === 6), 'declaration included');
    assert.ok(ref.locations.some((l) => l.line === 11), 'usage included');

    const hov = await hover({ file: BROKEN, line: 8, character: 17, root: TMP });
    assert.equal(hov.available, true);
    assert.ok(hov.hover && /interface User/.test(hov.hover.contents), 'hover returns the real type signature');

    const sym = await symbols({ file: BROKEN, root: TMP });
    assert.equal(sym.available, true);
    const names = sym.symbols.map((s) => s.name);
    assert.ok(names.includes('User'), 'document symbols include the interface');
    assert.ok(names.includes('greet'), 'document symbols include the function');
  } finally {
    await manager.shutdown();
  }
});

/* ── A4: multi-server routing reuses one process ──────────────────────── */

test('A4: one manager reuses the same server process across calls', { skip: skipIfNoTs }, async () => {
  const manager = new LspManager();
  try {
    const r = route(BROKEN);
    const c1 = await manager.ensureServer(r.server, r.argv, TMP);
    const c2 = await manager.ensureServer(r.server, r.argv, TMP);
    assert.equal(c1, c2, 'second request reuses the running server');
    assert.equal(manager.status().running.length, 1);
  } finally {
    await manager.shutdown();
  }
});

/* ── A5: workspace index ──────────────────────────────────────────────── */

test('A5: indexer walks the workspace and finds source files', () => {
  writeFile('src/a.ts', 'export const a = 1;\n');
  writeFile('src/b.js', 'export const b = 2;\n');
  writeFile('README.md', '# nope\n');
  fs.mkdirSync(path.join(TMP, 'node_modules', 'x'), { recursive: true });
  fs.writeFileSync(path.join(TMP, 'node_modules', 'x', 'ignored.ts'), 'export const x = 1;\n');

  const files = walkWorkspace(TMP, { maxFiles: 100 });
  assert.ok(files.some((f) => f.endsWith('a.ts')));
  assert.ok(files.some((f) => f.endsWith('b.js')));
  assert.ok(!files.some((f) => f.endsWith('README.md')), 'non-source excluded');
  assert.ok(!files.some((f) => f.includes('node_modules')), 'node_modules excluded');
});

test('A5: mission start opens every source file in the language server', { skip: skipIfNoTs }, async () => {
  const manager = new LspManager();
  try {
    const idx = await manager.startMission(TMP, { maxFiles: 50 });
    assert.ok(idx.files >= 2);
    assert.ok(idx.opened >= 2, 'files opened in the language server');
    assert.ok(idx.byServer.typescript >= 2);
    assert.equal(manager.documents.size, idx.opened);
  } finally {
    await manager.shutdown();
  }
});

/* ── A6: clean shutdown ───────────────────────────────────────────────── */

test('A6: shutdown stops every server and the child exits', { skip: skipIfNoTs }, async () => {
  const manager = new LspManager();
  try {
    const r = route(BROKEN);
    await manager.ensureServer(r.server, r.argv, TMP);
    const proc = manager.servers.get('typescript').proc;
    const stopped = await manager.shutdown();
    assert.deepEqual(stopped.stopped, ['typescript']);
    assert.equal(manager.servers.size, 0);
    assert.equal(manager.documents.size, 0);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.ok(proc.exitCode !== null || proc.signalCode !== null, 'child process exited');
  } finally {
    try { await manager.shutdown(); } catch { /* already stopped */ }
  }
});

/* Safety net — if ANY test above throws before its finally runs, the
 * singleton can still hold a tsserver child. Shut it down no matter what
 * so node --test exits instead of hanging on a leaked stdio pipe. */
after('dispose lingering lsp processes', async () => {
  try {
    const { lspManager } = await import('../../src/lsp/index.js');
    await lspManager().shutdown();
  } catch { /* nothing was running */ }
});
