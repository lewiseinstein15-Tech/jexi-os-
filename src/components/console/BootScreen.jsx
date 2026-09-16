import { useEffect, useRef, useState } from 'react';
import { JexiMark } from './LogoTool';
import { getBackendUrl } from '../../utils/helpers';
import {
  wakeBrain, runSelfTest, loadFleet, armAutoTest, emitEvent, fmtUptime,
} from '../../services/brain';

/* <BootScreen /> — v0.9: the console boots ITSELF.
   Open the app → this screen wakes the Render brain automatically (cold
   start tolerated), loads the live fleet, then fires ONE real test
   question through POST /api/chat. When the brain answers, the console
   opens straight on Chat with that same conversation replayed live —
   so the owner sees proof, not a placeholder. */

const hostOf = (() => {
  try { return getBackendUrl() ? new URL(getBackendUrl()).host : 'not configured'; }
  catch { return 'not configured'; }
})();

export default function BootScreen({ onDone }) {
  const [lines, setLines] = useState([]);
  const [state, setState] = useState('boot'); // boot | wake | fleet | test | ready | offline
  const logRef = useRef(null);

  const line = (text, tone) => setLines((ls) => [...ls, { t: text, tone }]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  useEffect(() => {
    let alive = true;
    (async () => {
      line(`JEXI OS console · boot sequence initiated`, 'var(--jcx-ink-2)');
      line(`brain target: ${hostOf}`, 'var(--jcx-ink-3)');
      emitEvent({ chip: 'SYS', who: 'Boot', msg: `boot sequence initiated · target ${hostOf}` });

      setState('wake');
      line('waking the brain — Render cold start can take ~50s…', 'var(--jcx-gold)');
      let lastEmit = 0;
      const health = await wakeBrain({
        onAttempt: (i) => {
          line(`  attempt ${i} · no response yet — retrying…`, 'var(--jcx-ink-3)');
          if (Date.now() - lastEmit > 15000) {
            lastEmit = Date.now();
            emitEvent({ chip: 'NET', who: 'Boot', msg: `waking brain · attempt ${i} — still cold`, tone: 'var(--jcx-gold)' });
          }
        },
      });
      if (!alive) return;
      if (!health) {
        setState('offline');
        line('brain unreachable after repeated attempts.', 'var(--jcx-down)');
        line('the console will open anyway — the sidebar keeps retrying and', 'var(--jcx-ink-3)');
        line('you can edit the server address there. Chat stays live once it answers.', 'var(--jcx-ink-3)');
        emitEvent({ chip: 'WARN', who: 'Boot', msg: 'brain unreachable — opening console degraded, retry continues', tone: 'var(--jcx-down)' });
        return;
      }
      line(`brain online · v${health.version} · uptime ${fmtUptime(health.uptime)}`, 'var(--jcx-up)');
      const prov = (health.providers || []).filter((p) => p.configured).map((p) => p.key).join(', ') || 'none';
      line(`model providers configured: ${prov}`, 'var(--jcx-ink-2)');
      emitEvent({ chip: 'OK', who: 'Boot', msg: `brain online · v${health.version} · providers: ${prov}`, tone: 'var(--jcx-up)' });

      setState('fleet');
      line('loading live fleet — team, agents, plugins, connectors, mcp, scheduler…', 'var(--jcx-ink-2)');
      const fleet = await loadFleet();
      if (!alive) return;
      line(`fleet loaded${fleet.errors.length ? ` · ${fleet.errors.length} endpoint(s) degraded` : ' · all endpoints OK'}`, fleet.errors.length ? 'var(--jcx-gold)' : 'var(--jcx-up)');

      setState('test');
      line('SELF-TEST — dispatching a live question through /api/chat…', 'var(--jcx-ember)');
      emitEvent({ chip: 'SYS', who: 'Boot', msg: 'self-test: live question dispatched to /api/chat' });
      let logN = 0;
      try {
        const r = await runSelfTest({
          onLog: () => {
            logN += 1;
            if (logN === 1 || logN % 10 === 0) line(`  pipeline running · ${logN} live events…`, 'var(--jcx-ink-3)');
          },
        });
        if (!alive) return;
        if (r.ok) {
          line(`self-test answer: “${(r.answer || '').trim()}”`, 'var(--jcx-up)');
          line('self-test PASSED — arming Chat replay and opening the console…', 'var(--jcx-up)');
          emitEvent({ chip: 'OK', who: 'Boot', msg: `self-test passed — brain replied “${(r.answer || '').trim()}”`, tone: 'var(--jcx-up)' });
          armAutoTest(); // ChatView re-runs the question live so it's visible
          window.location.hash = '#chat';
          setState('ready');
          line('welcome back, Lewis.', 'var(--jcx-ember)');
          setTimeout(() => alive && onDone(fleet, health), 900);
        } else {
          line('self-test finished WITHOUT a clean answer — opening console; Chat will show the raw error.', 'var(--jcx-gold)');
          emitEvent({ chip: 'WARN', who: 'Boot', msg: 'self-test inconclusive — opening console anyway', tone: 'var(--jcx-gold)' });
          setState('ready');
          setTimeout(() => alive && onDone(fleet, health), 1200);
        }
      } catch (e) {
        if (!alive) return;
        line(`self-test failed: ${(e && e.message) || 'unknown error'} — opening console; retry from Chat.`, 'var(--jcx-down)');
        emitEvent({ chip: 'WARN', who: 'Boot', msg: `self-test failed: ${(e && e.message) || 'unknown'}`, tone: 'var(--jcx-down)' });
        setState('ready');
        setTimeout(() => alive && onDone(fleet, null), 1400);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pill = state === 'offline'
    ? ['err', 'OFFLINE']
    : state === 'ready'
      ? ['ok', 'READY']
      : ['warn', state === 'wake' ? 'WAKING' : state === 'test' ? 'SELF-TEST' : 'BOOTING'];

  return (
    <div className="bootscreen">
      <div className="bs-glow" />
      <div className="bs-card">
        <div className="bs-brand">
          <span className="mark"><JexiMark size={54} /></span>
          <div>
            <div className="bs-word"><b>JEXI</b><i>OS</i></div>
            <div className="bs-sub">executive console · booting itself</div>
          </div>
          <span className={`pill ${pill[0]}`} style={{ marginLeft: 'auto' }}><span className="dot" />{pill[1]}</span>
        </div>

        <div className="bs-log" ref={logRef}>
          {lines.map((l, i) => (
            <div className="bs-line" key={i} style={{ color: l.tone || 'var(--jcx-ink-2)' }}>{l.t}</div>
          ))}
          {state !== 'ready' && state !== 'offline' && <div className="bs-line bs-cursor">▊</div>}
        </div>

        <div className="bs-bar"><i /></div>

        {state === 'offline' && (
          <button type="button" className="send live" onClick={() => onDone(null, null)}>
            Open console anyway
          </button>
        )}
      </div>
    </div>
  );
}
