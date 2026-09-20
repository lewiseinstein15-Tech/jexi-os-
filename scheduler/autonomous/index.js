import path from 'node:path';
import { createContinuation } from './continuation.js';
import { createGate } from './gate.js';
import { createGoals } from './goal.js';
import { createHeartbeat } from './heartbeat.js';
import { createGoalStorage } from './storage.js';

/**
 * Create an autonomous scheduler for one caller-owned session. Only goal
 * records persist; live heartbeat subscriptions deliberately stay in-process.
 */
export function createAutonomous({
  directory = path.resolve('.jexi/autonomous'),
  sessionId = 'default',
  clock = () => Date.now(),
  cwd = process.cwd(),
} = {}) {
  const storage = createGoalStorage({ directory, sessionId });
  const gate = createGate({ cwd, clock });
  const goal = createGoals({ storage, gate, clock });
  const heartbeat = createHeartbeat({ goals: goal, clock });
  const continuation = createContinuation({ goals: goal, clock });
  return { goal, heartbeat, continuation, gate };
}

// Commands need one process-resident heartbeat registry per session. Explicit
// createAutonomous() calls remain isolated and are never put in this cache.
const runtimes = new Map();
export function autonomousRuntime({ directory = path.resolve('.jexi/autonomous'), sessionId = 'default' } = {}) {
  const key = `${path.resolve(directory)}\u0000${sessionId}`;
  if (!runtimes.has(key)) runtimes.set(key, createAutonomous({ directory, sessionId }));
  return runtimes.get(key);
}

export function closeAutonomousRuntimes() {
  for (const runtime of runtimes.values()) runtime.heartbeat.close();
  runtimes.clear();
}

export default createAutonomous;
