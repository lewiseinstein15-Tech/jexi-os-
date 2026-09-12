/**
 * JEXI OS - Provider bridge - Mistral adapter.
 */
import { ChatClientBase } from './chatClientBase.js';

export class MistralAdapter extends ChatClientBase {
  constructor(cfg, env = process.env) {
    super({ id: 'mistral', cfg, env, adapter: 'openai', wire: 'openai' });
    this.capabilities = {
      toolCalling: true,
      codeReasoning: 'strong',
      longContext: 128_000,
      vision: true,
      streaming: true,
      structuredOutput: true,
    };
    this.modelConfig = {
      'mistral-large': { contextWindow: 128000, maxOutput: 8192, priceInPer1M: 2.00, priceOutPer1M: 6.00 },
      'mistral-small': { contextWindow: 128000, maxOutput: 8192, priceInPer1M: 0.20, priceOutPer1M: 0.60 },
    };
  }
}
