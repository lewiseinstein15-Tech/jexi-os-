/**
 * B225 — the alternative-infrastructure build:
 *   Part 13 AndroidRuntime: a REAL adb-backed computer-use provider (the
 *     device is the computer — no host Chromium, no daemon, free forever).
 *   Discovery composes assignments (B223's metadata finally rides along).
 *   Voice input: the browser is the microphone (frontend contract).
 *
 * The adb here is a STUB BINARY (argv-precise recorder + canned outputs) —
 * a test harness, clearly labeled, never shipped. Production uses real adb.
 * What these tests prove: the adapter speaks correct adb argv, parses real
 * uiautomator XML, and is honestly unavailable without a device — never fake.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { AndroidRuntime, androidAdbPath, parseUiDump } from './src/services/AndroidRuntime.js';
import { RUNTIME_PROVIDERS, providerCapabilities, activeProvider, computerStatus, runtimeCall } from './src/services/ComputerRuntime.js';
import { recommendedToolsForSubtask } from './src/services/director/Director.js';

/* ── the stub adb harness ─────────────────────────────────────────────── */

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-b225-'));
const STUB = path.join(TMP, 'adb');
const LOG = path.join(TMP, 'argv.log');
const MODE = path.join(TMP, 'mode');
const XMLF = path.join(TMP, 'dump.xml');
const PNGF = path.join(TMP, 'shot.png');

fs.writeFileSync(MODE, 'online');
fs.writeFileSync(LOG, '');

// a real 1x1 PNG (valid signature — the adapter checks it)
fs.writeFileSync(PNGF, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));

// a real-shaped uiautomator dump: button + label + editable field
fs.writeFileSync(XMLF, `<?xml version='1.0' encoding='UTF-8'?>
<hierarchy rotation="0"><node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.app" content-desc="" checkable="false" clickable="false" bounds="[0,0][1080,2340]">
  <node index="1" text="SIGN IN" resource-id="com.app:id/btn_login" class="android.widget.Button" package="com.app" content-desc="" clickable="true" bounds="[10,20][110,70]"/>
  <node index="2" text="Hello world" resource-id="" class="android.widget.TextView" package="com.app" content-desc="" clickable="false" bounds="[10,80][200,100]"/>
  <node index="3" text="" resource-id="com.app:id/search" class="android.widget.EditText" package="com.app" content-desc="Search…" clickable="true" bounds="[10,110][300,150]"/>
</node></hierarchy>`);

fs.writeFileSync(STUB, `#!/bin/sh
# JEXI test stub for adb — argv recorder + canned outputs. NEVER shipped.
printf '%s\\n' "$*" >> "\${JEXI_TEST_ADB_LOG:?}"
[ "$1" = "-s" ] && shift 2
MODE=$(cat "\${JEXI_TEST_ADB_MODE:?}" 2>/dev/null || echo online)
case "$1" in
  devices)
    echo "List of devices attached"
    [ "$MODE" != offline ] && echo "emulator-5554	device"
    ;;
  shell)
    case "$2" in
      "echo hello") echo hello ;;
      "uiautomator dump '/sdcard/jexi-dump.xml'") echo "UI hierchary dumped to: /sdcard/jexi-dump.xml" ;;
      "cat '/sdcard/jexi-dump.xml'") cat "\${JEXI_TEST_ADB_XML:?}" ;;
      "wm size") echo "Physical size: 1080x2340" ;;
      am*) echo "Starting: Intent { act=android.intent.action.VIEW }" ;;
      *) : ;;
    esac ;;
  exec-out)
    [ "$2" = "screencap -p" ] && { [ "$MODE" = noscreen ] && echo "not a png" || cat "\${JEXI_TEST_ADB_PNG:?}"; }
    ;;
  push) echo "1 file pushed" ;;
esac
exit 0
`);
fs.chmodSync(STUB, 0o755);

process.env.JEXI_TEST_ADB_LOG = LOG;
process.env.JEXI_TEST_ADB_MODE = MODE;
process.env.JEXI_TEST_ADB_XML = XMLF;
process.env.JEXI_TEST_ADB_PNG = PNGF;

const argvLog = () => fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean);
const clearLog = () => fs.writeFileSync(LOG, '');

// env save/restore around every subtest that mutates it
const ENV_KEYS = ['ANDROID_ADB', 'ANDROID_HOME', 'JEXI_ANDROID_SERIAL', 'ANDROID_SERIAL', 'COMPUTER_RUNTIME', 'PATH'];
const savedEnv = {};
for (const k of ENV_KEYS) savedEnv[k] = process.env[k];

