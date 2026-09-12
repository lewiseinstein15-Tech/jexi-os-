/**
 * JEXI OS - Provider bridge - Anthropic adapter.
 */
import { ChatClientBase } from './chatClientBase.js';

export class AnthropicAdapter extends ChatClientBase {
  constructor(cfg, env = process.env) {
    super({ id: 'anthropic', cfg, env, adapter: 'anthropic', wire: 'anthropic' });
    this.capabilities = {
      toolCalling: true,
      codeReasoning: 'strong',
      longContext: 200_000,
      vision: true,
      streaming: true,
      structuredOutput: true,
    };
    this.modelConfig = {
      'claude-3-5-haiku': { contextWindow: 200000, maxOutput: 8192, priceInPer1M: 0.80, priceOutPer1M: 4.00 },
      'claude-3-7-sonnet': { contextWindow: 200000, maxOutput: 32000, priceInPer1M: 3.00, priceOutPer1M: 15.00 },
    };
  }
}
