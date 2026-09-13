/**
 * JEXI OS — WORK GRAPH — shared node typedefs + constructors re-export.
 */

/**
 * @typedef {'mission'|'strategy'|'task'|'verification'|'recovery'} NodeType
 * @typedef {'pending'|'ready'|'running'|'blocked'|'waiting'|'completed'|'failed'|'cancelled'|'superseded'} NodeStatus
 *
 * @typedef {object} Evidence
 * @property {string} source
 * @property {string} [content]
 * @property {number} at     — epoch ms
 * @property {object} [meta]
 *
 * @typedef {object} Artifact
 * @property {string} path
 * @property {string} kind
 * @property {object} [meta]
 *
 * @typedef {object} WorkNode
 * @property {string} id
 * @property {NodeType} type
 * @property {string} objective
 * @property {string} [ownerAcbId]
 * @property {NodeStatus} status
 * @property {string[]} dependencies
 * @property {Evidence[]} evidence
 * @property {Artifact[]} artifacts
 * @property {string} [checkpoint]
 * @property {number} retryCount
 * @property {number} [leaseExpiry]
 */

export const NODE_TYPES = Object.freeze(['mission', 'strategy', 'task', 'verification', 'recovery']);
export const NODE_STATUSES = Object.freeze(['pending', 'ready', 'running', 'blocked', 'waiting', 'completed', 'failed', 'cancelled', 'superseded']);

export { createMissionNode } from './MissionNode.js';
export { createStrategyNode } from './StrategyNode.js';
export { createTaskNode } from './TaskNode.js';
export { createVerificationNode } from './VerificationNode.js';
export { createRecoveryNode } from './RecoveryNode.js';