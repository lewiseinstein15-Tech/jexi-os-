import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';

const workspaceDir = path.join(process.cwd(), 'jexi-workspace');

export function runFile(fileName) {
  return new Promise((resolve) => {
    if (!fs.existsSync(path.join(workspaceDir, fileName))) {
      return resolve({ success: false, output: `Error: File '${fileName}' not found in jexi-workspace.` });
    }

    let command = '';
    if (fileName.endsWith('.py')) command = `python ${fileName}`;
    else if (fileName.endsWith('.js')) command = `node ${fileName}`;
    else if (fileName.endsWith('.sh')) command = `bash ${fileName}`;
    else return resolve({ success: false, output: "Error: Unsupported file type for execution." });

    exec(command, { cwd: workspaceDir, timeout: 10000 }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, output: stderr || error.message });
      } else {
        resolve({ success: true, output: stdout || "Script executed successfully with no output." });
      }
    });
  });
}
