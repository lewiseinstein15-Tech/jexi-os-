import { useMemo } from 'react';

/**
 * B192 — WIDGET CARDS (the floating glass panels from the reference UI):
 *   StatusCard  — "ACTIVE n · DONE n" + "all companions idle" line
 *   CalendarCard — month grid, today highlighted in amber, agenda footer
 *   QueueCard   — recent published builds with live links
 */
export function StatusCard({ active = 0, done = 0, idle = true }) {
  return (
    <div className="jx2-card">
      <div className="jx2-card-title">SYSTEM</div>
      <div className="jx2-status-nums">
        <span className="jx2-num-amber">{active}</span> ACTIVE
        <span className="jx2-dotsep" />
        <span className="jx2-num-cyan">{done}</span> DONE
      </div>
      <div className="jx2-status-sub">{idle ? 'all companions idle' : 'working…'}</div>
    </div>
  );
}

export function CalendarCard({ date = new Date() }) {
  const { monthName, year, cells, todayIdx } = useMemo(() => {
    const y = date.getFullYear(); const m = date.getMonth();
    const first = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    const names = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    // week starts Monday (Mo..Su like the reference)
    const shift = (first + 6) % 7;
    const arr = [];
    for (let i = 0; i < shift; i++) arr.push(null);
    for (let d = 1; d <= days; d++) arr.push(d);
    while (arr.length % 7) arr.push(null);
    return { monthName: names[m], year: y, cells: arr, todayIdx: shift + date.getDate() - 1 };
  }, [date]);
  return (
    <div className="jx2-card">
      <div className="jx2-card-title">{monthName} {year}</div>
      <div className="jx2-cal">
        {['MO','TU','WE','TH','FR','SA','SU'].map((d) => <span key={d} className="jx2-cal-dow">{d}</span>)}
        {cells.map((d, i) => (
          <span key={i} className={`jx2-cal-day${i === todayIdx ? ' today' : ''}`}>{d || ''}</span>
        ))}
      </div>
      <div className="jx2-card-foot">TODAY · no events</div>
    </div>
  );
}

export function QueueCard({ items = [], onOpen }) {
  return (
    <div className="jx2-card">
      <div className="jx2-card-title">BUILDS</div>
      {items.length === 0 && <div className="jx2-status-sub">no published builds yet</div>}
      {items.slice(0, 4).map((it) => (
        <button type="button" key={it.slug || it.name} className="jx2-queue-item" onClick={() => onOpen?.(it)}>
          <span className="jx2-queue-ic">◆</span>
          <span className="jx2-queue-t">{it.title || it.name || it.slug}</span>
        </button>
      ))}
    </div>
  );
}
