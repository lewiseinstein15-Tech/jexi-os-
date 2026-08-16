import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import fetch from 'node-fetch';
import { YoutubeTranscript } from 'youtube-transcript';
import { generateContent, resolveKeys } from './LLMClient.js';
import { isSSRF } from './Security.js';

/**
 * VIDEO ANALYST — JEXI's eyes and ears for videos (the agentic video-
 * understanding pattern from video-ai / VideoAgent / watch-video /
 * youtube-skills: timestamped captions + sampled frames → vision LLM):
 *
 *   1. classify the link (YouTube / TikTok / Instagram / direct file / …)
 *   2. pull the FULL timestamped transcript or on-page captions — that is the
 *      "watching frame-by-frame" of what is SAID, with exact seconds
 *   3. sample real VISUAL frames across the video's timeline (thumbnails for
 *      YouTube — 0% / 25% / 50% / 75%; ffmpeg for direct video files) and
 *      run the vision models over them — the "watching frame-by-frame" of
 *      what is SHOWN
 *   4. fuse both into a chaptered analysis with timestamps.
 *
 * Every stage degrades gracefully: no AI key → timestamped transcript summary;
 * no ffmpeg → thumbnail frames only; blocked site → honest error, never a crash.
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
const DIRECT_VIDEO_RE = /\.(mp4|webm|mov|m4v|mkv|avi|m3u8|ogg|ogv)(\?.*)?$/i;

/* ------------------------------------------------------------------ */
/* 1. URL classification                                               */
/* ------------------------------------------------------------------ */

