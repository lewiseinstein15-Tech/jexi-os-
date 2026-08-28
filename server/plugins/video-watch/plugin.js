/**
 * JEXI OS — Video Watch Plugin (B167).
 * Port of the `claude-watch` /watch skill (github.com/taoufik123-collab/
 * claude-watch, MIT): JEXI can WATCH any video — URL or local file.
 *
 * Registers:
 *   /watch <url-or-path> [question]   — the chat command (claude-watch shape)
 *   video_watch tool                  — model-facing, for video questions
 */

import { watchVideo, parseWatchCommand, videoWatchDeps } from '../../src/services/VideoWatch.js';
import { registerCommand, listCommands } from '../../src/services/CommandRegistry.js';

export const name = 'video-watch';
export const version = '1.0.0';
export const inject = ['tools'];

async function runWatch(a, b = {}) {
  // The registry calls run(text, ctx); the DSH dialect calls
  // run({ name, rawInput, ctx, signal }). Accept both.
  const invocation = typeof a === 'string' ? { rawInput: a, ctx: b, signal: b?.signal || null } : (a || {});
  const parsed = parseWatchCommand(invocation.rawInput || '');
  if (!parsed) {
    const deps = await videoWatchDeps();
    return {
      ok: false,
      summary: `### 📺 /watch\n\nUsage: \`/watch <video-url-or-file> [question]\`\n\nExample: \`/watch https://youtu.be/xyz how does the creator hook the viewer?\`\n\nServer tools: yt-dlp ${deps.ytdlp ? '✓' : '✗'} · ffmpeg ${deps.ffmpeg ? '✓' : '✗'}${!deps.ytdlp || !deps.ffmpeg ? '\n\n(missing tools mean URL downloads or frame extraction are disabled on this host)' : ''}`,
    };
  }
  const sendEvent = invocation.ctx?.sendEvent || (() => {});
  const result = await watchVideo({
    input: parsed.input,
    question: parsed.question,
    sendEvent,
    signal: invocation.signal || null,
  });
  if (!result.ok) {
    return { ok: false, summary: `### 📺 /watch — could not watch that\n\n${result.error}` };
  }
  return {
    ok: true,
    summary: `### 📺 ${result.title}\n\n${result.answer}\n\n---\n⚙️ watched ${result.frames} frame${result.frames === 1 ? '' : 's'} · transcript: ${result.transcriptSource || 'none'} (${result.segments} segments)`,
    frames: result.frames,
    transcriptSource: result.transcriptSource,
  };
}

export async function apply(ctx) {
  const unregisters = [];

  // Model-facing tool
  unregisters.push(ctx.tools.register({
    slug: 'video_watch',
    name: 'Watch Video',
    desc: 'Watch a video (YouTube/TikTok/… URL or local file path) and answer questions about its ACTUAL content: downloads it, extracts scene-change frames + a transcript (captions or Whisper), looks at every frame, then answers with timestamps. Optional question.',
    args: {
      input: { type: 'string', required: true, desc: 'video URL or local file path' },
      question: { type: 'string', required: false, desc: 'what to answer about the video (default: summarize)' },
    },
    handler: async (a, o = {}) => watchVideo({
      input: a.input,
      question: a.question || '',
      sendEvent: o.sendEvent || (() => {}),
      signal: o.signal || null,
    }),
  }));

  // The /watch chat command (dsh command-registry dialect). The registry is
  // process-global: if a previous load already registered /watch, leave the
  // live one in place — a plugin reload must never fail the boot.
  if (!listCommands().some((c) => c.name === 'watch')) {
    unregisters.push(registerCommand({
      name: 'watch',
      description: 'watch a video (URL or local file) and answer questions about what happens in it — /watch <url-or-path> [question]',
      run: runWatch,
    }));
  }

  return () => unregisters.forEach((u) => { try { u(); } catch { /* noop */ } });
}
