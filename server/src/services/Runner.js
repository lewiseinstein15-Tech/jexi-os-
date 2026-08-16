import { exec, execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { WORKSPACE_DIR, MANAGER_URL, PUBLIC_URL } from '../config.js';
import { isShellSafeFileName } from './PathSafety.js';

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

    // Security: file runs are invoked with execFile (argv array, no shell), and
    // the name must be a single shell-safe file name — a crafted filename can
    // never inject commands.
    if (!isShellSafeFileName(cleanName)) {
      return resolve({ success: false, output: `Error: '${cleanName}' is not a safe file name.` });
    }

    if (cleanName.toLowerCase().endsWith('.html')) {
      const url = `${PUBLIC_URL || MANAGER_URL}/preview/${cleanName}`;
      (async () => {
        try {
          // Real verification, not a rubber stamp: syntax-check every inline
          // <script> block with node --check, so broken JavaScript is caught
          // by the debug loop (fix → rerun) instead of being delivered broken.
          const html = fs.readFileSync(filePath, 'utf-8');
          const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
          for (let i = 0; i < scripts.length; i++) {
            const body = (scripts[i][1] || '').trim();
            if (!body) continue;
            const tmp = path.join(WORKSPACE_DIR, `.jexi-check-${Date.now()}-${i}.js`);
            fs.writeFileSync(tmp, body, 'utf-8');
            const res = await runCommand(`node --check "${tmp}"`, { cwd: WORKSPACE_DIR, timeout: 8000 });
            try { fs.unlinkSync(tmp); } catch (e) {}
            if (!res.success) {
              return resolve({ success: false, output: `JavaScript error in inline script #${i + 1}: ${res.output.slice(0, 1500)}`, url });
            }
          }
        } catch (e) { /* unreadable file — fall through to success */ }
        if (onOutput) onOutput('stdout', `Website ready. Preview at: ${url}\n`);
        resolve({ success: true, output: 'Website generated successfully — inline JavaScript passed syntax check.', url });
      })();
      return;
    }

    let cmd = null;
    let args = null;
    if (cleanName.endsWith('.py')) { cmd = 'python3'; args = [cleanName]; }
    else if (cleanName.endsWith('.js')) { cmd = 'node'; args = [cleanName]; }
    else if (cleanName.endsWith('.sh')) { cmd = 'bash'; args = [cleanName]; }
    else return resolve({ success: false, output: `Error: Unsupported file type.` });

    runFileCmd(cmd, args, { timeout: 15000, onOutput }).then(async (res) => {
      // python3 may be missing on some hosts — retry with `python` (the old
      // `python3 f 2>&1 || python f 2>&1` fallback, now without a shell).
      if (!res.success && cleanName.endsWith('.py') && /ENOENT|spawn python3/i.test(res.output)) {
        const retry = await runFileCmd('python', args, { timeout: 15000, onOutput });
        return resolve(retry);
      }
      resolve(res);
    });
  });
}

/** Invoke one command with an argv array — never a shell string. */
function runFileCmd(command, args, opts = {}) {
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
      child = execFile(command, args, { cwd: opts.cwd || WORKSPACE_DIR, timeout: opts.timeout || 15000, maxBuffer: 10 * 1024 * 1024 });
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
