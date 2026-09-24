/**
 * JEXI OS — Phase 19 Scope D — two-host script generation.
 *
 * Contract:
 *   podcast.script(docs, { hosts, minutes }) -> {
 *     hosts, minutes, label, segments[], totalTurns
 *   }
 *
 * SurfSense research note: the Studio pipeline validates the podcast brief
 * before a job runs and maps a duration preset to a minutes target
 * (brief.py MINUTES {short: 3, standard: 8, long: 15}). Here the caller
 * passes the minutes target directly; ~TURNS_PER_MINUTE (4) turns per minute
 * drives the turn budget: intro (2) + outro (2) fixed, main = rest (kept
 * even — dialogue is composed in host pairs). A 5-minute target -> 20 turns,
 * 10 minutes -> 40 turns.
 *
 * Errors (SurfError, reused from surfsense/connectors/_internal.js):
 *   E_MISSING_HOSTS   — hosts is not an array of non-empty string names
 *                       (missing, null, non-array, or invalid entries)
 *   E_TOO_FEW_HOSTS   — hosts array has fewer than 2 entries (two-host
 *                       minimum; more than 2 is allowed and rotates)
 *   E_INVALID_MINUTES — minutes missing or not a positive finite number
 *   E_INVALID_DOC     — bad document shape (Scope B public validateDocs,
 *                       reused via surfsense/search/keyword.js — same
 *                       {id, text} contract as search and output layers)
 *
 * Empty docs -> empty script (segments: [], totalTurns: 0), not an error.
 * Determinism: pure function of (docs, hosts, minutes) — same inputs give
 * byte-identical scripts. Truthfulness: rule-based composition only, labeled
 * "rule-based — LLM generation NOT VERIFIED"; every factual statement is
 * quoted or derived from a cited doc id (turn.cites), no invented facts.
 */
import { SurfError } from '../connectors/_internal.js';
import { validateDocs } from '../search/keyword.js';
import { buildSegments } from './segment.js';

/** Truthfulness label carried on every script and rendered on transcripts. */
export const LABEL = 'rule-based — LLM generation NOT VERIFIED';

/** Turn budget density: ~4 turns per minute of target runtime. */
export const TURNS_PER_MINUTE = 4;

/**
 * Validate the hosts option: required array of >= 2 non-empty string names.
 * Non-array / missing / invalid entries -> E_MISSING_HOSTS; length < 2 ->
 * E_TOO_FEW_HOSTS. Returns the hosts array on success.
 */
export function assertHosts(hosts) {
  if (!Array.isArray(hosts)) {
    throw new SurfError(
      'E_MISSING_HOSTS',
      `hosts must be an array of at least 2 non-empty string names, received ${
        hosts === null ? 'null' : typeof hosts
      }`
    );
  }
  if (hosts.some((h) => typeof h !== 'string' || h.trim().length === 0)) {
    throw new SurfError('E_MISSING_HOSTS', 'hosts must contain only non-empty string names');
  }
  if (hosts.length < 2) {
    throw new SurfError(
      'E_TOO_FEW_HOSTS',
      `a two-host conversation needs at least 2 hosts, received ${hosts.length}`
    );
  }
  return hosts;
}

/**
 * Validate the minutes option: positive finite number (missing / non-number /
 * <= 0 / NaN / Infinity -> E_INVALID_MINUTES). Returns minutes on success.
 */
export function assertMinutes(minutes) {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) {
    throw new SurfError(
      'E_INVALID_MINUTES',
      `minutes must be a positive finite number, received ${String(minutes)}`
    );
  }
  return minutes;
}

/**
 * podcast.script(docs, { hosts, minutes }) -> script object.
 * segments = [intro, main, outro]; each segment { name, turns[] }; each turn
 * { speaker, text, cites } with cites = cited doc ids. Speakers rotate by
 * global turn index (hosts[t % hosts.length]) — 2+ hosts supported.
 */
export function script(docs, { hosts, minutes } = {}) {
  assertHosts(hosts);
  assertMinutes(minutes);
  validateDocs(docs);

  if (docs.length === 0) {
    return { hosts: [...hosts], minutes, label: LABEL, segments: [], totalTurns: 0 };
  }

  // Turn budget: total target from minutes, minus fixed intro+outro, kept
  // even (main composes in host pairs).
  let mainTurns = Math.max(0, Math.round(minutes * TURNS_PER_MINUTE) - 4);
  mainTurns -= mainTurns % 2;

  const segments = buildSegments(docs, hosts, mainTurns);
  const totalTurns = segments.reduce((n, s) => n + s.turns.length, 0);
  return { hosts: [...hosts], minutes, label: LABEL, segments, totalTurns };
}
