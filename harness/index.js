/**
 * JEXI OS — HARNESS facade (Phase 7 H).
 *
 * Re-exports the cross-harness adapter registry so both import styles work:
 *
 *   import adapters from '../harness/index.js';
 *   node -e "require('./harness/adapters').list()"
 */

export * from './adapters/index.js';
export { default } from './adapters/index.js';
