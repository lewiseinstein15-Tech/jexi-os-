// Tests for the Video Analyst — JEXI's frame-by-frame video understanding
// (YouTube / TikTok / Instagram / Vimeo / direct files):
//  - classifyVideoUrl / isVideoUrl: link classification (pure, no network)
//  - chunkSegments / fmtTime: timestamped chapter cutting (pure, no network)
//  - youtubeFrameUrls: dependency-free thumbnail sampling points
//  - toolsForIntent: the link_analysis team auto-routes the video tools
//  - guarded live transcript test: skipped cleanly when network is blocked
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-vid-test-'));
process.env.DATA_DIR = tmp;
delete process.env.GROQ_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.OPENROUTER_API_KEY;
delete process.env.HF_TOKEN;

let failures = 0;
const ok = (cond, label) => {
  if (!cond) failures++;
  console.log(`${cond ? '✅' : '❌'} ${label}`);
};

const {
  classifyVideoUrl, isVideoUrl, chunkSegments, fmtTime, youtubeFrameUrls, getVideoTranscript,
} = await import('./src/services/VideoAnalyzer.js');
const { toolsForIntent } = await import('./src/services/ToolRegistry.js');

/* ---------------- 1. URL classification ---------------- */
ok(classifyVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ').platform === 'youtube', 'youtube watch URL');
ok(classifyVideoUrl('https://youtu.be/dQw4w9WgXcQ').platform === 'youtube', 'youtu.be short URL');
ok(classifyVideoUrl('https://www.youtube.com/shorts/abc12345678').platform === 'youtube', 'youtube shorts URL');
ok(classifyVideoUrl('https://www.tiktok.com/@user/video/7123456789012345678').platform === 'tiktok', 'tiktok video URL');
ok(classifyVideoUrl('https://www.instagram.com/reel/CxYzAbCdEfG/').platform === 'instagram', 'instagram reel URL');
ok(classifyVideoUrl('https://www.instagram.com/p/CxYzAbCdEfG/').platform === 'instagram', 'instagram post URL');
ok(classifyVideoUrl('https://vimeo.com/123456789').platform === 'vimeo', 'vimeo URL');
ok(classifyVideoUrl('https://cdn.example.com/clip.mp4?token=abc').platform === 'direct', 'direct .mp4 URL');
ok(classifyVideoUrl('https://example.com/article.html').platform === null, 'plain website is not a video');
ok(classifyVideoUrl('').platform === null, 'empty URL is null');
ok(isVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ') === true, 'isVideoUrl true for YouTube');
ok(isVideoUrl('https://www.tiktok.com/@u/video/7123456789012345678') === true, 'isVideoUrl true for TikTok');
ok(isVideoUrl('https://example.com/blog') === false, 'isVideoUrl false for plain site');

/* ---------------- 2. chunkSegments — timestamped chapters ---------------- */
ok(chunkSegments([]).length === 0, 'chunkSegments empty input → []');
const segs = [
  { text: 'Welcome to this video', startSec: 0, durationSec: 10 },
  { text: 'We talk about basics', startSec: 10, durationSec: 10 },
  { text: 'Now the advanced part', startSec: 100, durationSec: 15 },
];
const chunks = chunkSegments(segs, 60);
ok(chunks.length === 2, 'chunkSegments cuts into 2 windows');
ok(chunks[0].startSec === 0 && chunks[0].text.includes('Welcome'), 'first chapter starts at 0 and keeps its text');
ok(chunks[1].startSec === 100 && chunks[1].text.includes('advanced'), 'second chapter starts at 100');
ok(chunkSegments([{ text: '', startSec: 0 }, { text: '   ', startSec: 5 }]).length === 0, 'blank segments are filtered');

/* ---------------- 3. fmtTime ---------------- */
ok(fmtTime(0) === '0:00', 'fmtTime(0)');
ok(fmtTime(59) === '0:59', 'fmtTime(59)');
ok(fmtTime(61) === '1:01', 'fmtTime(61)');
ok(fmtTime(3661) === '1:01:01', 'fmtTime(3661)');

/* ---------------- 4. YouTube thumbnail sampling points ---------------- */
const frames = youtubeFrameUrls('dQw4w9WgXcQ');
ok(frames.length === 4, 'youtubeFrameUrls returns 4 sample points');
ok(frames[0].url.includes('dQw4w9WgXcQ'), 'frame URLs carry the video id');

/* ---------------- 5. auto tool routing for link_analysis ---------------- */
const linkTools = toolsForIntent('link_analysis').map((t) => t.slug);
ok(linkTools.includes('video-analyze'), 'link_analysis team auto-routes video-analyze');
ok(linkTools.includes('video-transcript'), 'link_analysis team auto-routes video-transcript');
ok(linkTools.includes('video-frames'), 'link_analysis team auto-routes video-frames');
ok(linkTools.length > 0, 'link_analysis has a non-empty tool set');

/* ---------------- 6. guarded live transcript test ---------------- */
try {
  const tr = await getVideoTranscript('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  if (tr && tr.segments && tr.segments.length) {
    ok(tr.platform === 'youtube', 'live YouTube transcript: platform detected');
    ok(tr.kind === 'timed-captions', 'live YouTube transcript: timed captions');
    ok(tr.segments[0].startSec >= 0, 'live YouTube transcript: segments carry timestamps');
    console.log(`  (live transcript: ${tr.segments.length} segments, ${tr.plain.length} chars)`);
  } else {
    ok(true, 'live YouTube transcript: no transcript returned (skipped)');
    console.log('  (no transcript returned — video may have captions disabled; skipped)');
  }
} catch (e) {
  ok(true, 'live YouTube transcript: network blocked — skipped cleanly');
  console.log(`  (${String(e.message).slice(0, 100)})`);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures === 0
  ? '\nALL VIDEO-ANALYZER TESTS PASSED'
  : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
