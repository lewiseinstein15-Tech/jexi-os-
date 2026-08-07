import fs from 'fs';
import path from 'path';
import { generateCode, applyFix, planProject } from './Architect.js';
import { runFile } from './Runner.js';
import { aggregateSearch } from './SearchEngine.js';
import { extractContent } from './Extractor.js';
import { reasonAndWrite } from './Reasoner.js';
import { learnHowTo } from './Researcher.js';
import { generateContent } from './LLMClient.js';
import { studyTopic, recallKnowledge } from './KnowledgeAgent.js';
import { ComputerUseAgent } from './ComputerUseAgent.js';

const MANAGER_URL = 'http://localhost:3001';
const workspaceDir = path.join(process.cwd(), 'jexi-workspace');

function clearWorkspace() {
  if (fs.existsSync(workspaceDir)) fs.readdirSync(workspaceDir).forEach(f => fs.unlinkSync(path.join(workspaceDir, f)));
  else fs.mkdirSync(workspaceDir, { recursive: true });
}

export class Orchestrator {
  constructor() { this.executionHistory = []; }

  async executePlan(plan, query, sendEvent) {
    const startTime = Date.now();
    const results = { success: true, query, intent: plan.intent, tasks: plan.tasks, agentResults: {}, summary: '', sources: [], statistics: { executionTime: 0, agentsUsed: plan.tasks.length, confidence: 0 } };

    try {
      if (plan.intent === 'clear_memory') {
        await fetch(`${MANAGER_URL}/api/memory/clear`, { method: 'POST' });
        clearWorkspace();
        results.summary = "### 🧠 JEXI OS\n\n✓ Memory core wiped completely.";
        results.statistics.confidence = 100;
        return results;
      }

      if (plan.intent === 'conversation') {
        results.summary = `### 🧠 JEXI OS\n\nHeyyy! 👋💜✨ I'm JEXI! What are we building today? 🚀`;
        results.statistics.confidence = 100;
        return results;
      }

      if (plan.intent === 'memory_query') {
        const memRes = await fetch(`${MANAGER_URL}/api/memory`);
        const memData = await memRes.json();
        results.summary = `### 🧠 JEXI OS\n\nI remember your name is **${memData.userProfile?.name || 'Unknown'}**! 💜`;
        results.statistics.confidence = 100;
        return results;
      }

      if (plan.intent === 'study_topic') {
        const topic = plan.payload || query;
        const content = await studyTopic('07_GENERAL_KNOWLEDGE', topic.replace(/\s+/g, '_'), sendEvent);
        results.summary = `### 📚 JEXI SCHOLAR\n\nI have studied **${topic}**.\n\n${content.substring(0, 1000)}...`;
        results.statistics.confidence = 100;
        return results;
      }

      // === COMPUTER USE ===
      if (plan.intent === 'computer_use') {
        sendEvent('log', { agent: 'Orchestrator', message: 'Taking control of Virtual Desktop...' });
        const agent = new ComputerUseAgent();
        const result = await agent.executeTask(query, sendEvent);
        
        if (result.success) {
          const isWebsite = result.files && result.files.some(f => f.endsWith('.html'));
          const isCode = result.files && result.files.some(f => f.endsWith('.py') || f.endsWith('.js'));
          
          if (isWebsite) {
            let summary = `### 🖥️ JEXI VIRTUAL DESKTOP\n\n✅ Website created successfully!\n\n`;
            summary += `**Files Created:**\n${result.files.map(f => `- \`${f}\``).join('\n')}\n\n`;
            summary += `📁 **[View Generated Files](http://localhost:3002/workspace)**\n`;
            const htmlFile = result.files.find(f => f.endsWith('.html'));
            if (htmlFile) {
              summary += `\n🌐 **[View Live Website](http://localhost:3002/preview/${htmlFile}?v=${Date.now()})**`;
            }
            results.summary = summary;
          } else if (result.output && result.output.length > 200) {
            // Research output - show the synthesized answer
            results.summary = `### 🧠 JEXI OS\n\n${result.output}`;
          } else {
            // Code output
            let summary = `### 🖥️ JEXI VIRTUAL DESKTOP\n\n✅ Task completed!\n\n`;
            if (result.files && result.files.length > 0) {
              summary += `**Files Created:**\n${result.files.map(f => `- \`${f}\``).join('\n')}\n\n`;
            }
            if (result.output && result.output.trim().length > 0) {
              summary += `**Output:**\n\`\`\`bash\n${result.output.trim().substring(0, 500)}\n\`\`\`\n\n`;
            }
            if (result.files && result.files.length > 0) {
              summary += `📁 **[View Generated Files](http://localhost:3002/workspace)**`;
            }
            results.summary = summary;
          }
          results.statistics.confidence = 100;
        } else {
          results.summary = `### 🖥️ JEXI VIRTUAL DESKTOP\n\n⚠ Task failed.`;
          results.statistics.confidence = 50;
        }
        return results;
      }

      // === KNOWLEDGE RECALL ===
      if (plan.intent === 'knowledge_recall') {
        const knowledgeContext = await recallKnowledge(query, sendEvent);
        if (knowledgeContext) {
          const responsePrompt = `The user asked: "${query}"\n\nKnowledge:\n${knowledgeContext}\n\nWrite a well-structured response with numbered points.`;
          let structuredResponse = await generateContent(responsePrompt, 'You are JEXI OS.');
          results.summary = `### 🧠 JEXI OS\n\n${structuredResponse}`;
          results.statistics.confidence = 100;
          return results;
        }
      }

      results.summary = `### 🧠 JEXI OS\n\nTask completed.`;
      results.statistics.confidence = 100;
      return results;

    } catch (error) {
      results.success = false; results.error = error.message;
      sendEvent('log', { agent: 'System', message: `Error: ${error.message}` });
      return results;
    }
  }
}
export const orchestrator = new Orchestrator();
