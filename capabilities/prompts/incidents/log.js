// prompt/incidents/log.js
// Phase 25 — Scope H: append-only incident store (NDJSON).
//
// Every production failure can become a permanent defense — but only if the
// failure is CAPTURED first. This module is the capture layer: a strictly
// append-only NDJSON event log under .jexi/incidents/ (covered by the
// existing `.jexi/` gitignore rule). No simulation, no in-memory shim: real
// NDJSON on real disk, one JSON event per line.
//
// Event types (seq = 1-based line order, assigned at append time):
//   { seq, type:'incident',  id:'INC-0001', recordedAt, trigger, context,
//     failure, fix, recurrenceOf }                     — a captured failure
//   { seq, type:'promotion', id:'RULE-0001', promotedAt, incidentId,
//     rule:{ when, do, because, incidentId }, active:true,
//     method:'rule-based - LLM promotion NOT VERIFIED',
//     supersedes:['RULE-0000', ...] }                  — incident -> rule
//   { seq, type:'revoke',    at, ruleId, reason }      — kill switch for a
//                                                        rule (an EVENT,
//                                                        never a deletion)
//
// Scope H rules implemented here:
//   RULE 1  no orphan rules — a promotion event is only ever written FROM a
//           recorded incident and carries that incident's id.
//   RULE 2  append-only — nothing is rewritten or deleted; revocation and
//           supersession are EVENTS; current state is derived by replay.
//   RULE 6  storage at .jexi/incidents/; override with env JEXI_INCIDENTS_ROOT
//           for probes/tests (read at CALL time, like memory-fs's store root).
//   RULE 7  determinism — ids are POSITIONAL (count of prior events of that
//           kind + 1, zero-padded), so the same input sequence yields the same
//           ids and the same log; only timestamps vary (masked in comparisons).
//
// Zone discipline: prompt/incidents defines its own codes (INCIDENT_CODES).
// prompt/assembly is READ-ONLY for this scope.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
// log.js lives at <projectRoot>/prompt/incidents/log.js
export const PROJECT_ROOT = path.resolve(MODULE_DIR, '..', '..');

/** Machine-readable codes for the incidents zone (Scope H). */
export const INCIDENT_CODES = Object.freeze({
  INVALID_INCIDENT: 'E_INVALID_INCIDENT',
  VAGUE_TRIGGER: 'E_VAGUE_TRIGGER',
  VAGUE_FIX: 'E_VAGUE_FIX',
  NO_SUCH_INCIDENT: 'E_NO_SUCH_INCIDENT',
  NO_SUCH_RULE: 'E_NO_SUCH_RULE',
  INVALID_SECTIONS: 'E_INVALID_SECTIONS',
  INVALID_INJECT_OPTS: 'E_INVALID_INJECT_OPTS',
});

/** Provenance label required on every promotion (PROMOTION HEURISTIC). */
export const RULE_METHOD = 'rule-based - LLM promotion NOT VERIFIED';

/** Store root. Read at CALL time (probe isolation via env, like memory-fs). */
export function incidentsRoot() {
  const override = process.env.JEXI_INCIDENTS_ROOT;
  if (typeof override === 'string' && override.trim() !== '') {
    return path.resolve(override);
  }
  return path.join(PROJECT_ROOT, '.jexi', 'incidents');
}

/** The one append-only NDJSON file. */
export function logPath() {
  return path.join(incidentsRoot(), 'log.ndjson');
}

/**
 * Identity key for recurrence detection (RULE 3): two records with the same
 * trigger key are the SAME incident recurring; a different fix then
 * supersedes the old rule at promote time.
 */
export function triggerKey(trigger) {
  return String(trigger).trim().toLowerCase().replace(/\s+/g, ' ');
}

function readRawLines() {
  let raw = '';
  try {
    raw = fs.readFileSync(logPath(), 'utf8');
  } catch {
    return { raw: '', lines: [], lineCount: 0 }; // missing log = empty store
  }
  const lines = raw.split('\n').filter((l) => l.trim() !== '');
  return { raw, lines, lineCount: lines.length };
}

/** Parse the full event log. Probes assert parseErrors stays empty. */
export function readEvents() {
  const { raw, lines } = readRawLines();
  const events = [];
  const parseErrors = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      events.push(JSON.parse(lines[i]));
    } catch (e) {
      parseErrors.push({ line: i + 1, error: String((e && e.message) || e) });
    }
  }
  return { events, parseErrors, lineCount: lines.length, raw };
}

