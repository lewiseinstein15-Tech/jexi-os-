/**
 * JEXI OS — tools — testing domain.
 *
 * run, coverage. Executors are injected; definitions are always registered so the
 * capability surface stays stable and provider-independent.
 */

import { defineTool } from '../../interface/ToolDefinition.js';
import { registerToolBatch } from '../../registry/ToolRegistry.js';
import { runNativeCommand } from '../../../services/NativeCommand.js';
import fs from 'node:fs';
import path from 'node:path';

/** Detect the test command for a project root (package.json first). */
export function detectTestCommand(root = process.cwd()) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (pkg.scripts && pkg.scripts.test) return `npm test`;
    return null;
  } catch {
    return null;
  }
}

function parseNodeTestReport(output, exitCode) {
  const pass = Number((output.match(/# pass (\d+)/) || [])[1] ?? 0);
  const fail = Number((output.match(/# fail (\d+)/) || [])[1] ?? 0);
  const skip = Number((output.match(/# skipped (\d+)/) || [])[1] ?? 0);
  const tests = Number((output.match(/# tests (\d+)/) || [])[1] ?? (pass + fail));
  return { status: fail > 0 || exitCode !== 0 ? 'fail' : (tests > 0 ? 'pass' : 'error'), exitCode, pass, fail, skip, tests };
}

export function registerTestingTools() {
  const defs = [
    defineTool({ name: 'test_run', description: 'Run the project test suite and return real pass/fail.', riskLevel: 'medium', runtimeRing: 2, parameters: { type: 'object', properties: { file: { type: 'string' } }, required: [] }, sideEffects: ['test'], failureTypes: ['tool_error'], idempotent: false }),
    defineTool({ name: 'test_coverage', description: 'Run tests with coverage and return the coverage report.', riskLevel: 'medium', runtimeRing: 2, parameters: { type: 'object', properties: { file: { type: 'string' } }, required: [] }, sideEffects: ['test'], failureTypes: ['tool_error'], idempotent: false })
  ];
  const unreg = registerToolBatch(defs);
  const engines = {
    async test_run({ file }, ctx = {}) {
      const root = ctx.root ?? process.cwd();
      const cmd = detectTestCommand(root);
      if (!cmd && !file) return { ok: false, status: 'error', reason: 'no test command configured', root };
      const argv = file ? ['node', '--test', String(file)] : (['npm', 'test']);
      const res = await runNativeCommand(argv[0], argv.slice(1), { cwd: root, timeoutMs: 60000, maxOutputChars: 30000 });
      const parsed = parseNodeTestReport(res.output ?? '', res.code ?? -1);
      return { ok: res.code === 0, status: parsed.status, exitCode: res.code, pass: parsed.pass, fail: parsed.fail, skip: parsed.skip, tests: parsed.tests, output: (res.output ?? '').slice(0, 6000) };
    },
    async test_coverage({ file }, ctx = {}) {
      const root = ctx.root ?? process.cwd();
      const res = await runNativeCommand('node', ['--experimental-test-coverage', '--test', String(file || '')], { cwd: root, timeoutMs: 60000, maxOutputChars: 30000 });
      return { ok: res.code === 0, exitCode: res.code, output: (res.output ?? '').slice(0, 8000) };
    },
  };
  return { unreg, engines };
}
