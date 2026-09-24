import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAutonomous } from '../runtime/scheduler/autonomous/index.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p10g-'));
const autonomousUrl = new URL('../runtime/scheduler/autonomous/index.js', import.meta.url).href;
let passed = 0;
let child;
const pass = name => { passed += 1; console.log(`PASS ${name}`); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const apiFor = (name, sessionId = 'probe') => createAutonomous({ directory: path.join(root, name), sessionId });

function waitForChildReady(processChild) {
  return new Promise((resolve, reject) => {
    let timer;
    const finish = (settle, value) => {
      clearTimeout(timer);
      processChild.removeListener('message', onMessage);
      processChild.removeListener('exit', onExit);
      processChild.removeListener('error', onError);
      settle(value);
    };
    const onMessage = message => finish(resolve, message);
    const onExit = (code, signal) => finish(reject, new Error(`WRITER_EXITED_BEFORE_READY code=${code} signal=${signal}`));
    const onError = cause => finish(reject, cause);
    processChild.once('message', onMessage);
    processChild.once('exit', onExit);
    processChild.once('error', onError);
    timer = setTimeout(() => finish(reject, new Error('WRITER_READY_TIMEOUT')), 10_000);
  });
}

try {
  console.log('P1');
  const p1 = apiFor('p1');
  const created = p1.goal.set({ description: 'run 3 iterations', maxTurns: 5 });
  const goals = p1.goal.list();
  assert.equal(goals.length, 1);
  assert.equal(goals[0].id, created.goalId);
  assert.equal(goals[0].description, 'run 3 iterations');
  assert.equal(goals[0].maxTurns, 5);
  assert.equal(goals[0].maxTokens, 100_000);
  assert.equal(goals[0].maxWallMs, 60_000);
  assert.equal(goals[0].status, 'active');
  console.log(JSON.stringify({ created, goals }));
  pass('P1 goal set and list');

  console.log('P2');
  const p2 = await p1.continuation.run(created.goalId, () => 'done');
  assert.ok(p2.turnsRun <= 5);
  assert.equal(p2.stoppedBecause, 'goal-complete');
  assert.equal(p1.goal.isComplete(created.goalId), true);
  console.log(JSON.stringify(p2));
  pass('P2 goal completes within bounds');

  console.log('P3');
  {
    const api = apiFor('p3');
    const goal = api.goal.set({ description: 'would take five turns', maxTurns: 2 });
    let calls = 0;
    const result = await api.continuation.run(goal.goalId, () => {
      calls += 1;
      return { complete: false, tokens: 1 };
    });
    assert.equal(calls, 2);
    assert.equal(result.turnsRun, 2);
    assert.equal(result.stoppedBecause, 'max-turns');
    console.log(JSON.stringify({ result, calls }));
    pass('P3 max-turns boundary');
  }

  console.log('P4');
  {
    const api = apiFor('p4');
    const goal = api.goal.set({ description: 'slow turn', maxWallMs: 100 });
    const result = await api.continuation.run(goal.goalId, async () => {
      await sleep(220);
      return 'done';
    });
    assert.equal(result.stoppedBecause, 'max-wall-ms');
    assert.ok(Date.parse(result.endedAt) - Date.parse(result.startedAt) > 200);
    assert.equal(api.goal.isComplete(goal.goalId), false);
    console.log(JSON.stringify(result));
    pass('P4 max-wall-ms boundary');
  }

  console.log('P5');
  {
    const api = apiFor('p5');
    const goal = api.goal.set({ description: 'token cap', maxTokens: 5 });
    const result = await api.continuation.run(goal.goalId, () => ({ complete: false, tokens: 10 }));
    assert.equal(result.stoppedBecause, 'max-tokens');
    assert.equal(result.turnsRun, 1);
    assert.equal(result.tokensUsed, 10);
    console.log(JSON.stringify(result));
    pass('P5 max-tokens boundary');
  }

  console.log('P6');
  {
    const api = apiFor('p6');
    const goal = api.goal.set({
      description: 'gate must fail',
      gateCommand: 'node -e "process.exit(1)"',
    });
    const result = await api.continuation.run(goal.goalId, () => 'done');
    assert.equal(result.stoppedBecause, 'gate-failed');
    assert.equal(result.gate.passed, false);
    assert.equal(result.gate.exitCode, 1);
    assert.equal(api.goal.isComplete(goal.goalId), false);
    console.log(JSON.stringify({ result, complete: api.goal.isComplete(goal.goalId) }));
    pass('P6 gate blocks completion');
  }

  console.log('P7');
  {
    const api = apiFor('p7');
    const goal = api.goal.set({
      description: 'gate must pass',
      gateCommand: 'node -e "process.exit(0)"',
    });
    const result = await api.continuation.run(goal.goalId, () => ({ complete: true, evidence: { verified: true }, tokens: 2 }));
    assert.equal(result.stoppedBecause, 'goal-complete');
    assert.equal(result.gate.passed, true);
    assert.equal(api.goal.isComplete(goal.goalId), true);
    console.log(JSON.stringify({ result, complete: api.goal.isComplete(goal.goalId) }));
    pass('P7 gate passes and completes goal');
  }

  console.log('P8');
  {
    const api = apiFor('p8');
    const goal = api.goal.set({ description: 'heartbeat target' });
    const fires = [];
    const subscription = api.heartbeat.onFire(event => fires.push(event));
    const scheduled = api.heartbeat.schedule(goal.goalId, { everyMs: 50 });
    await sleep(230);
    assert.ok(fires.length >= 3, `expected at least 3 fires, got ${fires.length}`);
    const beforeCancel = fires.length;
    const cancelled = api.heartbeat.cancel(scheduled.scheduleId);
    await sleep(130);
    assert.equal(fires.length, beforeCancel);
    subscription.unsubscribe();
    api.heartbeat.close();
    console.log(JSON.stringify({ scheduled, fires, beforeCancel, cancelled, afterCancel: fires.length }));
    pass('P8 heartbeat fires then cancellation stops pings');
  }

  console.log('P9');
  {
    const directory = path.join(root, 'p9');
    const childSource = `
      import { createAutonomous } from ${JSON.stringify(autonomousUrl)};
      const api = createAutonomous({ directory: ${JSON.stringify(directory)}, sessionId: 'restart' });
      const created = api.goal.set({ description: 'survive SIGKILL', maxTurns: 4, maxTokens: 99, maxWallMs: 1234 });
      process.send({ ready: true, pid: process.pid, created });
      setInterval(() => {}, 1000);
    `;
    child = spawn(process.execPath, ['--input-type=module', '--eval', childSource], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    const ready = await waitForChildReady(child);
    assert.equal(ready.ready, true);
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    const [, signal] = await exited;
    assert.equal(signal, 'SIGKILL');
    child = undefined;

    const readerSource = `
      import { createAutonomous } from ${JSON.stringify(autonomousUrl)};
      const api = createAutonomous({ directory: ${JSON.stringify(directory)}, sessionId: 'restart' });
      console.log(JSON.stringify(api.goal.get(${JSON.stringify(ready.created.goalId)})));
    `;
    const fresh = spawnSync(process.execPath, ['--input-type=module', '--eval', readerSource], {
      encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(fresh.status, 0, fresh.stderr);
    const restored = JSON.parse(fresh.stdout);
    assert.equal(restored.description, 'survive SIGKILL');
    assert.equal(restored.maxTurns, 4);
    assert.equal(restored.maxTokens, 99);
    console.log(JSON.stringify({ writerPid: ready.pid, signal, readerExit: fresh.status }));
    console.log(fresh.stdout.trim());
    pass('P9 persistent goal survives SIGKILL restart');
  }

  console.log('P10');
  {
    const commandNames = ['goal', 'heartbeat', 'autonomous'];
    const commands = await import('../capabilities/commands/index.js');
    const rows = [];
    for (const name of commandNames) {
      const file = path.resolve('capabilities/commands', `${name}.command.js`);
      assert.equal(fs.existsSync(file), true);
      const loaded = await import(pathToFileURL(file).href);
      const registered = commands.resolve(name);
      assert.equal(loaded.default.name, name);
      assert.equal(registered?.name, name);
      rows.push({ file: path.relative(process.cwd(), file), exists: true, loadable: true, registered: registered.name });
    }
    console.log(JSON.stringify({ registry: 'commands/index.js', commands: rows, registeredNames: commands.list().map(command => command.name) }));
    pass('P10 command files load and registry resolves each command');
  }

  console.log(`TOTAL ${passed} PASS ${passed} FAIL 0`);
} finally {
  if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  fs.rmSync(root, { recursive: true, force: true });
}
