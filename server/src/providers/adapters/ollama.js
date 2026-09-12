/**
 * JEXI OS - Provider bridge - Ollama adapter (local, no API key).
 */
import { ChatClientBase } from './chatClientBase.js';

export class OllamaAdapter extends ChatClientBase {
  constructor(cfg, env = process.env) {
    const c = { ...cfg, needsKey: false };
    super({ id: 'ollama', cfg: c, env, adapter: 'openai', wire: 'openai' });
    this.capabilities = {
      toolCalling: true,
      codeReasoning: 'medium',
      longContext: 128_000,
      vision: false,
      streaming: true,
      structuredOutput: true,
    };
    this.modelConfig = {
      'llama3.1': { contextWindow: 128000, maxOutput: 8192, priceInPer1M: 0, priceOutPer1M: 0 },
    };
    this.baseUrl = (cfg?.baseUrl ?? env.OLLAMA_HOST ?? 'http://localhost:11434/v1').replace(/\/$/, '');
    this.headers = { 'Content-Type': 'application/json' };
  }
}
