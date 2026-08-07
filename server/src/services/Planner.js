const MANAGER_URL = 'http://localhost:3001';

export class Planner {
  async analyzeIntent(query) {
    const lowerQuery = query.toLowerCase();
    
    if (/clear (all )?memory|forget everything|wipe memory|delete memory/i.test(query)) return { intent: "clear_memory", tasks: ["memory"], reasoning: "User wants to wipe memory." };
    if (/study|learn everything about|fill knowledge base|master topic/i.test(query)) {
      const topic = query.replace(/study|learn everything about|fill knowledge base|master topic/i, '').trim();
      return { intent: "study_topic", tasks: ["knowledge"], reasoning: "User wants JEXI to study a topic.", payload: topic };
    }

    // NEW: Auto-route coding or research tasks to the Virtual Desktop!
    const isCoding = /build|create|make|develop|write a|code|function|script|program|component|app|application|python|javascript|react|html|website/i.test(query);
    const isResearch = /search|research|find|look up|google|what is|how to/i.test(query);
    
    if (isCoding || isResearch) {
      return { intent: "computer_use", tasks: ["computer_use"], reasoning: "Task requires visual desktop interaction." };
    }

    const isConversation = /^(hello|hey|hi|sup|yo|howdy|good morning|good evening|what's up|wassup)\b/i.test(query);
    if (isConversation) return { intent: "conversation", tasks: ["memory"], reasoning: "User is greeting." };
    
    if (/what is my name|what do you remember|who am i/i.test(query)) return { intent: "memory_query", tasks: ["memory"], reasoning: "User is asking about memory." };

    try {
      const kbRes = await fetch(`${MANAGER_URL}/api/knowledge/search?query=${encodeURIComponent(query)}`);
      const kbData = await kbRes.json();
      if (kbData && kbData.length > 0) return { intent: "knowledge_recall", tasks: ["reasoning", "memory"], reasoning: "Found relevant book in Knowledge Base." };
    } catch (e) {}

    return { intent: "learning_research", tasks: ['research', 'reasoning', 'memory'], reasoning: "Will research and learn." };
  }
}
export const planner = new Planner();
