/**
 * B167 — VIDEO WATCH (the `claude-watch` /watch skill, ported to JEXI).
 * Repo: github.com/taoufik123-collab/claude-watch (MIT) — pipeline ported:
 *
 *   1. RESOLVE    URL → yt-dlp download (bounded: ≤80 MB, ≤30 min, ≤720p);
 *                 local path → use as-is
 *   2. TRANSCRIPT captions FIRST (free, yt-dlp auto-subs) → fallback
 *                 Groq whisper-large-v3 (FREE on JEXI's existing Groq key —
 *                 verbose_json gives timestamped segments)
 *   3. FRAMES     scene-change extraction (ffmpeg select='gt(scene,0.30)') —
 *                 one frame per detected CUT, not every-N-seconds — plus the
 *                 0–10s HOOK MICROSCOPE at 2 fps (claude-watch's insight:
 *                 the first 10 seconds deserve dense treatment)
 *   4. VISION     every frame → JEXI's vision models (Gemini / Seed) with its
 *                 timestamp → a per-shot description
 *   5. ANSWER     transcript + timed shot descriptions + metadata → the
 *                 user's question answered from what was SEEN and HEARD
 *
 * Degradation is honest at every step: no yt-dlp → metadata+captions path or
 * a clear install hint; no ffmpeg → transcript-only; no captions and no
 * Groq key → frames-only ("muted" watch). Never a crash.
 */

import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { generateContent, resolveKeys } from './LLMClient.js';

const MAX_FILESIZE = '80M';
const MAX_DURATION_SEC = 30 * 60;
const SCENE_THRESHOLD = 0.3;   // claude-watch default sensitivity
const MAX_SCENE_FRAMES = 14;
const HOOK_FPS = 2;
const HOOK_SECONDS = 10;
const MAX_HOOK_FRAMES = 8;
const MAX_FRAMES_TO_DESCRIBE = 18;

/* yt-dlp extras: alternate YouTube player clients avoid the datacenter
 * 'sign in to confirm you're not a bot' wall; cookies optional via env. */
const YTDLP_EXTRA = [
  '--extractor-args', 'youtube:player_client=android,web_embedded,tv',
  ...(process.env.YTDLP_COOKIES ? ['--cookies', process.env.YTDLP_COOKIES] : []),
];

const run = (bin, args, { timeoutMs = 120000, maxBuffer = 8 * 1024 * 1024 } = {}) => new Promise((resolve) => {
  execFile(bin, args, { timeout: timeoutMs, maxBuffer }, (err, stdout, stderr) => {
    resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err ? (err.message || String(err)) : null });
  });
});

const which = (bin) => run('which', [bin], { timeoutMs: 3000 }).then((r) => r.ok);

/** Resolve the yt-dlp binary: PATH first, then the repo-local ./bin install
 *  (Render's native runtime drops the static binary at ./bin/yt-dlp and the
 *  startCommand puts it on PATH — probe both so PATH quirks never disable it). */
export function resolveYtDlp() {
  const candidates = ['yt-dlp', path.join(process.cwd(), 'bin', 'yt-dlp'), path.join(process.cwd(), 'bin', 'yt-dlp_linux')];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch { /* keep looking */ }
  }
  return null;
}

export async function videoWatchDeps() {
  const [ffmpeg, ffprobe] = await Promise.all([which('ffmpeg'), which('ffprobe')]);
  const ytdlp = resolveYtDlp();
  return { ytdlp: !!ytdlp, ffmpeg, ffprobe, ok: !!ytdlp && ffmpeg && ffprobe };
}

