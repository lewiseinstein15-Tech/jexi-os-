/**
 * JEXI OS — Phase 23 Scope A — madtea atomic finish.
 *
 * One call runs the whole finish sequence, in this exact order:
 *
 *   commit -> push -> PR -> gates -> merge
 *
 * ATOMICITY
 * The first failure stops the sequence. Later steps never run against an
 * operation that has already failed: a gate failure aborts BEFORE merge,
 * a push failure aborts before PR, and so on. Effects of steps that DID
 * run are real and are reported honestly (a completed commit is a
 * completed commit — madtea does not rewrite history to hide it).
 *
 * SANDBOX / NETWORK POLICY
 * This harness is offline. Network steps (push, PR, merge) are refused
 * with E_NO_REMOTE naming the step — NEVER faked into success:
 *   - localOnly mode:   network steps are pre-declared skipped, each
 *     recorded in the step ledger as { ran: false, code: 'E_NO_REMOTE' };
 *     the local subset (commit, gates) runs for real. This is the only
 *     honest way to exercise the gates step offline, because gates sit
 *     after PR in the sequence.
 *   - full mode:        the first network step aborts the operation with
 *     E_NO_REMOTE (default allowNetwork: false). With allowNetwork: true
 *     a configured remote is required (E_NO_REMOTE otherwise) and git
 *     push runs for real; PR/merge still refuse E_NO_REMOTE because the
 *     forge API is not wired here (carry-forward: wire into server PR
 *     flow when CI exists).
 *
 * CREDENTIALS
 * Resolved via keyRef (env var or keyring:<ref>) — never inline
 * (E_INLINE_KEY_REFUSED). Every resolved value is registered with a
 * SecretGuard; every string leaving this module (step output, error
 * messages, abort reasons, the serialized result) is leak-checked.
 * A credential reaching any output surface aborts with E_CRED_LEAK and
 * the value is withheld — including from the error that reports it.
 *
 * Result contract:
 *   finish({ branch, message, gates }) -> {
 *     committed, pushed, prOpened, gatesPassed, merged, sha,
 *     abortedAt, errorCode, reason, steps, gateResults?
 *   }
 *   dryRun({ branch, message, gates }) -> { steps: [{ name, willRun, reason? }] }
 *
 * dryRun is a pure function of its input: no repo access, no clocks, no
 * randomness — the same props produce a byte-identical plan.
 *
 * Errors thrown (caller mistakes, before any side effect):
 *   E_INVALID_ARGUMENT    bad props shape
 *   E_INLINE_KEY_REFUSED  inline credential field in props
 *   E_INVALID_KEY_REF     keyRef matches neither env nor keyring shape
 *   E_KEYREF_UNRESOLVED   keyring reference missing from the provided keyring
 * Errors returned (operational aborts, never thrown):
 *   E_NOTHING_TO_COMMIT, E_COMMIT_FAILED, E_NO_REMOTE, E_PUSH_FAILED,
 *   E_GATE_FAILED, E_CRED_LEAK
 */

import { execFileSync } from 'node:child_process';
import { SemanticaError } from '../../../services/semantica/_internal.js';
import { runGates } from './gates.js';
import { createSecretGuard, findInlineKeys, resolveCredentials } from './credentials.js';

/** The finish sequence, in contract order. */
export const STEP_NAMES = Object.freeze(['commit', 'push', 'pr', 'gates', 'merge']);

/** Network steps per the sandbox policy — they can never be faked. */
export const NETWORK_STEPS = Object.freeze(['push', 'pr', 'merge']);

function badProps(message) {
  throw new SemanticaError('E_INVALID_ARGUMENT', message);
}

/**
 * Validate + normalize props shared by finish() and dryRun().
 * dryRun omits repoDir (it never touches the repo).
 */
function validateProps(props, { requireRepo }) {
  if (!props || typeof props !== 'object' || Array.isArray(props)) {
    badProps(`finish/dryRun props must be a plain object, got ${props === null ? 'null' : typeof props}`);
  }
  const inline = findInlineKeys(props);
  if (inline.length > 0) {
    throw new SemanticaError('E_INLINE_KEY_REFUSED', `inline credential field(s) refused: ${inline.join(', ')}; pass keyRef (env var name or keyring:<ref>) instead`);
  }
  const { repoDir, branch, message, gates, remote = 'origin', localOnly = false, allowNetwork = false, keyRef, keyring } = props;

  if (requireRepo && (typeof repoDir !== 'string' || repoDir.trim() === '')) {
    badProps(`repoDir must be a non-empty string (the git work tree to finish), got ${JSON.stringify(repoDir)}`);
  }
  if (typeof branch !== 'string' || branch.trim() === '') {
    badProps(`branch must be a non-empty string, got ${JSON.stringify(branch)}`);
  }
  if (/\s/.test(branch)) {
    badProps(`branch must not contain whitespace, got ${JSON.stringify(branch)}`);
  }
  if (typeof message !== 'string' || message.trim() === '') {
    badProps(`message must be a non-empty string, got ${JSON.stringify(message)}`);
  }
  if (gates !== undefined && !Array.isArray(gates)) {
    badProps(`gates must be an array of { name, cmd | check }, got ${typeof gates}`);
  }
  if (typeof remote !== 'string' || remote.trim() === '') {
    badProps(`remote must be a non-empty string, got ${JSON.stringify(remote)}`);
  }
  if (typeof localOnly !== 'boolean' || typeof allowNetwork !== 'boolean') {
    badProps('localOnly and allowNetwork must be booleans');
  }
  return { repoDir, branch, message, gates: gates || [], remote, localOnly, allowNetwork, keyRef, keyring };
}

