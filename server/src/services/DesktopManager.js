import { exec } from 'child_process';
import util from 'util';

const execAsync = util.promisify(exec);

export class DesktopManager {
  constructor(runtime = 'proot') {
    this.runtime = runtime; 
  }

  async executeCommand(agentId, command) {
    const cmd = `proot-distro login ubuntu -- bash -c "${command} 2>&1"`;
    try {
      const { stdout } = await execAsync(cmd);
      return stdout;
    } catch (error) {
      return error.stdout || error.stderr || error.message;
    }
  }

  // NEW: Bulletproof file writing using Base64 encoding!
  async writeFile(agentId, filename, content) {
    // 1. Base64 encode the content in Node.js (ignores all quotes/special chars)
    const b64Content = Buffer.from(content).toString('base64');
    // 2. Decode inside Ubuntu and write to file
    const command = `echo "${b64Content}" | base64 -d > /root/${filename}`;
    return await this.executeCommand(agentId, command);
  }

  async takeScreenshot(agentId) {
    const command = `export DISPLAY=:1 ; ffmpeg -f x11grab -video_size 1280x720 -i :1 -vframes 1 -update 1 /tmp/jexi_shot.png -y ; base64 /tmp/jexi_shot.png`;
    const base64String = await this.executeCommand(agentId, command);
    if (base64String && base64String.length > 100) {
      return `data:image/png;base64,${base64String.replace(/\n/g, '')}`;
    }
    throw new Error("Screenshot failed.");
  }

  async click(agentId, x, y) {
    return await this.executeCommand(agentId, `export DISPLAY=:1 ; xdotool mousemove ${x} ${y} click 1`);
  }

  async type(agentId, text) {
    const b64Text = Buffer.from(text).toString('base64');
    const command = `export DISPLAY=:1 ; echo "${b64Text}" | base64 -d > /tmp/jexi_type.txt ; xdotool type --file /tmp/jexi_type.txt`;
    return await this.executeCommand(agentId, command);
  }

  async pressKey(agentId, key) {
    return await this.executeCommand(agentId, `export DISPLAY=:1 ; xdotool key ${key}`);
  }
}
