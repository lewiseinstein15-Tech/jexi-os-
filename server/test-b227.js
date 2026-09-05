/**
 * B227 — the image actually reaches the AI (the "not describing what is in
 * the photo" bug, reproduced live and fixed for real).
 *
 * The live repro: a photo of three yellow rubber ducks + "What do you see in
 * this image?" was answered by the PICTURE-SEARCH Presenter with a random
 * 1915 Wikimedia postcard — the attached photo was never looked at. Four
 * separate drops/hijacks existed:
 *
 *   D. the Presenter picture-search fast path fired on analysis phrasing
 *      ("see…image") and swallowed the turn — the photo was ignored.
 *   A. the SIMPLE lane (SimpleTask) never read opts.image at all.
 *   B. WorkerRouter's plain lane hardcoded the image to null; the tools lane
 *      cannot carry images and would silently drop them.
 *   C. AgentLoop's main path TOLD the model an image existed (text note)
 *      without showing it — the model guessed.
 *
 * The graph lane (intent image_recognition → N.imageRecognition with
 * plan.payload) was already correct — these tests lock that in too.
 * LLMClient's provider layer was already honest (text-only providers return
 * null for images; groq/openrouter switch to vision models; gemini sends
 * inline_data) — locked in as contracts.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');

/* ── D: the picture-search hijack ──────────────────────────────────────── */

test('detectPictureIntent: analysis phrasing never triggers picture SEARCH', async () => {
  const { detectPictureIntent } = await import('./src/services/ImageSearch.js');
  assert.equal(detectPictureIntent('What do you see in this image? Describe it and tell me anything important.'), null);
  assert.equal(detectPictureIntent('describe this photo for me'), null);
  assert.equal(detectPictureIntent('analyze the image I sent'), null);
  assert.equal(detectPictureIntent('what is in this picture?'), null);
  assert.equal(detectPictureIntent('identify what this is'), null);
});

test('detectPictureIntent: real picture requests still work', async () => {
  const { detectPictureIntent } = await import('./src/services/ImageSearch.js');
  const a = detectPictureIntent('show me a picture of a lion');
  assert.ok(a && a.mode === 'find' && /lion/.test(a.subject));
  const b = detectPictureIntent('find a photo of Kericho tea fields');
  assert.ok(b && b.mode === 'find');
});

test('chat dispatcher: an attached image disables the picture-search fast path', () => {
  const src = read('./index.js');
  assert.match(src, /let pic = image \? null : detectPictureIntent\(raw\)/, 'the Presenter never fires when the user attached a photo');
  assert.match(src, /if \(!pic && !image\)/, 'the correction path is gated too');
});

/* ── A: the SIMPLE lane carries the image ──────────────────────────────── */

test('SimpleTask: reads opts.image, validates it, and instructs real grounding', () => {
  const src = read('./src/services/SimpleTask.js');
  assert.match(src, /const image = typeof opts\.image === 'string' && opts\.image\.startsWith\('data:image\/'\) \? opts\.image : null/, 'the image is read and validated (only real data URLs pass)');
  assert.match(src, /ground your answer in what you truly see/i, 'the prompt demands grounding in the ACTUAL image');
  assert.match(src, /NEVER invent content that is not in the picture/i, 'the prompt forbids invention');
  assert.match(src, /image, \/\/ B227 — the real photo/, 'the image is passed to the worker');
});

/* ── B: the worker lanes ───────────────────────────────────────────────── */

