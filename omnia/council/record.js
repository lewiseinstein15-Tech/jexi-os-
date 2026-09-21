/**
 * JEXI OS — Phase 15 Scope C — immutable decision record.
 *
 * record() freezes the full ritual (topic, participants, votes,
 * decision, tally, dissents) to <councilDir>/councils/<id>-record.json
 * and writes the decision itself into the Phase 14 decisions log
 * through its PUBLIC API (decisions.record). Idempotent: a second
 * record() returns the same decisionId.
 *   not decided yet -> E_NOT_DECIDED
 */
import fs from 'node:fs';
import path from 'node:path';
import { fail } from '../../semantica/_internal.js';
import { loadCouncil, saveCouncil } from './council.js';

export function buildRecord(council) {
  if (!council.decided) {
    throw fail('E_NOT_DECIDED', 'council ' + council.councilId + ' has not decided yet');
  }
  const tally = {};
  for (const v of council.votes) tally[v.choice] = (tally[v.choice] || 0) + 1;
  return Object.freeze({
    councilId: council.councilId,
    topic: council.topic,
    participants: council.participants.map((p) => ({ ...p })),
    votes: council.votes.map((v) => ({ ...v })),
    decision: { ...council.decision },
    tally,
    dissents: council.votes.filter((v) => v.choice !== council.decision.choice).map((v) => ({ by: v.by, rationale: v.rationale })),
  });
}

export function recordCouncil(dir, decisionsLog, councilId) {
  const council = loadCouncil(dir, councilId);
  const record = buildRecord(council);
  if (council.decisionId) return { decisionId: council.decisionId };

  const chair = council.participants.find((p) => p.role === 'chair');
  const alternatives = Object.keys(record.tally).filter((c) => c !== council.decision.choice).sort();
  const rationale = 'council ' + councilId + ' on "' + council.topic + '": ' +
    council.votes.filter((v) => v.choice === council.decision.choice).map((v) => v.by + ' (' + v.choice + '): ' + v.rationale).join(' | ') +
    (record.dissents.length ? ' | dissents: ' + record.dissents.map((d) => d.by + ': ' + d.rationale).join(' | ') : '');

  const { decisionId } = decisionsLog.record({
    subject: 'council:' + councilId + ':' + council.topic,
    chosen: council.decision.choice,
    alternatives,
    rationale,
    by: chair ? chair.by : councilId,
  });

  council.decisionId = decisionId;
  saveCouncil(dir, council);
  fs.writeFileSync(path.join(dir, 'councils', councilId + '-record.json'), JSON.stringify(record, null, 2) + '\n');
  return { decisionId };
}
