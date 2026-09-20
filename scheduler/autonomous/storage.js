import fs from 'node:fs';
import path from 'node:path';

export function failure(code, message = code) {
  return Object.assign(new Error(message), { code });
}

export function assertSessionId(sessionId) {
  if (typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(sessionId)) {
    throw failure('E_SESSION_ID');
  }
  return sessionId;
}

function assertJson(value, stack = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object' || stack.has(value)) throw failure('E_JSON_VALUE');
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) throw failure('E_JSON_VALUE');
  stack.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor?.enumerable || !('value' in descriptor)) throw failure('E_JSON_VALUE');
    assertJson(descriptor.value, stack);
  }
  stack.delete(value);
}

export function copyJson(value) {
  assertJson(value);
  return JSON.parse(JSON.stringify(value));
}

function validIso(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validGoal(goal) {
  return goal && typeof goal === 'object'
    && typeof goal.id === 'string' && /^goal-[1-9][0-9]*$/.test(goal.id)
    && typeof goal.description === 'string' && goal.description.trim().length > 0
    && Number.isSafeInteger(goal.maxTurns) && goal.maxTurns >= 1
    && Number.isSafeInteger(goal.maxTokens) && goal.maxTokens >= 0
    && Number.isSafeInteger(goal.maxWallMs) && goal.maxWallMs >= 1
    && (goal.gateCommand === null || typeof goal.gateCommand === 'string')
    && validIso(goal.createdAt)
    && ['active', 'completed'].includes(goal.status)
    && (goal.completedAt === null || validIso(goal.completedAt))
    && Object.hasOwn(goal, 'evidence');
}

function validateState(state, sessionId) {
  if (!state || typeof state !== 'object' || state.version !== 1 || state.sessionId !== sessionId
    || !Number.isSafeInteger(state.nextGoalSeq) || state.nextGoalSeq < 1 || !Array.isArray(state.goals)
    || state.goals.some(goal => !validGoal(goal))) {
    throw failure('E_GOAL_STATE_CORRUPT');
  }
  const seen = new Set();
  for (const goal of state.goals) {
    if (seen.has(goal.id)) throw failure('E_GOAL_STATE_CORRUPT');
    seen.add(goal.id);
    try { copyJson(goal.evidence); } catch { throw failure('E_GOAL_STATE_CORRUPT'); }
  }
  return state;
}

function initialState(sessionId) {
  return { version: 1, sessionId, nextGoalSeq: 1, goals: [] };
}

/** A small fsynced, atomic state store scoped to one autonomous session. */
export function createGoalStorage({ directory, sessionId }) {
  const root = path.resolve(directory);
  const session = assertSessionId(sessionId);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const file = path.join(root, `${session}.json`);
  const temporary = `${file}.tmp`;
  const lock = path.join(root, `.${session}.lock`);

  function read() {
    try {
      return validateState(JSON.parse(fs.readFileSync(file, 'utf8')), session);
    } catch (cause) {
      if (cause?.code === 'ENOENT') return initialState(session);
      if (cause?.code === 'E_GOAL_STATE_CORRUPT') throw cause;
      if (cause instanceof SyntaxError) throw failure('E_GOAL_STATE_CORRUPT');
      throw cause;
    }
  }

  function write(state) {
    validateState(state, session);
    let fd;
    try {
      fd = fs.openSync(temporary, 'w', 0o600);
      fs.writeFileSync(fd, `${JSON.stringify(state)}\n`);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(temporary, file);
      const directoryFd = fs.openSync(root, 'r');
      try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
    } catch (cause) {
      if (fd !== undefined) fs.closeSync(fd);
      fs.rmSync(temporary, { force: true });
      throw cause;
    }
  }

  function transaction(work) {
    let lockFd;
    try {
      lockFd = fs.openSync(lock, 'wx', 0o600);
    } catch (cause) {
      if (cause?.code === 'EEXIST') throw failure('E_GOAL_STORE_BUSY');
      throw cause;
    }
    try {
      const state = read();
      const result = work(state);
      write(state);
      return result;
    } finally {
      fs.closeSync(lockFd);
      fs.rmSync(lock, { force: true });
    }
  }

  return { directory: root, sessionId: session, file, read, transaction };
}