/** Real git invocation. stdout+stderr combined; never throws. */
function git(args, cwd) {
  try {
    const out = execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    return { ok: true, out: String(out), err: '' };
  } catch (e) {
    const err = `${e.stdout || ''}${e.stderr || ''}` || (e.message ? `git spawn error: ${e.message}` : 'git failed');
    return { ok: false, out: '', err: String(err) };
  }
}

/** Leak-check then redact: the only way text enters a message or result. */
function clean(text, where, guard) {
  guard.assertClean(text, where);
  return guard.redact(text);
}

/** Build the SecretGuard from the operation's resolved credential(s). */
function buildGuard({ keyRef, keyring }) {
  const resolved = resolveCredentials({ keyRef, keyring });
  return createSecretGuard(resolved.found ? [resolved.value] : []);
}

/** commit step — REAL git operations in repoDir. */
function stepCommit({ repoDir, branch, message, guard }) {
  const pre = git(['rev-parse', '--is-inside-work-tree'], repoDir);
  if (!pre.ok) {
    throw new SemanticaError('E_COMMIT_FAILED', clean(`commit: ${repoDir} is not a git work tree: ${pre.err.trim()}`, 'git output', guard));
  }
  const branchExists = git(['rev-parse', '--verify', `refs/heads/${branch}`], repoDir).ok;
  const co = branchExists ? git(['checkout', branch], repoDir) : git(['checkout', '-b', branch], repoDir);
  if (!co.ok) {
    throw new SemanticaError('E_COMMIT_FAILED', clean(`commit: git checkout ${branch} failed: ${co.err.trim()}`, 'git checkout output', guard));
  }
  const add = git(['add', '-A'], repoDir);
  if (!add.ok) {
    throw new SemanticaError('E_COMMIT_FAILED', clean(`commit: git add -A failed: ${add.err.trim()}`, 'git add output', guard));
  }
  // `git diff --cached --quiet` exits 0 when NOTHING is staged.
  const staged = git(['diff', '--cached', '--quiet'], repoDir);
  if (staged.ok) {
    throw new SemanticaError('E_NOTHING_TO_COMMIT', 'commit: nothing to commit (working tree clean after staging)');
  }
  const cm = git(['commit', '-m', message], repoDir);
  if (!cm.ok) {
    throw new SemanticaError('E_COMMIT_FAILED', clean(`commit: git commit failed: ${cm.err.trim()}`, 'git commit output', guard));
  }
  const shaOut = git(['rev-parse', 'HEAD'], repoDir);
  if (!shaOut.ok) {
    throw new SemanticaError('E_COMMIT_FAILED', clean(`commit: git rev-parse HEAD failed: ${shaOut.err.trim()}`, 'git rev-parse output', guard));
  }
  return { sha: shaOut.out.trim() };
}

/**
 * Network steps under the sandbox policy. In this offline harness push can
 * only run with allowNetwork + a configured remote (a real git push); PR and
 * merge need the forge API, which is not wired here (carry-forward), so they
 * refuse with E_NO_REMOTE — refused, never faked.
 */
function runNetworkStep(step, { repoDir, branch, remote, allowNetwork, guard }) {
  if (!allowNetwork) {
    throw new SemanticaError('E_NO_REMOTE', `${step}: network disabled in sandbox — no remote access granted`);
  }
  const hasRemote = git(['remote', 'get-url', remote], repoDir);
  if (!hasRemote.ok) {
    throw new SemanticaError('E_NO_REMOTE', `${step}: no remote "${remote}" configured in ${repoDir}`);
  }
  if (step === 'push') {
    const push = git(['push', '-u', remote, branch], repoDir);
    if (!push.ok) {
      throw new SemanticaError('E_PUSH_FAILED', clean(`push: git push failed: ${push.err.trim()}`, 'git push output', guard));
    }
    return;
  }
  throw new SemanticaError('E_NO_REMOTE', `${step}: forge API calls are not wired in this offline harness — refused, never faked`);
}

const SKIP_NETWORK = 'skipped: localOnly mode (network step)';
const LOCAL_ONLY_DONE = 'localOnly sequence completed; network steps skipped (push, pr, merge — E_NO_REMOTE in sandbox)';

