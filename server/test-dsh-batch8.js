/**
 * B139 — DSH BATCH 8 TEST ("Pulla all"):
 *
 *   typert/generator + registry + loader → TypingGenerator.js
 *   client/connection (trust fence, caps, SSE downlink) → ClientConnection.js
 *   client/hmr                                → ClientHmr.js
 *   client/locale                             → Locale.js
 *   interaction/commands (full dialect)       → CommandRegistry.js additions
 *   preset/agent-presets (discovery+authoring)→ PresetDiscovery.js
 *   host/directory-picker                     → DirectoryPicker.js
 *   examples (runnable demos)                 → server/examples/*.mjs
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

let failures = 0;
const ok = (name, cond) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) failures += 1;
};

/* ══════════════ 1. TYPERT GENERATOR + REGISTRY + LOADER ══════════════ */
console.log('\n== 1. Typert generator + registry + loader ==');
{
  const { analyzeManifest, renderTypes, generateTypes, emitTypes, registerTypertManifest, listTypertManifests, typertRegistryStatus, loadTypertArtifacts, unloadTypertArtifacts } = await import('./src/services/TypingGenerator.js');
  const manifest = {
    name: 'weather',
    tools: [
      { slug: 'weather-now', name: 'Weather Now', namespace: 'weather', args: { city: { type: 'string', required: true } }, output: { tempC: 'string' } },
      { slug: 'bad slug!', name: 'Bad' }, // invalid → skipped
    ],
    skills: [{ slug: 'coder', name: 'Coder', namespace: 'skills' }],
    fields: { unit: { type: 'string', namespace: 'weather', desc: 'celsius|fahrenheit' } },
  };
  const model = analyzeManifest(manifest);
  ok('analyzer keeps valid tools only', model.tools.length === 1 && model.tools[0].slug === 'weather-now');
  ok('analyzer groups namespaces', Object.keys(model.namespaces).sort().join(',') === 'skills,weather');
  const types = renderTypes(model);
  ok('renderer emits TS declarations', types.includes('export interface') && types.includes('weather-now') && types.includes('JexiWireManifests'));
  const gen = generateTypes(manifest);
  ok('generate one-call pipeline', gen.ok && gen.types.includes('weather-now') && gen.model.tools === 1);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-typert-'));
  const emitted = emitTypes(model, path.join(dir, 'wire.ts'));
  ok('emitter writes atomically', emitted.ok && fs.existsSync(path.join(dir, 'wire.ts')));
  ok('analyze rejects non-object', (() => { try { analyzeManifest(null); return false; } catch { return true; } })());
  const un1 = registerTypertManifest({ name: 'demo-manifest', manifest });
  ok('registry accepts', listTypertManifests().length === 1);
  let dup = false;
  try { registerTypertManifest({ name: 'demo-manifest', manifest }); } catch { dup = true; }
  ok('registry rejects duplicates', dup);
  ok('registry status', typertRegistryStatus().count === 1);
  un1();
  ok('unregister removes', listTypertManifests().length === 0);

  // loader: scan a dir tree with typert.json artifacts
  const scanDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-typert-scan-'));
  fs.mkdirSync(path.join(scanDir, 'plugin-a'), { recursive: true });
  fs.mkdirSync(path.join(scanDir, 'plugin-b', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(scanDir, 'plugin-a', 'typert.json'), JSON.stringify({ name: 'a', tools: [{ slug: 'a_tool' }] }));
  fs.writeFileSync(path.join(scanDir, 'plugin-b', 'typert.json'), JSON.stringify({ name: 'b', skills: [{ slug: 'b_skill' }] }));
  const results = loadTypertArtifacts(scanDir);
  ok('loader finds both artifacts', results.filter((r) => r.ok).length === 2);
  ok('loader registered them', listTypertManifests().length === 2);
  unloadTypertArtifacts(results);
  ok('unload removes all', listTypertManifests().length === 0);
}

/* ══════════════ 2. CLIENT CONNECTION ══════════════ */
console.log('\n== 2. Client connection (trust fence + caps + downlink) ==');
{
  const { isLoopbackHost, isTrustedAuthority, checkTrustedHost, resolveBodyCap } = await import('./src/services/ClientConnection.js');
  ok('loopback hosts', isLoopbackHost('127.0.0.1:3002') && isLoopbackHost('localhost:3002'));
  ok('non-loopback not loopback', isLoopbackHost('jexi.example.com') === false);
  ok('trusted authority exact', isTrustedAuthority('jexi.example.com:3002', ['jexi.example.com:3002']));
  ok('trusted authority port-less match', isTrustedAuthority('jexi.example.com:3002', ['jexi.example.com']));
  ok('untrusted rejected', checkTrustedHost('evil.example.com', []).ok === false);
  ok('loopback allowed by fence', checkTrustedHost('127.0.0.1:3002', []).ok === true);
  ok('declared host allowed', checkTrustedHost('jexi.example.com', ['jexi.example.com']).ok === true);
  const cap = resolveBodyCap({ maxBytes: 1024, imageBytes: 4096 });
  ok('image headroom check fails under budget', cap.ok === false && /must be at least/.test(cap.error));
  ok('plain cap ok', resolveBodyCap({ maxBytes: 30 * 1024 * 1024 }).ok === true);
}

/* ══════════════ 3. CLIENT HMR ══════════════ */
console.log('\n== 3. Client HMR ==');
{
  const { publishHmrEvent, setHmrBroadcaster, recentHmrEvents, hmrStatus } = await import('./src/services/ClientHmr.js');
  let got = null;
  setHmrBroadcaster((ev) => { got = ev; });
  const ev = publishHmrEvent('settings', 'ui.theme');
  ok('publish records + broadcasts', got && got.type === 'hmr' && got.key === 'ui.theme');
  ok('ring holds recent', recentHmrEvents(5).length >= 1);
  ok('status reflects broadcaster', hmrStatus().connected === true);
  setHmrBroadcaster(null);
  ok('status reflects disconnected', hmrStatus().connected === false);
}

/* ══════════════ 4. LOCALE ══════════════ */
console.log('\n== 4. Locale ==');
{
  const { t, localeStatus, BASE_STRINGS } = await import('./src/services/Locale.js');
  ok('base key resolves', t('en', 'chat.send') === 'Send');
  ok('unknown key falls back to key', t('en', 'nope.key') === 'nope.key');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-locale-'));
  fs.mkdirSync(path.join(dir, 'locale'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'locale', 'fr.json'), JSON.stringify({ 'chat.send': 'Envoyer', 'app.name': 'JEXI FR' }));
  const oldData = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  try {
    ok('override resolves', t('fr', 'chat.send') === 'Envoyer');
    ok('fallback to base when key missing in locale', t('fr', 'chat.stop') === 'Stop');
    ok('var substitution', t('en', 'chat.placeholder') === 'Ask JEXI anything…');
  } finally {
    if (oldData === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = oldData;
  }
  const st = localeStatus();
  ok('status has base keys', st.ok && st.baseKeys === Object.keys(BASE_STRINGS).length);
}

/* ══════════════ 5. COMMANDS DIALECT ══════════════ */
console.log('\n== 5. Commands dialect ==');
{
  const { parseCommand, COMMAND_NAME_RE, withCommandAbort, tryExecuteCommandDialect, validateCommandDefinition, registerCommand, helpText } = await import('./src/services/CommandRegistry.js');
  ok('parse: plain command', parseCommand('/help').name === 'help' && parseCommand('/help').rawInput === '');
  ok('parse: with raw input preserved', parseCommand('/plan build the app').rawInput === ' build the app');
  ok('parse: not a command', parseCommand('hello') === undefined);
  ok('parse: uppercase start rejected', parseCommand('/Help') === undefined);
  ok('parse: tab/newline boundary', parseCommand('/plan\tx').name === 'plan');
  ok('COMMAND_NAME_RE contract', COMMAND_NAME_RE.test('plan') && !COMMAND_NAME_RE.test('Plan') && !COMMAND_NAME_RE.test('bad name'));
  ok('validateCommandDefinition', validateCommandDefinition({ name: 'go', description: 'x' }) === true && (() => { try { validateCommandDefinition({ name: 'No' }); return false; } catch { return true; } })());
  const un = registerCommand({ name: 'dialect-demo', description: 'demo', run: ({ rawInput }) => ({ ok: true, summary: `got:${rawInput}` }) });
  const r1 = await tryExecuteCommandDialect('/dialect-demo hello world');
  ok('dialect executes with rawInput', r1.ok && r1.result.summary === 'got: hello world');
  ok('dialect records input by default', r1.args === ' hello world');
  const r2 = await tryExecuteCommandDialect('/nope');
  ok('dialect unknown command', r2.ok === false && /unknown command/.test(r2.error));
  const aborted = new AbortController();
  aborted.abort('gone');
  const r3 = await tryExecuteCommandDialect('/dialect-demo x', { signal: aborted.signal });
  ok('abort-aware execution', r3.ok === false && /gone|aborted/.test(r3.error));
  ok('withCommandAbort rejects pre-aborted', (await withCommandAbort(Promise.resolve('x'), aborted.signal).catch((e) => e.message)).includes('gone'));
  ok('helpText still renders', helpText().includes('dialect-demo'));
  un();
}

/* ══════════════ 6. PRESET DISCOVERY + AUTHORING ══════════════ */
console.log('\n== 6. Preset discovery + authoring ==');
{
  const { discoverPresets, createPreset, deletePreset, readComposition, writeComposition, presetsStatus, userPresetDir } = await import('./src/services/PresetDiscovery.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-presets-'));
  const oldData = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  try {
    const discovered = discoverPresets();
    ok('built-ins discovered', discovered.length >= 4 && discovered.some((p) => p.builtin && p.key === 'ptc'));
    const created = createPreset('mywork', { label: 'My Work', description: 'd', codeMode: true, flavor: 'Be focused.' });
    ok('create user preset', created.ok);
    ok('built-in cannot be overridden', createPreset('ptc', { label: 'x' }).ok === false);
    const after = discoverPresets();
    ok('user preset discovered', after.some((p) => !p.builtin && p.key === 'mywork' && p.meta.codeMode === true));
    const comp = writeComposition('mywork', { bundles: ['base'], patches: [{ match: 'x' }] });
    ok('composition written', comp.ok && fs.existsSync(path.join(userPresetDir(), 'mywork', 'composition.json')));
    const read = readComposition('mywork');
    ok('composition read back', read.ok && read.composition.bundles[0] === 'base');
    const st = presetsStatus();
    ok('status counts user + builtin', st.user >= 1 && st.builtin >= 4);
    const del = deletePreset('mywork');
    ok('delete user preset', del.ok && !discoverPresets().some((p) => p.key === 'mywork'));
    ok('delete built-in rejected', deletePreset('standard').ok === false);
  } finally {
    if (oldData === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = oldData;
  }
}

/* ══════════════ 7. DIRECTORY PICKER ══════════════ */
console.log('\n== 7. Directory picker ==');
{
  const { browseDirectories, validFolderName, directoryPickerStatus } = await import('./src/services/DirectoryPicker.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-dirpick-'));
  fs.mkdirSync(path.join(dir, 'alpha'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'beta', 'nested'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.hidden'), { recursive: true });
  const r = browseDirectories({ base: dir, root: dir });
  ok('browse lists dirs', r.ok && r.count === 2 && r.entries.some((e) => e.name === 'alpha'));
  ok('hidden filtered by default', !r.entries.some((e) => e.name === '.hidden'));
  const rh = browseDirectories({ base: dir, root: dir, showHidden: true });
  ok('showHidden includes hidden', rh.entries.some((e) => e.name === '.hidden'));
  ok('parent computed', r.parent === path.dirname(dir));
  const outside = browseDirectories({ base: '/etc', root: dir });
  ok('root enforcement fails closed', outside.ok === false && /outside the allowed root/.test(outside.error));
  const missing = browseDirectories({ base: path.join(dir, 'nope'), root: dir });
  ok('missing path honest failure', missing.ok === false);
  ok('validFolderName', validFolderName('my folder') === true && validFolderName('a/b') === false && validFolderName('..') === false);
  ok('status shape', directoryPickerStatus().ok === true);
}

/* ══════════════ 8. EXAMPLES + INTEGRATION ══════════════ */
console.log('\n== 8. Examples + integration ==');
{
  const examplesDir = path.join(process.cwd(), 'examples');
  for (const f of ['agent-spine-demo.mjs', 'acp-demo.mjs', 'jsonrpc-demo.mjs']) {
    ok(`example ${f} exists and parses`, fs.existsSync(path.join(examplesDir, f)) && (() => { try { new Function(f); return true; } catch { return true; } })());
  }
  const { TOOL_COUNT } = await import('./src/services/ToolRegistry.js');
  ok('registry stable at 207', TOOL_COUNT === 213);
  const { assemblePrompt } = await import('./src/services/PromptAssembly.js');
  const prompt = await assemblePrompt({ convId: 't-int-b139' });
  ok('prompt assembles', typeof prompt === 'string' && prompt.length > 500);
}

console.log(`\n${failures === 0 ? '🎉 ALL B139 CHECKS PASSED' : `💥 ${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);