function workdirFor(id) {
  const dir = path.join(os.tmpdir(), `jexi-watch-${String(id).replace(/[^a-z0-9-]/gi, '').slice(0, 24) || Date.now()}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/* ─────────────────── 1. RESOLVE: URL or local file ─────────────────── */

const URL_RE = /^https?:\/\/\S+$/i;

export function isHttpUrl(s) { return URL_RE.test(String(s || '').trim()); }

async function ytdlpJson(url) {
  const r = await run(resolveYtDlp() || 'yt-dlp', ['-J', '--no-warnings', '--skip-download', '--no-playlist', ...YTDLP_EXTRA, url], { timeoutMs: 60000 });
  if (!r.ok) return { ok: false, error: (r.stderr || r.error || '').split('\n').filter((l) => l.includes('ERROR'))[0] || 'yt-dlp metadata failed' };
  try { return { ok: true, info: JSON.parse(r.stdout) }; } catch { return { ok: false, error: 'yt-dlp metadata: bad json' }; }
}

async function downloadVideo(url, dir, say) {
  const meta = await ytdlpJson(url);
  if (!meta.ok) return meta;
  const info = meta.info;
  if ((info.duration || 0) > MAX_DURATION_SEC) {
    return { ok: false, error: `video is ${Math.round(info.duration / 60)} min — /watch caps at 30 minutes` };
  }
  say('⬇️', `downloading "${String(info.title || 'video').slice(0, 70)}" (${fmt(info.duration)})…`);
  const out = path.join(dir, 'video.%(ext)s');
  const dl = await run(resolveYtDlp() || 'yt-dlp', [
    ...YTDLP_EXTRA,
    '-f', 'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/b',
    '--max-filesize', MAX_FILESIZE,
    '--no-playlist', '--no-warnings', '-o', out, url,
  ], { timeoutMs: 300000 });
  const file = fs.readdirSync(dir).find((f) => f.startsWith('video.'));
  if (!file) return { ok: false, error: `download failed (${(dl.stderr || '').split('\n').filter((l) => l.includes('ERROR'))[0] || 'no file — too large or blocked'})` };
  return { ok: true, file: path.join(dir, file), title: info.title || file, duration: info.duration || 0, uploader: info.uploader || '', webpage: info.webpage_url || url };
}

function fmt(sec) {
  const s = Math.round(Number(sec) || 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/* ─────────────────── 2. TRANSCRIPT: captions → whisper ─────────────────── */

export function parseVtt(vtt) {
  const lines = vtt.split('\n');
  const segs = [];
  let cur = null;
  const tc = (t) => {
    const m = String(t).trim().replace(',', '.').match(/(?:(\d+):)?(\d+):(\d+(?:\.\d+))?/);
    if (!m) return 0;
    return (Number(m[1] || 0) * 3600) + (Number(m[2]) * 60) + Number(m[3] || 0);
  };
  for (const line of lines) {
    const m = line.match(/^(\S+)\s+-->\s+(\S+)/);
    if (m) { cur = { start: tc(m[1]), end: tc(m[2]), text: '' }; continue; }
    if (cur && line.trim() && !line.startsWith('WEBVTT') && !line.startsWith('Kind:') && !line.startsWith('Language:') && !line.includes('align:')) {
      const clean = line.replace(/<[^>]+>/g, '').trim();
      if (clean && !/^\d+$/.test(clean)) cur.text += (cur.text ? ' ' : '') + clean;
    }
    if (cur && (!line.trim()) && cur.text) { segs.push(cur); cur = null; }
  }
  if (cur && cur.text) segs.push(cur);
  // merge into readable chunks (~1 line per 12s)
  const merged = [];
  for (const s of segs) {
    const last = merged[merged.length - 1];
    if (last && s.start - last.start < 12) last.text += ' ' + s.text;
    else merged.push({ start: s.start, text: s.text });
  }
  return merged.map((s) => ({ start: s.start, text: s.text.replace(/\s+/g, ' ').slice(0, 600) }));
}

async function captionsTranscript(url, dir) {
  const r = await run(resolveYtDlp() || 'yt-dlp', [
    ...YTDLP_EXTRA,
    '--skip-download', '--no-playlist', '--no-warnings',
    '--write-auto-subs', '--write-subs', '--sub-langs', 'en.*,en',
    '--sub-format', 'vtt', '-o', path.join(dir, 'cap'), url,
  ], { timeoutMs: 90000 });
  const vtt = fs.readdirSync(dir).find((f) => f.startsWith('cap') && f.endsWith('.vtt'));
  if (!vtt) return { ok: false };
  const segs = parseVtt(fs.readFileSync(path.join(dir, vtt), 'utf-8'));
  if (!segs.length) return { ok: false };
  return { ok: true, segments: segs, source: 'captions' };
}

/** Groq whisper-large-v3 — FREE, rides JEXI's existing GROQ key (claude-watch's preferred backend). */
async function whisperTranscript(mediaFile, dir, say, __seams = {}) {
  const groqKey = __seams?.groqKey !== undefined ? __seams.groqKey : resolveKeys().groqKey;
  if (!groqKey) return { ok: false, error: 'no Groq key for Whisper (captions unavailable for this video)' };
  const mp3 = path.join(dir, 'audio.mp3');
  const ex = await run('ffmpeg', ['-y', '-i', mediaFile, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', mp3], { timeoutMs: 120000 });
  if (!ex.ok || !fs.existsSync(mp3)) return { ok: false, error: 'audio extraction failed' };
  const stat = fs.statSync(mp3);
  if (stat.size > 24 * 1024 * 1024) return { ok: false, error: 'audio too large for the Whisper tier (>24 MB)' };
  say('🎙️', 'no captions — transcribing the audio with Whisper…');
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(mp3)]), 'audio.mp3');
  form.append('model', 'whisper-large-v3');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');
  try {
    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${groqKey}` }, body: form, signal: AbortSignal.timeout(180000),
    });
    if (!res.ok) return { ok: false, error: `whisper HTTP ${res.status}` };
    const data = await res.json();
    const words = String(data.text || '').split(/\s+/).filter(Boolean).length;
    const segs = (data.segments || []).map((s) => ({ start: Math.round(s.start), text: String(s.text || '').trim() }));
    if (!segs.length && data.text) segs.push({ start: 0, text: String(data.text).slice(0, 3000) });
    return segs.length ? { ok: true, segments: segs, source: 'whisper', words } : { ok: false, error: 'whisper returned nothing' };
  } catch (e) {
    return { ok: false, error: `whisper: ${e.message}` };
  }
}

