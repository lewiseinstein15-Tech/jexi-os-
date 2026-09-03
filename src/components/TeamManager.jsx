import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, UserPlus, Power, History, Loader2, X } from 'lucide-react';
import { jexiFetch, getBackendUrl } from '../utils/helpers';

/**
 * B209 — TEAM MANAGER: JEXI's actual staff, managed at runtime.
 * Activate/deactivate employees (staffing respects it immediately), hire
 * new ones, and inspect each employee's REAL assignment history. This is
 * the Director roster (data/employees.json), not the RosterPanel skill
 * registry — different things, both real.
 */

export default function TeamManager() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [expanded, setExpanded] = useState(null); // agentId whose history is open
  const [history, setHistory] = useState({});
  const [showHire, setShowHire] = useState(false);
  const [hire, setHire] = useState({ displayName: '', role: '', personality: '', capabilities: '', support: false });
  const [hireMsg, setHireMsg] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/team/roster`);
      const data = await res.json();
      setEmployees(data.employees || []);
    } catch (e) { /* offline: keep whatever we had */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (emp) => {
    setBusy(emp.agentId);
    try {
      await jexiFetch(`${getBackendUrl()}/api/team/employees/${emp.agentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disabled: !emp.disabled }),
      });
      await load();
    } catch (e) { /* surfaced by reload state */ }
    setBusy(null);
  };

  const openHistory = async (emp) => {
    if (expanded === emp.agentId) { setExpanded(null); return; }
    setExpanded(emp.agentId);
    if (!history[emp.agentId]) {
      try {
        const res = await jexiFetch(`${getBackendUrl()}/api/team/employees/${emp.agentId}/history`);
        const data = await res.json();
        setHistory((h) => ({ ...h, [emp.agentId]: data.history || [] }));
      } catch (e) {
        setHistory((h) => ({ ...h, [emp.agentId]: [] }));
      }
    }
  };

  const submitHire = async () => {
    if (!hire.displayName.trim()) { setHireMsg('Name required'); return; }
    setHireMsg('');
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/team/employees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: hire.displayName.trim(),
          role: hire.role.trim() || 'Specialist',
          personality: hire.personality.trim(),
          capabilities: hire.capabilities.split(',').map((c) => c.trim()).filter(Boolean),
          support: hire.support,
        }),
      });
      const data = await res.json();
      if (!data.ok) { setHireMsg(data.error || 'Could not add'); return; }
      setHire({ displayName: '', role: '', personality: '', capabilities: '', support: false });
      setShowHire(false);
      await load();
    } catch (e) { setHireMsg('Network error'); }
  };

  if (loading) {
    return (
      <div className="surface-card p-6 flex items-center justify-center gap-2">
        <Loader2 className="w-4 h-4 text-brand animate-spin" />
        <span className="text-[10px] text-text-tertiary">Loading the team…</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="surface-card p-3">
        <div className="flex items-center gap-2 mb-1">
          <Users className="w-3 h-3 text-brand" />
          <p className="text-[9px] font-bold text-brand tracking-wider">JEXI'S TEAM — RUNTIME MANAGEMENT</p>
          <span className="ml-auto text-[8px] text-text-tertiary">{employees.filter((e) => !e.disabled).length} active · {employees.filter((e) => e.disabled).length} benched</span>
        </div>
        <p className="text-[9px] text-text-tertiary leading-snug mb-3">
          Deactivated employees are skipped for new staffing instantly. History shows what each one actually did.
        </p>

        <div className="space-y-2">
          {employees.map((emp) => {
            const isBusy = busy === emp.agentId;
            const isOpen = expanded === emp.agentId;
            const hist = history[emp.agentId];
            const rate = emp.stats?.samples ? Math.round((emp.stats.successRate || 0) * 100) : null;
            return (
              <div key={emp.agentId} className={`rounded-lg border p-2.5 ${emp.disabled ? 'border-hairline bg-surface-2/40 opacity-60' : 'border-brand-line/40 bg-surface-2'}`}>
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-bold text-text-primary truncate">{emp.displayName} <span className="text-[8px] font-medium text-text-tertiary">· {emp.role}{emp.support ? ' · support' : ''}</span></p>
                    <p className="text-[9px] text-text-tertiary truncate">{emp.description || emp.personality || '—'}</p>
                  </div>
                  {rate !== null && (
                    <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${rate >= 70 ? 'text-status-ok bg-status-ok/10' : 'text-status-warn bg-status-warn/10'}`}>
                      {rate}% · {emp.stats.samples} runs
                    </span>
                  )}
                  <button onClick={() => openHistory(emp)} className="tap-target p-1.5 rounded-md text-text-tertiary hover:text-brand transition-colors" aria-label={`${emp.displayName} history`}>
                    <History className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => toggle(emp)}
                    disabled={isBusy}
                    className={`tap-target flex items-center gap-1 px-2 py-1 rounded-md text-[8px] font-bold border transition-colors ${
                      emp.disabled
                        ? 'text-status-ok border-status-ok/40 hover:bg-status-ok/10'
                        : 'text-status-warn border-status-warn/40 hover:bg-status-warn/10'
                    }`}
                  >
                    {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Power className="w-3 h-3" />}
                    {emp.disabled ? 'ACTIVATE' : 'BENCH'}
                  </button>
                </div>
                <AnimatePresence>
                  {isOpen && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                      <div className="mt-2 pt-2 border-t border-hairline">
                        {!hist ? (
                          <p className="text-[9px] text-text-tertiary italic">Loading history…</p>
                        ) : hist.length === 0 ? (
                          <p className="text-[9px] text-text-tertiary italic">No recorded assignments yet.</p>
                        ) : (
                          <div className="space-y-1">
                            {hist.slice(0, 10).map((h, i) => (
                              <div key={i} className="flex items-start gap-2 text-[9px]">
                                <span className={`font-bold ${h.ok ? 'text-status-ok' : 'text-status-error'}`}>{h.ok ? '✓' : '✗'}</span>
                                <span className="text-text-secondary truncate flex-1">{h.title || h.subtask || 'assignment'}</span>
                                <span className="text-text-tertiary flex-shrink-0">{h.ms ? `${(h.ms / 1000).toFixed(1)}s` : ''}{h.confidence ? ` · ${h.confidence}` : ''}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>

      {/* Hire card */}
      <div className="surface-card p-3">
        <button onClick={() => setShowHire((v) => !v)} className="tap-target flex items-center gap-2 w-full">
          <UserPlus className="w-3 h-3 text-brand" />
          <span className="text-[9px] font-bold text-brand tracking-wider">HIRE A NEW EMPLOYEE</span>
          <span className="ml-auto text-[8px] text-text-tertiary">{showHire ? 'CANCEL' : 'OPEN'}</span>
        </button>
        <AnimatePresence>
          {showHire && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <div className="mt-3 space-y-2">
                {[
                  ['Name', 'displayName', 'e.g. Nadia'],
                  ['Role', 'role', 'e.g. Data Analyst'],
                  ['Personality', 'personality', 'one line — how she works'],
                  ['Capabilities', 'capabilities', 'comma list: research, verification…'],
                ].map(([label, key, ph]) => (
                  <div key={key}>
                    <p className="text-[8px] font-bold text-text-tertiary tracking-wider mb-1">{label.toUpperCase()}</p>
                    <input
                      value={hire[key]}
                      onChange={(e) => setHire((h) => ({ ...h, [key]: e.target.value }))}
                      placeholder={ph}
                      className="w-full bg-surface-2 border border-hairline rounded-md px-2.5 py-2 text-[10px] text-text-primary placeholder:text-text-tertiary/60 focus:outline-none focus:border-brand-line"
                    />
                  </div>
                ))}
                <label className="flex items-center gap-2 text-[9px] text-text-secondary">
                  <input type="checkbox" checked={hire.support} onChange={(e) => setHire((h) => ({ ...h, support: e.target.checked }))} className="accent-current" />
                  Support role (backs up the leads)
                </label>
                {hireMsg && <p className="text-[9px] text-status-error">{hireMsg}</p>}
                <button onClick={submitHire} className="tap-target w-full bg-brand/20 border border-brand-line text-brand rounded-md py-2 text-[9px] font-bold tracking-wider hover:bg-brand/30 transition-colors">
                  ADD TO THE TEAM
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
