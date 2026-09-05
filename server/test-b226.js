/**
 * B226 — the camera & photos render fixes (found with real browser eyes):
 *
 *  BUG 1 (B225 regression, the big one): Composer referenced `autosize` in
 *       toggleMic's useCallback deps BEFORE autosize was defined — a TDZ
 *       ReferenceError thrown at RUNTIME (build passes fine). The whole chat
 *       view crashed on load → the + menu (EYES / PHOTO / CHECK — "the
 *       three") never rendered. Lesson: vite build green ≠ runs green.
 *  BUG 2 (pre-existing since B193): the PHOTO action clicked fileRef…, but
 *       the <input ref={fileRef}> element was NEVER rendered — a silent null
 *       click. The image picker literally did not exist in the DOM.
 *  BUG 3 (pre-existing): VisionPanel captured a photo and handed it to
 *       onVisionResult — which neither App nor CommandCenter passed. The
 *       captured image vanished into /dev/null.
 *
 * All three verified live with Playwright (chromium, 390×844): menu renders
 * three actions, EYES capture lands in chat with the vision question, PHOTO
 * preview renders and sends. These contracts keep the wiring from rotting.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');

test('Composer: autosize is defined BEFORE toggleMic uses it (the TDZ crash)', () => {
  const src = read('../src/components/Composer.jsx');
  const autosizeAt = src.indexOf('const autosize = useCallback(');
  const toggleAt = src.indexOf('const toggleMic = useCallback(');
  const stopAt = src.indexOf('const stopMic = useCallback(');
  assert.ok(autosizeAt > -1, 'autosize exists');
  assert.ok(toggleAt > -1, 'toggleMic exists');
  assert.ok(stopAt > -1, 'stopMic exists');
  assert.ok(autosizeAt < toggleAt, 'autosize is declared before toggleMic (a useCallback dep referenced before definition is a runtime TDZ crash that the build will NOT catch)');
  assert.ok(autosizeAt < stopAt, 'autosize is declared before stopMic');
});

test('Composer: the mic button is feature-detected (never a dead button)', () => {
  const src = read('../src/components/Composer.jsx');
  assert.match(src, /window\.SpeechRecognition \|\| window\.webkitSpeechRecognition/);
  assert.ok(src.includes('{SpeechRecognitionCtor && ('));
});

test('ChatWindow: the image input PHOTO clicks actually EXISTS in the DOM', () => {
  const src = read('../src/components/ChatWindow.jsx');
  // the B193 action clicked fileRef — the input element itself never rendered
  assert.ok(
    src.includes('<input ref={fileRef} type="file" accept="image/*"'),
    'the hidden image input is rendered (B226 fix: fileRef was a null click before)',
  );
  assert.ok(src.includes('onChange={handleFile}'), 'picking a file runs handleFile → preview');
  assert.match(src, /action === 'photo'\) fileRef\.current\?\.click\(\)/, 'PHOTO still opens it');
});

test('ChatWindow: captured/attached images render as real <img> tags', () => {
  const src = read('../src/components/ChatWindow.jsx');
  assert.match(src, /msg\.image &&/, 'messages render their image');
  assert.match(src, /<img src=\{msg\.image\}/, 'message image is a real img element');
  assert.match(src, /<img src=\{image\} alt="attachment"/, 'the pending-attachment preview renders');
});

test('VisionPanel: capture hands the photo to onVision (unchanged contract)', () => {
  const src = read('../src/components/VisionPanel.jsx');
  assert.match(src, /if \(onVision\) onVision\(base64\)/, 'capture calls onVision with the base64 image');
  assert.match(src, /capture="environment"/, 'opens the device camera');
});

test('App + CommandCenter: onVisionResult is actually wired (captures go somewhere)', () => {
  const app = read('../src/App.jsx');
  const cc = read('../src/components/CommandCenter.jsx');
  assert.match(app, /onVisionResult=\{\(img\) => engine\.runSearch\(/, 'App wires captured photos into a vision query');
  assert.match(cc, /onVisionResult=\{\(img\) => engine\.runSearch\(/, 'CommandCenter wires it too');
  assert.match(app, /'What do you see in this image\?/, 'the vision prompt is honest and human');
});

test('engine: runSearch carries the image into the chat message + request', async () => {
  const src = read('../src/hooks/useJexiEngine.js');
  assert.match(src, /const userMsg = \{ role: 'user', text: query, image \}/, 'the user message carries the image (rendered in chat)');
  assert.match(src, /body: JSON\.stringify\(\{ query, image: image \|\| undefined/, 'the request body carries the image');
});