/* ─────────────────── 3. FRAMES: scene-change + hook microscope ─────────────────── */

async function extractFrames(file, dir, duration, say) {
  const framesDir = path.join(dir, 'frames');
  fs.mkdirSync(framesDir, { recursive: true });
  // Scene-change: one frame per detected cut (claude-watch frames.py core idea)
  const sceneArgs = ['-y', '-i', file, '-vf', `select='gt(scene,${SCENE_THRESHOLD})',showinfo`, '-vsync', 'vfr', '-frames:v', String(MAX_SCENE_FRAMES), path.join(framesDir, 'scene_%02d.jpg')];
  const scene = await run('ffmpeg', sceneArgs, { timeoutMs: 180000 });
  // showinfo pts_time lives on stderr — pair each written file with its timestamp
  const times = [...scene.stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1]));
  const sceneFiles = fs.readdirSync(framesDir).filter((f) => f.startsWith('scene_')).sort();
  const shots = sceneFiles.map((f, i) => ({ file: path.join(framesDir, f), t: times[i] ?? null, kind: 'scene' }));

  // Hook microscope: first 10 s at 2 fps (claude-watch hook.py)
  const hookFiles = [];
  if (duration === 0 || duration > 2) {
    const hook = await run('ffmpeg', ['-y', '-t', String(HOOK_SECONDS), '-i', file, '-vf', `fps=${HOOK_FPS}`, path.join(framesDir, 'hook_%02d.jpg')], { timeoutMs: 120000 });
    if (hook.ok) {
      const hs = fs.readdirSync(framesDir).filter((f) => f.startsWith('hook_')).sort();
      for (const f of hs.slice(0, MAX_HOOK_FRAMES)) {
        const idx = Number(f.match(/hook_(\d+)/)?.[1] || 1) - 1;
        hookFiles.push({ file: path.join(framesDir, f), t: idx / HOOK_FPS, kind: 'hook' });
      }
    }
  }

  const all = [...shots, ...hookFiles];
  say('🎬', `${shots.length} scene cut${shots.length === 1 ? '' : 's'} detected${hookFiles.length ? ` + ${hookFiles.length} hook-microscope frames (first ${HOOK_SECONDS}s)` : ''}.`);
  return all;
}

/* ─────────────────── 4. VISION: describe every frame ─────────────────── */

async function describeFrames(frames, say, seams = {}) {
  const picked = frames.slice(0, MAX_FRAMES_TO_DESCRIBE);
  const descriptions = [];
  let i = 0;
  for (const f of picked) {
    i += 1;
    say('👀', `looking at frame ${i}/${picked.length}${f.t !== null ? ` (${fmt(f.t)})` : ''}…`);
    try {
      const b64 = `data:image/jpeg;base64,${fs.readFileSync(f.file).toString('base64')}`;
      const desc = seams?.vision ? await seams.vision(f, b64) : await generateContent(
        `Describe this video frame in 1-2 short sentences. Timestamp ${f.t !== null ? fmt(f.t) : 'unknown'}${f.kind === 'hook' ? ' (opening seconds — the hook)' : ' (scene cut)'}. Note any on-screen text, people, actions, and visual style.`,
        'You are JEXI\'s video analyst. Be concrete and brief.',
        b64,
      );
      descriptions.push({ t: f.t, kind: f.kind, description: String(desc || '').slice(0, 400) });
    } catch {
      descriptions.push({ t: f.t, kind: f.kind, description: '(frame could not be described)' });
    }
  }
  return descriptions;
}

/* ─────────────────── 5. ANSWER: synthesize ─────────────────── */

