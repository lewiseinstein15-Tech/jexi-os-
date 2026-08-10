import { useState, useCallback, useRef } from 'react';
import { getBackendUrl, jexiFetch } from '../utils/helpers';

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
      const res = await jexiFetch(`${backendUrl}/api/chat`, {
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
      // Whether a completion event arrived. If the stream just ends (proxy drop,
      // host restart mid-task), the user must never be left hanging with no reply.
      let sawDone = false;

      const handleLine = (line) => {
        if (!line) return;
        let data;
        try {
          data = JSON.parse(line);
        } catch (e) {
          // A corrupted event must never silently eat JEXI's answer — log it
          // and keep listening (later events may still be valid).
          console.error('[JEXI stream] unparseable event:', String(line).slice(0, 300));
          return;
        }
        if (data.type === 'log') setLogs(prev => [...prev, { agent: data.agent, message: data.message }]);
        else if (data.type === 'website') setWebsites(prev => [...prev, data.site]);
        else if (data.type === 'done') {
          sawDone = true;
          if (data.success) {
            // ALWAYS show an answer on success — never a silent drop. Even if
            // the backend returns no summary, the user must see the outcome
            // (this is the root of "she finished in the logs but never answered").
            const summary = (data.summary && String(data.summary).trim())
              ? data.summary
              : '✅ Task completed — the team finished, but returned no readable summary. Check the activity log above to see what ran.';
            const stats = data.statistics || {};
            const bits = [];
            if (stats.agentsUsed) bits.push(`${stats.agentsUsed} agents`);
            if (stats.executionTime) bits.push(`${(stats.executionTime / 1000).toFixed(1)}s`);
            if (typeof stats.confidence === 'number') bits.push(`${Math.round(stats.confidence)}% confidence`);
            if (data.files?.length) bits.push(`${data.files.length} files`);
            if (data.sources?.length) bits.push(`${data.sources.length} sources`);
            const footer = bits.length ? `\n\n---\n⚙️ ${bits.join(' · ')}` : '';
            setMessages(prev => [...prev, { role: 'jexi', text: summary + footer, sources: data.sources, files: data.files }]);
          } else {
            setMessages(prev => [...prev, { role: 'jexi', text: `⚠ ${data.error || 'Something went wrong. Is the backend running?'}` }]);
          }
        }
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

      // Stream ended without a completion event — the connection dropped
      // mid-task (host restart, proxy timeout). Surface it instead of silence.
      if (!sawDone) {
        setMessages(prev => [...prev, {
          role: 'jexi',
          text: '⚠ The connection dropped before JEXI finished — the task may still be running on the server. Wait a moment, then ask me to continue from where it stopped.',
        }]);
      }
    } catch (error) {
      // Aborted by the user (STOP) — don't show a scary network error.
      if (error?.name === 'AbortError') return;
      setMessages(prev => [...prev, { role: 'jexi', text: `Error: ${error.message}. Is the backend running?` }]);
    } finally {
      abortRef.current = null;
      setIsProcessing(false);
    }
  }, []);

  const stopGeneration = useCallback(() => {
    const wasRunning = abortRef.current != null;
    abortRef.current?.abort();
    abortRef.current = null;
    setIsProcessing(false);
    if (!wasRunning) return; // nothing was running — don't inject a phantom message
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
