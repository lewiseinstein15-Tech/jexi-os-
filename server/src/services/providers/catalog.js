/**
 * JEXI OS — Unified Provider Catalog.
 *
 * ONE credential model for every model provider:
 *
 *   Provider + API key + Model (+ optional Base URL)
 *
 * JEXI is the operating system; the model is a replaceable reasoning engine.
 * Every provider below is reachable through ONE of two wire adapters:
 *
 *   adapter 'openai'    → OpenAI-compatible /chat/completions (REST + SSE).
 *                         Covers OpenAI, Groq, DeepSeek, OpenRouter, Mistral,
 *                         xAI, NVIDIA NIM, SambaNova, Cerebras, DeepInfra,
 *                         HuggingFace router, Gemini (OpenAI endpoint),
 *                         Ollama, LM Studio, vLLM and any custom endpoint.
 *   adapter 'anthropic' → Anthropic Messages API (native, incl. tools).
 *
 * No provider logic may live in agent prompts or the frontend — only here.
 */

export const PROVIDERS = [
  {
    id: 'openai', label: 'OpenAI', adapter: 'openai',
    defaultBaseUrl: 'https://api.openai.com/v1', keyEnv: 'OPENAI_API_KEY',
    needsKey: true, docsUrl: 'https://platform.openai.com/api-keys',
    modelHints: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'o4-mini'],
    blurb: 'Official OpenAI API.',
  },
  {
    id: 'anthropic', label: 'Anthropic', adapter: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com/v1', keyEnv: 'ANTHROPIC_API_KEY',
    needsKey: true, docsUrl: 'https://console.anthropic.com/settings/keys',
    modelHints: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-1'],
    blurb: 'Official Anthropic API (native messages + tools).',
  },
  {
    id: 'gemini', label: 'Google Gemini', adapter: 'openai',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyEnv: 'GEMINI_API_KEY', needsKey: true,
    docsUrl: 'https://aistudio.google.com/apikey',
    modelHints: ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-pro'],
    blurb: 'Gemini via its OpenAI-compatible endpoint.',
  },
  {
    id: 'groq', label: 'Groq', adapter: 'openai',
    defaultBaseUrl: 'https://api.groq.com/openai/v1', keyEnv: 'GROQ_API_KEY',
    needsKey: true, docsUrl: 'https://console.groq.com/keys',
    modelHints: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3-32b', 'llama-3.3-70b-versatile'],
    blurb: 'Ultra-fast inference (Llama, Qwen, GPT-OSS). Free tier.',
  },
  {
    id: 'deepseek', label: 'DeepSeek', adapter: 'openai',
    defaultBaseUrl: 'https://api.deepseek.com/v1', keyEnv: 'DEEPSEEK_API_KEY',
    needsKey: true, docsUrl: 'https://platform.deepseek.com/api_keys',
    modelHints: ['deepseek-chat', 'deepseek-reasoner'],
    blurb: 'Official DeepSeek API (V3 chat + R1 reasoning).',
  },
  {
    id: 'openrouter', label: 'OpenRouter', adapter: 'openai',
    defaultBaseUrl: 'https://openrouter.ai/api/v1', keyEnv: 'OPENROUTER_API_KEY',
    needsKey: true, docsUrl: 'https://openrouter.ai/keys',
    modelHints: ['nvidia/nemotron-3-super-120b-a12b:free', 'qwen/qwen3-32b:free', 'deepseek/deepseek-chat-v3.1:free'],
    extraHeaders: { 'HTTP-Referer': 'https://jexi.os', 'X-Title': 'JEXI OS' },
    blurb: 'One key → hundreds of models, incl. free tiers.',
  },
  {
    id: 'mistral', label: 'Mistral', adapter: 'openai',
    defaultBaseUrl: 'https://api.mistral.ai/v1', keyEnv: 'MISTRAL_API_KEY',
    needsKey: true, docsUrl: 'https://console.mistral.ai/api-keys',
    modelHints: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest'],
    blurb: 'Official Mistral API.',
  },
  {
    id: 'xai', label: 'xAI (Grok)', adapter: 'openai',
    defaultBaseUrl: 'https://api.x.ai/v1', keyEnv: 'XAI_API_KEY',
    needsKey: true, docsUrl: 'https://console.x.ai/',
    modelHints: ['grok-4', 'grok-3', 'grok-3-mini'],
    blurb: 'Official xAI API.',
  },
  {
    id: 'nvidia', label: 'NVIDIA NIM', adapter: 'openai',
    defaultBaseUrl: 'https://integrate.api.nvidia.com/v1', keyEnv: 'NVIDIA_API_KEY',
    needsKey: true, docsUrl: 'https://build.nvidia.com/',
    modelHints: ['deepseek-ai/deepseek-v3.1', 'qwen/qwen3-235b-a22b'],
    blurb: 'Free credits, no card (DeepSeek, Qwen, Nemotron).',
  },
  {
    id: 'sambanova', label: 'SambaNova', adapter: 'openai',
    defaultBaseUrl: 'https://api.sambanova.ai/v1', keyEnv: 'SAMBANOVA_API_KEY',
    needsKey: true, docsUrl: 'https://cloud.sambanova.ai/',
    modelHints: ['DeepSeek-V3.1', 'Meta-Llama-3.3-70B-Instruct'],
    blurb: 'Fast free tier (DeepSeek, Llama).',
  },
  {
    id: 'cerebras', label: 'Cerebras', adapter: 'openai',
    defaultBaseUrl: 'https://api.cerebras.ai/v1', keyEnv: 'CEREBRAS_API_KEY',
    needsKey: true, docsUrl: 'https://cloud.cerebras.ai/',
    modelHints: ['llama-3.3-70b', 'qwen-3-32b'],
    blurb: 'Wafer-scale inference. Free tier.',
  },
  {
    id: 'deepinfra', label: 'DeepInfra', adapter: 'openai',
    defaultBaseUrl: 'https://api.deepinfra.com/v1/openai', keyEnv: 'DEEPINFRA_API_KEY',
    needsKey: true, docsUrl: 'https://deepinfra.com/dash/api_keys',
    modelHints: ['Qwen/Qwen3-32B', 'deepseek-ai/DeepSeek-V3.1'],
    blurb: 'Cheap open-model hosting.',
  },
  {
    id: 'huggingface', label: 'HuggingFace', adapter: 'openai',
    defaultBaseUrl: 'https://router.huggingface.co/v1', keyEnv: 'HF_TOKEN',
    needsKey: true, docsUrl: 'https://huggingface.co/settings/tokens',
    modelHints: ['Qwen/Qwen2.5-7B-Instruct', 'Qwen/Qwen2.5-Coder-7B-Instruct', 'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B'],
    blurb: 'Serverless inference via the HF router.',
  },
  {
    id: 'ollama', label: 'Ollama (local)', adapter: 'openai',
    defaultBaseUrl: 'http://127.0.0.1:11434/v1', keyEnv: null,
    needsKey: false, docsUrl: 'https://ollama.com/',
    modelHints: ['qwen3', 'llama3.3', 'deepseek-r1', 'gpt-oss'],
    blurb: 'Your own machine. No key, no cloud, private.',
  },
  {
    id: 'lmstudio', label: 'LM Studio (local)', adapter: 'openai',
    defaultBaseUrl: 'http://127.0.0.1:1234/v1', keyEnv: null,
    needsKey: false, docsUrl: 'https://lmstudio.ai/',
    modelHints: [],
    blurb: 'Local server mode. No key.',
  },
  {
    id: 'vllm', label: 'vLLM (self-hosted)', adapter: 'openai',
    defaultBaseUrl: '', keyEnv: 'VLLM_BASE_URL',
    needsKey: false, docsUrl: 'https://docs.vllm.ai/',
    modelHints: [],
    blurb: 'Your own OpenAI-compatible server. Set its base URL.',
  },
  {
    id: 'custom', label: 'Custom (OpenAI-compatible)', adapter: 'openai',
    defaultBaseUrl: '', keyEnv: null,
    needsKey: false, docsUrl: '',
    modelHints: [],
    blurb: 'Any OpenAI-compatible endpoint: Together, Fireworks, Workers AI gateway, proxies…',
  },
];

/** Look up a provider definition by id (case-insensitive). Null when unknown. */
export function getProviderDef(id) {
  const want = String(id || '').trim().toLowerCase();
  return PROVIDERS.find((p) => p.id === want) || null;
}

/** Safe catalog for API/UI clients — never contains key material. */
export function publicCatalog() {
  return PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    adapter: p.adapter,
    defaultBaseUrl: p.defaultBaseUrl,
    keyEnv: p.keyEnv,
    needsKey: p.needsKey,
    docsUrl: p.docsUrl,
    modelHints: [...p.modelHints],
    blurb: p.blurb,
  }));
}
