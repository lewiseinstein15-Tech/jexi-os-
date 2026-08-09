import { generateContent } from './LLMClient.js';
import { jsonrepair } from 'jsonrepair';
import { recordError } from './SelfMonitor.js';

/** Strip markdown fences + surrounding prose, then isolate the outermost {...} block. */
function isolateJson(raw) {
  let clean = String(raw || '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) clean = clean.substring(firstBrace, lastBrace + 1);
  return clean.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
}

/** Post-process parsed files: unescape newlines, enforce safe buttons. */
function normalizeFiles(files) {
  return (files || [])
    .filter(f => f.name && f.code)
    .map(f => ({
      name: f.name,
      code: f.code
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/<button(?![^>]*type=)/g, '<button type="button"'),
    }));
}

/** Strict parse with a one-shot retry when the model wraps JSON in prose. */
async function parseProject(raw, prompt, systemInstruction, sendEvent) {
  // Pass 1 — clean the raw response
  try {
    const project = JSON.parse(jsonrepair(isolateJson(raw)));
    project.files = normalizeFiles(project.files);
    if (project.files.length === 0) throw new Error('No valid files generated.');
    return project;
  } catch (e) { /* fall through to retry */ }

  // Pass 2 — one targeted retry demanding ONLY raw JSON (models love markdown fences)
  try {
    sendEvent('log', { agent: 'Architect', message: '⚠ JSON was malformed — retrying with strict format…' });
    const retry = await generateContent(
      `${prompt}\n\nIMPORTANT: Reply with ONLY the raw JSON object. No markdown, no code fences, no explanation, no trailing text — it is parsed directly with JSON.parse().`,
      systemInstruction + '\nOUTPUT FORMAT: ONLY the raw JSON object, nothing else.',
      null,
      { prefer: 'gemini', temperature: 0.2 }
    );
    const retryProject = JSON.parse(jsonrepair(isolateJson(retry)));
    retryProject.files = normalizeFiles(retryProject.files);
    if (retryProject.files.length === 0) throw new Error('No valid files generated.');
    sendEvent('log', { agent: 'Architect', message: '✓ Strict retry succeeded.' });
    return retryProject;
  } catch (retryError) {
    sendEvent('log', { agent: 'Architect', message: '✗ Strict retry also failed.' });
    throw retryError;
  }
}

/** Regex fallback: pull every { "name": ..., "code": ... } block out of the mess. */
function regexFallback(cleanResponse) {
  const blocks = [...cleanResponse.matchAll(/"name"\s*:\s*"([^"]+)"[\s\S]*?"code"\s*:\s*"((?:[^"\\]|\\.)*)"/g)];
  const files = blocks.map(m => ({
    name: m[1],
    code: m[2]
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .replace(/<button(?![^>]*type=)/g, '<button type="button"'),
  })).filter(f => f.name && f.code);
  if (files.length === 0) throw new Error('Regex fallback failed.');
  const entryMatch = cleanResponse.match(/"entryPoint"\s*:\s*"([^"]+)"/);
  return {
    language: 'HTML/CSS/JS',
    entryPoint: entryMatch ? entryMatch[1] : files[0].name,
    summary: 'Fallback parse',
    files,
  };
}

export async function planProject(query, sendEvent, existingCode = null, errorContext = null, attemptNum = 1) {
  let systemInstruction = `You are JEXI Architect, the code design brain of JEXI OS (created by Lewis Einstein). Respond with ONLY valid JSON.
Schema: { "language": "string", "entryPoint": "string", "summary": "string", "files": [{"name": "string", "code": "string"}] }
RULES:
1. Single index.html for web apps (inline CSS/JS).
2. Node.js MUST use built-in modules (require('http')). NO express, NO external npm packages.
3. Python scripts MUST use built-in modules only (no pip packages that may not be installed).
4. Servers MUST use port 8080.
5. HTML buttons in forms MUST have type="button".
6. Mobile-responsive, modern UI (Flexbox/Grid).
7. Escape newlines properly: use \\n inside JSON strings.
8. Write clean, correct, runnable code — it will be executed and checked.`;

  let prompt = `User Request: "${query}"\n\nGenerate the complete project JSON.`;

  if (existingCode && errorContext) {
    // DEBUG MODE: read the error, fix it, never leave the loop until clean
    systemInstruction += `\nYou are in DEBUG MODE. The previous code FAILED. Read the error, fix the exact cause, and keep the rest of the logic intact. Re-run mentally: your fixed code must not produce the same error.`;
    if (attemptNum === 2) {
      prompt = `Code failed with error:\n${errorContext}\n\nOriginal Code:\n${existingCode}\n\nUser Request: "${query}"\n\nAttempt 2: Fix the specific error, but also review the logic. Return ONLY valid JSON.`;
    } else if (attemptNum >= 3) {
      prompt = `Code repeatedly fails with:\n${errorContext}\n\nOriginal Code:\n${existingCode}\n\nAttempt ${attemptNum}: RADICAL SIMPLIFICATION. Strip out complex logic. Write the absolute simplest version that fulfills the core request: "${query}". Return ONLY valid JSON.`;
    }
  }

  // Code planning + debugging uses Gemini first (much stronger at writing and
  // fixing code than the fast Groq text model), with Groq as automatic fallback.
  const response = await generateContent(prompt, systemInstruction, null, { prefer: 'gemini', temperature: 0.2 });
  const cleanResponse = isolateJson(response);

  try {
    return await parseProject(cleanResponse, prompt, systemInstruction, sendEvent);
  } catch (e) {
    // Last resort: regex extraction of each file block
    try {
      const project = regexFallback(cleanResponse);
      sendEvent('log', { agent: 'Architect', message: '⚠ JSON parse failed, but Regex Fallback extracted the files.' });
      return project;
    } catch (regexError) {
      recordError('architect', `Architect returned invalid JSON for: "${String(query).slice(0, 90)}"`);
      throw new Error('Architect returned invalid JSON.');
    }
  }
}

export async function generateCode(query, sendEvent) { return await planProject(query, sendEvent); }
export async function applyFix(query, errorContext, existingCode, attemptNum, sendEvent) {
  return await planProject(query, sendEvent, existingCode, errorContext, attemptNum);
}
