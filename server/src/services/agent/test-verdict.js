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
