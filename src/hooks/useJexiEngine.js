import { useState, useCallback, useRef } from 'react';
import { getBackendUrl } from '../utils/helpers';

// Backend defaults to same origin (/api is proxied by Vite in dev),
// VITE_JEXI_BACKEND_URL for hosted frontends (Vercel), or a localStorage override.

export const useJexiEngine = () => {
  const [messages, setMessages] = useState([]);
  const [logs, setLogs] = useState([]);
  const [websites, setWebsites] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const abortRef = useRef(null);

  const runSearch = useCallback(async (query, image = null) => {
    // Halt any previous run before starting a new one.
    abortRef.current?.abort();

    setIsProcessing(true);
    setLogs([]);
    setWebsites([]);
    const userMsg = { role: 'user', text: query, image };
    setMessages(prev => [...prev, userMsg]);

    try {
      const backendUrl = getBackendUrl();
      abortRef.current = new AbortController();
      const res = await fetch(`${backendUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, image: image || undefined }),
        signal: abortRef.current.signal,
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
            if (data.type === 'log') setLogs(prev => [...prev, { agent: data.agent, message: data.message }]);
            else if (data.type === 'website') setWebsites(prev => [...prev, data.site]);
            else if (data.type === 'done') {
              if (data.summary) setMessages(prev => [...prev, { role: 'jexi', text: data.summary, sources: data.sources, files: data.files }]);
              else if (!data.success) setMessages(prev => [...prev, { role: 'jexi', text: `⚠ ${data.error || 'Something went wrong. Is the backend running?'}` }]);
            }
          } catch (e) {}
        }
      }
    } catch (error) {
      // Aborted by the user (STOP) — don't show a scary network error.
      if (error?.name === 'AbortError') return;
      setMessages(prev => [...prev, { role: 'jexi', text: `Error: ${error.message}. Is the backend running?` }]);
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    setIsProcessing(false);
    // An agent never leaves you hanging — acknowledge the halt and propose the next move.
    setMessages(prev => [...prev, { role: 'jexi', text: '⏹ Stopped mid-task. Tell me what to do next and I\'ll take it from there.' }]);
  }, []);

  // Append an assistant or user message directly (used by the camera vision panel).
  const pushMessage = useCallback((role, text) => {
    if (!text) return;
    setMessages(prev => [...prev, { role, text }]);
  }, []);

  return { messages, logs, websites, isProcessing, runSearch, stopGeneration, pushMessage };
};
