import { generateContent } from './LLMClient.js';
import { jsonrepair } from 'jsonrepair';

export async function planProject(query, sendEvent, existingCode = null, errorContext = null, attemptNum = 1) {
  let systemInstruction = `You are JEXI Architect. Respond with ONLY valid JSON.
Schema: { "language": "string", "entryPoint": "string", "summary": "string", "files": [{"name": "string", "code": "string"}] }
RULES:
1. Single index.html for web apps (inline CSS/JS).
2. Node.js MUST use built-in modules (require('http')). NO express.
3. Servers MUST use port 8080.
4. HTML buttons in forms MUST have type="button".
5. Mobile-responsive, modern UI (Flexbox/Grid).`;

  let prompt = `User Request: "${query}"\n\nGenerate the complete project JSON.`;

  if (existingCode && errorContext) {
    // DEBUG MODE: Strategy variation based on attempt number
    systemInstruction += `\nYou are in DEBUG MODE. The code failed.`;
    if (attemptNum === 2) {
      prompt = `Code failed with error:\n${errorContext}\n\nOriginal Code:\n${existingCode}\n\nUser Request: "${query}"\n\nAttempt 2: Fix the specific error, but also review the logic. Return ONLY valid JSON.`;
    } else if (attemptNum >= 3) {
      prompt = `Code repeatedly fails with:\n${errorContext}\n\nOriginal Code:\n${existingCode}\n\nAttempt ${attemptNum}: RADICAL SIMPLIFICATION. Strip out complex logic. Write the absolute simplest version of the app that fulfills the core request: "${query}". Return ONLY valid JSON.`;
    }
  }

  const response = await generateContent(prompt, systemInstruction);
  let cleanResponse = response.replace(/```json/g, '').replace(/```/g, '');
  const firstBrace = cleanResponse.indexOf('{');
  const lastBrace = cleanResponse.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) cleanResponse = cleanResponse.substring(firstBrace, lastBrace + 1);
  cleanResponse = cleanResponse.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');

  try {
    const repairedJson = jsonrepair(cleanResponse);
    const project = JSON.parse(repairedJson);
    project.files = (project.files || []).filter(f => f.name && f.code);
    project.files.forEach(file => {
      if (file.code) {
        file.code = file.code.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
        file.code = file.code.replace(/<button(?![^>]*type=)/g, '<button type="button"');
      }
    });
    if (project.files.length === 0) throw new Error("No valid files generated.");
    return project;
  } catch (e) {
    // Regex Fallback Extraction
    try {
      const entryMatch = cleanResponse.match(/"entryPoint"\s*:\s*"([^"]+)"/);
      const entryPoint = entryMatch ? entryMatch[1] : 'index.html';
      const codeMatch = cleanResponse.match(/"code"\s*:\s*"([\s\S]*?)"\s*[,}]/);
      let code = codeMatch ? codeMatch[1] : '';
      if (!code) throw new Error("Regex fallback failed.");
      code = code.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      code = code.replace(/<button(?![^>]*type=)/g, '<button type="button"');
      const project = { language: 'HTML/CSS/JS', entryPoint, summary: "Fallback parse", files: [{ name: entryPoint, code }] };
      sendEvent('log', { agent: 'Architect', message: '⚠ JSON parse failed, but Regex Fallback extracted code.' });
      return project;
    } catch (regexError) {
      throw new Error("Architect returned invalid JSON.");
    }
  }
}

export async function generateCode(query, sendEvent) { return await planProject(query, sendEvent); }
export async function applyFix(query, errorContext, existingCode, attemptNum, sendEvent) { 
  return await planProject(query, sendEvent, existingCode, errorContext, attemptNum); 
}