function withAndroidEnv(fn) {
  return async () => {
    process.env.ANDROID_ADB = STUB;
    process.env.JEXI_ANDROID_SERIAL = 'emulator-5554';
    delete process.env.ANDROID_HOME;
    process.env.COMPUTER_RUNTIME = 'android';
    try {
      await fn();
    } finally {
      for (const k of ENV_KEYS) {
        if (savedEnv[k] === undefined) delete process.env[k];
        else process.env[k] = savedEnv[k];
      }
    }
  };
}

function withNoAdbEnv(fn) {
  return async () => {
    process.env.ANDROID_ADB = path.join(TMP, 'does-not-exist');
    delete process.env.ANDROID_HOME;
    process.env.JEXI_ANDROID_SERIAL = '';
    const emptyPath = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-nopath-'));
    const realPath = process.env.PATH;
    process.env.PATH = emptyPath;
    try {
      await fn();
    } finally {
      process.env.PATH = realPath;
      for (const k of ENV_KEYS) {
        if (savedEnv[k] === undefined) delete process.env[k];
        else process.env[k] = savedEnv[k];
      }
    }
  };
}

const rt = new AndroidRuntime();

/* ── 1. adb resolution + honest absence ───────────────────────────────── */

test('adb resolution: null when nothing real is present (honest)', withNoAdbEnv(() => {
  assert.equal(androidAdbPath(), null, 'no adb anywhere → null, never a guess');
  const st = computerStatus();
  const android = st.providers.find((p) => p.name === 'android');
  assert.ok(android, 'android listed in status');
  assert.equal(android.configured, false, 'android configured=false with no adb — honest');
}));

test('adb resolution: the stub binary is found via ANDROID_ADB', withAndroidEnv(() => {
  assert.equal(androidAdbPath(), STUB);
  const st = computerStatus();
  const android = st.providers.find((p) => p.name === 'android');
  assert.equal(android.configured, true, 'configured=true when the adb binary exists');
}));

test('status: no adb → unavailable with the true reason (never fake)', withNoAdbEnv(async () => {
  const r = await rt.call('status');
  assert.equal(r.unavailable, true);
  assert.match(r.reason, /adb not found/);
}));

test('status: adb present but no device → honest "no device"', withAndroidEnv(async () => {
  fs.writeFileSync(MODE, 'offline');
  clearLog();
  const r = await rt.call('status');
  fs.writeFileSync(MODE, 'online');
  assert.equal(r.unavailable, true);
  assert.match(r.reason, /no Android device ready/);
  assert.match(r.reason, /no device attached/);
}));

test('status: device ready → ok with provider + device + adb path', withAndroidEnv(async () => {
  clearLog();
  const r = await rt.call('status');
  assert.equal(r.ok, true);
  assert.equal(r.provider, 'android');
  assert.equal(r.device, 'emulator-5554');
  assert.equal(r.adb, STUB);
  assert.ok(argvLog().some((l) => l === 'devices'), 'device check runs raw `adb devices`');
}));

/* ── 2. terminal — real shell pass-through ────────────────────────────── */

test('execute: real shell command through adb, output captured', withAndroidEnv(async () => {
  clearLog();
  const r = await rt.call('execute', { command: 'echo hello' });
  assert.equal(r.success, true);
  assert.match(r.output, /hello/);
  assert.ok(argvLog().some((l) => l === '-s emulator-5554 shell echo hello'), 'argv is exact: -s serial shell <command>');
}));

/* ── 3. the accessibility tree — real uiautomator parse ──────────────── */

test('parseUiDump: numbered elements with tags from a real-shaped dump', () => {
  const els = parseUiDump(fs.readFileSync(XMLF, 'utf8'));
  assert.equal(els.length, 3, 'three labeled, visible elements (frame layout is skipped)');
  assert.equal(els[0].id, 1);
  assert.equal(els[0].tag, 'button', 'clickable → button');
  assert.equal(els[0].text, 'SIGN IN');
  assert.equal(els[0].bounds.cx, 60, 'center x of [10,20][110,70]');
  assert.equal(els[0].bounds.cy, 45);
  assert.equal(els[1].tag, 'text', 'plain TextView → text');
  assert.equal(els[2].tag, 'input', 'EditText → input');
  assert.equal(els[2].text, 'Search…', 'content-desc is the label when text is empty');
});

