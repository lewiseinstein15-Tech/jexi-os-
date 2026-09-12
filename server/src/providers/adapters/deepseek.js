/**
 * JEXI OS - Provider bridge - DeepSeek adapter.
 */
import { ChatClientBase } from './chatClientBase.js';

export class DeepSeekAdapter extends ChatClientBase {
  constructor(cfg, env = process.env) {
    super({ id: 'deepseek', cfg, env, adapter: 'openai', wire: 'openai' });
    this.capabilities = {
      toolCalling: true,
      codeReasoning: 'strong',
      longContext: 128_000,
      vision: false,
      streaming: true,
      structuredOutput: true,
    };
    this.modelConfig = {
      'deepseek-chat': { contextWindow: 128000, maxOutput: 8192, priceInPer1M: 0.27, priceOutPer1M: 1.10 },
      'deepseek-reasoner': { contextWindow: 128000, maxOutput: 32768, priceInPer1M: 0.55, priceOutPer1M: 2.19 },
    };
  }
}
