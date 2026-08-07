import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { WORKSPACE_DIR, MANAGER_URL } from '../config.js';

/**
 * Run a file in the workspace and capture its output.
 * HTML is treated as success (served by the backend).
 */
export function runFile(fileName, onOutput) {
  return new Promise((resolve) => {
    const cleanName = String(fileName || '').trim();
    const filePath = path.join(WORKSPACE_DIR, cleanName);

    if (!fs.existsSync(filePath)) {
      return resolve({ success: false, output: `Error: File '${cleanName}' not found.` });
    }

    if (cleanName.toLowerCase().endsWith('.html')) {
      const url = `${MANAGER_URL}/preview/${cleanName}`;
      if (onOutput) onOutput('stdout', `Website ready. Preview at: ${url}\n`);
      return resolve({ success: true, output: 'Website generated successfully.', url });
    }

    let command = '';
    if (cleanName.endsWith('.py')) command = `python3 ${cleanName} 2>&1 || python ${cleanName} 2>&1`;
    else if (cleanName.endsWith('.js')) command = `node ${cleanName} 2>&1`;
    else if (cleanName.endsWith('.sh')) command = `bash ${cleanName} 2>&1`;
    else return resolve({ success: false, output: `Error: Unsupported file type.` });

    runCommand(command, { cwd: WORKSPACE_DIR, timeout: 15000, onOutput }).then(resolve);
  });
}

/** Run an arbitrary terminal command (used by the code debug loop). */
export function runCommand(command, opts = {}) {
  return new Promise((resolve) => {
    const onOutput = opts.onOutput || (() => {});
    let fullOutput = '';
    let resolved = false;

    const done = (success, output) => {
      if (resolved) return;
      resolved = true;
      resolve({ success, output });
    };

    let child;
    try {
      child = exec(command, { cwd: opts.cwd || WORKSPACE_DIR, timeout: opts.timeout || 15000, maxBuffer: 10 * 1024 * 1024 });
    } catch (e) {
      return done(false, `Failed to start process: ${e.message}`);
    }

    const checkSuccess = (data) => {
      // If a server started, treat as success and free the port
      if (/listening|server running|started on|http:\/\/localhost|ready in/i.test(data)) {
        onOutput('stdout', '\n[Runner] Server detected as running. Marking as successful.\n');
        try { child.kill(); } catch (e) {}
        done(true, fullOutput);
      }
    };

    child.stdout.on('data', (data) => {
      fullOutput += data;
      onOutput('stdout', data);
      checkSuccess(data);
    });
    child.stderr.on('data', (data) => {
      fullOutput += data;
      onOutput('stderr', data);
      checkSuccess(data);
    });
    child.on('close', (code) => {
      if (resolved) return;
      done(code === 0, fullOutput || (code === 0 ? 'Script executed successfully.' : '(no output)'));
    });
    child.on('error', (err) => {
      if (resolved) return;
      done(false, `Failed to start process: ${err.message}`);
    });
  });
}