/** Assemble + leak-check a result. Belt and braces: the serialized result is checked too. */
function assemble({ state, ledger, abortedAt, errorCode, reason, guard, gateResults }) {
  const result = { ...state, abortedAt, errorCode, reason, steps: ledger };
  if (gateResults !== undefined) result.gateResults = gateResults;
  try {
    guard.assertClean(JSON.stringify(result), 'finish result');
  } catch {
    // A secret reached the result despite per-step checks. Return a minimal
    // safe shape: no ledger, no gate output, value withheld everywhere.
    return {
      committed: Boolean(state.committed), pushed: false, prOpened: false,
      gatesPassed: null, merged: false, sha: null,
      abortedAt, errorCode: 'E_CRED_LEAK',
      reason: 'credential leak detected while assembling the finish result (value withheld)',
      steps: [],
    };
  }
  return result;
}

/** Operational abort (SemanticaError from a step). Never throws. */
function abort({ state, ledger, step, error, guard, gateResults }) {
  return assemble({
    state, ledger, abortedAt: step,
    errorCode: error.code || 'E_UNEXPECTED',
    reason: guard.redact(error.message || String(error)),
    guard, gateResults,
  });
}

/**
 * Run the atomic finish sequence. Operational failures are RETURNED as
 * abort results (abortedAt + errorCode + reason); caller mistakes (bad
 * props, inline credentials, unresolved keyRef) throw before any effect.
 */
export function finish(props) {
  const { repoDir, branch, message, gates, remote, localOnly, allowNetwork, keyRef, keyring } =
    validateProps(props, { requireRepo: true });
  const guard = buildGuard({ keyRef, keyring });

  // A credential must not ride in on the inputs either.
  guard.assertClean(branch, 'branch name');
  guard.assertClean(message, 'commit message');

  const ledger = [];
  const state = { committed: false, pushed: false, prOpened: false, gatesPassed: null, merged: false, sha: null };

  // --- commit (always real) -------------------------------------------------
  try {
    const { sha } = stepCommit({ repoDir, branch, message, guard });
    state.committed = true;
    state.sha = sha;
    ledger.push({ name: 'commit', ran: true, ok: true });
  } catch (e) {
    return abort({ state, ledger, step: 'commit', error: e, guard });
  }

  // --- push, pr (network steps, in order) -----------------------------------
  for (const step of ['push', 'pr']) {
    if (localOnly) {
      ledger.push({ name: step, ran: false, ok: false, code: 'E_NO_REMOTE', reason: SKIP_NETWORK });
      continue;
    }
    try {
      runNetworkStep(step, { repoDir, branch, remote, allowNetwork, guard });
      if (step === 'push') state.pushed = true; else state.prOpened = true;
      ledger.push({ name: step, ran: true, ok: true });
    } catch (e) {
      return abort({ state, ledger, step, error: e, guard });
    }
  }

  // --- gates (local; the only quality gate reachable offline) ----------------
  let gateResults;
  if (gates.length > 0) {
    let outcome;
    try {
      outcome = runGates(gates, { cwd: repoDir, guard });
    } catch (e) {
      return abort({ state, ledger, step: 'gates', error: e, guard });
    }
    gateResults = outcome.results;
    state.gatesPassed = outcome.passed;
    ledger.push({ name: 'gates', ran: true, ok: outcome.passed, ...(outcome.failed ? { reason: `gate failed: ${outcome.failed}` } : {}) });
    if (!outcome.passed) {
      // Contract: { merged: false, gatesPassed: false, reason: '<gate name>' }
      return assemble({ state, ledger, abortedAt: 'gates', errorCode: 'E_GATE_FAILED', reason: outcome.failed, guard, gateResults });
    }
  } else {
    ledger.push({ name: 'gates', ran: false, ok: null, reason: 'no gates configured' });
  }

  // --- merge (network step) ---------------------------------------------------
  if (localOnly) {
    ledger.push({ name: 'merge', ran: false, ok: false, code: 'E_NO_REMOTE', reason: SKIP_NETWORK });
    return assemble({ state, ledger, abortedAt: null, errorCode: null, reason: LOCAL_ONLY_DONE, guard, gateResults });
  }
  try {
    runNetworkStep('merge', { repoDir, branch, remote, allowNetwork, guard });
    state.merged = true;
    ledger.push({ name: 'merge', ran: true, ok: true });
    return assemble({ state, ledger, abortedAt: null, errorCode: null, reason: null, guard, gateResults });
  } catch (e) {
    return abort({ state, ledger, step: 'merge', error: e, guard, gateResults });
  }
}

/**
 * The exact sequence a given props bag would run — without executing
 * anything. Pure function of its input: byte-identical output for
 * byte-identical props, no repo access, no side effects.
 */
export function dryRun(props) {
  const { gates, localOnly } = validateProps(props, { requireRepo: false });
  const hasGates = gates.length > 0;
  const steps = STEP_NAMES.map((name) => {
    if (name === 'gates') {
      return hasGates
        ? { name, willRun: true }
        : { name, willRun: false, reason: 'no gates configured' };
    }
    if (NETWORK_STEPS.includes(name) && localOnly) {
      return { name, willRun: false, reason: 'skipped: localOnly mode (network step)' };
    }
    return { name, willRun: true };
  });
  return { steps };
}
