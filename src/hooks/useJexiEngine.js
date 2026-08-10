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
      // NDJSON lines can arrive SPLIT across network chunks (a full build report
      // is one big line — tens of KB — and almost always crosses a chunk
      // boundary). Naively splitting each chunk on '\n' silently drops those
      // events, which is exactly why JEXI finished a task in the logs while the
      // chat showed no answer. Buffer partial lines until the newline arrives.
      let buffer = '';

      const handleLine = (line) => {
        if (!line) return;
        try {
          const data = JSON.parse(line);
          if (data.type === 'log') setLogs(prev => [...prev, { agent: data.agent, message: data.message }]);
          else if (data.type === 'website') setWebsites(prev => [...prev, data.site]);
          else if (data.type === 'done') {
            if (data.summary) setMessages(prev => [...prev, { role: 'jexi', text: data.summary, sources: data.sources, files: data.files }]);
            else if (!data.success) setMessages(prev => [...prev, { role: 'jexi', text: `⚠ ${data.error || 'Something went wrong. Is the backend running?'}` }]);
          }
        } catch (e) {}
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        // { stream: true } keeps multi-byte UTF-8 (emoji!) intact across chunks
        buffer += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          handleLine(line);
        }
      }
      // Flush anything left (final newline might be missing) + decoder tail bytes
      buffer += decoder.decode();
      handleLine(buffer);
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
