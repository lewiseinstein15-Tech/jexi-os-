import { planner } from './src/services/Planner.js';
import { orchestrator } from './src/services/Orchestrator.js';

const testCases = [
  "Build me a weather app",
  "Research the latest AI trends",
  "Learn about quantum computing"
];

async function runTests() {
  console.log('🧪 Testing JEXI OS Planner and Orchestrator\n');
  
  for (const query of testCases) {
    console.log(`\n📝 Query: "${query}"`);
    console.log('─'.repeat(50));
    
    const plan = await planner.analyzeIntent(query);
    console.log('Plan:', JSON.stringify(plan, null, 2));
    
    const results = await orchestrator.executePlan(plan, query, () => {}); // silent stub — no live client attached
    console.log('Results Summary:', JSON.stringify({
      success: results.success,
      intent: results.intent,
      tasks: results.tasks,
      summary: results.summary?.substring(0, 100) + '...',
      confidence: results.statistics.confidence
    }, null, 2));
    
    console.log('\n' + '═'.repeat(60) + '\n');
  }
}

runTests().catch(console.error);
