/**
 * JEXI OS — Phase 15 Scope C — convene / deliberate / decide.
 *
 * Councils live on disk at <councilDir>/councils/<councilId>.json.
 * Ids are a monotonic counter (council-seq.txt) — no clocks.
 *   quorum = strict majority of participants: floor(n/2) + 1
 *   decision = choice with the most votes; ties break in favor of
 *              the chair's choice when the chair voted, otherwise
 *              alphabetically first choice (deterministic).
 *   dissents = every vote against the decided choice [{ by, rationale }]
 *   decide twice          -> E_ALREADY_DECIDED
 *   below quorum          -> E_NO_QUORUM
 */
import fs from 'node:fs';
import path from 'node:path';
import { fail, assertNonEmptyString } from '../../semantica/_internal.js';
import { assertRole } from './roles.js';

const councilsDir = (dir) => path.join(dir, 'councils');
const fileOf = (dir, councilId) => path.join(councilsDir(dir), councilId + '.json');

function nextSeq(dir, name) {
  let seq = 0;
  const p = path.join(dir, name + '-seq.txt');
  try { seq = parseInt(fs.readFileSync(p, 'utf8'), 10) || 0; } catch { seq = 0; }
  seq += 1;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, String(seq));
  return seq;
}

export function saveCouncil(dir, council) {
  fs.mkdirSync(councilsDir(dir), { recursive: true });
  fs.writeFileSync(fileOf(dir, council.councilId), JSON.stringify(council, null, 2) + '\n');
  return council;
}

export function loadCouncil(dir, councilId) {
  const p = fileOf(dir, councilId);
  if (typeof councilId !== 'string' || !fs.existsSync(p)) {
    throw fail('E_UNKNOWN_COUNCIL', 'unknown councilId: ' + JSON.stringify(councilId));
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function convene(dir, { topic, roles }) {
  assertNonEmptyString(topic, 'council topic', 'E_INVALID_COUNCIL');
  if (!Array.isArray(roles) || roles.length === 0) {
    throw fail('E_INVALID_COUNCIL', 'council roles must be a non-empty array of { by, role }');
  }
  const participants = [];
  for (const r of roles) {
    if (!r || typeof r !== 'object') throw fail('E_INVALID_COUNCIL', 'each role entry must be { by, role }');
    assertNonEmptyString(r.by, 'participant by', 'E_INVALID_COUNCIL');
    assertRole(r.role);
    if (participants.some((p) => p.by === r.by)) {
      throw fail('E_DUPLICATE_PARTICIPANT', 'participant ' + r.by + ' declared twice');
    }
    participants.push({ by: r.by, role: r.role });
  }
  const councilId = 'council-' + String(nextSeq(dir, 'council')).padStart(3, '0');
  const council = { councilId, topic, participants, votes: [], decided: false, decision: null, decisionId: null };
  saveCouncil(dir, council);
  return { councilId, participants };
}

export function decide(dir, councilId) {
  const council = loadCouncil(dir, councilId);
  if (council.decided) {
    throw fail('E_ALREADY_DECIDED', 'council ' + councilId + ' already decided: ' + JSON.stringify(council.decision.choice));
  }
  const quorum = Math.floor(council.participants.length / 2) + 1;
  if (council.votes.length < quorum) {
    throw fail('E_NO_QUORUM', 'council ' + councilId + ' has ' + council.votes.length + ' votes, quorum is ' + quorum);
  }
  const tally = {};
  for (const v of council.votes) tally[v.choice] = (tally[v.choice] || 0) + 1;
  const choices = Object.keys(tally).sort();
  const max = Math.max(...choices.map((c) => tally[c]));
  const tied = choices.filter((c) => tally[c] === max);
  let choice = tied[0];
  if (tied.length > 1) {
    const chair = council.participants.find((p) => p.role === 'chair');
    const chairVote = chair ? council.votes.find((v) => v.by === chair.by) : null;
    if (chairVote && tied.includes(chairVote.choice)) choice = chairVote.choice;
  }
  const dissents = council.votes.filter((v) => v.choice !== choice).map((v) => ({ by: v.by, rationale: v.rationale }));
  const decision = { choice, quorum, votesCast: council.votes.length };
  council.decided = true;
  council.decision = decision;
  saveCouncil(dir, council);
  return { decision, tally, dissents };
}
