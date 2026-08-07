import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { jsonrepair } from 'jsonrepair';
import { generateContent } from './LLMClient.js';
import { MASTER_TRAINING_PROMPT } from './ComputerUseTraining.js';

const VIRTUAL_API = 'http://localhost:4000/api/desktop/coder';
const workspaceDir = path.join(process.cwd(), 'jexi-workspace');

export class ComputerUseAgent {
  
  clearWorkspace() {
    if (fs.existsSync(workspaceDir)) {
      fs.readdirSync(workspaceDir).forEach(f => {
        const fullPath = path.join(workspaceDir, f);
        if (fs.statSync(fullPath).isFile()) fs.unlinkSync(fullPath);
      });
    } else {
      fs.mkdirSync(workspaceDir, { recursive: true });
    }
  }

  async clearTerminal() {
    try {
      await axios.post(`${VIRTUAL_API}/type`, { text: 'clear' });
      await axios.post(`${VIRTUAL_API}/press`, { key: 'Return' });
      await new Promise(r => setTimeout(r, 1000));
    } catch(e) {}
  }

  hasError(output) {
    const lower = output.toLowerCase();
    return lower.includes('error') || lower.includes('traceback') || lower.includes('exception') || 
           lower.includes('errno') || lower.includes('no such file') || lower.includes('syntaxerror') ||
           lower.includes('failed') || lower.includes('cannot');
  }

  async executeTask(task, sendEvent) {
    sendEvent?.('log', { agent: 'ComputerUseAgent', message: `Starting task: ${task}` });
    
    sendEvent?.('log', { agent: 'ComputerUseAgent', message: 'Clearing workspace...' });
    this.clearWorkspace();
    sendEvent?.('log', { agent: 'ComputerUseAgent', message: 'Clearing terminal...' });
    await this.clearTerminal();
    
    let attempts = 0;
    let lastError = null;
    let finalOutput = '';
    let filesCreated = [];

    // === THE INFINITE UNBREAKABLE LOOP ===
    while (true) {
      attempts++;
      
      let prompt = `Task: ${task}`;
      if (lastError) {
        sendEvent?.('log', { agent: 'Debugger', message: `⚠ ERROR DETECTED on attempt ${attempts - 1}!` });
        sendEvent?.('log', { agent: 'Debugger', message: `Error: ${lastError.substring(0, 100)}...` });
        sendEvent?.('log', { agent: 'Debugger', message: `Feeding error to AI for fixing (Attempt ${attempts})...` });
        
        // CRITICAL: Give the AI explicit context about common mistakes
        let errorContext = `CRITICAL: Your previous code failed with this error:\n${lastError}\n\n`;
        if (lastError.includes('FileNotFoundError')) {
          errorContext += "You tried to read a file that doesn't exist. Did you forget to run the script that CREATES the file first? Or better yet, put ALL logic into ONE script.\n";
        }
        if (lastError.includes('NameError')) {
          errorContext += "You used a variable that doesn't exist. Check your spelling and ensure variables are defined before use.\n";
        }
        if (lastError.includes('SyntaxError')) {
          errorContext += "You have a syntax error. Check for missing colons, brackets, or quotes.\n";
        }
        
        prompt += `\n${errorContext}\nDO NOT repeat the same mistake. Analyze the error, use "write_file" to OVERWRITE the file with the CORRECTED code, and run it again.`;
      } else {
        sendEvent?.('log', { agent: 'ComputerUseAgent', message: `Writing initial code (Attempt ${attempts})...` });
      }

      const response = await generateContent(prompt, MASTER_TRAINING_PROMPT);
      
      try {
        const jsonMatch = response.match(/\[[\s\S]*\]/);
        if (!jsonMatch) throw new Error("No action array found");
        
        const repairedJson = jsonrepair(jsonMatch[0]);
        const actions = JSON.parse(repairedJson);
        
        sendEvent?.('log', { agent: 'ComputerUseAgent', message: `Executing ${actions.length} steps...` });

        let capturedOutput = '';
        let didRunCode = false;

        for (let i = 0; i < actions.length; i++) {
          const action = actions[i];
          sendEvent?.('log', { agent: 'ComputerUseAgent', message: `Step ${i+1}/${actions.length}: ${action.action} ${action.filename || action.text || action.command || ''}` });

          try {
            switch(action.action) {
              case 'write_file':
                await axios.post(`${VIRTUAL_API}/write-file`, { filename: action.filename, content: action.code });
                fs.writeFileSync(path.join(workspaceDir, action.filename), action.code, 'utf-8');
                if (!filesCreated.includes(action.filename)) filesCreated.push(action.filename);
                await new Promise(r => setTimeout(r, 500));
                break;
                
              case 'type':
                await axios.post(`${VIRTUAL_API}/type`, { text: action.text });
                await new Promise(r => setTimeout(r, 800));
                break;
                
              case 'press':
                await axios.post(`${VIRTUAL_API}/press`, { key: action.key });
                await new Promise(r => setTimeout(r, 500));
                break;
                
              case 'shell':
                didRunCode = true;
                sendEvent?.('log', { agent: 'ComputerUseAgent', message: `Running: ${action.command}` });
                const shellRes = await axios.post(`${VIRTUAL_API}/execute`, { 
                  command: action.command
                });
                if (shellRes.data.output) {
                  capturedOutput += shellRes.data.output.trim() + '\n';
                  sendEvent?.('log', { agent: 'Output', message: shellRes.data.output.trim().substring(0, 200) });
                }
                await new Promise(r => setTimeout(r, 1000));
                break;
                
              case 'wait':
                await new Promise(r => setTimeout(r, action.ms || 1000));
                break;
            }
          } catch (e) {
            sendEvent?.('log', { agent: 'ComputerUseAgent', message: `⚠ Action failed: ${action.action} - ${e.message}` });
          }
        }

        if (!didRunCode && filesCreated.length > 0) {
          lastError = "You wrote a file but forgot to run it! Add a 'shell' action to execute the script.";
          sendEvent?.('log', { agent: 'Debugger', message: `⚠ Error: Code was written but never executed!` });
        } else if (this.hasError(capturedOutput)) {
          lastError = capturedOutput;
          finalOutput = capturedOutput;
          sendEvent?.('log', { agent: 'Debugger', message: `⚠ Error found in output! Will retry...` });
        } else {
          sendEvent?.('log', { agent: 'ComputerUseAgent', message: '✅ Execution successful! No errors detected.' });
          finalOutput = capturedOutput;
          lastError = null;
          break; // EXIT THE INFINITE LOOP ONLY ON SUCCESS
        }

      } catch (e) {
        sendEvent?.('log', { agent: 'ComputerUseAgent', message: `Error parsing AI response: ${e.message}` });
        lastError = "Failed to parse AI response. Please output ONLY valid JSON.";
      }
    }

    return { success: true, output: finalOutput, files: filesCreated };
  }
}
