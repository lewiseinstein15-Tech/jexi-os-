import fs from 'fs';
import path from 'path';
import { jsonrepair } from 'jsonrepair';
import { generateContent } from './LLMClient.js';
import { MASTER_TRAINING_PROMPT } from './ComputerUseTraining.js';
import { JEXI_SYSTEM_PROMPT } from './JexiPrompt.js';
import { WORKSPACE_DIR, MANAGER_URL, MAX_DEBUG_ATTEMPTS } from '../config.js';
import { extractContent } from './Extractor.js';
import { aggregateSearch } from './SearchEngine.js';
import { saveInternetKnowledge, saveCodingKnowledge } from './MemoryManager.js';

const VIRTUAL_API = process.env.VIRTUAL_API || MANAGER_URL;
const MAX_ATTEMPTS = Number(process.env.COMPUTER_USE_MAX_ATTEMPTS) || MAX_DEBUG_ATTEMPTS;

export class ComputerUseAgent {

  clearWorkspace() {
    if (fs.existsSync(WORKSPACE_DIR)) {
      fs.readdirSync(WORKSPACE_DIR).forEach(f => {
        const full = path.join(WORKSPACE_DIR, f);
        if (fs.statSync(full).isFile()) fs.unlinkSync(full);
      });
    } else {
      fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
    }
  }

  hasError(output) {
    const lower = (output || '').toLowerCase();
    if (lower.includes('<html') || lower.includes('<!doctype')) return false;
    if (lower.includes('screen contents')) return false;
    return lower.includes('traceback') || lower.includes('exception') ||
      lower.includes('errno') || lower.includes('no such file') ||
      lower.includes('syntaxerror') || lower.includes('modulenotfounderror') ||
      lower.includes('nameerror') || lower.includes('command not found') ||
      lower.includes('importerror') || lower.includes('attributeerror') ||
      lower.includes('typeerror') || lower.includes('referenceerror') ||
      lower.includes('failed to fetch') || lower.includes('unexpected token') ||
      lower.includes('cannot find module') || lower.includes('is not defined');
  }

  normalizeAction(raw) {
    const action = {
      action: 'unknown', filename: raw.filename, code: raw.code, text: raw.text,
      command: raw.command || raw.shell, key: raw.key, ms: raw.ms,
      url: raw.url || raw.link || raw.href, direction: raw.direction,
      x: raw.x, y: raw.y,
    };
    const val = (raw.action || raw.type || raw.name || '').toLowerCase();
    if (val.includes('goto') || val.includes('open') || val.includes('navigate') || action.url) action.action = 'goto';
    else if (val.includes('write') || (raw.filename && raw.code)) action.action = 'write_file';
    else if (val.includes('read_page') || val.includes('read page') || val.includes('read_screen')) action.action = 'read_page';
    else if (val.includes('screenshot') || val.includes('vision')) action.action = 'screenshot';
    else if (val.includes('click_index') || val.includes('click index')) action.action = 'click_index';
    else if (val.includes('type_index') || val.includes('type index')) action.action = 'type_index';
    else if (val.includes('click_text') || val.includes('click text')) action.action = 'click_text';
    else if (val.includes('click')) action.action = 'click';
    else if (val.includes('scroll')) action.action = 'scroll';
    else if (val.includes('back')) action.action = 'back';
    else if (val.includes('forward')) action.action = 'forward';
    else if (val.includes('shell') || raw.shell || (raw.command && !raw.key)) action.action = 'shell';
    else if (val.includes('press') || raw.key) { action.action = 'press'; action.key = raw.key || raw.text; }
    else if (val.includes('type') || (raw.text && !raw.key)) action.action = 'type';
    else if (val.includes('wait')) action.action = 'wait';
    else if (val.includes('done')) action.action = 'done';
    return action;
  }

  /** Fetch the live interactive element map (JEXI's numbered eyes) or a friendly empty fallback. */
  async currentElements() {
    try {
      const map = await this.api('elements', {});
      if (map?.elements?.length) {
        const lines = map.elements.map(e =>
          `[${e.id}] ${e.tag}${e.type ? `:${e.type}` : ''} "${e.text}"${e.href ? ` -> ${e.href}` : ''}${e.placeholder ? ` (placeholder: ${e.placeholder})` : ''}`
        ).join('\n');
        return { map, lines, count: map.elements.length };
      }
    } catch {}
    return { map: null, lines: '', count: 0 };
  }

