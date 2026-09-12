/**
 * JEXI OS - Provider bridge - Google Gemini adapter (OpenAI-compatible endpoint).
 */
import { ChatClientBase } from './chatClientBase.js';

export class GoogleAdapter extends ChatClientBase {
  constructor(cfg, env = process.env) {
    const c = { ...cfg, defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' };
    super({ id: 'google', cfg: c, env, adapter: 'openai', wire: 'openai' });
    if (cfg?.baseUrl) this.baseUrl = cfg.baseUrl.replace(/\/$/, '');
    this.capabilities = {
      toolCalling: true,
      codeReasoning: 'strong',
      longContext: 1_000_000,
      vision: true,
      streaming: true,
      structuredOutput: true,
    };
    this.modelConfig = {
      'gemini-2.5-flash': { contextWindow: 1000000, maxOutput: 65536, priceInPer1M: 0.30, priceOutPer1M: 2.50 },
      'gemini-2.5-pro': { contextWindow: 1000000, maxOutput: 65536, priceInPer1M: 1.25, priceOutPer1M: 10.00 },
    };
  }
}
