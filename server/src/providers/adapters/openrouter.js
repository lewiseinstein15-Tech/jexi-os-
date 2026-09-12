/**
 * JEXI OS - Provider bridge - OpenRouter adapter.
 */
import { ChatClientBase } from './chatClientBase.js';

export class OpenRouterAdapter extends ChatClientBase {
  constructor(cfg, env = process.env) {
    super({ id: 'openrouter', cfg, env, adapter: 'openai', wire: 'openai' });
    this.capabilities = {
      toolCalling: true,
      codeReasoning: 'medium',
      longContext: 200_000,
      vision: true,
      streaming: true,
      structuredOutput: true,
    };
    this.modelConfig = {
      auto: { contextWindow: 200000, maxOutput: 8192, priceInPer1M: 0, priceOutPer1M: 0 },
    };
  }
}
