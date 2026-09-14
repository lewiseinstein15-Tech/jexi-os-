/**
 * JEXI OS — VERIFICATION — line diff for FileStateVerifier.
 *
 * A minimal, deterministic unified diff over two strings (line-based LCS).
 * Produces real `-`/`+` output so a byte mismatch can be read back as
 * actionable context — no external `diff` binary required (portable, and the
 * verifier must never shell out for evidence it can compute itself).
 */

/** Longest-common-subsequence table (line tokens). */
function lcsTable(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  return dp;
}

/**
 * Unified-style diff between two texts (no headers, no external binary).
 * @returns {string} lines prefixed with ' ', '-', '+', or '\ No newline at end of file'
 */
export function diffLines(a, b, { context = 3 } = {}) {
  const al = String(a).split('\n');
  const bl = String(b).split('\n');
  const dp = lcsTable(al, bl);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < al.length && j < bl.length) {
    if (al[i] === bl[j]) {
      out.push(` ${al[i]}`);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push(`-${al[i]}`);
      i += 1;
    } else {
      out.push(`+${bl[j]}`);
      j += 1;
    }
  }
  while (i < al.length) { out.push(`-${al[i]}`); i += 1; }
  while (j < bl.length) { out.push(`+${bl[j]}`); j += 1; }

  // Trim to a bounded context window around the first change.
  const firstChange = out.findIndex((l) => l.startsWith('-') || l.startsWith('+'));
  if (firstChange > context) {
    const start = Math.max(0, firstChange - context);
    return ['…', ...out.slice(start)].join('\n');
  }
  return out.join('\n');
}