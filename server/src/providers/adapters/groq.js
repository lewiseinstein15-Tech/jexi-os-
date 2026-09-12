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
    };
    this.modelConfig = {
      'llama-3.3-70b-versatile': { contextWindow: 128000, maxOutput: 8192, priceInPer1M: 0.59, priceOutPer1M: 0.79 },
      'openai-gpt-oss-120b': { contextWindow: 131072, maxOutput: 32768, priceInPer1M: 0.60, priceOutPer1M: 0.80 },
    };
  }
}