test('WorkerRouter: vision turns skip the tools lane and carry the image on the text lane', () => {
  const src = read('./src/services/WorkerRouter.js');
  assert.match(src, /const toolLane = wantsTools && !image/, 'the native-tools loop (which cannot carry images) is skipped for vision turns');
  assert.match(src, /generateContentSafe\(prompt, system, image,/, 'the plain lane passes the REAL image (was hardcoded null)');
  assert.match(src, /if \(image && !VISION_PROVIDERS\.has\(p\.key\)\) continue/, 'text-only providers are skipped for vision turns — no wasted attempts, no text-only guesses');
  assert.match(src, /const VISION_PROVIDERS = new Set\(\['groq', 'gemini', 'openrouter'\]\)/, 'the vision-capable set matches LLMClient reality');
});

/* ── C: the agent loop ─────────────────────────────────────────────────── */

test('AgentLoop: image turns attach the REAL photo; the text-only lie is gone', () => {
  const src = read('./src/services/AgentLoop.js');
  assert.ok(!src.includes('(An image was provided — analyze it.)'), 'the old note that told the model an image existed WITHOUT showing it is removed');
  assert.match(src, /if \(image\) \{[\s\S]{0,400}generateContent\(/, 'image turns make a direct vision call');
  assert.match(src, /An image is attached\. Answer from what you ACTUALLY see/, 'the vision prompt demands real grounding');
});

/* ── the already-correct lanes, locked in ──────────────────────────────── */

test('graph lane: the vision node gets the image with a fallback + honest absence', () => {
  const plan = read('./src/services/Planner.js');
  assert.match(plan, /if \(hasImage\) \{\s*return \{ intent: 'image_recognition'[\s\S]*?payload: opts\.image \}/, 'an attached image deterministically plans image_recognition with the real image as payload');
  const orch = read('./src/services/Orchestrator.js');
  assert.match(orch, /visionImage = \(typeof \(plan && plan\.payload\) === 'string' && plan\.payload\.startsWith\('data:image\/'\)/, 'the node reads plan.payload');
  assert.match(orch, /: \(typeof \(opts && opts\.image\) === 'string' && opts\.image\.startsWith\('data:image\/'\)\) \? opts\.image : null/, 'opts.image is the fallback belt-and-suspenders');
  assert.match(orch, /🔍 Analyzing image \(\$\{Math\.round\(visionImage\.length \/ 1024\)\}KB attached to the model\)/, 'the size of what actually reached the model is LOGGED (the observability the live debugging needed)');
  assert.match(orch, /⚠ No image reached the vision node/, 'no image → one honest warning, never a blind guess');
  assert.match(orch, /I did not receive the image on this turn/, 'the no-image answer is honest, not a hallucinated description');
  assert.match(orch, /visionImage,\s*\{ prefer: 'gemini', temperature: 0\.4 \}/, 'the vision call uses the proven /api/vision lane');
});

test('graph lane (functional): the image reaches the vision node through the real graph', async () => {
  const { Planner } = await import('./src/services/Planner.js');
  const { orchestrator } = await import('./src/services/Orchestrator.js');
  const p = new Planner();
  const fake = 'data:image/jpeg;base64,' + 'A'.repeat(1000);
  const plan = await p.analyzeIntent('What do you see in this image? Describe it.', { image: fake });
  assert.equal(plan.intent, 'image_recognition');
  const logs = [];
  const sendEvent = (t, d) => { if (t === 'log') logs.push(String(d && d.message || '')); };
  const out = await orchestrator.executePlan(plan, 'What do you see in this image? Describe it.', sendEvent, { image: fake });
  assert.ok(logs.some((l) => l.includes('Analyzing image (1KB attached to the model)')), 'the node logged the attached image size');
  // no keys in the test env → the node fails HONESTLY (no blind text answer)
  assert.match(String(out.summary || ''), /problem while working on this|No API keys configured|did not receive the image/, 'no keys → honest failure, never a fabricated description');
});

test('provider layer: text-only providers honestly decline images; vision providers carry them', () => {
  const src = read('./src/services/LLMClient.js');
  assert.match(src, /async function tryOpenAICompat\(\{[^}]*\}, prompt, system, imageBase64, opts, errors\) \{\s*\n\s*if \(imageBase64\) return null;/, 'the OpenAI-compat family (cerebras/deepinfra/mistral/etc.) declines images instead of answering text-only');
  assert.match(src, /if \(imageBase64\) return null; \/\/ text-only — vision stays on hosted providers/, 'vllm declines too');
  assert.match(src, /let models = imageBase64 \? GROQ_VISION_MODELS :/, 'groq switches to its vision models when an image is present');
  assert.match(src, /OPENROUTER_VISION_MODELS :/, 'openrouter switches to its vision models');
  assert.match(src, /if \(imageBase64\) \{[\s\S]{0,120}inlineData:/, 'gemini sends the image as inlineData');
});

/* ── the frontend contract (from B226, still intact) ───────────────────── */

test('frontend: the captured photo is sent with the vision question', () => {
  const engine = read('../src/hooks/useJexiEngine.js');
  assert.match(engine, /const userMsg = \{ role: 'user', text: query, image \}/, 'the message carries the image');
  assert.match(engine, /body: JSON\.stringify\(\{ query, image: image \|\| undefined/, 'the request carries the image');
});

/* ── the live proof record (what "fixed" must mean from now on) ────────── */

test('the live proof: a real photo must be described by its actual content', async () => {
  // This is the harness that proved the bug live (a ducks photo answered with
  // a Wikimedia postcard) and proves the fix: send a REAL distinctive image
  // through the real /api/chat and check the answer names what is IN it.
  // Run it against a deployed brain: JEXI_VISION_PROOF=1 node --test test-b227.js
  if (process.env.JEXI_VISION_PROOF !== '1') return; // opt-in (needs a live brain + keys)
  const base = process.env.JEXI_PROOF_URL || 'https://jexi-brain-image.onrender.com';
  const key = process.env.JEXI_PROOF_KEY || 'com/0006/25';
  const photo = process.env.JEXI_PROOF_IMAGE; // path to a jpg/png
  assert.ok(photo, 'JEXI_PROOF_IMAGE=<path to a real photo> is required');
  const b64 = `data:image/jpeg;base64,${fs.readFileSync(photo).toString('base64')}`;
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-jexi-key': key },
    body: JSON.stringify({ query: 'What do you see in this image? Describe it and tell me anything important.', image: b64 }),
  });
  let answer = '';
  for await (const line of res.body) {
    const ev = JSON.parse(String(line).trim() || '{}');
    if (ev.type === 'done') { answer = String(ev.summary || ''); break; }
  }
  const expect = String(process.env.JEXI_PROOF_EXPECT || '').split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
  assert.ok(answer, 'a done answer arrived');
  const found = expect.filter((w) => answer.toLowerCase().includes(w));
  assert.deepEqual(found, expect, `the answer must name what is actually in the photo. Answer started: ${answer.slice(0, 300)}`);
});
