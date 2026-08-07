import { useState } from 'react';

export const useJexiEngine = () => {
  const [messages, setMessages] = useState([]);
  const [logs, setLogs] = useState([]);
  const [websites, setWebsites] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const runSearch = async (query) => {
    setIsProcessing(true);
    setLogs([]);
    setWebsites([]);
    
    setMessages(prev => [...prev, { role: 'user', text: query }]);

    try {
      const res = await fetch('http://localhost:3002/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const text = decoder.decode(value);
        const lines = text.split('\n').filter(Boolean);
        
        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (data.type === 'log') {
              setLogs(prev => [...prev, { agent: data.agent, message: data.message }]);
            } else if (data.type === 'website') {
              setWebsites(prev => [...prev, data.site]);
            } else if (data.type === 'done') {
              if (data.summary) {
                setMessages(prev => [...prev, { role: 'jexi', text: data.summary }]);
              }
            }
          } catch (e) {}
        }
      }
    } catch (error) {
      setMessages(prev => [...prev, { role: 'jexi', text: `Error: ${error.message}` }]);
    } finally {
      setIsProcessing(false);
    }
  };

  const stopGeneration = () => setIsProcessing(false);

  return { messages, logs, websites, isProcessing, runSearch, stopGeneration };
};
