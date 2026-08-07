import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { jsonrepair } from 'jsonrepair';
import { generateContent } from './LLMClient.js';
import { MASTER_TRAINING_PROMPT } from './ComputerUseTraining.js';

const VIRTUAL_API = 'http://localhost:3002/api/desktop/coder';
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

  async cleanDesktop() {
    await axios.post(`${VIRTUAL_API}/execute`, { 
      command: "killall netsurf-gtk geany xfce4-terminal 2>/dev/null; xdotool key ctrl+u; xdotool type 'clear'; xdotool key Return"
    }).catch(()=>{});
    await new Promise(r => setTimeout(r, 1500));
  }

  hasError(output) {
    const lower = output.toLowerCase();
    if (lower.includes('<html') || lower.includes('<!doctype')) return false;
    if (lower.includes('screen contents')) return false;
    return lower.includes('traceback') || lower.includes('exception') || 
           lower.includes('errno') || lower.includes('no such file') || lower.includes('syntaxerror') ||
           lower.includes('modulenotfounderror') || lower.includes('nameerror') ||
           lower.includes('failed to fetch') || lower.includes('command not found') ||
           lower.includes('importerror') || lower.includes('attributeerror');
  }

  normalizeAction(rawAction) {
    const action = { 
      action: 'unknown', 
      filename: rawAction.filename, 
      code: rawAction.code, 
      text: rawAction.text, 
      command: rawAction.command || rawAction.shell, 
      key: rawAction.key, 
      ms: rawAction.ms 
    };
    
    const actionVal = (rawAction.action || rawAction.type || rawAction.name || '').toLowerCase();
    
    if (actionVal.includes('write') || (rawAction.filename && rawAction.code)) action.action = 'write_file';
    else if (actionVal.includes('read_screen') || actionVal.includes('read screen')) action.action = 'read_screen';
    else if (actionVal.includes('click_text') || actionVal.includes('click text')) action.action = 'click_text';
    else if (actionVal.includes('shell') || rawAction.shell || (rawAction.command && !rawAction.key)) action.action = 'shell';
    else if (actionVal.includes('press') || rawAction.key) {
      action.action = 'press';
      action.key = rawAction.key || rawAction.text;
    }
    else if (actionVal.includes('type') || (rawAction.text && !rawAction.key)) action.action = 'type';
    else if (actionVal.includes('wait')) action.action = 'wait';
    else if (actionVal.includes('done')) action.action = 'done';
    
    return action;
  }

  async executeTask(task, sendEvent) {
    sendEvent?.('log', { agent: 'ComputerUseAgent', message: `Starting task: ${task}` });
    
    this.clearWorkspace();
    await this.cleanDesktop();
    
    let attempts = 0;
    let lastError = null;
    let finalOutput = '';
    let filesCreated = [];
    let isResearchTask = task.toLowerCase().includes('search') || task.toLowerCase().includes('what is') || task.toLowerCase().includes('find') || task.toLowerCase().includes('who is') || task.toLowerCase().includes('capital');

    while (true) {
      attempts++;
      
      let prompt = `Task: ${task}`;
      if (lastError) {
        sendEvent?.('log', { agent: 'Debugger', message: `⚠ ERROR on attempt ${attempts - 1}!` });
        sendEvent?.('log', { agent: 'Debugger', message: `Error: ${lastError.substring(0, 150)}...` });
        sendEvent?.('log', { agent: 'Debugger', message: `Fixing (Attempt ${attempts})...` });
        
        let guidance = `CRITICAL: Your previous attempt failed:\n${lastError}\n\n`;
        if (lastError.includes('ModuleNotFoundError')) {
          guidance += "STOP using external modules! Use ONLY built-in modules or the visual browser.\n";
        }
        if (isResearchTask && (lastError.includes('didn\'t read') || lastError.includes('ModuleNotFoundError'))) {
          guidance += "STOP writing Python scripts for research! Use the VISUAL NETSURF BROWSER and the 'read_screen' action.\n";
        }
        
        prompt += `\n\n${guidance}\nFix the issue and try again.`;
      } else {
        sendEvent?.('log', { agent: 'ComputerUseAgent', message: `Attempt ${attempts}...` });
      }

      const response = await generateContent(prompt, MASTER_TRAINING_PROMPT);
      
      try {
        const jsonMatch = response.match(/\[[\s\S]*\]/);
        if (!jsonMatch) throw new Error("No JSON array found");
        
        const repairedJson = jsonrepair(jsonMatch[0]);
        const rawActions = JSON.parse(repairedJson);
        
        sendEvent?.('log', { agent: 'ComputerUseAgent', message: `Executing ${rawActions.length} steps...` });

        let capturedOutput = '';
        let didReadScreen = false;

        for (let i = 0; i < rawActions.length; i++) {
          const action = this.normalizeAction(rawActions[i]);
          
          if (action.action === 'unknown') {
            sendEvent?.('log', { agent: 'ComputerUseAgent', message: `Step ${i+1}/${rawActions.length}: Skipped` });
            continue;
          }

          const detail = action.filename || action.text?.substring(0,50) || action.command?.substring(0,50) || action.key || '';
          sendEvent?.('log', { agent: 'ComputerUseAgent', message: `Step ${i+1}/${rawActions.length}: ${action.action} ${detail}` });

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
                await new Promise(r => setTimeout(r, 1200));
                break;
                
              case 'press':
                await axios.post(`${VIRTUAL_API}/press`, { key: action.key });
                await new Promise(r => setTimeout(r, 800));
                break;
                
              case 'shell':
                sendEvent?.('log', { agent: 'ComputerUseAgent', message: `Running: ${action.command}` });
                const shellRes = await axios.post(`${VIRTUAL_API}/execute`, { command: action.command });
                if (shellRes.data.output) {
                  capturedOutput += shellRes.data.output.trim() + '\n';
                  sendEvent?.('log', { agent: 'Output', message: shellRes.data.output.trim().substring(0, 300) });
                }
                await new Promise(r => setTimeout(r, 1000));
                break;

              case 'read_screen':
                sendEvent?.('log', { agent: 'Vision', message: `📖 Reading screen...` });
                didReadScreen = true;
                let visionText = '';
                
                // 1. Ensure a fresh screenshot exists
                await axios.post(`${VIRTUAL_API}/execute`, { command: "ffmpeg -f x11grab -video_size 1280x720 -i :1 -vframes 1 -update 1 /tmp/jexi_ocr.png -y" });
                
                // 2. Try AI Vision first
                try {
                  sendEvent?.('log', { agent: 'Vision', message: `Trying AI Vision...` });
                  const shotRes = await axios.get(`${VIRTUAL_API}/desktop/coder/screenshot`);
                  const imageBase64 = shotRes.data.image;
                  const aiVisionPrompt = "Extract all visible text from this screenshot exactly as it appears. Return ONLY the text.";
                  visionText = await generateContent(aiVisionPrompt, "You are an AI assistant that extracts text from images.", imageBase64);
                  sendEvent?.('log', { agent: 'Vision', message: `✓ AI Vision read ${visionText.length} chars.` });
                } catch (aiError) {
                  // 3. Fallback to Tesseract OCR if AI Vision fails
                  sendEvent?.('log', { agent: 'Vision', message: `⚠ AI Vision failed. Falling back to Tesseract OCR...` });
                  const ocrRes = await axios.post(`${VIRTUAL_API}/execute`, { command: "tesseract /tmp/jexi_ocr.png - 2>/dev/null" });
                  visionText = ocrRes.data.output || '';
                  sendEvent?.('log', { agent: 'Vision', message: `✓ Tesseract read ${visionText.length} chars.` });
                }
                
                if (visionText && visionText.trim().length > 0) {
                  capturedOutput += "\n[SCREEN CONTENTS]:\n" + visionText.trim() + '\n';
                } else {
                  sendEvent?.('log', { agent: 'Vision', message: `Screen was empty or unreadable.` });
                }
                await new Promise(r => setTimeout(r, 2000));
                break;

              case 'click_text':
                sendEvent?.('log', { agent: 'ComputerUseAgent', message: `🖱️ Clicking text: "${action.text}"` });
                await axios.post(`${VIRTUAL_API}/execute`, { command: "ffmpeg -f x11grab -video_size 1280x720 -i :1 -vframes 1 -update 1 /tmp/jexi_ocr.png -y" });
                const ocrRes2 = await axios.post(`${VIRTUAL_API}/execute`, { command: "tesseract /tmp/jexi_ocr.png - tsv 2>/dev/null" });
                const lines2 = ocrRes2.data.output.trim().split('\n');
                let clicked = false;
                for (let l = 1; l < lines2.length; l++) {
                  const parts = lines2[l].split('\t');
                  if (parts.length >= 12) {
                    const text = parts[11].trim();
                    if (text.toLowerCase().includes(action.text.toLowerCase())) {
                      const x = parseInt(parts[6]) + Math.floor(parseInt(parts[8]) / 2);
                      const y = parseInt(parts[7]) + Math.floor(parseInt(parts[9]) / 2);
                      await axios.post(`${VIRTUAL_API}/click`, { x, y });
                      sendEvent?.('log', { agent: 'Vision', message: `✓ Found and clicked "${text}" at ${x},${y}` });
                      clicked = true;
                      break;
                    }
                  }
                }
                if (!clicked) sendEvent?.('log', { agent: 'Vision', message: `✗ Could not find text "${action.text}" on screen.` });
                await new Promise(r => setTimeout(r, 1500));
                break;
                
              case 'wait':
                sendEvent?.('log', { agent: 'ComputerUseAgent', message: `Waiting ${action.ms || 1000}ms...` });
                await new Promise(r => setTimeout(r, action.ms || 1000));
                break;
            }
          } catch (e) {
            sendEvent?.('log', { agent: 'ComputerUseAgent', message: `⚠ Action failed: ${action.action} - ${e.message}` });
          }
        }

        if (this.hasError(capturedOutput)) {
          lastError = capturedOutput;
          finalOutput = capturedOutput;
          sendEvent?.('log', { agent: 'Debugger', message: `⚠ Error found! Will retry...` });
        } else if (isResearchTask && !didReadScreen) {
          lastError = "You finished the task but you DIDN'T READ THE SCREEN. You MUST include the 'read_screen' action.";
          sendEvent?.('log', { agent: 'Debugger', message: `⚠ Error: Didn't read screen! Will retry...` });
        } else {
          sendEvent?.('log', { agent: 'ComputerUseAgent', message: '✅ Success! No errors detected.' });
          finalOutput = capturedOutput;
          lastError = null;
          
          sendEvent?.('log', { agent: 'ComputerUseAgent', message: 'Waiting 2s before cleaning...' });
          await new Promise(r => setTimeout(r, 2000));
          await this.cleanDesktop();
          break;
        }

      } catch (e) {
        sendEvent?.('log', { agent: 'ComputerUseAgent', message: `Parse error: ${e.message}` });
        lastError = `Failed to parse AI response: ${e.message}. Output ONLY valid JSON.`;
      }
    }

    if (isResearchTask && finalOutput && finalOutput.length > 0) {
      sendEvent?.('log', { agent: 'Reasoner', message: 'Synthesizing research answer...' });
      const synthesis = await generateContent(
        `The user asked: "${task}"\n\nI opened the browser and read this text from the screen:\n${finalOutput}\n\nBased on this information, write a concise, well-structured answer. Use numbered points and bold text for key facts. Do NOT write in long paragraphs.`,
        'You are JEXI OS, an expert AI.'
      );
      return { success: true, output: synthesis, files: filesCreated };
    }

    return { success: true, output: finalOutput, files: filesCreated };
  }
}
