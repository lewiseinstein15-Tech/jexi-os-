import { useState, useRef } from 'react';
import { Brain, Globe, Database, Code2, Play } from 'lucide-react';

const initialAgents = [
  { id: "orchestrator", name: "ORCHESTRATOR", progress: 0, status: "idle", color: "#00FF9D", icon: 'Brain', task: "Standing by" },
  { id: "search", name: "SEARCH AGENT", progress: 0, status: "idle", color: "#22c55e", icon: 'Globe', task: "Standing by" },
  { id: "coding", name: "CODING AGENT", progress: 0, status: "idle", color: "#3b82f6", icon: 'Code2', task: "Standing by" },
  { id: "app-runner", name: "APP RUNNER", progress: 0, status: "idle", color: "#a855f7", icon: 'Play', task: "Standing by" },
  { id: "memory", name: "MEMORY AGENT", progress: 0, status: "idle", color: "#f59e0b", icon: 'Database', task: "Standing by" },
];

export const useJexiEngine = () => {
  const [agents, setAgents] = useState(initialAgents);
  const [logs, setLogs] = useState([]);
  const [messages, setMessages] = useState([]);
  const [websites, setWebsites] = useState([]);
  const [stats, setStats] = useState({ duration: 0, words: 0, sources: 0, confidence: 0, tokens: 0, memory: 42 });
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentTask, setCurrentTask] = useState("");
  const [taskProgress, setTaskProgress] = useState(0);
  
  const streamIntervalRef = useRef(null);
  const abortControllerRef = useRef(null);

  const updateAgent = (id, status, progress, task) => {
    setAgents(prev => prev.map(a => a.id === id ? { ...a, status, progress, task: task || a.task } : a));
  };

  const addLog = (agent, message) => {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs(prev => [...prev, { id: Math.random().toString(36), time, agent, message }]);
  };

  const stopGeneration = () => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    if (streamIntervalRef.current) clearInterval(streamIntervalRef.current);
    setIsProcessing(false);
    setAgents(prev => prev.map(a => a.status === 'working' ? { ...a, status: 'idle', progress: 0, task: 'Stopped' } : a));
    addLog("System", "Generation stopped by user.");
  };

  const runSearch = async (query) => {
    if (isProcessing) return;
    setIsProcessing(true);
    setCurrentTask(query);
    setTaskProgress(0);
    setLogs([]);
    setWebsites([]);
    setStats({ duration: 0, words: 0, sources: 0, confidence: 0, tokens: 0, memory: 42 });
    setAgents(initialAgents.map(a => ({ ...a, status: "idle", progress: 0, task: "Standing by" })));

    const userMsgId = Date.now().toString();
    setMessages(prev => [...prev, { id: userMsgId, role: "user", content: query, time: new Date().toLocaleTimeString() }]);

    updateAgent("orchestrator", "working", 20, "Understanding question...");
    
    const isCoding = /write a|code|function|script|program|build a/gi.test(query);
    const isRun = /\b(run|execute|start)\b/gi.test(query);
    if (isCoding) updateAgent("coding", "working", 10, "Booting up...");
    else if (isRun) updateAgent("app-runner", "working", 10, "Booting up...");
    else updateAgent("search", "working", 10, "Initializing search...");
    
    updateAgent("memory", "working", 10, "Allocating memory...");

    abortControllerRef.current = new AbortController();

    try {
      const res = await fetch("http://localhost:3001/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
        signal: abortControllerRef.current.signal
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); 

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            
            if (event.type === 'log') {
              addLog(event.agent, event.message);
              setTaskProgress(prev => Math.min(90, prev + 5));
              
              if (event.agent.includes("Coding")) updateAgent("coding", "working", Math.min(80, 10 + Math.random() * 20), "Generating code...");
              else if (event.agent.includes("Runner")) updateAgent("app-runner", "working", Math.min(80, 10 + Math.random() * 20), "Executing...");
              else if (event.agent.includes("Search")) updateAgent("search", "working", Math.min(80, 10 + Math.random() * 20), "Scanning web...");
            } 
            else if (event.type === 'website') {
              setWebsites(prev => [...prev, event.site]);
              setStats(prev => ({ ...prev, words: prev.words + event.site.wordCount, sources: prev.sources + 1 }));
            } 
            else if (event.type === 'done') {
              if (!event.success) throw new Error(event.error);

              setStats(prev => ({ ...prev, duration: event.statistics.searchTime, confidence: event.statistics.confidence }));
              updateAgent("search", "completed", 100, "Search complete");
              updateAgent("coding", "completed", 100, "Code generated");
              updateAgent("app-runner", "completed", 100, "Execution complete");
              updateAgent("memory", "completed", 100, "Context saved");
              updateAgent("orchestrator", "working", 90, "Generating answer...");

              const fullText = event.summary || "Error: No summary generated.";
              const jexiMsgId = (Date.now() + 1).toString();
              setMessages(prev => [...prev, { id: jexiMsgId, role: "jexi", content: "", time: new Date().toLocaleTimeString(), sources: event.sources, streaming: true }]);

              let charIndex = 0;
              streamIntervalRef.current = setInterval(() => {
                if (charIndex <= fullText.length) {
                  setMessages(prev => prev.map(m => m.id === jexiMsgId ? { ...m, content: fullText.substring(0, charIndex) } : m));
                  charIndex += 3;
                } else {
                  clearInterval(streamIntervalRef.current);
                  setMessages(prev => prev.map(m => m.id === jexiMsgId ? { ...m, streaming: false } : m));
                  setTaskProgress(100);
                  updateAgent("orchestrator", "completed", 100, "Task completed");
                  setIsProcessing(false);
                }
              }, 10);
            }
          } catch (e) { console.error("Parse error:", e); }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      addLog("System", "Error: " + err.message);
      updateAgent("orchestrator", "failed", 100, "Error");
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: "jexi",
        content: `Agent failed: ${err.message}`,
        time: new Date().toLocaleTimeString()
      }]);
      setIsProcessing(false);
    }
  };

  return { agents, logs, messages, websites, stats, isProcessing, currentTask, taskProgress, runSearch, stopGeneration };
};
