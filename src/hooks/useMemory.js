import { useState, useEffect } from 'react';

export const useMemory = (activeNav) => {
  const [memory, setMemory] = useState(null);

  useEffect(() => {
    if (activeNav !== 'memory') return;
    
    const fetchMemory = async () => {
      try {
        const res = await fetch('http://localhost:3001/api/memory');
        const data = await res.json();
        setMemory(data);
      } catch (e) {
        console.error("Failed to fetch memory", e);
      }
    };

    fetchMemory();
    const interval = setInterval(fetchMemory, 2000);
    return () => clearInterval(interval);
  }, [activeNav]);

  return memory;
};
