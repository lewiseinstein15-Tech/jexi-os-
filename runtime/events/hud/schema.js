/**
 * JEXI OS — HUD STATUS CONTRACT — schema (Phase 7 F).
 *
 * The HUD payload is the ONE state contract between the brain and every
 * operator surface. `jexi.hud-status.v1` is declared here, in one place,
 * as data — the validator, the producer, and the console all read the
 * same declaration and can never drift apart.
 *
 * Zero dependencies (ECC reference layout, like learning/ and
 * verification/eval/): this file must stay importable from the server,
 * from probe scripts, and from any future consumer without node_modules.
 */

export const HUD_VERSION = 'jexi.hud-status.v1';

/**
 * Field kinds understood by the validator. `kind` values:
 *   string   — non-empty string
 *   number   — finite number
 *   boolean  — true/false
 *   iso      — ISO-8601 timestamp string
 *   iso|null — timestamp or explicit null
 *   enum     — one of `values`
 *   array    — array of objects matching `item`
 * Sections themselves are `object` with nested `fields`.
 */
export const HUD_SCHEMA = {
  version: { kind: 'const', value: HUD_VERSION, required: true, doc: 'contract version — consumer refuses any other value' },
  generatedAt: { kind: 'iso', required: true, doc: 'when this payload was assembled' },
  sessionId: { kind: 'string', required: true, doc: 'active conversation/session id' },
  agentId: { kind: 'string', required: true, doc: 'the brain agent answering for this state' },
  missionId: { kind: 'string|null', required: true, doc: 'active mission id or null' },

  context: {
    kind: 'object',
    required: false, // sections are producer-guaranteed; schema tolerates omission (probe P7 path)
    fields: {
      model: { kind: 'string' },
      provider: { kind: 'string' },
      contextPressure: { kind: 'number', min: 0, max: 1 },
      tokensUsed: { kind: 'number', min: 0 },
      tokensCap: { kind: 'number', min: 0 },
    },
  },

  toolCalls: {
    kind: 'object',
    required: false,
    fields: {
      recent: {
        kind: 'array',
        item: {
          name: { kind: 'string' },
          status: { kind: 'enum', values: ['ok', 'fail', 'blocked'] },
          durationMs: { kind: 'number', min: 0 },
          at: { kind: 'iso' },
        },
      },
      pending: { kind: 'number', min: 0 },
      stale: { kind: 'number', min: 0 },
      lastEvent: { kind: 'text' }, // any string — an idle bus honestly reports ''
    },
  },

  activeAgents: {
    kind: 'array',
    required: false,
    item: {
      id: { kind: 'string' },
      name: { kind: 'string' },
      role: { kind: 'string' },
      state: { kind: 'enum', values: ['idle', 'working', 'paused'] },
      objective: { kind: 'string|null' },
      resourcePct: { kind: 'number', min: 0, max: 100 },
      startedAt: { kind: 'iso|null' },
    },
  },

  todos: {
    kind: 'array',
    required: false,
    item: {
      id: { kind: 'string' },
      text: { kind: 'string' },
      status: { kind: 'enum', values: ['pending', 'active', 'done'] },
      owner: { kind: 'string' },
    },
  },

  checks: {
    kind: 'object',
    required: false,
    fields: {
      local: { kind: 'enum', values: ['pass', 'fail', 'running', 'idle'] },
      remote: { kind: 'enum', values: ['pass', 'fail', 'running', 'idle'] },
      lastRunAt: { kind: 'iso|null' },
    },
  },

  cost: {
    kind: 'object',
    required: false,
    fields: {
      sessionUsd: { kind: 'number', min: 0 },
      budgetUsd: { kind: 'number', min: 0 },
      trend: { kind: 'enum', values: ['up', 'flat', 'down'] },
    },
  },

  risk: {
    kind: 'object',
    required: false,
    fields: {
      attention: { kind: 'enum', values: ['normal', 'warning', 'critical'] },
      conflictPressure: { kind: 'number', min: 0, max: 1 },
      staleCalls: { kind: 'number', min: 0 },
    },
  },

  queueState: {
    kind: 'object',
    required: false,
    fields: {
      missionsQueued: { kind: 'number', min: 0 },
      toolsQueued: { kind: 'number', min: 0 },
      verificationsQueued: { kind: 'number', min: 0 },
    },
  },

  sessionControls: {
    kind: 'object',
    required: false,
    fields: {
      canPause: { kind: 'boolean' },
      canStop: { kind: 'boolean' },
      canRestart: { kind: 'boolean' },
      mode: { kind: 'enum', values: ['ask', 'plan', 'agent'] },
    },
  },

  sync: {
    kind: 'object',
    required: false,
    fields: {
      linear: { kind: 'enum', values: ['synced', 'pending', 'error', 'none'] },
      github: { kind: 'enum', values: ['synced', 'pending', 'error', 'none'] },
      handoff: { kind: 'enum', values: ['idle', 'pending', 'done'] },
    },
  },
};

/** The 5 identity keys + 10 state sections, in contract order. */
export const IDENTITY_KEYS = ['version', 'generatedAt', 'sessionId', 'agentId', 'missionId'];
export const SECTION_KEYS = [
  'context', 'toolCalls', 'activeAgents', 'todos', 'checks',
  'cost', 'risk', 'queueState', 'sessionControls', 'sync',
];
export const TOP_LEVEL_KEYS = [...IDENTITY_KEYS, ...SECTION_KEYS];

/** Honest defaults for an unbuilt subsystem — never a fabricated value. */
export function emptyPayload() {
  return {
    version: HUD_VERSION,
    generatedAt: new Date().toISOString(),
    sessionId: '',
    agentId: 'jexi-brain',
    missionId: null,
    context: { model: '', provider: '', contextPressure: 0, tokensUsed: 0, tokensCap: 0 },
    toolCalls: { recent: [], pending: 0, stale: 0, lastEvent: '' },
    activeAgents: [],
    todos: [],
    checks: { local: 'idle', remote: 'idle', lastRunAt: null },
    cost: { sessionUsd: 0, budgetUsd: Number(process.env.JEXI_BUDGET_USD) || 5, trend: 'flat' },
    risk: { attention: 'normal', conflictPressure: 0, staleCalls: 0 },
    queueState: { missionsQueued: 0, toolsQueued: 0, verificationsQueued: 0 },
    sessionControls: { canPause: false, canStop: false, canRestart: false, mode: 'ask' },
    sync: { linear: 'none', github: 'none', handoff: 'idle' },
  };
}
