/**
 * JEXI OS - Provider bridge - Groq adapter.
 */
import { ChatClientBase } from './chatClientBase.js';

export class GroqAdapter extends ChatClientBase {
  constructor(cfg, env = process.env) {
    super({ id: 'groq', cfg, env, adapter: 'openai', wire: 'openai' });
    this.capabilities = {
      toolCalling: true,
      codeReasoning: 'strong',
      longContext: 131_000,
      vision: true,
      streaming: true,
      structuredOutput: true,
      audio: { transcription: { model: 'whisper-large-v3' } },
    };
    this.modelConfig = {
      'llama-3.3-70b-versatile': { contextWindow: 128000, maxOutput: 8192, priceInPer1M: 0.59, priceOutPer1M: 0.79 },
      'openai-gpt-oss-120b': { contextWindow: 131072, maxOutput: 32768, priceInPer1M: 0.60, priceOutPer1M: 0.80 },
    };
  }

  /**
   * Audio transcription capability (provider layer). Business logic calls
   * resolveAudioTranscriber() and never names this provider.
   * @param {{fileBuffer: Buffer, filename?: string, signal?: AbortSignal}} task
   * @returns {Promise<{providerId: string, segments: object[], source: string, words: number}>}
   */
  async transcribeAudio(task) {
    const key = this.cfg.keyEnv ? this.env[this.cfg.keyEnv] : null;
    if (!key) {
      const err = new Error('no audio transcription key configured');
      err.code = 'CREDENTIAL_MISSING';
      throw err;
    }
    const { model } = this.capabilities.audio.transcription;
    const fileName = task?.filename || 'audio.mp3';
    const form = new FormData();
    form.append('file', new Blob([task.fileBuffer]), fileName);
    form.append('model', model);
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'segment');
    const res = await fetch(`${this.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: task?.signal || AbortSignal.timeout(180000),
    });
    if (!res.ok) {
      const err = new Error(`whisper HTTP ${res.status}`);
      err.code = 'PROVIDER_ERROR';
      throw err;
    }
    const data = await res.json().catch(() => { throw new Error('whisper returned bad json'); });
    const words = String(data.text || '').split(/\s+/).filter(Boolean).length;
    const segments = (data.segments || []).map((s) => ({ start: Math.round(s.start), text: String(s.text || '').trim() }));
    if (!segments.length && data.text) segments.push({ start: 0, text: String(data.text).slice(0, 3000) });
    if (!segments.length) {
      const err = new Error('whisper returned nothing');
      err.code = 'PROVIDER_ERROR';
      throw err;
    }
    return { providerId: this.id, segments, source: 'whisper', words };
  }
}