/** Append ONE event; seq is derived from the current line count. */
export function appendEvent(evt) {
  const { lineCount } = readRawLines();
  const withSeq = { seq: lineCount + 1, ...evt };
  fs.mkdirSync(incidentsRoot(), { recursive: true });
  fs.appendFileSync(logPath(), JSON.stringify(withSeq) + '\n', 'utf8');
  return withSeq;
}

/**
 * Replay the log into derived state:
 *   incidents — Map id -> incident event
 *   rules     — promotion events in log order with supersession/revocation
 *               applied as flags (nothing deleted — RULE 2)
 */
export function computeState(events) {
  const incidents = new Map();
  const rules = [];
  for (const evt of events) {
    if (!evt || typeof evt !== 'object') continue;
    if (evt.type === 'incident') {
      incidents.set(evt.id, evt);
    } else if (evt.type === 'promotion') {
      rules.push({
        ruleId: evt.id,
        incidentId: evt.incidentId,
        when: evt.rule.when,
        do: evt.rule.do,
        because: evt.rule.because,
        ruleIncidentId: evt.rule.incidentId,
        promotedAt: evt.promotedAt,
        method: evt.method,
        supersedes: Array.isArray(evt.supersedes) ? [...evt.supersedes] : [],
        supersededBy: null,
        revoked: false,
        revokedAt: null,
        revokedReason: null,
      });
    } else if (evt.type === 'revoke') {
      const r = rules.find((x) => x.ruleId === evt.ruleId);
      if (r) {
        r.revoked = true;
        r.revokedAt = evt.at ?? null;
        r.revokedReason = evt.reason ?? null;
      }
    }
  }
  // RULE 3 — a promotion event naming older rule ids marks them superseded.
  // Applied after collection so event order inside the log is irrelevant.
  for (const evt of events) {
    if (evt && evt.type === 'promotion' && Array.isArray(evt.supersedes)) {
      for (const sid of evt.supersedes) {
        const r = rules.find((x) => x.ruleId === sid);
        if (r && r.supersededBy === null) r.supersededBy = evt.id;
      }
    }
  }
  return { incidents, rules };
}

/** A rule is active unless superseded by a newer rule or explicitly revoked. */
export function isActiveRule(rule) {
  return rule.supersededBy === null && rule.revoked === false;
}

function invalidIncident(reason) {
  return {
    id: null,
    recordedAt: null,
    reason,
    errorCode: INCIDENT_CODES.INVALID_INCIDENT,
  };
}

/**
 * incidents.record(incident) -> { id, recordedAt }
 *   incident = { trigger, context, failure, fix } — all non-empty strings.
 * Recording is raw capture: every well-formed incident is stored (vagueness
 * is gated at PROMOTION time, not capture time). recurrenceOf links a
 * re-recorded trigger to the latest prior record with the same trigger key.
 */
export function record(incident) {
  if (!incident || typeof incident !== 'object' || Array.isArray(incident)) {
    return invalidIncident('incident must be a plain object');
  }
  for (const f of ['trigger', 'context', 'failure', 'fix']) {
    const v = incident[f];
    if (typeof v !== 'string' || v.trim() === '') {
      return invalidIncident(`incident.${f} must be a non-empty string`);
    }
  }
  const { events } = readEvents();
  const state = computeState(events);
  const key = triggerKey(incident.trigger);
  let recurrenceOf = null;
  for (const evt of events) {
    if (evt && evt.type === 'incident' && triggerKey(evt.trigger) === key) {
      recurrenceOf = evt.id; // keep the LATEST prior match
    }
  }
  const id = `INC-${String(state.incidents.size + 1).padStart(4, '0')}`;
  const recordedAt = new Date().toISOString();
  appendEvent({
    type: 'incident',
    id,
    recordedAt,
    trigger: incident.trigger.trim(),
    context: incident.context.trim(),
    failure: incident.failure.trim(),
    fix: incident.fix.trim(),
    recurrenceOf,
  });
  return { id, recordedAt };
}

/** incidents.get(id) -> incident event | null */
export function getIncident(id) {
  const { events } = readEvents();
  for (const evt of events) {
    if (evt && evt.type === 'incident' && evt.id === id) return evt;
  }
  return null;
}

/** incidents.list() -> all incident events in log order. */
export function listIncidents() {
  const { events } = readEvents();
  return events.filter((e) => e && e.type === 'incident');
}
