import fs from 'node:fs';
import path from 'node:path';

export function error(code, message = code) {
  return Object.assign(new Error(message), { code });
}

export function assertAgentId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw error('E_AGENT_ID');
  return id;
}

function jsonValue(value, stack = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object' || stack.has(value)) throw error('E_JSON_VALUE');
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) throw error('E_JSON_VALUE');
  stack.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor?.enumerable || !('value' in descriptor)) throw error('E_JSON_VALUE');
    jsonValue(descriptor.value, stack);
  }
  stack.delete(value);
}

/** Make a data-only copy before it crosses the durable boundary. */
export function copyJson(value) {
  jsonValue(value);
  return JSON.parse(JSON.stringify(value));
}

function isMessage(message) {
  return message && typeof message === 'object'
    && typeof message.id === 'string' && typeof message.from === 'string'
    && typeof message.to === 'string' && typeof message.kind === 'string'
    && typeof message.ts === 'string' && typeof message.delivered === 'boolean'
    && Object.hasOwn(message, 'payload');
}

function validateRecord(record, id) {
  if (!record || typeof record !== 'object' || record.version !== 1
    || !record.agent || typeof record.agent !== 'object' || record.agent.id !== id
    || (record.agent.parentId != null && typeof record.agent.parentId !== 'string')
    || !['live', 'evicted'].includes(record.agent.state)
    || typeof record.agent.role !== 'string' || !record.agent.role
    || !Number.isFinite(Date.parse(record.agent.lastActivityAt))
    || !Array.isArray(record.queue) || !Array.isArray(record.inflight)
    || !Number.isSafeInteger(record.nextSeq) || record.nextSeq < 1
    || (record.persistedAt != null && typeof record.persistedAt !== 'string')) {
    throw error('E_STATE_CORRUPT');
  }
  for (const message of [...record.queue, ...record.inflight]) {
    if (!isMessage(message)) throw error('E_STATE_CORRUPT');
    try { copyJson(message.payload); } catch { throw error('E_STATE_CORRUPT'); }
  }
  try { copyJson(record.agent); } catch { throw error('E_STATE_CORRUPT'); }
  return record;
}

export function createStorage(directory) {
  const root = path.resolve(directory);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });

  const file = id => path.join(root, `${assertAgentId(id)}.json`);
  const lockPath = path.join(root, '.writer.lock');

  return {
    directory: root,
    file,
    locked(work) {
      let fd;
      try {
        fd = fs.openSync(lockPath, 'wx', 0o600);
      } catch (cause) {
        if (cause.code === 'EEXIST') throw error('E_STORE_BUSY');
        throw cause;
      }
      try {
        return work();
      } finally {
        fs.closeSync(fd);
        fs.rmSync(lockPath, { force: true });
      }
    },
    read(id) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file(id), 'utf8'));
        return validateRecord(parsed, id);
      } catch (cause) {
        if (cause?.code === 'ENOENT') return null;
        if (cause?.code === 'E_STATE_CORRUPT') throw cause;
        if (cause instanceof SyntaxError) throw error('E_STATE_CORRUPT');
        throw cause;
      }
    },
    write(id, state) {
      validateRecord(state, id);
      const target = file(id);
      const temporary = `${target}.tmp`;
      let fd;
      try {
        fd = fs.openSync(temporary, 'w', 0o600);
        fs.writeFileSync(fd, `${JSON.stringify(state)}\n`);
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = undefined;
        fs.renameSync(temporary, target);
        const directoryFd = fs.openSync(root, 'r');
        try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
      } catch (cause) {
        if (fd !== undefined) fs.closeSync(fd);
        fs.rmSync(temporary, { force: true });
        throw cause;
      }
    },
    ids() {
      return fs.readdirSync(root)
        .filter(name => /^[A-Za-z0-9_-]{1,100}\.json$/.test(name))
        .map(name => name.slice(0, -'.json'.length))
        .sort();
    },
  };
}

export function recordFor(storage, agent) {
  const present = storage.read(agent.id);
  if (present) return present;
  return {
    version: 1,
    agent: copyJson(agent),
    queue: [],
    // A message enters inflight before receive() returns. If a process dies
    // before ack(), a new process will redeliver it: at-least-once delivery.
    inflight: [],
    nextSeq: 1,
  };
}
