import { useState, useEffect, useCallback } from 'react';

const getBackendUrl = () => localStorage.getItem('jexi_backend_url') || '';

export const useMemory = (activeNav) => {
  const [memory, setMemory] = useState(null);

  const fetchMemory = useCallback(async () => {
    try {
      const res = await fetch(`${getBackendUrl()}/api/memory`);
      const data = await res.json();
      if (data && data.chatHistory) setMemory(data);
    } catch (e) {
      console.error("Failed to fetch memory", e);
    }
  }, []);

  useEffect(() => {
    if (activeNav !== 'memory') return;
    fetchMemory();
    const interval = setInterval(fetchMemory, 3000);
    return () => clearInterval(interval);
  }, [activeNav, fetchMemory]);

  return memory;
};
