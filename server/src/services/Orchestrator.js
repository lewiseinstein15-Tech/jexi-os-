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
        const lowerTopic = topic.toLowerCase();
        let category = '07_GENERAL_KNOWLEDGE';
        if (/python|javascript|react|node|html|css|api|backend|frontend/.test(lowerTopic)) category = '01_PROGRAMMING';
        else if (/machine learning|ai|neural|llm/.test(lowerTopic)) category = '02_AI';
        else if (/algebra|calculus|geometry|statistics|math/.test(lowerTopic)) category = '03_MATHEMATICS';
        else if (/quantum|mechanics|thermodynamics|physics/.test(lowerTopic)) category = '04_PHYSICS';
        
        const content = await studyTopic(category, topic.replace(/\s+/g, '_'), sendEvent);
        results.summary = `### 📚 JEXI SCHOLAR\n\nI have successfully studied **${topic}**.\n\n**Knowledge Preview:**\n\n${content.substring(0, 1000)}...`;
        results.statistics.confidence = 100;
        return results;
      }

      // === COMPUTER USE (VISUAL DESKTOP WITH FULL CHAT RESPONSE) ===
      if (plan.intent === 'computer_use') {
        sendEvent('log', { agent: 'Orchestrator', message: 'Taking control of Virtual Desktop...' });
        const agent = new ComputerUseAgent();
        const result = await agent.executeTask(query, sendEvent);
        
        if (result.success) {
          let summary = `### 🖥️ JEXI VIRTUAL DESKTOP\n\n✅ I have completed the task visually on the virtual desktop!\n\n`;
          
          // Show files created for THIS task only
          if (result.files && result.files.length > 0) {
            summary += `**Files Created:**\n${result.files.map(f => `- \`${f}\``).join('\n')}\n\n`;
          }
          
          // Show the actual terminal output
          if (result.output && result.output.trim().length > 0) {
            summary += `**Terminal Output:**\n\`\`\`bash\n${result.output.trim().substring(0, 500)}\n\`\`\`\n\n`;
          } else {
            summary += `*No output was captured from the terminal.*\n\n`;
          }
          
          // Add link to view files
          if (result.files && result.files.length > 0) {
            summary += `📁 **[View Generated Files](http://localhost:3002/workspace)**`;
            
            // Add preview link for HTML files
            const htmlFile = result.files.find(f => f.endsWith('.html'));
            if (htmlFile) {
              summary += `\n\n🌐 **[View Live Website](http://localhost:3002/preview/${htmlFile}?v=${Date.now()})**`;
            }
          }
          
          results.summary = summary;
          results.statistics.confidence = 100;
        } else {
          results.summary = `### 🖥️ JEXI VIRTUAL DESKTOP\n\n⚠ I encountered issues completing the task visually.`;
          results.statistics.confidence = 50;
        }
        return results;
      }

      // === SMART SEMANTIC RECALL ===
      if (plan.intent === 'knowledge_recall') {
        sendEvent('log', { agent: 'Memory Agent', message: '✓ Found relevant knowledge in books! Retrieving...' });
        const knowledgeContext = await recallKnowledge(query, sendEvent);
        if (knowledgeContext) {
          sendEvent('log', { agent: 'Reasoner', message: 'Generating structured response from learned knowledge...' });
          const responsePrompt = `The user asked: "${query}"\n\nI have this expert knowledge from my internal files:\n${knowledgeContext}\n\nPlease write a comprehensive, well-structured response. Use Markdown. Use LaTeX ($$) for math.`;
          let structuredResponse = await generateContent(responsePrompt, 'You are JEXI OS, an advanced AI operating system.');
          results.summary = `### 🧠 JEXI OS\n\n${structuredResponse}\n\n*💡 Retrieved from internal knowledge base.*`;
          results.statistics.confidence = 100;
          return results;
        }
      }

      // === STANDARD TASKS ===
      for (const task of plan.tasks) {
        sendEvent('log', { agent: 'Orchestrator', message: `Executing: ${task}` });
        const agentResult = await this.executeAgent(task, query, results, sendEvent);
        results.agentResults[task] = agentResult;
        this.mergeResults(results, task, agentResult);
      }

      results.summary = this.generateSummary(results, plan);
      results.statistics.executionTime = parseFloat(((Date.now() - startTime) / 1000).toFixed(2));
      results.statistics.confidence = this.calculateConfidence(results);
      return results;

    } catch (error) {
      results.success = false; results.error = error.message;
      sendEvent('log', { agent: 'System', message: `Error: ${error.message}` });
      return results;
    }
  }

  async executeAgent(task, query, currentResults, sendEvent) {
    switch (task) {
      case 'research': return await this.executeResearchAgent(query, sendEvent);
      case 'coding': return await this.executeDevLoop(query, sendEvent, currentResults.agentResults.research);
      default: return { success: true };
    }
  }

  async executeResearchAgent(query, sendEvent) {
    const learning = await learnHowTo(query, sendEvent);
    return { success: true, knowledge: learning.knowledge, sources: learning.sources };
  }

  async executeDevLoop(query, sendEvent, researchKnowledge = null) {
    let enhancedQuery = query;
    if (researchKnowledge) enhancedQuery = `${query}\n\nLEARNED KNOWLEDGE:\n${researchKnowledge}`;
    
    let project = await generateCode(enhancedQuery, sendEvent);
    clearWorkspace();
    project.files.forEach(f => fs.writeFileSync(path.join(workspaceDir, f.name), f.code, 'utf-8'));

    let attempts = 1;
    const MAX_ATTEMPTS = 5;
    let runResult = { success: false };

    while (attempts <= MAX_ATTEMPTS) {
      runResult = await runFile(project.entryPoint, (type, data) => {
        data.split('\n').filter(Boolean).forEach(line => sendEvent('log', { agent: type === 'stderr' ? 'Error' : 'Output', message: line }));
      });
      if (runResult.success) break;
      if (attempts < MAX_ATTEMPTS) {
        project = await applyFix(query, runResult.output, project.files[0]?.code, attempts, sendEvent);
        const fixedFile = project.files.find(f => f.name === project.entryPoint);
        if (fixedFile) fs.writeFileSync(path.join(workspaceDir, fixedFile.name), fixedFile.code, 'utf-8');
      }
      attempts++;
    }

    let finalSummary = runResult.success ? project.summary : project.summary + "\n\n⚠ *Max debug attempts reached.*";
    return { success: runResult.success, language: project.language, files: project.files, entryPoint: project.entryPoint, summary: finalSummary };
  }

  mergeResults(results, task, agentResult) { if (task === 'search') results.sources = agentResult.sources || []; }
  
  generateSummary(results, plan) {
    if (results.agentResults.coding?.summary) {
      let summary = results.agentResults.coding.summary;
      summary += results.agentResults.coding.success ? `\n\n**Final Status:** ✅ Verified Working` : `\n\n**Final Status:** ❌ Failed`;
      summary += `\n\n📁 **[View Generated Files](http://localhost:3002/workspace)**`;
      const htmlFile = results.agentResults.coding.files?.find(f => f.name.endsWith('.html'));
      if (htmlFile) summary += `\n\n🌐 **[View Live Website](http://localhost:3002/preview/${htmlFile.name}?v=${Date.now()})**`;
      return summary;
    }
    return `### 🧠 JEXI OS\n\nTask completed.`;
  }
  
  calculateConfidence(results) {
    let c = 0;
    if (results.agentResults.research?.success) c += 30;
    if (results.agentResults.coding?.success) c += 50;
    return Math.min(c, 100);
  }
}
export const orchestrator = new Orchestrator();
