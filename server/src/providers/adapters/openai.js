/**
 * JEXI OS — Provider bridge — OpenAI adapter.
 */
import { ChatClientBase } from './chatClientBase.js';

export class OpenAIAdapter extends ChatClientBase {
  constructor(cfg, env = process.env) {
    super({ id: 'openai', cfg, env, adapter: 'openai', wire: 'openai' });
    this.capabilities = {
      toolCalling: true,
      codeReasoning: 'strong',
      longContext: 128_000,
      vision: true,
      streaming: true,
      structuredOutput: true,
    };
    this.modelConfig = {
      'gpt-4o-mini': { contextWindow: 128000, maxOutput: 16384, priceInPer1M: 0.15, priceOutPer1M: 0.60 },
      'gpt-4o': { contextWindow: 128000, maxOutput: 16384, priceInPer1M: 2.50, priceOutPer1M: 10.00 },
    };
  }
}