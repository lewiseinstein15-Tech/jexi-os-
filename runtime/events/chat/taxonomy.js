/**
 * JEXI OS — Phase 16 Scope A — CHAT EVENT TAXONOMY
 *
 * Typed events for every chat-renderable state.
 * Each event: { type, version, ts, sessionId, agentId?, payload }
 *
 * Types (16):
 *  message.delta, thinking.delta, plan.created, plan.updated,
 *  tool.started, tool.progress, tool.completed, tool.failed,
 *  approval.requested, approval.resolved, artifact.created,
 *  agent.spawned, agent.completed, turn.completed,
 *  checkpoint.created, narration.line
 *
 * Rules:
 *  - validate(event) → { valid, errors? }
 *  - schemaFor(type) → JSON Schema
 *  - list() → all event types
 */

const EVENT_TYPES = [
  'message.delta',
  'thinking.delta',
  'plan.created',
  'plan.updated',
  'tool.started',
  'tool.progress',
  'tool.completed',
  'tool.failed',
  'approval.requested',
  'approval.resolved',
  'artifact.created',
  'agent.spawned',
  'agent.completed',
  'turn.completed',
  'checkpoint.created',
  'narration.line',
];

const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
const AGENT_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

function isIsoDateString(v) {
  if (typeof v !== 'string') return false;
  const d = Date.parse(v);
  return Number.isFinite(d);
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Base JSON Schema shared by all events
function baseSchema(type) {
  return {
    $id: `jexi.chat.${type}`,
    type: 'object',
    version: 1,
    required: ['type', 'version', 'ts', 'sessionId', 'payload'],
    properties: {
      type: { type: 'string', const: type },
      version: { type: 'integer', minimum: 1 },
      ts: { type: 'string', format: 'date-time', description: 'ISO timestamp' },
      sessionId: { type: 'string', pattern: SESSION_ID_RE.source },
      agentId: { type: 'string', pattern: AGENT_ID_RE.source, description: 'optional source agent' },
      payload: { type: 'object' },
    },
    additionalProperties: false,
  };
}

// Type-specific payload schemas (minimal required fields, extensible)
const PAYLOAD_SCHEMAS = {
  'message.delta': {
    required: ['delta'],
    properties: {
      delta: { type: 'string' },
      messageId: { type: 'string' },
    },
  },
  'thinking.delta': {
    required: ['delta'],
    properties: {
      delta: { type: 'string' },
      thinkingId: { type: 'string' },
    },
  },
  'plan.created': {
    required: ['planId', 'steps'],
    properties: {
      planId: { type: 'string' },
      steps: { type: 'array', items: { type: 'object' } },
      title: { type: 'string' },
    },
  },
  'plan.updated': {
    required: ['planId', 'steps'],
    properties: {
      planId: { type: 'string' },
      steps: { type: 'array' },
      status: { type: 'string', enum: ['pending', 'running', 'completed', 'failed'] },
    },
  },
  'tool.started': {
    required: ['toolCallId', 'toolName'],
    properties: {
      toolCallId: { type: 'string' },
      toolName: { type: 'string' },
      args: { type: 'object' },
    },
  },
  'tool.progress': {
    required: ['toolCallId', 'progress'],
    properties: {
      toolCallId: { type: 'string' },
      progress: { type: 'number', minimum: 0, maximum: 1 },
      message: { type: 'string' },
    },
  },
  'tool.completed': {
    required: ['toolCallId'],
    properties: {
      toolCallId: { type: 'string' },
      result: {},
      durationMs: { type: 'number' },
    },
  },
  'tool.failed': {
    required: ['toolCallId', 'error'],
    properties: {
      toolCallId: { type: 'string' },
      error: { type: 'object' },
    },
  },
  'approval.requested': {
    required: ['approvalId', 'reason'],
    properties: {
      approvalId: { type: 'string' },
      reason: { type: 'string' },
      options: { type: 'array' },
    },
  },
  'approval.resolved': {
    required: ['approvalId', 'decision'],
    properties: {
      approvalId: { type: 'string' },
      decision: { type: 'string', enum: ['approved', 'rejected', 'cancelled'] },
      resolver: { type: 'string' },
    },
  },
  'artifact.created': {
    required: ['artifactId', 'path'],
    properties: {
      artifactId: { type: 'string' },
      path: { type: 'string' },
      content: { type: 'string' },
    },
  },
  'agent.spawned': {
    required: ['agentId', 'role'],
    properties: {
      agentId: { type: 'string' },
      role: { type: 'string' },
      parentId: { type: 'string' },
    },
  },
  'agent.completed': {
    required: ['agentId'],
    properties: {
      agentId: { type: 'string' },
      result: {},
      status: { type: 'string' },
    },
  },
  'turn.completed': {
    required: ['turnId', 'status'],
    properties: {
      turnId: { type: 'string' },
      status: { type: 'string', enum: ['ok', 'fail'] },
      summary: { type: 'string' },
    },
  },
  'checkpoint.created': {
    required: ['checkpointId'],
    properties: {
      checkpointId: { type: 'string' },
      snapshot: { type: 'object' },
    },
  },
  'narration.line': {
    required: ['narrationType', 'text'],
    properties: {
      narrationType: {
        type: 'string',
        enum: ['acknowledge', 'recon', 'finding', 'decision', 'progress', 'correction', 'completion'],
      },
      text: { type: 'string' },
      ctx: { type: 'object' },
      input: {},
    },
  },
};

function buildFullSchema(type) {
  const base = baseSchema(type);
  const payloadSpec = PAYLOAD_SCHEMAS[type];
  if (!payloadSpec) return base;
  return {
    ...base,
    properties: {
      ...base.properties,
      payload: {
        type: 'object',
        required: payloadSpec.required,
        properties: payloadSpec.properties,
        additionalProperties: true,
      },
    },
  };
}

// Pre-build schemas map
const SCHEMAS = {};
for (const t of EVENT_TYPES) {
  SCHEMAS[t] = buildFullSchema(t);
}

export function list() {
  return [...EVENT_TYPES];
}

export function schemaFor(type) {
  if (!EVENT_TYPES.includes(type)) {
    const err = new Error(`Unknown event type: ${type}`);
    err.code = 'E_UNKNOWN_TYPE';
    throw err;
  }
  // Return deep copy to prevent mutation
  return JSON.parse(JSON.stringify(SCHEMAS[type]));
}

export function validate(event) {
  const errors = [];

  if (!isObject(event)) {
    return { valid: false, errors: [{ code: 'E_EVENT_NOT_OBJECT', message: 'event must be an object' }] };
  }

  // type
  if (typeof event.type !== 'string' || !EVENT_TYPES.includes(event.type)) {
    errors.push({ code: 'E_UNKNOWN_TYPE', message: `unknown type: ${event.type}`, field: 'type' });
  }

  // version
  if (!Number.isInteger(event.version) || event.version < 1) {
    errors.push({ code: 'E_INVALID_VERSION', message: 'version must be integer >=1', field: 'version' });
  }

  // ts
  if (!isIsoDateString(event.ts) && typeof event.ts !== 'number') {
    errors.push({ code: 'E_INVALID_TS', message: 'ts must be ISO date string or number', field: 'ts' });
  }

  // sessionId
  if (typeof event.sessionId !== 'string' || !SESSION_ID_RE.test(event.sessionId)) {
    errors.push({ code: 'E_INVALID_SESSION_ID', message: 'sessionId must match [A-Za-z0-9_-]{1,100}', field: 'sessionId' });
  }

  // agentId optional
  if (event.agentId !== undefined) {
    if (typeof event.agentId !== 'string' || !AGENT_ID_RE.test(event.agentId)) {
      errors.push({ code: 'E_INVALID_AGENT_ID', message: 'agentId must match [A-Za-z0-9_-]{1,100}', field: 'agentId' });
    }
  }

  // payload
  if (!isObject(event.payload)) {
    errors.push({ code: 'E_INVALID_PAYLOAD', message: 'payload must be an object', field: 'payload' });
  } else if (event.type && PAYLOAD_SCHEMAS[event.type]) {
    const spec = PAYLOAD_SCHEMAS[event.type];
    for (const req of spec.required || []) {
      if (!(req in event.payload)) {
        errors.push({ code: 'E_MISSING_PAYLOAD_FIELD', message: `payload missing required field: ${req}`, field: `payload.${req}` });
      }
    }
    // Type checks for known fields (lightweight)
    if (event.type === 'narration.line' && event.payload.narrationType) {
      const allowed = ['acknowledge', 'recon', 'finding', 'decision', 'progress', 'correction', 'completion'];
      if (!allowed.includes(event.payload.narrationType)) {
        errors.push({ code: 'E_INVALID_NARRATION_TYPE', message: `invalid narrationType: ${event.payload.narrationType}`, field: 'payload.narrationType' });
      }
    }
    if (event.type === 'turn.completed' && event.payload.status) {
      if (!['ok', 'fail'].includes(event.payload.status)) {
        errors.push({ code: 'E_INVALID_TURN_STATUS', message: `invalid turn status: ${event.payload.status}`, field: 'payload.status' });
      }
    }
  }

  // No extra top-level props beyond allowed
  const allowedTop = new Set(['type', 'version', 'ts', 'sessionId', 'agentId', 'payload']);
  for (const key of Object.keys(event)) {
    if (!allowedTop.has(key)) {
      errors.push({ code: 'E_EXTRA_FIELD', message: `extra field not allowed: ${key}`, field: key });
    }
  }

  if (errors.length) {
    return { valid: false, errors };
  }
  return { valid: true };
}

export const taxonomy = {
  list,
  schemaFor,
  validate,
  EVENT_TYPES,
  SESSION_ID_RE,
  AGENT_ID_RE,
};

export default taxonomy;
