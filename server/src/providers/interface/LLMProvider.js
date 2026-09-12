/**
 * JEXI OS — Provider bridge — LLMProvider contract.
 *
 * The interface every adapter implements. Business logic depends on this
 * contract ONLY — never on a concrete provider's SDK or wire format.
 */

/**
 * A provider adapter must expose:
 *
 *   id: string                       // 'openai' | 'anthropic' | …
 *   capabilities: {
 *     toolCalling: boolean
 *     codeReasoning: 'weak' | 'medium' | 'strong'
 *     longContext: number            // context window in tokens
 *     vision: boolean
 *     streaming: boolean
 *     structuredOutput: boolean
 *   }
 *   chat(request)        → Promise<NormalizedResponse>
 *   stream(request)      → AsyncIterable<ChatChunk>
 *   countTokens(text)    → number
 *   estimateCost(request)→ number        // USD
 *   listModels()         → ModelInfo[]
 *   isConfigured()       → boolean
 */

/** Shape-check a candidate object implements the required surface. */
export function isLLMProvider(maybe) {
  return !!(
    maybe &&
    typeof maybe === 'object' &&
    typeof maybe.id === 'string' &&
    maybe.capabilities &&
    typeof maybe.capabilities.toolCalling === 'boolean' &&
    typeof maybe.capabilities.codeReasoning === 'string' &&
    typeof maybe.chat === 'function' &&
    typeof maybe.stream === 'function' &&
    typeof maybe.countTokens === 'function' &&
    typeof maybe.estimateCost === 'function' &&
    typeof maybe.listModels === 'function' &&
    typeof maybe.isConfigured === 'function'
  );
}

export const CONTRACT = {
  requiredMethods: ['chat', 'stream', 'countTokens', 'estimateCost', 'listModels', 'isConfigured'],
  requiredCapabilities: ['toolCalling', 'codeReasoning', 'longContext', 'vision', 'streaming', 'structuredOutput'],
};