/**
 * JEXI-002 — reading a test tool's verdict.
 *
 * A test tool can "succeed" at the transport level and still report a red
 * suite: `pytest_run` returns ok:true with result.status:'fail' when tests
 * fail. Treating transport success as a passing suite is how an unverified
 * turn gets reported as a success.
 *
 * This lives outside CodingLoop on purpose — JEXI-016 requires the loop to
 * stay a small, separable unit.
 */

/** Verdict strings that mean "the suite is not green". */
export function isFailingVerdict(status) {
  if (status === undefined || status === null) return false;
  return /^(fail|error|red|timeout)/.test(String(status));
}

/**
 * Turn a test tool's result into a structured failure, or null when the
 * suite is green / the tool returned no verdict at all.
 *
 * @returns {{layer:string,tool:string,reason:string,evidence:object[]}|null}
 */
export function readTestVerdict(name, result) {
  if (!result || typeof result !== 'object') return null;
  if (!isFailingVerdict(result.status)) return null;
  const parts = [`${name} reported status=${result.status}`];
  if (result.exitCode !== undefined) parts.push(` exitCode=${result.exitCode}`);
  if (result.failed !== undefined) parts.push(` · ${result.failed} failed`);
  const raw = result.evidence ?? result.output;
  return {
    layer: 'test',
    tool: name,
    reason: parts.join(''),
    evidence: raw ? [{ content: String(raw) }] : [],
  };
}

/**
 * M17/D1 — the typed-metadata verdict. This is the reader the gate uses now:
 * it consumes the `meta` object ToolRuntime attaches to every result, so the
 * decision rests on typed facts (status/exitCode/timedOut) instead of on a
 * shape the result never had. Returns a structured failure for a test tool
 * that did NOT pass — red, errored, timed out, blocked, denied, or never run.
 * A green suite returns null (it clears any earlier red).
 */
export function readTestMetaVerdict(name, meta) {
  if (!meta || meta.kind !== 'test') return null;
  if (meta.status === 'pass') return null;
  const parts = [`${name} reported status=${meta.status}`];
  if (meta.exitCode !== undefined) parts.push(` exitCode=${meta.exitCode}`);
  if (meta.failed !== undefined) parts.push(` · ${meta.failed} failed`);
  if (meta.reason) parts.push(` (${meta.reason})`);
  return {
    layer: 'test',
    tool: name,
    reason: parts.join(''),
    evidence: meta.evidence ? [{ content: String(meta.evidence) }] : [],
  };
}

/**
 * M17/D1 — the ONE reader the loop uses. Prefers the typed metadata when the
 * runtime attached it; falls back to the legacy structured object so a caller
 * that still hands us the raw engine result keeps working. Returns a
 * structured failure, or null when the suite is green / gave no verdict.
 */
export function readVerdict(name, result, meta = null) {
  return meta && meta.kind === 'test' ? readTestMetaVerdict(name, meta) : readTestVerdict(name, result);
}
