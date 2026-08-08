import { searchKnowledge } from './MemoryManager.js';

/**
 * JEXI's Planner — decides which agents/tools to use and when.
 * This is the "know when to call which tool" brain.
 */
export class Planner {
  async analyzeIntent(query, opts = {}) {
    const q = String(query || '').toLowerCase();
    const hasImage = Boolean(opts.image);

    // 0. Image given → vision recognition
    if (hasImage) {
      return { intent: 'image_recognition', tasks: ['vision', 'reasoning', 'memory'], reasoning: 'User provided an image to analyze.', payload: opts.image };
    }

    // 1. Clear memory
    if (/clear (all )?memory|forget everything|wipe memory|delete memory/i.test(q)) {
      return { intent: 'clear_memory', tasks: ['memory'], reasoning: 'User wants to wipe memory.' };
    }

    // 2. Any link in the message → analyze it (YouTube, TikTok, Instagram, article, any site)
    const linkMatch = query.match(/https?:\/\/[^\s)'"]+/i);
    if (linkMatch && !/http:\/\/localhost|127\.0\.0\.1|\.onion/i.test(linkMatch[0])) {
      return { intent: 'link_analysis', tasks: ['browser', 'extractor', 'reasoning', 'memory'], reasoning: 'User shared a link — JEXI will open it with the browser and summarize.', payload: { url: linkMatch[0], fullQuery: query } };
    }

    // 3. Study / deep learn
    if (/study|learn everything about|fill knowledge base|master topic|teach me (everything about )?/i.test(q)) {
      const topic = query.replace(/study|learn everything about|fill knowledge base|master topic|teach me/i, '').trim().replace(/^about\s+/i, '');
      return { intent: 'study_topic', tasks: ['scholar', 'research', 'memory'], reasoning: 'User wants JEXI to deep-study and store in the knowledge library.', payload: topic };
    }

    // 4. Math detection — symbols, formulas, calculations, word problems
    const mathHints = /(calculate|compute|solve|integrate|derivative|differentiate|sum of|multiply|divide|sqrt|square root|equation|formula|math|algebra|calculus|geometry|trigonometry|percentage|what is \d|\d+\s*[+\-×÷*\/]\s*\d|\^2|\$\$)/i;
    if (mathHints.test(q) && !this.isCoding(q)) {
      return { intent: 'math_solve', tasks: ['reasoning', 'memory'], reasoning: 'Mathematical question — solve with structured LaTeX steps.' };
    }

    // 5. Coding / programming (code in the question, or ask to build/debug)
    if (this.isCoding(q)) {
      return { intent: 'code_task', tasks: ['architect', 'coder', 'runner', 'debugger', 'memory'], reasoning: 'Coding task — write, run, and verify code before answering.' };
    }

    // 6. Greetings & pure conversation
    if (/^(hello|hey|hi|sup|yo|howdy|good morning|good evening|what's up|wassup|who are you|what are you|who made you|who created you)\b/i.test(q)) {
      return { intent: 'conversation', tasks: ['memory'], reasoning: 'Conversation / identity question.' };
    }

    // 7. Memory questions
    if (/what is my name|what do you remember|who am i|remember me/i.test(q)) {
      return { intent: 'memory_query', tasks: ['memory'], reasoning: 'User asks about memory.' };
    }

    // 8. Self-diagnosis — JEXI checks her own system, reads her source, reports root causes
    if (/self[- ]?check|check yourself|diagnos(e|tic)|run (a )?(system|self) check|system status|are you (ok|okay|healthy|fine)|monitor yourself|what'?s wrong|any errors|health check/i.test(q)) {
      return { intent: 'self_check', tasks: ['self', 'reasoning', 'memory'], reasoning: 'JEXI runs a full self-diagnosis and reports system health with root causes.' };
    }

    // 9. Knowledge base recall — check the knowledge library first
    try {
      const kb = searchKnowledge(query);
      if (kb.length > 0) {
        return { intent: 'knowledge_recall', tasks: ['reasoning', 'memory'], reasoning: 'Found matching knowledge in the library.', payload: kb };
      }
    } catch (e) {}

    // 9. Research / search / facts
    const isResearch = /search|research|find|look up|google|what is|who is|when did|where is|why does|how to|explain|latest|news|history|capital|population|meaning|difference between|benefits of|types of|top \d/i.test(q);
    if (isResearch) {
      return { intent: 'research', tasks: ['search', 'browser', 'extractor', 'reasoner', 'memory'], reasoning: 'Needs current/verified information from the internet.' };
    }

    // 10. Default: learning research
    return { intent: 'learning_research', tasks: ['research', 'reasoning', 'memory'], reasoning: 'General question — research and answer.' };
  }

  isCoding(q) {
    const buildVerbs = /(write|build|create|make|develop|fix|debug|refactor|implement|generate|code|program)/i;
    const codeNouns = /\b(python|javascript|js|typescript|ts|react|node(\.js)?|html|css|java|c\+\+|c#|go|rust|sql|bash|shell|script|function|class|api|server|program|app(lication)?|website|web ?page|code|regex|pipeline|scraper|bot|component|database|endpoint)\b/i;
    return (buildVerbs.test(q) && codeNouns.test(q)) ||
      /```[\s\S]*```/i.test(q) || // user pasted code
      /(error|traceback|exception|syntaxerror|debug this code|code is broken|doesn'?t work|not working|fix this|fix the code|debug)/i.test(q);
  }
}

export const planner = new Planner();