  /** Format a compact, LLM-friendly screen snapshot: page text + numbered elements. */
  async screenSnapshot(maxText = 6000) {
    let out = '';
    try {
      const txt = await this.api('page-text', {});
      if (txt && txt.trim()) {
        out += `\n[SCREEN CONTENTS]:\n${txt.trim().slice(0, maxText)}\n`;
      }
    } catch {}
    const { lines, count } = await this.currentElements();
    if (count > 0) {
      out += `\n[SCREEN ELEMENTS — interact by number]:\n${lines}\n`;
    }
    return out;
  }

  async executeTask(task, sendEvent, opts = {}) {
    const intent = opts.intent || 'task';
    const isResearch = intent === 'research';
    const isLink = intent === 'link_analysis';
    const isCode = intent === 'code_task';
    sendEvent?.('log', { agent: 'Navigator', message: `Planning task: ${task}` });

    // Try to talk to the real browser/terminal first.
    const desktopOk = await this.pingDesktop(sendEvent);

    let attempts = 0;
    let lastError = null;
    let capturedOutput = '';
    let filesCreated = [];
    let didReadPage = false;

    while (attempts < MAX_ATTEMPTS) {
      attempts++;

      let prompt = `Task: ${task}`;
      if (lastError) {
        sendEvent?.('log', { agent: 'Debugger', message: `⚠ ERROR on attempt ${attempts - 1}: ${String(lastError).substring(0, 200)}` });
        sendEvent?.('log', { agent: 'Debugger', message: `Fixing (Attempt ${attempts}/${MAX_ATTEMPTS})...` });
        let guidance = `CRITICAL: Your previous attempt failed:\n${lastError}\n\n`;
        if (isCode) {
          guidance += `You are in the CODE DEBUG LOOP. Read the error, rewrite the file with the fix, and run it again. Do not claim success while an error is on screen.\n`;
        }
        if ((isResearch || isLink) && lastError.includes("DIDN'T READ")) {
          guidance += `You MUST read the page content with 'read_page' before finishing. Open the page, wait, read_page.\n`;
        }
        if (lastError.includes('Browser unavailable')) {
          guidance += `The visual browser is unavailable. Do not attempt 'goto'. Instead use 'shell' with a python script that fetches the page, or simply finish — the orchestrator will read sources server-side.\n`;
        }
        // Give the fix attempt JEXI's current numbered eyes so it stops guessing.
        if (desktopOk.ok) {
          const snap = await this.screenSnapshot(4000).catch(() => '');
          if (snap) guidance += `\nHere is what is currently on screen — use the numbered [N] elements:\n${snap}`;
        }
        prompt += `\n\n${guidance}\nFix the issue and try again.`;
      } else {
        sendEvent?.('log', { agent: 'ComputerUseAgent', message: `Attempt ${attempts}...` });
      }

      let response;
      try {
        response = await generateContent(prompt, MASTER_TRAINING_PROMPT);
      } catch (e) {
        lastError = `LLM call failed: ${e.message}`;
        continue;
      }

      let rawActions;
      try {
        const jsonMatch = response.match(/\[[\s\S]*\]/);
        if (!jsonMatch) throw new Error('No JSON array found');
        rawActions = JSON.parse(jsonrepair(jsonMatch[0]));
        if (!Array.isArray(rawActions)) throw new Error('Not an array');
      } catch (e) {
        lastError = `Failed to parse AI response: ${e.message}. Output ONLY valid JSON.`;
        continue;
      }

      const stepOutput = { text: '', error: false };

      for (let i = 0; i < rawActions.length; i++) {
        const action = this.normalizeAction(rawActions[i]);
        if (action.action === 'unknown' || action.action === 'done') continue;

        const detail = action.filename || action.text?.substring(0, 60) || action.url?.substring(0, 60) || action.command?.substring(0, 60) || action.key || '';
        sendEvent?.('log', { agent: 'ComputerUseAgent', message: `Step ${i + 1}: ${action.action} ${detail}` });

        try {
          switch (action.action) {
            case 'goto': {
              if (!desktopOk.ok) throw new Error('Browser unavailable');
              const r = await this.api('goto', { url: action.url });
              sendEvent?.('log', { agent: 'Vision', message: `🌐 Opened: ${r.title || action.url}` });
              await new Promise(r2 => setTimeout(r2, 1200));
              const { lines, count } = await this.currentElements();
              if (count > 0) {
                stepOutput.text += `\n[SCREEN ELEMENTS]:\n${lines}\n`;
                sendEvent?.('log', { agent: 'Navigator', message: `🔢 Indexed ${count} interactive elements` });
              }
              break;
            }
            case 'write_file': {
              await this.api('write-file', { filename: action.filename, content: action.code });
              fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
              fs.writeFileSync(path.join(WORKSPACE_DIR, action.filename), action.code, 'utf-8');
              if (!filesCreated.includes(action.filename)) filesCreated.push(action.filename);
              await new Promise(r2 => setTimeout(r2, 400));
              break;
            }
            case 'type': {
              await this.api('type', { text: action.text });
              await new Promise(r2 => setTimeout(r2, 600));
              break;
            }
            case 'press': {
              await this.api('press', { key: action.key });
              await new Promise(r2 => setTimeout(r2, 500));
              break;
            }
            case 'click_index': {
              const r = await this.api('click-index', { index: action.index });
              sendEvent?.('log', { agent: 'Navigator', message: r.ok ? `✓ Clicked element [${action.index}]` : `✗ Element [${action.index}] not found` });
              await new Promise(r2 => setTimeout(r2, 1200));
              break;
            }
            case 'type_index': {
              const r = await this.api('type-index', { index: action.index, text: action.text });
              sendEvent?.('log', { agent: 'Navigator', message: `⌨ Typed into element [${action.index}]: ${String(action.text).slice(0, 40)}` });
              await new Promise(r2 => setTimeout(r2, 400));
              break;
            }
            case 'click_text': {
              const ok = await this.api('click-text', { text: action.text });
              sendEvent?.('log', { agent: 'Vision', message: ok ? `✓ Clicked "${action.text}"` : `✗ Not found: "${action.text}"` });
              await new Promise(r2 => setTimeout(r2, 1500));
              break;
            }
            case 'click': {
              await this.api('click', { x: action.x, y: action.y });
              await new Promise(r2 => setTimeout(r2, 700));
              break;
            }
            case 'scroll': {
              await this.api('scroll', { direction: action.direction || 'down' });
              break;
            }
            case 'back': {
              await this.api('back', {});
              break;
            }
            case 'forward': {
              await this.api('forward', {});
              break;
            }
            case 'read_page': {
              didReadPage = true;
              sendEvent?.('log', { agent: 'Vision', message: '📖 Reading page + indexing elements...' });
              const txt = await this.api('page-text', {});
              if (txt && txt.trim().length > 0) {
                stepOutput.text += `\n[SCREEN CONTENTS]:\n${txt.trim().slice(0, 8000)}\n`;
                sendEvent?.('log', { agent: 'Vision', message: `✓ Read ${txt.length} chars from page` });
              } else {
                sendEvent?.('log', { agent: 'Vision', message: 'Page was empty or unreadable.' });
              }
              const { lines, count } = await this.currentElements();
              if (count > 0) {
                stepOutput.text += `\n[SCREEN ELEMENTS]:\n${lines}\n`;
                sendEvent?.('log', { agent: 'Navigator', message: `🔢 Indexed ${count} interactive elements` });
              }
              break;
            }
            case 'screenshot': {
              sendEvent?.('log', { agent: 'Vision', message: '📸 Reading screenshot with vision...' });
              try {
                const shotRes = await this.api('screenshot-json', {});
                if (shotRes?.image) {
                  const visionText = await generateContent(
                    'Extract all visible text from this screenshot exactly as it appears. Return ONLY the text.',
                    'You are an AI assistant that extracts text from images.', shotRes.image
                  );
                  if (visionText?.trim()) {
                    stepOutput.text += `\n[SCREEN CONTENTS]:\n${visionText.trim().slice(0, 8000)}\n`;
                    didReadPage = true;
                  }
                }
              } catch (e) { sendEvent?.('log', { agent: 'Vision', message: `Vision read failed: ${e.message.substring(0, 60)}` }); }
              break;
            }
            case 'shell': {
              sendEvent?.('log', { agent: 'ComputerUseAgent', message: `Running: ${action.command}` });
              const shellRes = await this.api('execute', { command: action.command });
              const out = shellRes?.output || '';
              if (out) {
                stepOutput.text += `${out.trim()}\n`;
                sendEvent?.('log', { agent: 'Output', message: out.trim().substring(0, 400) });
              }
              await new Promise(r2 => setTimeout(r2, 700));
              break;
            }
            case 'wait': {
              await new Promise(r2 => setTimeout(r2, action.ms || 1000));
              break;
            }
          }
        } catch (e) {
          sendEvent?.('log', { agent: 'ComputerUseAgent', message: `⚠ Action failed: ${action.action} — ${e.message.substring(0, 120)}` });
          if (String(e.message).toLowerCase().includes('browser unavailable')) {
            lastError = 'Browser unavailable';
          }
        }
      }

      capturedOutput = stepOutput.text;

      if (this.hasError(capturedOutput) && isCode) {
        lastError = capturedOutput.split('\n').filter(l => l.trim()).slice(-12).join('\n');
        sendEvent?.('log', { agent: 'Debugger', message: '⚠ Error found in output! Retrying...' });
      } else if ((isResearch || isLink) && !didReadPage) {
        lastError = "You finished but you DIDN'T READ the page content with 'read_page'.";
        sendEvent?.('log', { agent: 'Debugger', message: `⚠ ${lastError}` });
      } else {
        sendEvent?.('log', { agent: 'ComputerUseAgent', message: '✅ Task executed without errors.' });
        lastError = null;
        break;
      }
    }

    if (lastError && attempts >= MAX_ATTEMPTS) {
      sendEvent?.('log', { agent: 'Debugger', message: `⚠ Gave up after ${MAX_ATTEMPTS} attempts. Falling back to server-side processing.` });
    }

    // --- Fallback / enrichment for research & links: read sources server-side ---
    let researchText = capturedOutput;
    if ((isResearch || isLink) && (!researchText || researchText.length < 300)) {
      researchText = await this.serverSideRead(task, sendEvent, intent);
    }

    // --- Synthesis: answer the user's question from everything read ---
    if ((isResearch || isLink) && researchText && researchText.trim().length > 0) {
      sendEvent?.('log', { agent: 'Reasoner', message: 'Synthesizing answer from everything read...' });
      const synth = await generateContent(
        `The user asked: "${task}"\n\nInformation I gathered from the browser/internet:\n${researchText.slice(0, 16000)}\n\nReframe this into a clear, well-structured answer that DIRECTLY answers the user's question. Follow JEXI OS formatting rules.`,
        JEXI_SYSTEM_PROMPT
      );
      try { saveInternetKnowledge(task, synth, []); } catch (e) {}
      return { success: true, output: synth, files: filesCreated };
    }

    // Coding result: present verified code
    if (isCode) {
      try {
        const codeBlock = filesCreated.map(f => `\`\`\`\nFile: ${f}\n\`\`\``).join('\n');
        saveCodingKnowledge(task, 'code', capturedOutput.slice(0, 8000), filesCreated);
        return { success: true, output: capturedOutput, files: filesCreated, codeBlock };
      } catch (e) { return { success: true, output: capturedOutput, files: filesCreated }; }
    }

    return { success: true, output: capturedOutput, files: filesCreated };
  }

