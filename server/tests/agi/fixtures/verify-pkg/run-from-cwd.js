// Launcher for the frozen-sandbox test: runs `src/plain-sum.js` from the
// CURRENT working directory. Used by B7 to verify a real child process against
// the materialized snapshot bytes (the sandbox cwd) without node:test nesting.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cwd = process.cwd();
const kid = spawnSync(process.execPath, [path.join(cwd, 'src', 'plain-sum.js')], { encoding: 'utf8' });
process.stdout.write(String(kid.stdout || ''));
process.stderr.write(String(kid.stderr || ''));
process.exit(kid.status ?? 1);