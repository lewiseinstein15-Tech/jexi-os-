/**
 * JEXI OS — benchmarks/humaneval-live/lib/tasks.mjs
 *
 * HumanEval task materialisation + OFFICIAL-equivalent grading.
 *
 * The dataset is pinned on disk (dataset/humaneval-test.json) with its
 * sha256 recorded in the run manifest, so a run is reproducible without
 * network access to HuggingFace.
 *
 * Grading follows the upstream HumanEval harness exactly:
 *   exec(solution)   # solution.py == prompt + the agent's completion
 *   exec(test)       # test_<entry>.py defines check()
 *   check(entry)     # raises on failure
 * A task passes iff check() raises nothing. The grader runs inside a
 * throwaway Docker container (--network none) so a solution cannot reach
 * the network and cannot touch the host.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const DATASET_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', 'dataset', 'humaneval-test.json',
);

export function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function loadDataset(datasetPath = DATASET_PATH) {
  const raw = fs.readFileSync(datasetPath, 'utf8');
  const parsed = JSON.parse(raw);
  const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  return { dataset: parsed, tasks, sha256: sha256(raw) };
}

/** The grader copied into every sandbox. Official HumanEval logic. */
export const GRADE_PY = `import sys, traceback
sol, test, entry = sys.argv[1], sys.argv[2], sys.argv[3]
ns = {}
try:
    exec(open(sol, encoding="utf-8").read(), ns)
    exec(open(test, encoding="utf-8").read(), ns)
    ns["check"](ns[entry])
    print("HUMANEVAL_GRADE=PASS")
    sys.exit(0)
except Exception:
    traceback.print_exc()
    print("HUMANEVAL_GRADE=FAIL")
    sys.exit(1)
`;

/** The test file for a task: the canonical `test` body + the check() call. */
export function testFileFor(task) {
  return `${task.test}\n\ncheck(${task.entry_point})\n`;
}

/**
 * Materialise one task's sandbox. `solution.py` starts as the bare prompt,
 * exactly what the model is given upstream.
 */
export function materialiseTask(task, sandboxDir) {
  fs.mkdirSync(sandboxDir, { recursive: true });
  const solutionName = 'solution.py';
  const testName = `test_${task.entry_point}.py`;
  fs.writeFileSync(path.join(sandboxDir, solutionName), `${task.prompt}\n`);
  fs.writeFileSync(path.join(sandboxDir, testName), testFileFor(task));
  fs.writeFileSync(path.join(sandboxDir, 'grade.py'), GRADE_PY);
  return { solutionName, testName, sandboxDir };
}

/**
 * Grade a materialised sandbox in a throwaway Docker container. Returns
 * { passed, output, exitCode, error }. Network is disabled and the container
 * is removed afterwards, so grading is hermetic.
 */
export function gradeInDocker({ sandboxDir, solutionName, testName, entryPoint, image = 'python:3.11-slim', dockerBin = 'docker', timeoutMs = 120_000 }) {
  const res = spawnSync(
    dockerBin,
    ['run', '--rm', '--network', 'none', '-v', `${sandboxDir}:/w`, '-w', '/w', image,
      'python', 'grade.py', solutionName, testName, entryPoint],
    { encoding: 'utf8', timeout: timeoutMs },
  );
  const output = `${res.stdout || ''}${res.stderr || ''}`.trim();
  if (res.error) return { passed: false, output, exitCode: null, error: String(res.error.message || res.error) };
  return { passed: res.status === 0, output, exitCode: res.status, error: null };
}

/**
 * Fallback grader: same grade.py, run as a plain subprocess in the sandbox.
 *
 * Docker is the preferred grader because `--network none` makes it hermetic.
 * This path is NOT hermetic — the solution runs with the harness's own
 * privileges — so every run that uses it is marked `gradedWithoutIsolation:
 * true` in its manifest and the number is not presented as an isolated result.
 * It exists so a Docker daemon restart cannot silently turn a measurement into
 * a crash.
 */
export function gradeLocally({ sandboxDir, solutionName, testName, entryPoint, pythonBin = 'python3', timeoutMs = 120_000 }) {
  const res = spawnSync(pythonBin, ['grade.py', solutionName, testName, entryPoint],
    { cwd: sandboxDir, encoding: 'utf8', timeout: timeoutMs });
  const output = `${res.stdout || ''}${res.stderr || ''}`.trim();
  if (res.error) return { passed: false, output, exitCode: null, error: String(res.error.message || res.error) };
  return { passed: res.status === 0, output, exitCode: res.status, error: null };
}