  async pingDesktop(sendEvent) {
    try {
      const res = await this.api('status', {});
      if (res?.ok) { sendEvent?.('log', { agent: 'Vision', message: 'Browser eyes online.' }); return { ok: true }; }
      sendEvent?.('log', { agent: 'Vision', message: '⚠ Browser eyes offline — using server-side reading.' });
      return { ok: false, error: res?.error || 'offline' };
    } catch (e) {
      sendEvent?.('log', { agent: 'Vision', message: '⚠ Browser eyes offline — using server-side reading.' });
      return { ok: false, error: e.message };
    }
  }

  async api(endpoint, payload) {
    const res = await fetch(`${VIRTUAL_API}/api/desktop/coder/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (endpoint === 'page-text') return data.text || '';
    if (endpoint === 'click-text') return data.success;
    return data;
  }

  async serverSideRead(task, sendEvent, intent) {
    sendEvent?.('log', { agent: 'Researcher', message: 'Reading sources server-side...' });
    let url = null;
    if (intent === 'link_analysis') {
      const m = task.match(/https?:\/\/[^\s)'"]+/i);
      url = m ? m[0] : null;
    }
    let chunks = '';
    try {
      if (url) {
        const content = await extractContent(url);
        chunks += `\n--- ${content.title} ---\n${content.content.slice(0, 8000)}\n`;
        sendEvent?.('website', { site: { title: content.title, url, favicon: `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`, status: 'success' } });
        sendEvent?.('log', { agent: 'Researcher', message: `✓ Read ${content.title}` });
      } else {
        const sources = await aggregateSearch(task);
        sendEvent?.('log', { agent: 'Researcher', message: `Found ${sources.length} sources. Deep-reading top ${Math.min(sources.length, 4)}...` });
        for (const src of sources.slice(0, 4)) {
          try {
            const content = await extractContent(src.link);
            chunks += `\n--- ${content.title} (${src.link}) ---\n${content.content.slice(0, 6000)}\n`;
            sendEvent?.('website', { site: { title: content.title, url: src.link, favicon: `https://www.google.com/s2/favicons?domain=${new URL(src.link).hostname}&sz=64`, status: 'success' } });
          } catch (e) {
            sendEvent?.('log', { agent: 'Researcher', message: `✗ Could not read ${src.link}` });
          }
        }
      }
    } catch (e) {
      sendEvent?.('log', { agent: 'Researcher', message: `✗ Server-side read failed: ${e.message.substring(0, 80)}` });
    }
    return chunks;
  }
}
