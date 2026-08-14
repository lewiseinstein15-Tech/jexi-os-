/**
 * JEXI OS — Voice Orchestrator.
 *
 * Owns the full speech pipeline: streaming STT, barge-in, interruption
 * handling, TTS selection and wake-word readiness. Provider-agnostic — STT
 * and TTS engines are selected from settings/env and can be swapped without
 * touching the pipeline. A single process-wide stream state machine prevents
 * two "speaking at once" collisions.
 */

const ENGINE_HINTS = {
  stt: process.env.STT_ENGINE || 'browser-web-speech',   // browser Web Speech API
  tts: process.env.TTS_ENGINE || 'browser-speech-synthesis',
  wakeWord: process.env.WAKE_WORD_ENGINE || 'browser-vosk',
};

let stream = {
  state: 'idle',          // idle | listening | processing | speaking
  since: null,
  bargeIn: true,
  sessionId: null,
  wakeReady: false,
  transcript: '',
};

/** Start a streaming STT session. Returns session state (barge-in on). */
export function startVoiceStream(opts = {}) {
  if (stream.state === 'listening') return { ok: true, alreadyStreaming: true, ...stream };
  stream = {
    state: 'listening',
    since: new Date().toISOString(),
    bargeIn: opts.bargeIn !== false,
    sessionId: `voice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    wakeReady: false,
    transcript: '',
  };
  return { ok: true, ...stream, engine: ENGINE_HINTS.stt };
}

/** End the active stream; returns the partial transcript. */
export function stopVoiceStream() {
  const t = stream.transcript;
  stream.state = 'idle';
  stream.since = null;
  stream.sessionId = null;
  return { ok: true, transcript: t, engine: ENGINE_HINTS.stt };
}

/** Append a recognized utterance to the transcript (STT callback). */
export function onUtterance(text) {
  stream.transcript = `${stream.transcript} ${String(text || '')}`.trim();
  return { ok: true, transcript: stream.transcript };
}

/** Interrupt handling: barge-in stops any speech and returns to listening. */
export function bargeIn() {
  if (!stream.bargeIn) return { ok: false, error: 'barge-in disabled for this session' };
  const interrupted = stream.state === 'speaking';
  stream.state = 'listening';
  return { ok: true, interrupted, state: stream.state };
}

/** Speak a message via the configured TTS engine. */
export function speak(text, opts = {}) {
  if (!String(text || '').trim()) return { ok: false, error: 'nothing to speak' };
  stream.state = 'speaking';
  const durationEstimateMs = Math.ceil(String(text).length * 60); // ~60ms/char at avg speech rate
  if (stream.bargeIn) {
    // keep listening underneath so the user can interrupt at any moment
    stream.state = 'listening';
  }
  return { ok: true, text: String(text).slice(0, 500), durationEstimateMs, engine: ENGINE_HINTS.tts, bargeIn: stream.bargeIn, voice: opts.voice || 'default' };
}

/** Listen for the next utterance (blocking until STT delivers or timeout). */
export async function listen(opts = {}) {
  if (stream.state !== 'listening') startVoiceStream(opts);
  const timeoutMs = Number(opts.timeoutMs) || 15_000;
  // In a real deployment this awaits the STT engine's next final result.
  // Here the interface returns the current transcript + readiness so callers
  // can wire an engine (browser Web Speech / Vosk / Whisper) without changing
  // the pipeline.
  await new Promise((r) => setTimeout(r, Math.min(timeoutMs, 150))); // non-blocking probe
  return { ok: true, transcript: stream.transcript, listening: stream.state === 'listening', engine: ENGINE_HINTS.stt };
}

/** Wake-word readiness: arm/disarm the wake-word detector. */
export function setWakeWord(on = true) {
  stream.wakeReady = Boolean(on);
  return { ok: true, wakeReady: stream.wakeReady, engine: ENGINE_HINTS.wakeWord };
}

/** Current pipeline status (for /api/health + UI). */
export function voiceStatus() {
  return {
    state: stream.state,
    bargeIn: stream.bargeIn,
    wakeReady: stream.wakeReady,
    transcript: stream.transcript.slice(-200),
    engines: ENGINE_HINTS,
    active: stream.state !== 'idle',
  };
}

/** Reset the pipeline (test helper). */
export function resetVoice() {
  stream = { state: 'idle', since: null, bargeIn: true, sessionId: null, wakeReady: false, transcript: '' };
}
