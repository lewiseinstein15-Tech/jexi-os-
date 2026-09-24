import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSubagents } from '../agents/workforce/subagent/index.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p10f-'));
const moduleUrl = new URL('../agents/workforce/subagent/index.js', import.meta.url).href;
let passed = 0;
let child;
let now = Date.parse('2026-09-20T10:00:00.000Z');
const clock = () => now;
const stamp = offset => new Date(now + offset).toISOString();
const pass = name => { passed += 1; console.log(`PASS ${name}`); };

function makeGraph({ includeA = true } = {}) {
  const agent = (id, parentId, role, extra = {}) => ({
    id, parentId, role, state: 'live', lastActivityAt: stamp(0), ...extra,
  });
  return {
    agents: [
      agent('R', null, 'root'),
      agent('P', 'R', 'parent'),
      ...(includeA ? [agent('A', 'P', 'worker', { retained: { plan: 'build', revision: 2 } })] : []),
      agent('B', 'P', 'worker'),
      agent('C', 'P', 'worker'),
      agent('S', 'R', 'peer'),
      agent('Z', null, 'stranger'),
    ],
  };
}

function apiFor(name, graph = makeGraph()) {
  return createSubagents({ graph, directory: path.join(root, name), clock });
}

function relation(api, from, to, graph) {
  return api.family.assertInScope(from, to, graph);
}

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
    const onMessage = message => finish(resolve, [message]);
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
  {
    const graph = makeGraph();
    const api = apiFor('p1', graph);
    const results = {
      A_to_P: relation(api, 'A', 'P', graph),
      A_to_B: relation(api, 'A', 'B', graph),
      A_to_C: relation(api, 'A', 'C', graph),
      P_to_A: relation(api, 'P', 'A', graph),
      P_to_B: relation(api, 'P', 'B', graph),
      P_to_C: relation(api, 'P', 'C', graph),
      P_to_S: relation(api, 'P', 'S', graph),
    };
    assert.deepEqual(results.A_to_P, { allowed: true, relation: 'parent' });
    assert.deepEqual(results.A_to_B, { allowed: true, relation: 'sibling' });
    assert.deepEqual(results.A_to_C, { allowed: true, relation: 'sibling' });
    assert.deepEqual(results.P_to_A, { allowed: true, relation: 'child' });
    assert.deepEqual(results.P_to_B, { allowed: true, relation: 'child' });
    assert.deepEqual(results.P_to_C, { allowed: true, relation: 'child' });
    assert.deepEqual(results.P_to_S, { allowed: true, relation: 'sibling' });
    console.log(JSON.stringify(results));
    pass('P1 nuclear family allowed');
  }

  console.log('P2');
  {
    const graph = makeGraph();
    const api = apiFor('p2', graph);
    const uncle = relation(api, 'A', 'S', graph);
    const stranger = relation(api, 'A', 'Z', graph);
    assert.equal(uncle.allowed, false);
    assert.equal(uncle.errorCode, 'E_OUT_OF_FAMILY');
    assert.match(uncle.reason, /uncle/);
    assert.equal(stranger.allowed, false);
    assert.equal(stranger.errorCode, 'E_OUT_OF_FAMILY');
    assert.match(stranger.reason, /stranger/);
    console.log(JSON.stringify({ A_to_S: uncle, A_to_Z: stranger }));
    pass('P2 uncle and stranger refused');
  }

  console.log('P3');
  {
    const graph = makeGraph();
    const api = apiFor('p3', graph);
    const sent = api.messaging.send('A', 'P', { kind: 'task', payload: { action: 'compile', number: 3 } }, graph);
    const received = api.messaging.receive('P');
    assert.equal(sent.delivered, true);
    assert.equal(sent.queued, false);
    assert.equal(received.length, 1);
    assert.deepEqual(received[0], {
      id: sent.messageId,
      from: 'A', to: 'P', kind: 'task', payload: { action: 'compile', number: 3 },
      ts: stamp(0), delivered: true,
    });
    assert.deepEqual(api.messaging.receive('P'), []);
    console.log(JSON.stringify({ sent, received }));
    pass('P3 FIFO envelope received');
  }

  console.log('P4');
  {
    const graph = makeGraph();
    const api = apiFor('p4', graph);
    graph.agents.find(agent => agent.id === 'P').state = 'evicted';
    const sent = api.messaging.send('A', 'P', { kind: 'offline-task', payload: { retry: true } }, graph);
    assert.deepEqual({ delivered: sent.delivered, queued: sent.queued }, { delivered: false, queued: true });
    graph.agents.find(agent => agent.id === 'P').state = 'live';
    const received = api.messaging.receive('P');
    assert.equal(received.length, 1);
    assert.equal(received[0].id, sent.messageId);
    assert.equal(received[0].delivered, true);
    console.log(JSON.stringify({ sent, received }));
    pass('P4 offline recipient queued then received');
  }

  console.log('P5');
  {
    const graph = makeGraph();
    const directory = path.join(root, 'p5');
    const first = createSubagents({ graph, directory, clock });
    const persisted = first.retention.persist('A');
    assert.equal(fs.existsSync(path.join(directory, 'A.json')), true);
    const freshGraph = makeGraph({ includeA: false });
    const restarted = createSubagents({ graph: freshGraph, directory, clock });
    now += 1;
    const restored = restarted.retention.restore('A');
    assert.equal(restored.restored, true);
    assert.deepEqual(
      (({ id, parentId, role, retained, state }) => ({ id, parentId, role, retained, state }))(restored.state),
      { id: 'A', parentId: 'P', role: 'worker', retained: { plan: 'build', revision: 2 }, state: 'live' },
    );
    assert.equal(freshGraph.agents.find(agent => agent.id === 'A').retained.plan, 'build');
    console.log(JSON.stringify({ persisted, restored }));
    pass('P5 persist then fresh graph restore intact');
  }

  console.log('P6');
  {
    const graph = makeGraph();
    graph.agents.find(agent => agent.id === 'A').lastActivityAt = stamp(-200);
    const api = apiFor('p6', graph);
    const evicted = api.retention.evictIdle(100);
    const onDisk = JSON.parse(fs.readFileSync(path.join(root, 'p6', 'A.json'), 'utf8'));
    const discovered = api.discovery.list();
    assert.deepEqual(evicted, { evicted: ['A'] });
    assert.equal(onDisk.agent.state, 'evicted');
    assert.equal(discovered.find(agent => agent.id === 'A').state, 'evicted');
    console.log(JSON.stringify({ evicted, onDiskState: onDisk.agent.state, discovery: discovered }));
    pass('P6 idle eviction retained on disk');
  }

  console.log('P7');
  {
    const directory = path.join(root, 'p7');
    const graph = makeGraph();
    const childSource = `
      import { createSubagents } from ${JSON.stringify(moduleUrl)};
      const graph = ${JSON.stringify(graph)};
      const api = createSubagents({ graph, directory: ${JSON.stringify(directory)} });
      const one = api.messaging.send('A', 'P', { kind: 'crash-task', payload: { n: 1 } }, graph);
      const two = api.messaging.send('A', 'P', { kind: 'crash-task', payload: { n: 2 } }, graph);
      process.send({ ready: true, pid: process.pid, one, two });
      setInterval(() => {}, 1000);
    `;
    child = spawn(process.execPath, ['--input-type=module', '--eval', childSource], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    const [message] = await waitForChildReady(child);
    assert.equal(message.ready, true);
    assert.equal(message.one.messageId, 'P:1');
    assert.equal(message.two.messageId, 'P:2');
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    const [, signal] = await exited;
    assert.equal(signal, 'SIGKILL');
    child = undefined;

    const readerSource = `
      import { createSubagents } from ${JSON.stringify(moduleUrl)};
      const graph = ${JSON.stringify(makeGraph())};
      const api = createSubagents({ graph, directory: ${JSON.stringify(directory)} });
      console.log(JSON.stringify(api.messaging.receive('P')));
    `;
    const fresh = spawnSync(process.execPath, ['--input-type=module', '--eval', readerSource], {
      encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(fresh.status, 0, fresh.stderr);
    const messages = JSON.parse(fresh.stdout);
    assert.deepEqual(messages.map(message => ({ id: message.id, payload: message.payload })), [
      { id: 'P:1', payload: { n: 1 } },
      { id: 'P:2', payload: { n: 2 } },
    ]);
    console.log(JSON.stringify({ writerPid: message.pid ?? null, signal, readerExit: fresh.status }));
    console.log(fresh.stdout.trim());
    pass('P7 SIGKILL durable FIFO restart');
  }

  console.log('P8');
  {
    const graph = makeGraph();
    const api = apiFor('p8', graph);
    const stranger = relation(api, 'P', 'Z', graph);
    const nephew = relation(api, 'S', 'A', graph);
    const sentStranger = api.messaging.send('P', 'Z', { kind: 'blocked', payload: {} }, graph);
    const sentNephew = api.messaging.send('S', 'A', { kind: 'blocked', payload: {} }, graph);
    for (const result of [stranger, nephew, sentStranger, sentNephew]) assert.equal(result.errorCode, 'E_OUT_OF_FAMILY');
    assert.match(stranger.reason, /stranger/);
    assert.match(nephew.reason, /nephew/);
    assert.equal(sentStranger.messageId, undefined);
    assert.equal(sentNephew.messageId, undefined);
    console.log(JSON.stringify({ P_to_Z: stranger, S_to_A: nephew, send_P_to_Z: sentStranger, send_S_to_A: sentNephew }));
    pass('P8 stranger and nephew refused');
  }

  console.log('P8b');
  {
    const cousinGraph = {
      agents: [
        { id: 'G', parentId: null, role: 'root', state: 'live', lastActivityAt: stamp(0) },
        { id: 'P', parentId: 'G', role: 'parent', state: 'live', lastActivityAt: stamp(0) },
        { id: 'Q', parentId: 'G', role: 'parent', state: 'live', lastActivityAt: stamp(0) },
        { id: 'A', parentId: 'P', role: 'worker', state: 'live', lastActivityAt: stamp(0) },
        { id: 'D', parentId: 'Q', role: 'worker', state: 'live', lastActivityAt: stamp(0) },
      ],
    };
    const api = apiFor('p8b', cousinGraph);
    const cousin = relation(api, 'A', 'D', cousinGraph);
    const sent = api.messaging.send('A', 'D', { kind: 'blocked', payload: { relation: 'cousin' } }, cousinGraph);
    assert.equal(cousin.errorCode, 'E_OUT_OF_FAMILY');
    assert.match(cousin.reason, /cousin/);
    assert.equal(sent.errorCode, 'E_OUT_OF_FAMILY');
    console.log(JSON.stringify({ A_to_D: cousin, send_A_to_D: sent }));
    pass('P8b cousin refused');
  }

  console.log('P9');
  {
    const freshP1 = directory => {
      const source = `
        import { createSubagents } from ${JSON.stringify(moduleUrl)};
        const graph = { agents: [
          { id: 'R', parentId: null, role: 'root', state: 'live' },
          { id: 'P', parentId: 'R', role: 'parent', state: 'live' },
          { id: 'A', parentId: 'P', role: 'worker', state: 'live' },
          { id: 'B', parentId: 'P', role: 'worker', state: 'live' },
          { id: 'C', parentId: 'P', role: 'worker', state: 'live' },
          { id: 'S', parentId: 'R', role: 'peer', state: 'live' },
          { id: 'Z', parentId: null, role: 'stranger', state: 'live' },
        ]};
        const api = createSubagents({ graph, directory: ${JSON.stringify(directory)} });
        const rules = [['A','P'],['A','B'],['A','C'],['P','A'],['P','B'],['P','C'],['P','S']]
          .map(([from,to]) => ({ from, to, ...api.family.assertInScope(from,to,graph) }));
        const discovery = api.discovery.list().map(({ lastActivityAt, ...entry }) => ({ ...entry, lastActivityAt: '<masked>' }));
        console.log(JSON.stringify({ rules, discovery }));
      `;
      const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], { encoding: 'utf8', timeout: 10_000 });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    const one = freshP1(path.join(root, 'p9-one'));
    const two = freshP1(path.join(root, 'p9-two'));
    assert.equal(one, two);
    console.log(one);
    console.log('identicalFreshP1=true timestampsMasked=true');
    pass('P9 deterministic fresh P1 results');
  }

  console.log('P10');
  {
    const graph = makeGraph();
    graph.agents.find(agent => agent.id === 'A').lastActivityAt = stamp(-200);
    const api = apiFor('p10', graph);
    assert.deepEqual(api.retention.evictIdle(100), { evicted: ['A'] });
    const listed = api.discovery.list();
    assert.equal(listed.length, 7);
    assert.deepEqual(listed.find(agent => agent.id === 'A'), {
      id: 'A', parentId: 'P', state: 'evicted', lastActivityAt: stamp(-200), role: 'worker',
    });
    assert.deepEqual(listed.find(agent => agent.id === 'P'), {
      id: 'P', parentId: 'R', state: 'live', lastActivityAt: stamp(0), role: 'parent',
    });
    assert.equal(listed.find(agent => agent.id === 'S').parentId, 'R');
    assert.equal(listed.find(agent => agent.id === 'Z').state, 'live');
    console.log(JSON.stringify(listed));
    pass('P10 discovery parent role live evicted');
  }

  console.log(`TOTAL ${passed} PASS ${passed} FAIL 0`);
} finally {
  if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  fs.rmSync(root, { recursive: true, force: true });
}
