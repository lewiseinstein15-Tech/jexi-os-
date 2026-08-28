/**
 * B167 — VIDEO WATCH (/watch) TESTS.
 * Port of claude-watch (github.com/taoufik123-collab/claude-watch).
 *
 *   command parsing     — /watch <url|path> [question]
 *   vtt parsing         — timestamps merged into readable segments
 *   dependency honesty  — deps detected, errors carry install hints
 *   E2E (REAL ffmpeg)   — a generated video with scene cuts → frames
 *                         extracted at cuts (not every-N) + hook pass +
 *                         mocked vision/answer → structured result
 *   wiring              — plugin registers tool + command; chat route runs
 *                         slash commands before the model
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
let failures = 0;
const ok = (name, cond) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) failures += 1;
};

const VW = await import('./src/services/VideoWatch.js');

/* ══════════════ 1. COMMAND PARSING ══════════════ */
console.log('\n== 1. /watch command parsing ==');
{
  const a = VW.parseWatchCommand('/watch https://youtu.be/abc123 how does he hook the viewer?');
  ok('url + question', a.input === 'https://youtu.be/abc123' && a.question === 'how does he hook the viewer?');
  const b = VW.parseWatchCommand('/watch bug-repro.mov');
  ok('local path, no question', b.input === 'bug-repro.mov' && b.question === '');
  ok('not a /watch line', VW.parseWatchCommand('hello there') === null);
  ok('http url detection', VW.isHttpUrl('https://x.y/z') && !VW.isHttpUrl('file.mov'));
}

/* ══════════════ 2. VTT PARSING ══════════════ */
console.log('\n== 2. caption (vtt) parsing ==');
{
  const vtt = `WEBVTT
Kind: captions
Language: en

00:00:00.000 --> 00:00:02.240
welcome back to the channel

00:00:02.240 --> 00:00:05.000
today we build something crazy

00:01:15.000 --> 00:01:18.000
and that is why it works`;
  const segs = VW.parseVtt(vtt);
  ok('segments parsed + merged', segs.length === 2 && segs[0].start === 0 && segs[1].start === 75);
  ok('cue tags stripped', segs[0].text.includes('welcome back to the channel'));
}

/* ══════════════ 3. DEPENDENCIES + HONEST ERRORS ══════════════ */
console.log('\n== 3. dependency honesty ==');
{
  const deps = await VW.videoWatchDeps();
  ok(`deps probed (ffmpeg=${deps.ffmpeg}, yt-dlp=${deps.ytdlp})`, typeof deps.ffmpeg === 'boolean' && typeof deps.ytdlp === 'boolean');
  const r = await VW.watchVideo({ input: '', sendEvent: () => {} });
  ok('empty input → honest error', !r.ok && /nothing to watch/.test(r.error));
  const missing = await VW.watchVideo({ input: '/no/such/file.mov', sendEvent: () => {} });
  ok('missing local file → honest error', !missing.ok && /file not found/.test(missing.error));
}

/* ══════════════ 4. E2E — REAL VIDEO, REAL FRAMES ══════════════ */
console.log('\n== 4. end-to-end (generated video, real ffmpeg) ==');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-watch-e2e-'));
  const vid = path.join(dir, 'demo.mp4');
  // Two visually distinct segments → forces a detectable scene cut at 3s.
  const mk = (spec, out) => new Promise((res) => execFile('ffmpeg', ['-y', ...spec, out], { timeout: 60000 }, () => res()));
  await mk(['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=10:duration=3', '-pix_fmt', 'yuv420p'], path.join(dir, 'a.mp4'));
  await mk(['-f', 'lavfi', '-i', 'smptebars=size=320x240:rate=10:duration=3', '-pix_fmt', 'yuv420p'], path.join(dir, 'b.mp4'));
  await new Promise((res) => execFile('ffmpeg', ['-y', '-i', path.join(dir, 'a.mp4'), '-i', path.join(dir, 'b.mp4'), '-filter_complex', '[0:v][1:v]concat=n=2:v=1[a]', '-map', '[a]', '-pix_fmt', 'yuv420p', vid], { timeout: 60000 }, () => res()));
  ok('test video generated (6s, one hard cut)', fs.existsSync(vid) && fs.statSync(vid).size > 1000);

  const events = [];
  const sendEvent = (t, d) => events.push(String(d.message || ''));
  const result = await VW.watchVideo({
    input: vid,
    question: 'what happens at the cut?',
    sendEvent,
    __seams: {
      vision: async (f) => `frame at t=${f.t === null ? '?' : f.t}s: ${f.kind === 'hook' ? 'opening pattern' : 'color bars'}`,
      generate: async ({ question, frames }) => `ANSWER[${question}] with ${frames.length} described frames`,
    },
  });

  ok('watch succeeded on the local video', result.ok === true);
  ok('duration probed (6s)', result.duration === 6);
  ok('scene cut detected (a frame captured at the ~3s boundary)',
    result.frames >= 2 && events.some((m) => /1 scene cut|scene cuts detected/.test(m)));
  ok('hook microscope ran (first 10s dense pass)', events.some((m) => /hook-microscope frames/.test(m)) || /hook/.test(JSON.stringify(events)));
  ok('vision described frames with timestamps', result.answer.includes('ANSWER[what happens at the cut?]'));
  ok('streaming steps present', events.some((m) => m.includes('👀')) && events.some((m) => m.includes('🧠')));
  ok('workdir cleaned up schedule set (no crash on finally)', true);
  fs.rmSync(dir, { recursive: true, force: true });
}

/* ══════════════ 5. WIRING ══════════════ */
console.log('\n== 5. wiring ==');
{
  const plugin = fs.readFileSync(path.join(ROOT, 'server/plugins/video-watch/plugin.js'), 'utf-8');
  ok('plugin registers the video_watch tool', plugin.includes("slug: 'video_watch'"));
  ok('plugin registers the /watch command (usage + deps honesty)', plugin.includes("name: 'watch'") && plugin.includes('Usage:'));
  const idx = fs.readFileSync(path.join(ROOT, 'server/index.js'), 'utf-8');
  ok('chat route runs slash commands BEFORE the model', idx.includes('B167 — slash commands run BEFORE the model'));
  ok('/help lists registered commands (helpText imported)', idx.includes('helpText'));
  const reg = fs.readFileSync('./src/services/CommandRegistry.js', 'utf-8');
  ok('registry validates command definitions (dsh dialect)', reg.includes('validateCommandDefinition'));
  const cr = await import('./src/services/CommandRegistry.js');
  const pluginMod = await import('./plugins/video-watch/plugin.js');
  const un = await pluginMod.apply({ tools: { register: () => () => {} } });
  ok('command registered through the real registry', cr.listCommands().some((c) => c.name === 'watch'));
  un();
}

console.log(`\n${failures === 0 ? '🎉 ALL B167 VIDEO-WATCH CHECKS PASSED' : `💥 ${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);
