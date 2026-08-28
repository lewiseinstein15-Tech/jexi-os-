/**
 * JEXI OS — Python Run Plugin (B160).
 * DeepSeek Harness `packages/code-runtime/code-runtime-python` model-facing
 * tool: run a bounded CPython program (isolated mode, time + output caps).
 */

import { pythonToolHandler, pythonAvailable } from '../../src/services/CodeRuntimePython.js';

export const name = 'python-run';
export const version = '1.0.0';
export const inject = ['tools'];

export async function apply(ctx) {
  const unregister = ctx.tools.register({
    slug: 'python_run',
    name: 'Run Python',
    desc: `Execute a Python 3 program and return stdout/stderr (isolated, ${20}s cap, 64 KB output cap). ${pythonAvailable() ? 'Python is available on this host.' : 'NOTE: python3 is NOT installed on this host — calls will return PYTHON_UNAVAILABLE.'}`,
    args: {
      program: { type: 'string', required: true, desc: 'The Python program source to run.' },
      timeoutMs: { type: 'number', required: false, desc: 'Optional timeout in ms (default 20000).' },
    },
    handler: pythonToolHandler,
  });
  return unregister;
}