async function synthesize({ question, title, duration, uploader, transcript, frames }, say, seams = {}) {
  const transcriptText = transcript.segments
    .map((s) => `[${fmt(s.start)}] ${s.text}`)
    .join('\n')
    .slice(0, 20000) || '(no transcript available)';
  const framesText = frames.map((f) => `[${fmt(f.t)}]${f.kind === 'hook' ? ' (hook)' : ''} ${f.description}`).join('\n') || '(no frames)';
  const q = question ? `The user asked: "${question}"` : 'The user asked for a summary of the video.';
  say('🧠', 'putting together what I saw and heard…');
  const answer = seams?.generate ? await seams.generate({ question, title, duration, uploader, transcript, frames }) : await generateContent(
    `VIDEO: "${title}" (${fmt(duration)})${uploader ? ` by ${uploader}` : ''}

TRANSCRIPT (timestamped):
${transcriptText}

WHAT WAS ON SCREEN (timestamped frame descriptions):
${framesText}

${q}
Answer based ONLY on the transcript and frames above. Cite timestamps like [1:23] for every claim. Structure:
1. **TL;DR** — 2-3 sentences.
2. **Key moments** — bulleted, each with a timestamp.
3. ${question ? 'Direct answer' : 'Overview'} — the main response.
4. **Notable visuals** — what appeared on screen that the transcript alone would miss.`,
    'You are JEXI OS answering after actually watching a video. Honest, concrete, timestamped. Never invent content.',
  );
  return String(answer || '').slice(0, 8000);
}

/* ══════════════════ THE ENTRY POINT ══════════════════ */

export async function watchVideo({ input, question = '', sendEvent = () => {}, signal = null, __seams = null }) {
  const opts = { __seams: __seams || {} };
  const say = (icon, message) => sendEvent('log', { agent: 'Video Analyst', message: `${icon} ${message}` });
  const deps = await videoWatchDeps();

  if (!input || !String(input).trim()) return { ok: false, error: 'nothing to watch — give a video URL or file path' };

  const dir = workdirFor(`${Date.now()}`);
  try {
    let file = null;
    let title = 'local video';
    let duration = 0;
    let uploader = '';

    if (isHttpUrl(input)) {
      if (!deps.ytdlp) {
        return { ok: false, error: 'yt-dlp is not installed on this server (on Render it ships in the Docker image; locally: pip install yt-dlp)' };
      }
      const dl = await downloadVideo(input.trim(), dir, say);
      if (!dl.ok) return dl;
      file = dl.file; title = dl.title; duration = dl.duration; uploader = dl.uploader;
    } else {
      const local = path.resolve(String(input).trim());
      if (!fs.existsSync(local)) return { ok: false, error: `file not found: ${input}` };
      file = local; title = path.basename(local);
      if (deps.ffprobe) {
        const p = await run('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', local], { timeoutMs: 15000 });
        try { duration = Math.round(Number(JSON.parse(p.stdout).format?.duration) || 0); } catch { /* unknown */ }
      }
      say('📹', `opening local file ${title}${duration ? ` (${fmt(duration)})` : ''}…`);
    }

    // TRANSCRIPT
    let transcript = { segments: [], source: null };
    if (isHttpUrl(input)) {
      say('🗣️', 'checking for captions…');
      const caps = await captionsTranscript(input.trim(), dir);
      if (caps.ok) transcript = caps;
    }
    if (!transcript.segments.length && deps.ffmpeg) {
      const wh = await whisperTranscript(file, dir, say, opts.__seams || {});
      if (wh.ok) transcript = wh;
      else if (!transcript.segments.length) say('🔇', `no transcript available (${wh.error || 'no captions'}) — continuing with frames only.`);
    } else if (!transcript.segments.length && !deps.ffmpeg) {
      say('🔇', 'no captions and no ffmpeg — frames/transcript unavailable for this source.');
    }
    if (transcript.segments.length) {
      const words = transcript.segments.reduce((n, s) => n + s.text.split(/\s+/).length, 0);
      say('🗣️', `transcript ready (${transcript.source}, ${words} words, ${transcript.segments.length} timed segments).`);
    }

    // FRAMES
    let frames = [];
    if (deps.ffmpeg) {
      frames = await extractFrames(file, dir, duration, say);
    } else {
      say('🎬', 'ffmpeg not installed — skipping frame extraction (transcript only).');
    }

    if (!frames.length && !transcript.segments.length) {
      return { ok: false, error: 'could not extract ANY frames or transcript from this video' };
    }

    // VISION
    const descriptions = frames.length ? await describeFrames(frames, say, opts.__seams) : [];
    if (!descriptions.length && transcript.segments.length) {
      say('👀', 'no frames to look at — answering from the transcript alone.');
    }

    // ANSWER
    const answer = await synthesize({ question, title, duration, uploader, transcript, frames: descriptions }, say, opts.__seams);
    return {
      ok: true,
      title, duration, uploader,
      transcriptSource: transcript.source,
      segments: transcript.segments.length,
      frames: descriptions.length,
      answer,
    };
  } finally {
    setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } }, 15000).unref?.();
  }
}

/** Parse "/watch <url-or-path> [question]" (claude-watch command shape). */
export function parseWatchCommand(text) {
  const m = String(text || '').trim().match(/^\/watch\s+(\S+)(?:\s+([\s\S]+))?$/i);
  if (!m) return null;
  return { input: m[1], question: (m[2] || '').trim() };
}
