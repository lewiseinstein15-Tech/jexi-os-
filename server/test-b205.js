#!/usr/bin/env node
/**
 * B205 — ARENA-STYLE THINKING PANEL (unified agent streaming UI)
 *
 * The user asked for the streaming to be rebuilt the way the Arena agent's
 * streaming-thinking was described: ONE collapsible block per assistant
 * message that carries the whole live story — narrations (her first-person
 * voice), agent/tool activity rows, and dimmed reasoning tokens — open and
 * pulsing while she works ("Thinking · 12.3s"), auto-collapsed to
 * "Thought for 43s · 8 agents · 10 sources" when the answer lands, one tap
 * to review the full trace. Direct answers with no trace render no panel.
 *
 * This replaced the scattered trio (ThinkRow + NarrationFeed + chat-inline
 * ActionFeed/AgentPipeline) and fixed a real bug: the done-handler built a
 * fresh final message that DROPPED narrations, so the old "HOW I WORKED"
 * collapsed view could never render after completion.
 *
 * Server-side testable surface (no DOM): the pure helpers in
 * ../src/utils/agentStream.js + wiring contracts in the hook/component CSS.
 */
import {
  dedupeActivity, countAgents, countSteps, formatDuration, traceChips, hasTrace,
} from '../src/utils/agentStream.js';
import fs from 'node:fs';

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};
const read = (p) => fs.readFileSync(p, 'utf-8');

console.log('B205: arena-style thinking panel\n');

// --- 1. dedupeActivity collapses consecutive duplicates ---
console.log('[1] dedupeActivity');
{
  const rows = [
    { agent: 'Searcher', message: 'Scanning…' },
    { agent: 'Searcher', message: 'Scanning…' },
    { agent: 'Searcher', message: 'Scanning…' },
    { agent: 'Extractor', message: 'Read x' },
    { agent: 'Searcher', message: 'Scanning…' }, // non-consecutive → kept
  ];
  const out = dedupeActivity(rows);
  check(`3 consecutive dupes collapse (got ${out.length}, want 3)`, out.length === 3);
  check('non-consecutive repeat survives', out.some((r) => r.agent === 'Searcher' && r.message === 'Scanning…') && out[2].agent === 'Searcher');
  check('null-safe', dedupeActivity(null).length === 0 && dedupeActivity(undefined).length === 0);
}

// --- 2. agent / step counting ---
console.log('\n[2] counting');
{
  const rows = [
    { agent: 'Query Analyzer', message: 'a' },
    { agent: 'Searcher', message: 'b' },
    { agent: 'Searcher', message: 'c' },
    { agent: '', message: 'd' }, // blank agent → JEXI
  ];
  check('unique agents counted (3 + JEXI default)', countAgents(rows) === 3);
  check('steps counted raw', countSteps(rows) === 4);
}

// --- 3. formatDuration ---
console.log('\n[3] formatDuration');
check('sub-minute → 12.3s', formatDuration(12345) === '12.3s');
check('over a minute → 2m 04s', formatDuration(124000) === '2m 04s');
check('invalid → empty', formatDuration(NaN) === '' && formatDuration(-5) === '');

// --- 4. traceChips ---
console.log('\n[4] traceChips');
{
  const chips = traceChips({ activity: [{ agent: 'A', message: '1' }, { agent: 'B', message: '2' }], sourceCount: 10, narrations: ['note'] });
  check('agents chip', chips.includes('2 agents'));
  check('sources chip', chips.includes('10 sources'));
  check('notes chip (singular)', chips.includes('1 note'));
  check('no chips from nothing', traceChips({}).length === 0);
  check('singular agent', traceChips({ activity: [{ agent: 'A', message: '1' }] }).includes('1 agent'));
}

// --- 5. hasTrace — direct answers stay clean ---
console.log('\n[5] hasTrace');
check('narrations count', hasTrace({ narrations: ['x'] }) === true);
check('activity counts', hasTrace({ activity: [{ agent: 'a' }] }) === true);
check('reasoning counts', hasTrace({ thinking: 'because…' }) === true);
check('empty → no panel', hasTrace({}) === false);
check('blank strings → no panel', hasTrace({ narrations: [], activity: [], thinking: '   ' }) === false);
check('null-safe', hasTrace(null) === false);

// --- 6. wiring contracts (source-level, no DOM needed) ---
console.log('\n[6] wiring contracts');
{
  const hook = read('../src/hooks/useJexiEngine.js');
  check("log events attach to the streaming message's activity", /activity: \[\.\.\.\(last\.activity \|\| \[\]\), entry\]/.test(hook));
  check("website events bump the message's sourceCount", /sourceCount: \(last\.sourceCount \|\| 0\) \+ 1/.test(hook));
  check('final message preserves narrations after done', /cur\.narrations\?\.length \? \{ narrations: cur\.narrations \}/.test(hook));
  check('final message preserves activity + sourceCount', /cur\.activity\?\.length \? \{ activity: cur\.activity \}/.test(hook) && /cur\.sourceCount \? \{ sourceCount: cur\.sourceCount \}/.test(hook));
  check('final message stamps totalMs from t0', /totalMs: Date\.now\(\) - cur\.t0/.test(hook));

  const chat = read('../src/components/ChatWindow.jsx');
  check('ChatWindow renders the unified AgentThinking panel', /<AgentThinking/.test(chat));
  check('old ThinkRow/NarrationFeed/ActionFeed/AgentPipeline removed from chat', !/ThinkRow|NarrationFeed|ActionFeed|AgentPipeline/.test(chat.replace(/the old ThinkRow \+ NarrationFeed \+ inline ActionFeed/, '')));

  const panel = read('../src/components/AgentThinking.jsx');
  check('panel auto-collapses when the turn finishes', /if \(!live\) setExpanded\(false\)/.test(panel));
  check('panel live header ticks the timer', /Thinking\$\{safeBy \? ` · \$\{safeBy\}` : ''\} · \$\{elapsed\.toFixed\(1\)\}s/.test(panel));
  check('panel done header shows duration + chips', /Thought\$\{doneMs \? ` for \$\{formatDuration\(doneMs\)\}` : ''\}/.test(panel) && chipsBooleans(panel));
  check('panel renders no empty block for direct answers', /if \(!hasTrace\(\{ narrations, activity, thinking \}\)\) return null;/.test(panel));

  const css = read('../src/index.css');
  check('styles exist for the panel', /\.jx-agent-head/.test(css) && /\.jx-agent-row/.test(css) && /\.jx-agent-reason/.test(css));
}
function chipsBooleans(panelSrc) {
  return /chips\.map\(\(c\) => <span key=\{c\} className="jx-agent-chip">\{c\}<\/span>\)/.test(panelSrc);
}

console.log(`\nB205: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