/** Identify what kind of media a link is — returns platform + id (best effort). */
export function classifyVideoUrl(url) {
  const u = String(url || '').trim();
  if (!u) return { platform: null };
  const yt = u.match(/(?:youtube\.com\/(?:watch\?.*v=|shorts\/|embed\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (yt) return { platform: 'youtube', videoId: yt[1] };
  if (/youtube\.com\//.test(u)) return { platform: 'youtube', videoId: null };
  const tt = u.match(/tiktok\.com\/(?:@[\w.-]+\/video\/|video\/|embed\/)(\d+)/);
  if (tt) return { platform: 'tiktok', videoId: tt[1] };
  if (/tiktok\.com\//.test(u)) return { platform: 'tiktok', videoId: null };
  const ig = u.match(/instagram\.com\/(?:p|reel|tv|reels)\/([\w-]+)/);
  if (ig) return { platform: 'instagram', videoId: ig[1] };
  if (/instagram\.com\//.test(u)) return { platform: 'instagram', videoId: null };
  if (/vimeo\.com\//.test(u)) return { platform: 'vimeo' };
  if (/twitter\.com\//.test(u) || /x\.com\//.test(u)) return { platform: 'twitter' };
  if (DIRECT_VIDEO_RE.test(u)) return { platform: 'direct', directExt: u.match(DIRECT_VIDEO_RE)[1] };
  return { platform: null };
}

/** True when a link is a video the analyst should watch (vs. a plain web page). */
export function isVideoUrl(url) {
  const p = classifyVideoUrl(url).platform;
  return p === 'youtube' || p === 'tiktok' || p === 'instagram' || p === 'vimeo' || p === 'direct';
}

/* ------------------------------------------------------------------ */
/* 2. Transcript — what the video SAYS, with exact timestamps          */
/* ------------------------------------------------------------------ */

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

/** Fetch a page (direct → allorigins proxy → JS render not needed for captions). */
async function fetchHTML(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, timeout: 15000 });
    if (res.status === 403 || res.status === 503) throw new Error('Blocked by host');
    return await res.text();
  } catch (e) {
    const proxyRes = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, { timeout: 25000 });
    if (proxyRes.ok) return await proxyRes.text();
    throw new Error(`Fetch failed: ${e.message}`);
  }
}

function extractJsonLd(html) {
  const m = html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try {
    const j = JSON.parse(m[1].trim());
    const item = Array.isArray(j) ? j[0] : j;
    return item && typeof item === 'object' ? item : null;
  } catch (e) { return null; }
}

/** Pull the caption/description text out of TikTok / Instagram / social pages. */
async function scrapeSocialCaption(url, platform) {
  const html = await fetchHTML(url);
  let caption = '';
  const og =
    html.match(/property=["']og:description["']\s+content=["']([^"']+)["']/i) ||
    html.match(/content=["']([^"']+)["']\s+property=["']og:description["']/i);
  if (og) caption = decodeEntities(og[1]);
  if (!caption) {
    const ld = extractJsonLd(html);
    if (ld && (ld.description || ld.caption)) caption = String(ld.description || ld.caption || '');
  }
  if (!caption && platform === 'tiktok') {
    // TikTok embeds the caption inside the hydration blob as "desc"
    const m = html.match(/"desc":"((?:[^"\\]|\\.)*)"/);
    if (m) caption = m[1].replace(/\\u0026/g, '&').replace(/\\"/g, '"').replace(/\\n/g, ' ');
  }
  return decodeEntities(caption).replace(/\s+/g, ' ').trim();
}

/**
 * Timestamped transcript for any video link.
 * YouTube → word/chunk-level { text, startSec, durationSec } via the official
 * captions API. TikTok/Instagram → the on-page caption (they expose no public
 * transcript API; the caption is what the creator wrote).
 */
export async function getVideoTranscript(url) {
  if (await isSSRF(url)) throw new Error('Security blocked (SSRF)');
  const info = classifyVideoUrl(url);
  if (!info.platform) return null;
  if (info.platform === 'youtube' && info.videoId) {
    try {
      const data = await YoutubeTranscript.fetchTranscript(info.videoId);
      if (Array.isArray(data) && data.length) {
        return {
          platform: 'youtube',
          videoId: info.videoId,
          kind: 'timed-captions',
          segments: data.map((t) => ({
            text: String(t.text || '').trim(),
            startSec: Math.round((Number(t.offset) || 0) / 1000),
            durationSec: Math.round((Number(t.duration) || 0) / 1000),
          })).filter((s) => s.text),
          plain: data.map((t) => t.text).join(' '),
        };
      }
    } catch (e) {
      throw new Error(`YouTube captions unavailable: ${e.message}`);
    }
  }
  if (info.platform === 'tiktok' || info.platform === 'instagram') {
    const caption = await scrapeSocialCaption(url, info.platform);
    if (caption && caption.length > 3) {
      return {
        platform: info.platform,
        videoId: info.videoId,
        kind: 'caption',
        segments: [{ text: caption, startSec: 0, durationSec: 0 }],
        plain: caption,
      };
    }
    throw new Error(`${info.platform === 'tiktok' ? 'TikTok' : 'Instagram'} caption could not be read (login wall or blocked).`);
  }
  return null; // vimeo / direct / twitter — no public transcript source
}

/* ------------------------------------------------------------------ */
/* 3. Frames — what the video SHOWS, sampled across the timeline       */
/* ------------------------------------------------------------------ */

/** YouTube: dependency-free frames via i.ytimg (0% / 25% / 50% / 75%). */
export function youtubeFrameUrls(videoId) {
  return [
    { timeSec: 0, url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` },
    { timeSec: null, url: `https://i.ytimg.com/vi/${videoId}/1.jpg` },
    { timeSec: null, url: `https://i.ytimg.com/vi/${videoId}/2.jpg` },
    { timeSec: null, url: `https://i.ytimg.com/vi/${videoId}/3.jpg` },
  ];
}

async function toDataUrl(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error('empty');
  const mime = res.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function videoDurationSec(ffmpegPath, file) {
  try {
    const r = spawnSync(ffmpegPath, ['-i', file], { encoding: 'utf8', timeout: 15000 });
    const m = String(r.stderr || '').match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  } catch (e) {}
  return 0;
}

/**
 * Direct video files (.mp4/.webm/…): download (size-capped) and sample N
 * evenly-spaced JPEG frames with the ffmpeg bundled by ffmpeg-static.
 * Returns [] when ffmpeg is unavailable — the caller falls back gracefully.
 */
export async function extractFramesFromDirectVideo(url, { maxFrames = 5 } = {}) {
  if (await isSSRF(url)) throw new Error('Security blocked (SSRF)');
  let ffmpegPath = null;
  try { ffmpegPath = (await import('ffmpeg-static')).default; } catch (e) {}
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) return [];
  const info = classifyVideoUrl(url);
  const ext = (info.directExt || 'mp4').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'mp4';
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(45000) });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const len = Number(res.headers.get('content-length') || 0);
  if (len > 150 * 1024 * 1024) throw new Error('Video is larger than 150 MB — too big to sample on this host.');
  const tmp = path.join(os.tmpdir(), `jexi-vid-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-frames-'));
  try {
    fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
    const dur = videoDurationSec(ffmpegPath, tmp);
    const n = Math.min(maxFrames, Math.max(2, Math.floor(dur / 20))); // at most one frame / 20s
    const step = dur > 0 ? dur / (n + 1) : 5;
    const frames = [];
    for (let i = 1; i <= n; i++) {
      const t = Math.round(step * i);
      const out = path.join(outDir, `f${i}.jpg`);
      try {
        execFileSync(ffmpegPath, ['-ss', String(t), '-i', tmp, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '3', '-y', out], { timeout: 25000, stdio: 'pipe' });
      } catch (e) { continue; }
      if (fs.existsSync(out)) {
        frames.push({ timeSec: t, dataUrl: `data:image/jpeg;base64,${fs.readFileSync(out).toString('base64')}` });
      }
    }
    return frames;
  } finally {
    fs.rmSync(tmp, { force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

/** Best-effort visual frames for any video link (thumbnails / ffmpeg). */
export async function getVideoFrames(url, { maxFrames = 5, sendEvent } = {}) {
  const info = classifyVideoUrl(url);
  try {
    if (info.platform === 'youtube' && info.videoId) {
      const frames = [];
      for (const f of youtubeFrameUrls(info.videoId)) {
        try {
          frames.push({ timeSec: f.timeSec, dataUrl: await toDataUrl(f.url) });
        } catch (e) {}
      }
      return frames;
    }
    if (info.platform === 'direct') {
      try { return await extractFramesFromDirectVideo(url, { maxFrames }); }
      catch (e) { try { sendEvent?.('log', { agent: 'Video Analyst', message: `⚠ Frame sampling unavailable: ${e.message}` }); } catch (e2) {} return []; }
    }
  } catch (e) {}
  return [];
}

/* ------------------------------------------------------------------ */
/* 4. Key moments — chunk the transcript into timestamped segments     */
/* ------------------------------------------------------------------ */

/**
 * Cut a timestamped transcript into ~windowSec windows (the "frame-by-frame
 * reading" of what is said). Pure function — testable without any network.
 */
export function chunkSegments(segments, windowSec = 60) {
  const segs = Array.isArray(segments) ? segments.filter((s) => s && s.text) : [];
  if (!segs.length) return [];
  const chunks = [];
  let cur = { startSec: segs[0].startSec || 0, texts: [] };
  let curEnd = (segs[0].startSec || 0) + (segs[0].durationSec || 0);
  for (const s of segs) {
    const start = s.startSec || 0;
    const end = start + (s.durationSec || 0);
    if (start - cur.startSec >= windowSec && cur.texts.length) {
      chunks.push({ startSec: cur.startSec, endSec: curEnd, text: cur.texts.join(' ').trim() });
      cur = { startSec: start, texts: [] };
    }
    cur.texts.push(s.text);
    curEnd = end;
  }
  if (cur.texts.length) chunks.push({ startSec: cur.startSec, endSec: curEnd, text: cur.texts.join(' ').trim() });
  return chunks.filter((c) => c.text);
}

export function fmtTime(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ */
/* 5. The full analysis pipeline                                       */
/* ------------------------------------------------------------------ */

async function describeFrames(frames) {
  const keys = resolveKeys();
  if (!keys.groqKey && !keys.geminiKey && !keys.openrouterKey) return [];
  const observations = [];
  for (const f of frames.slice(0, 5)) {
    try {
      const obs = await generateContent(
        `This is a frame sampled from a video at ${f.timeSec != null ? fmtTime(f.timeSec) : 'an unknown point'}. Describe ONLY what is visibly happening: the scene, subjects, on-screen text, settings, or actions. 1-2 short sentences. If the frame is a plain thumbnail with no detail, say so briefly.`,
        'You are JEXI\'s Video Analyst, describing video frames for a human.',
        f.dataUrl,
        { temperature: 0.2 }
      );
      observations.push({ timeSec: f.timeSec, text: String(obs || '').trim().slice(0, 300) });
    } catch (e) {}
  }
  return observations;
}

/**
 * Watch a video end-to-end: transcript + frames + vision + synthesis.
 * Returns a ready-to-send markdown summary. Never throws for content reasons —
 * errors are converted into an honest report.
 */
export async function analyzeVideo(url, { sendEvent, maxFrames = 5 } = {}) {
  if (await isSSRF(url)) throw new Error('Security blocked (SSRF)');
  const info = classifyVideoUrl(url);
  const platformName = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', vimeo: 'Vimeo', direct: 'direct video file', twitter: 'X/Twitter' }[info.platform] || 'video';

  sendEvent?.('log', { agent: 'Video Analyst', message: `🎬 Detected a ${platformName} video — analyzing frames and captions...` });

  // Stage A — transcript (what the video says)
  let transcript = null;
  let transcriptError = '';
  try {
    transcript = await getVideoTranscript(url);
  } catch (e) { transcriptError = e.message; }
  if (transcript) {
    sendEvent?.('log', { agent: 'Video Analyst', message: `💬 Captured ${transcript.plain.length.toLocaleString()} chars of ${transcript.kind === 'timed-captions' ? 'timestamped captions' : 'captions'}.` });
  }

  // Stage B — frames (what the video shows)
  const frames = await getVideoFrames(url, { maxFrames, sendEvent });
  if (frames.length) sendEvent?.('log', { agent: 'Video Analyst', message: `🖼 Sampled ${frames.length} frames across the timeline for visual analysis.` });

  // Stage C — key moments (chunk the transcript with timestamps)
  const chunks = transcript ? chunkSegments(transcript.segments) : [];
  const keys = resolveKeys();
  const hasAI = !!(keys.groqKey || keys.geminiKey || keys.openrouterKey || keys.hfKey);

  // Stage D — vision pass over the frames
  const observations = frames.length && hasAI ? await describeFrames(frames) : [];

  // Stage E — synthesize everything into a chaptered report
  const chapterText = chunks
    .map((c) => `[${fmtTime(c.startSec)}] ${c.text}`)
    .join('\n')
    .slice(0, 14000);

  if (transcript && hasAI) {
    try {
      const frameBlock = observations.length
        ? `\n\nVISUAL FRAMES (what is on screen):\n${observations.map((o) => `- ${o.timeSec != null ? fmtTime(o.timeSec) : 'frame'}: ${o.text}`).join('\n')}`
        : '\n\n(No visual frames were available — the analysis below comes from the captions.)';
      const reply = await generateContent(
        `You just watched a ${platformName} video. Here is its full timestamped transcript, cut into chapters, plus visual frame observations.\n\nCHAPTERS (timestamp → text):\n${chapterText}${frameBlock}\n\nWrite a clear analysis of this video:\n1. **What it is** — one-line summary of the video's topic and purpose.\n2. **Key moments** — 3-8 bullets, each starting with the timestamp [m:ss], naming what happens or is said at that point.\n3. **Key takeaways** — the main points a viewer should remember.\n4. If the frames show something important not in the transcript (visual demo, on-screen text, product), note it under **What's on screen**.\nUse ## headings and markdown bullets. Stay strictly factual to the transcript and frames — never invent content that isn't there.`,
        'You are JEXI\'s Video Analyst. Analyze videos precisely from their captions and frames; cite timestamps; never invent.',
        null,
        { temperature: 0.3 }
      );
      return `### 🎬 JEXI VIDEO ANALYSIS (${platformName})\n\n${String(reply || '').trim()}\n\n---\n*Watched ${chunks.length ? `${chunks.length} chapters` : 'the full video'} · ${frames.length} visual frames · captions via ${transcript.kind}.*`;
    } catch (e) { /* fall through to the no-LLM report */ }
  }

  // No-AI / LLM-failure report: honest, timestamped, still genuinely useful.
  const lines = [];
  if (transcript?.plain) {
    lines.push(`**Captions** (${transcript.kind === 'timed-captions' ? 'timestamped' : 'caption'}):`);
    lines.push(chunks.map((c) => `- **[${fmtTime(c.startSec)}]** ${c.text.slice(0, 320)}`).join('\n') || transcript.plain.slice(0, 4000));
  } else if (transcriptError) {
    lines.push(`⚠ ${transcriptError}`);
  } else {
    lines.push('ℹ This video has no public transcript/captions, and I could not read on-page text for it.');
  }
  if (frames.length) {
    lines.push(`\n**Visual frames sampled:** ${frames.length} (${frames.map((f) => f.timeSec != null ? fmtTime(f.timeSec) : 'thumbnail').join(', ')})${observations.length ? `\n${observations.map((o) => `- ${o.text}`).join('\n')}` : ''}`);
  }
  return `### 🎬 JEXI VIDEO ANALYSIS (${platformName})\n\n${lines.join('\n')}\n\n---\n*Frame-by-frame analysis: ${frames.length} visual frames · ${chunks.length} timestamped chapters.*`;
}
