/**
 * JEXI OS — Phase 15 Scope C — per-agent vote capture.
 *
 * Votes are captured in arrival order onto the council record.
 *   non-participant     -> E_UNKNOWN_VOTER
 *   missing rationale   -> E_MISSING_RATIONALE
 *   empty choice        -> E_INVALID_VOTE
 *   duplicate vote      -> E_ALREADY_VOTED
 */
import { fail, assertNonEmptyString } from '../../semantica/_internal.js';

export function captureVote(council, { by, choice, rationale }) {
  assertNonEmptyString(by, 'vote by', 'E_INVALID_VOTE');
  const participant = council.participants.find((p) => p.by === by);
  if (!participant) {
    throw fail('E_UNKNOWN_VOTER', 'voter ' + JSON.stringify(by) + ' is not a declared participant of ' + council.councilId);
  }
  assertNonEmptyString(choice, 'vote choice', 'E_INVALID_VOTE');
  if (rationale === undefined || rationale === null || typeof rationale !== 'string' || rationale.trim() === '') {
    throw fail('E_MISSING_RATIONALE', 'vote by ' + by + ' has no rationale');
  }
  if (council.votes.some((v) => v.by === by)) {
    throw fail('E_ALREADY_VOTED', 'voter ' + by + ' already voted in ' + council.councilId);
  }
  const vote = Object.freeze({ by, role: participant.role, choice, rationale });
  council.votes.push(vote);
  return { recorded: true, by, choice };
}
