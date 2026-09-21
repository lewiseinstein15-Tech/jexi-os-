/**
 * JEXI OS — Phase 15 Scope B — persistent war-room.
 *
 * A room is a directory: <relayDir>/rooms/<id>/ with participants.json
 * and an append-only messages.jsonl (one { seq, by, text } per line).
 * Messages are never rewritten; reloading the room replays the file
 * in order, so persistence is trivially deterministic.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fail, assertNonEmptyString } from '../../semantica/_internal.js';

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

const roomDir = (dir, id) => {
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw fail('E_BAD_ROOM_ID', 'room id must match ' + ID_RE + ', got ' + JSON.stringify(id));
  }
  return path.join(dir, 'rooms', id);
};

export function ensureRoom(dir, id) {
  const rd = roomDir(dir, id);
  fs.mkdirSync(rd, { recursive: true });
  const pj = path.join(rd, 'participants.json');
  if (!fs.existsSync(pj)) fs.writeFileSync(pj, '[]\n');
  return rd;
}

export function readRoom(dir, id) {
  const rd = ensureRoom(dir, id);
  const participants = JSON.parse(fs.readFileSync(path.join(rd, 'participants.json'), 'utf8'));
  const mf = path.join(rd, 'messages.jsonl');
  const messages = fs.existsSync(mf)
    ? fs.readFileSync(mf, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l))
    : [];
  return { id, participants, messages };
}

export function joinRoom(dir, id, participant) {
  assertNonEmptyString(participant, 'participant', 'E_INVALID_ARGUMENT');
  const rd = ensureRoom(dir, id);
  const pj = path.join(rd, 'participants.json');
  const list = JSON.parse(fs.readFileSync(pj, 'utf8'));
  if (!list.includes(participant)) {
    list.push(participant);
    fs.writeFileSync(pj, JSON.stringify(list) + '\n');
  }
  return { id, participants: list };
}

export function postMessage(dir, id, { by, text }) {
  assertNonEmptyString(by, 'message by', 'E_INVALID_ARGUMENT');
  assertNonEmptyString(text, 'message text', 'E_INVALID_ARGUMENT');
  const rd = ensureRoom(dir, id);
  const mf = path.join(rd, 'messages.jsonl');
  let seq = 0;
  if (fs.existsSync(mf)) {
    seq = fs.readFileSync(mf, 'utf8').split('\n').filter((l) => l.trim() !== '').length;
  }
  seq += 1;
  fs.appendFileSync(mf, JSON.stringify({ seq, by, text }) + '\n');
  return { seq };
}
