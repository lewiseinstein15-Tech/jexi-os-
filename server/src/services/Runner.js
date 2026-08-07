import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';

const workspaceDir = path.join(process.cwd(), 'jexi-workspace');

export function runFile(fileName, onOutput) {
  return new Promise((resolve) => {
    const cleanName = fileName.trim();
    const filePath = path.join(workspaceDir, cleanName);

    if (!fs.existsSync(filePath)) {
      return resolve({ success: false, output: `Error: File '${cleanName}' not found.` });
    }

    if (cleanName.toLowerCase().endsWith('.html')) {
      const url = `http://localhost:3002/preview/${cleanName}`;
      if (onOutput) onOutput('stdout', `Website ready. Preview at: ${url}\n`);
      return resolve({ success: true, output: `Website generated successfully.` });
    }

    let command = '';
    if (cleanName.endsWith('.py')) command = `python ${cleanName}`;
    else if (cleanName.endsWith('.js')) command = `node ${cleanName}`;
    else if (cleanName.endsWith('.sh')) command = `bash ${cleanName}`;
    else return resolve({ success: false, output: `Error: Unsupported file type.` });

    const child = exec(command, { cwd: workspaceDir, timeout: 8000 });
    let fullOutput = '';
    let resolved = false;

    const checkSuccess = (data) => {
      if (resolved) return;
      // If the output looks like a server started, mark as success immediately!
      if (/listening|server running|started on|http:\/\/localhost/i.test(data)) {
        resolved = true;
        if (onOutput) onOutput('stdout', '\n[Runner] Server detected as running. Marking as successful.\n');
        child.kill(); // Kill it so it doesn't block the port
        resolve({ success: true, output: fullOutput });
      }
    };

    child.stdout.on('data', (data) => {
      fullOutput += data;
      if (onOutput) onOutput('stdout', data);
      checkSuccess(data);
    });
    
    child.stderr.on('data', (data) => {
      fullOutput += data;
      if (onOutput) onOutput('stderr', data);
      checkSuccess(data);
    });

    child.on('close', (code) => {
      if (resolved) return;
      if (code === 0) {
        resolve({ success: true, output: fullOutput || "Script executed successfully." });
      } else {
        resolve({ success: false, output: fullOutput });
      }
    });

    child.on('error', (err) => {
      if (resolved) return;
      resolve({ success: false, output: `Failed to start process: ${err.message}` });
    });
  });
}
