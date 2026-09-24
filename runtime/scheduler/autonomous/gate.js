import { spawnSync } from 'node:child_process';
import { failure } from './storage.js';

export const DEFAULT_GATE_COMMAND = 'npm run check';

/** Execute a trusted local completion gate and capture its actual process result. */
export function createGate({ cwd = process.cwd(), clock = () => Date.now(), spawnProcess = spawnSync } = {}) {
  return {
    run(command = DEFAULT_GATE_COMMAND, { timeoutMs } = {}) {
      if (typeof command !== 'string' || !command.trim()) throw failure('E_GATE_COMMAND');
      if (timeoutMs != null && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)) throw failure('E_GATE_TIMEOUT');
      const started = clock();
      try {
        const result = spawnProcess(command, {
          cwd,
          shell: true,
          encoding: 'utf8',
          windowsHide: true,
          ...(timeoutMs == null ? {} : { timeout: timeoutMs }),
        });
        const processError = result?.error ? String(result.error.message || result.error) : '';
        return {
          passed: result?.status === 0 && !result?.error,
          exitCode: Number.isInteger(result?.status) ? result.status : -1,
          stdout: String(result?.stdout || ''),
          stderr: `${String(result?.stderr || '')}${processError}`,
          durationMs: Math.max(0, clock() - started),
        };
      } catch (cause) {
        return {
          passed: false,
          exitCode: -1,
          stdout: '',
          stderr: String(cause?.message || cause),
          durationMs: Math.max(0, clock() - started),
        };
      }
    },
  };
}

export default createGate;