test('elements: dump → parse → numbered wire shape', withAndroidEnv(async () => {
  clearLog();
  const r = await rt.call('elements');
  assert.equal(r.elements.length, 3);
  assert.equal(r.elements[0].text, 'SIGN IN');
  assert.equal(r.elements[0].bounds, '[10,20][110,70]');
  assert.equal(r.elements[0].href, '', 'no URLs in the a11y tree — honest empty');
  const log = argvLog();
  assert.ok(log.some((l) => l.includes("uiautomator dump '/sdcard/jexi-dump.xml'")), 'dumps via the real command');
  assert.ok(log.some((l) => l.includes("cat '/sdcard/jexi-dump.xml'")), 'reads it back via cat');
}));

test('page-text: all visible labels joined', withAndroidEnv(async () => {
  const r = await rt.call('page-text');
  assert.match(r.text, /SIGN IN/);
  assert.match(r.text, /Hello world/);
  assert.match(r.text, /Search…/);
}));

test('page-title: honest unavailable — the a11y tree has no DOM title', withAndroidEnv(async () => {
  const r = await rt.call('page-title');
  assert.equal(r.unavailable, true);
  assert.match(r.reason, /no page title/);
}));

/* ── 4. input — tap centers, adb's real escaping rules ───────────────── */

test('click-index: taps the computed center of that element', withAndroidEnv(async () => {
  clearLog();
  const r = await rt.call('click-index', { index: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.tapped, '60,45');
  assert.ok(argvLog().some((l) => l === '-s emulator-5554 shell input tap 60 45'));
}));

test('click-text: finds by text and taps its center', withAndroidEnv(async () => {
  clearLog();
  const r = await rt.call('click-text', { text: 'SIGN IN' });
  assert.equal(r.ok, true);
  assert.ok(argvLog().some((l) => l.includes('input tap 60 45')));
}));

test('click-text: honest failure when nothing matches', withAndroidEnv(async () => {
  const r = await rt.call('click-text', { text: 'NOPE' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /element not found/);
  assert.equal(r.unavailable, undefined, 'a miss is a real miss, not an outage');
}));

test('type-index: focus tap + input text with adb escaping (space→%s)', withAndroidEnv(async () => {
  clearLog();
  const r = await rt.call('type-index', { index: 3, text: 'hello world' });
  assert.equal(r.ok, true);
  const log = argvLog();
  assert.ok(log.some((l) => l.includes('input tap 155 130')), 'taps the field center first');
  assert.ok(log.some((l) => l === "-s emulator-5554 shell input text 'hello%sworld'"), "space → %s (adb reality), single-quoted");
}));

/* ── 5. browser navigation — the device browser, quoted for the shell ── */

test('goto: am start VIEW with a shell-quoted URL (& survives)', withAndroidEnv(async () => {
  clearLog();
  const r = await rt.call('goto', { url: 'https://example.com/?a=1&b=2' });
  assert.equal(r.ok, true);
  assert.equal(r.opened, 'https://example.com/?a=1&b=2');
  assert.ok(argvLog().some((l) => l.includes("am start -a android.intent.action.VIEW -d 'https://example.com/?a=1&b=2'")));
}));

test('goto: refuses non-http urls honestly', withAndroidEnv(async () => {
  const r = await rt.call('goto', { url: 'file:///etc/passwd' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /non-http/);
}));

test('scroll: reads the real screen size, swipes a deterministic path', withAndroidEnv(async () => {
  clearLog();
  const r = await rt.call('scroll', { direction: 'down' });
  assert.equal(r.ok, true);
  const log = argvLog();
  assert.ok(log.some((l) => l.includes('wm size')), 'screen size read for real');
  assert.ok(log.some((l) => l === '-s emulator-5554 shell input swipe 540 1755 540 585 300'), 'down = 3/4 height → 1/4 height');
}));

test('press: mapped keys send real keyevents; unmapped fail honestly', withAndroidEnv(async () => {
  clearLog();
  const ok = await rt.call('press', { key: 'ENTER' });
  assert.equal(ok.ok, true);
  assert.equal(ok.keyevent, 66);
  assert.ok(argvLog().some((l) => l === '-s emulator-5554 shell input keyevent 66'));
  const bad = await rt.call('press', { key: 'FANCYKEY' });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /no Android keyevent mapping/);
}));

test('back/forward: back is a real keyevent; forward is honestly unsupported', withAndroidEnv(async () => {
  clearLog();
  const back = await rt.call('back');
  assert.equal(back.ok, true);
  assert.ok(argvLog().some((l) => l === '-s emulator-5554 shell input keyevent 4'));
  const fwd = await rt.call('forward');
  assert.equal(fwd.ok, false);
  assert.match(fwd.reason, /no forward key/);
}));

/* ── 6. screenshots — real PNG bytes or honest absence ────────────────── */

test('screenshot-json: the exact PNG the device returned, as a data URI', withAndroidEnv(async () => {
  const r = await rt.call('screenshot-json');
  const expected = `data:image/png;base64,${fs.readFileSync(PNGF).toString('base64')}`;
  assert.equal(r.image, expected);
}));

test('screenshot-json: non-PNG output → honest unavailable, never a fake image', withAndroidEnv(async () => {
  fs.writeFileSync(MODE, 'noscreen');
  const r = await rt.call('screenshot-json');
  fs.writeFileSync(MODE, 'online');
  assert.equal(r.unavailable, true);
  assert.match(r.reason, /no PNG/);
}));

/* ── 7. files + unknown endpoints ─────────────────────────────────────── */

test('write-file: real adb push of the content', withAndroidEnv(async () => {
  clearLog();
  const r = await rt.call('write-file', { path: '/sdcard/notes.txt', content: 'B225 live' });
  assert.equal(r.ok, true);
  assert.equal(r.pushed, '/sdcard/notes.txt');
  assert.equal(r.bytes, 'B225 live'.length);
  assert.ok(argvLog().some((l) => l.includes('push') && l.includes('/sdcard/notes.txt')));
}));

test('unknown endpoint: honest unavailable, never a silent ok', withAndroidEnv(async () => {
  const r = await rt.call('teleport');
  assert.equal(r.unavailable, true);
  assert.match(r.reason, /does not implement/);
}));

/* ── 8. ComputerRuntime integration ───────────────────────────────────── */

test('android is a first-class runtime provider', withAndroidEnv(async () => {
  assert.ok(RUNTIME_PROVIDERS.includes('android'));
  const caps = providerCapabilities('android');
  assert.deepEqual(caps, { terminal: true, browser: true, screenshot: true, input: true, files: true });
  assert.equal(activeProvider(), 'android', 'COMPUTER_RUNTIME=android selects it');
  clearLog();
  const r = await runtimeCall('status', {}, 'android');
  assert.equal(r.ok, true);
  assert.equal(r.provider, 'android');
}));

/* ── 9. the browser loop over android (the full alternative path) ─────── */

test('browser round executes on android via the adapter (no host Chromium)', withAndroidEnv(async () => {
  const { runBrowserRound } = await import('./src/services/director/ComputerOps.js');
  clearLog();
  const events = [];
  const emit = (type, fields) => events.push({ type, ...fields });
  const out = await runBrowserRound({
    lines: ['goto https://example.com/?a=1&b=2', 'click-index 1', 'scroll down', 'press ENTER'], // exactly MAX_ACTIONS_PER_ROUND (4)
    emit,
    identity: { agentId: 'atlas', agentName: 'Atlas' },
  });
  assert.equal(out.blocked, false, 'the device is the computer — no ensureBrowser/Chromium probe');
  assert.ok(out.results.every((r) => r.ok !== false), 'every action executed on the stub device');
  const log = argvLog();
  assert.ok(log.some((l) => l.includes('am start')), 'goto opened the device browser');
  assert.ok(log.some((l) => l.includes('input tap 60 45')), 'click-index tapped');
  assert.ok(log.some((l) => l.includes('input swipe')), 'scroll swiped');
  assert.ok(log.some((l) => l.includes('keyevent 66')), 'press ENTER sent the real keyevent');
  assert.ok(out.observation, 'the loop observed after acting');
  assert.equal(out.observation.elementCount, 3, 'observation from the real a11y dump');
  assert.match(out.observation.textSnippet, /SIGN IN/);
  assert.equal(out.observation.title, '', 'no DOM title on android — honest empty, never fabricated');
  assert.ok(events.some((e) => e.type === 'COMPUTER_OBSERVE'));
  assert.ok(!events.some((e) => e.type === 'COMPUTER_BLOCKED'));
}));

test('browser round with no adb: ONE COMPUTER_BLOCKED with the true reason', withNoAdbEnv(async () => {
  const { runBrowserRound } = await import('./src/services/director/ComputerOps.js');
  process.env.COMPUTER_RUNTIME = 'android';
  const events = [];
  const emit = (type, fields) => events.push({ type, ...fields });
  const out = await runBrowserRound({ lines: ['goto https://example.com'], emit, identity: { agentId: 'atlas', agentName: 'Atlas' } });
  assert.equal(out.blocked, true);
  assert.match(out.reason, /adb not found/);
  const blocked = events.filter((e) => e.type === 'COMPUTER_BLOCKED');
  assert.equal(blocked.length, 1, 'exactly one honest block — not a round of dead actions');
  assert.ok(out.results.length === 0);
}));

/* ── 10. discovery composes assignments ───────────────────────────────── */

test('recommendedToolsForSubtask: matches discovery tools to the subtask capability', () => {
  const discovery = {
    tools: [
      { slug: 'web-search', matchedCapabilities: ['research'] },
      { slug: 'run-command', matchedCapabilities: ['author-code'] },
      { slug: 'send-email', matchedCapabilities: ['outbound-send'] },
    ],
  };
  assert.deepEqual(
    recommendedToolsForSubtask(discovery, { capability: 'research', requirements: [] }),
    ['web-search'],
  );
  assert.deepEqual(
    recommendedToolsForSubtask(discovery, { capability: 'irrelevant', requirements: ['research', 'author-code'] }),
    ['web-search', 'run-command'],
    'requirements count too',
  );
});

test('recommendedToolsForSubtask: null when nothing matches (absence is honest)', () => {
  const discovery = { tools: [{ slug: 'web-search', matchedCapabilities: ['research'] }] };
  assert.equal(recommendedToolsForSubtask(discovery, { capability: 'vision' }), null);
  assert.equal(recommendedToolsForSubtask(null, { capability: 'research' }), null);
  assert.equal(recommendedToolsForSubtask({ tools: [] }, { capability: 'research' }), null);
  assert.equal(recommendedToolsForSubtask(discovery, {}), null);
});

test('Director wiring: the recommendation reaches the event and the brief', async () => {
  const src = fs.readFileSync('./src/services/director/Director.js', 'utf8');
  assert.ok(src.includes('recommendedToolsForSubtask(task.structuredObjective?.toolDiscovery, subtask)'), 'staffing consults discovery');
  assert.ok(/\.\.\.\(recommended \? \{ recommendedTools: recommended \} : \{\}\)/.test(src), 'EMPLOYEE_SELECTED carries recommendedTools when present');
  assert.match(src, /Recommended tools for this assignment \(matched to the objective by discovery\)/, 'the assignment brief tells the employee what discovery found');
});

/* ── 11. frontend: the browser is the microphone ──────────────────────── */

test('Composer voice input: feature-detected, honest when absent', async () => {
  const src = fs.readFileSync('../src/components/Composer.jsx', 'utf8');
  assert.match(src, /window\.SpeechRecognition \|\| window\.webkitSpeechRecognition/, 'Web Speech API, zero keys');
  assert.ok(src.includes('{SpeechRecognitionCtor && ('), 'the mic button renders ONLY when the engine exists — no dead button');
  assert.ok(src.includes('interimResults = true'), 'interim results stream into the draft');
  assert.match(src, /Microphone blocked — allow mic access/, 'permission errors surface honestly');
  assert.match(src, /rec\.onend = \(\) => setListening\(false\)/, 'listening state ends with the engine');
  assert.match(src, /import \{ Mic, Send, Square \} from 'lucide-react'/, 'mic icon imported');
});

/* ── 12. docs tell the same story ─────────────────────────────────────── */

test('docs: the android adapter and its honesty contract are documented', async () => {
  const android = fs.readFileSync('../ANDROID.md', 'utf8');
  assert.match(android, /AndroidRuntime/, 'ANDROID.md documents the adapter');
  assert.match(android, /adb/, 'the adb mechanism is named');
  assert.match(android, /COMPUTER_RUNTIME=android/, 'activation is documented');

  const audit = fs.readFileSync('../docs/JEXI_ARCHITECTURE_AUDIT.md', 'utf8');
  assert.match(audit, /Part 13[\s\S]{0,600}\*\*DONE — B225/, 'audit row 8 (Part 13) is closed honestly');

  const matrix = fs.readFileSync('../docs/CAPABILITY_MATRIX.md', 'utf8');
  assert.match(matrix, /AndroidRuntime adapter/i, 'the matrix has the android row');
});

/* ── cleanup ───────────────────────────────────────────────────────────── */

test('cleanup: stub harness removed', () => {
  fs.rmSync(TMP, { recursive: true, force: true });
  assert.ok(!fs.existsSync(STUB));
});
