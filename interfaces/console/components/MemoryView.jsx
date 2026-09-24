import { useEffect, useState } from 'react';
import { getBackendUrl, jexiFetch } from '../utils/helpers';
import MemoryPanel from './MemoryPanel';

/**
 * B221 — spec screen C (MEMORY bank): hydrates the memory panel from the
 * brain on mount + a slow poll, so the bank is alive when opened directly
 * from the menu (the panel itself only syncs from its prop / manual refresh).
 */
export default function MemoryView() {
  const [memory, setMemory] = useState(null);

  useEffect(() => {
    let dead = false;
    const load = async () => {
      try {
        const res = await jexiFetch(`${getBackendUrl()}/api/memory`);
        const d = await res.json();
        if (!dead && d) setMemory(d);
      } catch (e) { /* offline: panel shows its honest empty state */ }
    };
    load();
    const t = setInterval(load, 15000);
    return () => { dead = true; clearInterval(t); };
  }, []);

  return (
    <div className="jx-scroll">
      <div className="jx-view-inner">
        <div className="jx-vtitle">Memory</div>
        <div className="jx-vsub">Everything JEXI remembers about you — searchable, deletable, exportable. Yours.</div>
        <MemoryPanel memory={memory} />
      </div>
    </div>
  );
}
