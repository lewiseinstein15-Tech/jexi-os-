#!/usr/bin/env node
/**
 * B211 B4 — restart-child: the process that gets killed.
 * Usage: node restart-child.mjs <dataDir> <create|resume>
 *
 * create: boots a MissionRunner, creates a 2-item mission (item 2 depends on
 * item 1). Item 1's session answers immediately; item 2's session BLOCKS on a
 * gate file — so the parent can SIGKILL us exactly while item 2 is mid-flight.
 *
 * resume: boots a fresh process (nothing in memory), calls resumeOnBoot() —
 * the persisted mission + work graph must reconstruct, the in-flight item
 * must requeue, and (gate file now present) the mission must finish.
 */

const dataDir = process.argv[2];
const mode = process.argv[3] || 'create';
if (!dataDir) { console.error('usage: restart-child.mjs <dataDir> <create|resume>'); process.exit(2); }
process.env.DATA_DIR = dataDir;

const fs = (await import('node:fs')).default;
const path = (await import('node:path')).default;

const { MissionRunner } = await import('../../src/services/director/MissionRunner.js');
const { loadMission } = await import('../../src/services/director/Mission.js');

const GATE = path.join(dataDir, 'gate.done');
const EVENTS = path.join(dataDir, 'events.jsonl');
const SESSIONS = path.join(dataDir, 'sessions.jsonl');
const FINAL = path.join(dataDir, 'final.json');

const out = (d) => `## DELIVERABLE\n${d}\n## REPORT\nDelivered from real work, grounded in what actually ran.\n## CONFIDENCE\nhigh`;
const LONG = 'A complete, substantial deliverable covering the objective end to end with findings, reasoning and concrete results the verifier can check against the success criteria.';

let sessionCalls = 0;
const llm = {
  async employee({ system } = {}) {
    const sys = String(system || '');
    if (/MISSION COMPLEXITY/.test(sys)) return JSON.stringify({ complexity: 'SIMPLE', risk: 'LOW', reasons: ['x'] });
    if (/PERSISTENT MISSION/.test(sys)) return JSON.stringify({
      refinedObjective: 'do the restart-surviving work', assumptions: [], constraints: [],
      successCriteria: ['both parts done'],
      items: [
        { title: 'First part', details: 'Do the first part.', capability: 'reasoning', requirements: [], dependsOn: [], searchQueries: [], expectedOutput: 'done', priority: 'normal' },
        { title: 'Second part (depends on the first)', details: 'Do the second part.', capability: 'reasoning', requirements: [], dependsOn: [1], searchQueries: [], expectedOutput: 'done', priority: 'normal' },
      ],
    });
    if (/Part of a persistent mission failed/.test(sys)) return JSON.stringify({ refinedObjective: 'x', items: [] });
    if (/Mid-mission steering/.test(sys)) return JSON.stringify({ affectedItemIds: [], newItems: [], rationale: 'none' });
    sessionCalls += 1;
    fs.appendFileSync(SESSIONS, `${JSON.stringify({ call: sessionCalls, at: Date.now(), mode })}\n`);
    if (sessionCalls === 2) {
      // item 2: block until the gate file exists (the parent controls this)
      const t0 = Date.now();
      while (!fs.existsSync(GATE)) {
        if (Date.now() - t0 > 45000) throw new Error('gate timeout');
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    return out(LONG);
  },
  async verify() { return JSON.stringify({ pass: true, score: 1.0, problems: [], rationale: 'ok' }); },
  async interpret() { return null; },
  async report() { return 'report'; },
};

const runner = new MissionRunner();
runner.configure({ llm, tools: { search: async () => 'none' } });

if (mode === 'create') {
  const mission = runner.create({ conversationId: 'restart-cv', objective: 'Do the restart-surviving work', rawRequest: 'Do the restart-surviving work' });
  fs.writeFileSync(path.join(dataDir, 'mission-id.txt'), mission.id);
  runner.subscribe(mission.id, (evt) => {
    try { fs.appendFileSync(EVENTS, `${JSON.stringify({ type: evt.type, itemId: evt.data?.itemId || null, summary: String(evt.summary || '').slice(0, 120), mode })}\n`); } catch { /* never block */ }
  });
  // stay alive: the gated session keeps the loop pending; when the mission
  // finishes (gate present), write the final marker and exit.
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    const m = loadMission(mission.id);
    if (m && m.isTerminal) {
      fs.writeFileSync(FINAL, JSON.stringify({ state: m.state, id: mission.id, mode }));
      process.exit(0);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  fs.writeFileSync(FINAL, JSON.stringify({ state: 'TIMEOUT', id: mission.id, mode }));
  process.exit(1);
}

// resume mode: fresh process — only persisted state exists
const resumed = runner.resumeOnBoot();
fs.appendFileSync(EVENTS, `${JSON.stringify({ type: 'CHILD_RESUME_BOOT', resumed, mode })}\n`);
const t0 = Date.now();
while (Date.now() - t0 < 60000) {
  for (const id of fs.readdirSync(path.join(dataDir, 'missions')).filter((d) => d.startsWith('ms-'))) {
    try {
      const m = loadMission(id);
      if (m && m.isTerminal) {
        fs.writeFileSync(FINAL, JSON.stringify({ state: m.state, id, mode }));
        process.exit(0);
      }
    } catch { /* not a mission dir */ }
  }
  await new Promise((r) => setTimeout(r, 100));
}
fs.writeFileSync(FINAL, JSON.stringify({ state: 'TIMEOUT', mode }));
process.exit(1);
