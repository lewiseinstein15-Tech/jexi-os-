import fs from 'fs';
import path from 'path';
import { planProject } from './Architect.js';

const workspaceDir = path.join(process.cwd(), 'jexi-workspace');

export async function generateCode(query, errorContext = null) {
  // 1. DEBUG MODE: If there's an error, ask the LLM to fix it
  if (errorContext) {
    const prompt = `The user asked to: "${query}"\n\nThe code failed with this error:\n${errorContext}\n\nPlease rewrite the code to fix this error. Return ONLY valid JSON with the same schema.`;
    const fixedProject = await planProject(prompt);
    return {
      summary: `### 🛠️ JEXI AUTO-DEBUGGER\n\nI analyzed the error and rewrote the code.\n\n**Error Fixed:** \`${errorContext.split('\n')[0]}\``,
      files: fixedProject.files,
      entryPoint: fixedProject.entryPoint,
      language: fixedProject.language
    };
  }

  // 2. BUILD MODE: Plan and create project structure using LLM
  const project = await planProject(query);
  
  // Write files to disk
  if (!fs.existsSync(workspaceDir)) fs.mkdirSync(workspaceDir, { recursive: true });
  project.files.forEach(file => {
    fs.writeFileSync(path.join(workspaceDir, file.name), file.code, 'utf-8');
  });

  return {
    summary: `### 💻 JEXI CODING AGENT\n\nI have analyzed your request and generated a **${project.language}** solution.\n\n**File(s) Created:**\n${project.files.map(f => `- \`${f.name}\``).join('\n')}\n\nInitializing development pipeline...`,
    files: project.files,
    entryPoint: project.entryPoint,
    language: project.language
  };
}

export async function applyFix(query, error) {
  return await generateCode(query, error);
}
