import { exec } from 'child_process';
import util from 'util';

const execAsync = util.promisify(exec);

export class DesktopManager {
  constructor(runtime = 'proot') {
    this.runtime = runtime; 
  }

  // FIXED: Always inject DISPLAY=:1 into every command!
  async executeCommand(agentId, command) {
    // Ensure the command runs in the graphical environment
    const fullCommand = `export DISPLAY=:1; ${command}`;
    const cmd = `proot-distro login ubuntu -- bash -c "${fullCommand} 2>&1"`;
    try {
      const { stdout } = await execAsync(cmd);
      return stdout;
    } catch (error) {
      return error.stdout || error.stderr || error.message;
    }
  }

  async writeFile(agentId, filename, content) {
    const b64Content = Buffer.from(content).toString('base64');
    const command = `echo "${b64Content}" | base64 -d > /root/${filename}`;
    return await this.executeCommand(agentId, command);
  }

  async takeScreenshot(agentId) {
    const command = `ffmpeg -f x11grab -video_size 1280x720 -i :1 -vframes 1 -update 1 /tmp/jexi_shot.png -y ; base64 /tmp/jexi_shot.png`;
    const base64String = await this.executeCommand(agentId, command);
    
    if (base64String && base64String.length > 100) {
      return `data:image/png;base64,${base64String.replace(/\n/g, '')}`;
    }
    throw new Error("Screenshot failed. Is Session 7 running?");
  }

  async extractText(agentId) {
    await this.executeCommand(agentId, `ffmpeg -f x11grab -video_size 1280x720 -i :1 -vframes 1 -update 1 /tmp/jexi_shot.png -y`);
    const command = `tesseract /tmp/jexi_shot.png - tsv`;
    const tsvOutput = await this.executeCommand(agentId, command);
    
    const lines = tsvOutput.trim().split('\n');
    const words = [];
    
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split('\t');
      if (parts.length >= 12) {
        const text = parts[11].trim();
        if (text && text.length > 1) {
          words.push(text);
        }
      }
    }
    return words.join(' ');
  }

  async click(agentId, x, y) {
    return await this.executeCommand(agentId, `xdotool mousemove ${x} ${y} click 1`);
  }

  async type(agentId, text) {
    const b64Text = Buffer.from(text).toString('base64');
    const command = `echo "${b64Text}" | base64 -d > /tmp/jexi_type.txt ; xdotool type --file /tmp/jexi_type.txt`;
    return await this.executeCommand(agentId, command);
  }

  async pressKey(agentId, key) {
    return await this.executeCommand(agentId, `xdotool key ${key}`);
  }
}
