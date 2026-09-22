/** JEXI OS — Phase 30 Scope F — permission and command lifecycle facade. */
import PermissionDenied, { createPermissionDenied } from './permission-denied.js';
import PromptExpansion, { createPromptExpansion } from './prompt-expansion.js';
import PostToolBatch, { createPostToolBatch } from './post-tool-batch.js';

export function createLifecycle() {
  return Object.freeze({
    PermissionDenied: createPermissionDenied(),
    PromptExpansion: createPromptExpansion(),
    PostToolBatch: createPostToolBatch(),
  });
}

export const lifecycle = Object.freeze({ PermissionDenied, PromptExpansion, PostToolBatch });

export default lifecycle;
export { PermissionDenied, PromptExpansion, PostToolBatch };
export { createPermissionDenied, createPromptExpansion, createPostToolBatch };
