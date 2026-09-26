import { createRoot } from 'react-dom/client';
import { createElement as h } from 'react';
import '../ui/web/console/shell/tokens-premium.css';
import '../ui/web/console/shell/premium.css';
import Transcript from '../ui/web/console/components/transcript/Transcript.jsx';

/**
 * TRANSCRIPT COMPONENT DEMO — ui-rebuild-premium-v2.
 *
 * WHY THIS PAGE EXISTS: the live preview runs keyless (no model provider
 * configured in this sandbox), so /api/chat cannot stream 'think' reasoning
 * events — the ThinkingBlock therefore never renders in a live turn here.
 * This page mounts the REAL Transcript orchestrator with FIXED rows shaped
 * exactly like the mount.js row contract, copied from real captured events
 * (hello turn, workspace probe turn, ToolUseBridge pair shapes). It is a
 * component-visuals harness only — the live chat path never reads this file,
 * and no live turn can inject demo data.
 */

const now = Date.now();
const T = (offsetMs) => now + offsetMs;

const rows = [
  { seq: 1, turnId: 'demo:turn-1', type: 'message.delta', rowType: 'text', voice: 'user',
    content: 'summarize the workspace docs and draft the trigger fix', t: T(-14200) },
  { seq: 2, turnId: 'demo:turn-1', type: 'narration.line', rowType: 'narration', narrationType: 'recon', toolUse: null,
    content: 'The workspace holds the rebuild docs and the boot-chain notes — the overnight failure traces to docker-image.yml, whose push trigger shipped without a paths filter at f1733516.', t: T(-12800) },
  { seq: 3, turnId: 'demo:turn-1', type: 'narration.line', rowType: 'narration', narrationType: 'recon', toolUse: null,
    content: 'The fix belongs in the workflow trigger, not the deploy script; downstream hf-deploy was skipped because the parent never matched.', t: T(-11400) },
  { seq: 4, turnId: 'demo:turn-1', type: 'narration.line', rowType: 'narration', narrationType: 'decision', toolUse: null,
    content: 'plan composed · 3 steps\n1. Researcher: scan the boot-chain docs for the 12 trees\n2. Reasoner: draft the minimal paths filter\n3. Memory Agent: store the decision', t: T(-10100) },
  { seq: 5, turnId: 'demo:turn-1', type: 'narration.line', rowType: 'narration', narrationType: 'progress', toolUse: null,
    content: 'JEXI: Understanding your request…', t: T(-9600) },
  { seq: 6, turnId: 'demo:turn-1', type: 'narration.line', rowType: 'narration', narrationType: 'progress', toolUse: null,
    content: 'Planner: Intent: learning_research — research and answer.', t: T(-8900) },
  { seq: 7, turnId: 'demo:turn-1', type: 'narration.line', rowType: 'narration', narrationType: 'progress', toolUse: null,
    content: 'Tool Router: 🛠 Auto-selected tools for this task (32).', t: T(-8100) },
  { seq: 8, turnId: 'demo:turn-1', type: 'narration.line', rowType: 'narration', narrationType: 'progress', toolUse: null,
    content: 'Searcher: 🔍 Whole-internet scan done — 10 sources from 6 engines.', t: T(-6300) },
  { seq: 9, turnId: 'demo:turn-1', type: 'narration.line', rowType: 'tool-use', narrationType: 'progress',
    toolUse: { id: 'tu-demo-1', tool: 'Read', slug: 'deep-read', status: 'running', duration_ms: 0,
      summary: 'deep-read research note', detail: '$ deep-read https://example.com/research-note' },
    content: '$ deep-read https://example.com/research-note', t: T(-5600) },
  { seq: 10, turnId: 'demo:turn-1', type: 'narration.line', rowType: 'tool-result', narrationType: 'progress',
    toolUse: { id: 'tu-demo-1', tool: 'Read', slug: 'deep-read', status: 'success', duration_ms: 1180,
      summary: 'deep-read research note', detail: '$ deep-read https://example.com/research-note\n2411 chars extracted' },
    content: '$ deep-read https://example.com/research-note\n2411 chars extracted', t: T(-4400) },
  { seq: 11, turnId: 'demo:turn-1', type: 'narration.line', rowType: 'tool-use', narrationType: 'progress',
    toolUse: { id: 'tu-demo-2', tool: 'WebSearch', slug: 'web-search', status: 'running', duration_ms: 0,
      summary: 'whole-internet scan', detail: 'query: workspace docs' },
    content: 'query: workspace docs', t: T(-4200) },
  { seq: 12, turnId: 'demo:turn-1', type: 'narration.line', rowType: 'tool-result', narrationType: 'progress',
    toolUse: { id: 'tu-demo-2', tool: 'WebSearch', slug: 'web-search', status: 'success', duration_ms: 1893,
      summary: 'whole-internet scan', detail: '10 sources from 6 engines' },
    content: '10 sources from 6 engines', t: T(-2300) },
  { seq: 13, turnId: 'demo:turn-1', type: 'narration.line', rowType: 'narration', narrationType: 'finding', toolUse: null,
    content: 'I found 10 sources across 6 search engines.', t: T(-2100) },
  { seq: 14, turnId: 'demo:turn-1', type: 'message.delta', rowType: 'text', voice: 'jexi',
    content: "The boot chain failed because docker-image.yml's push trigger shipped without a paths filter, so the overnight commits never matched.\n\nI've drafted the minimal fix — add the 12 boot-chain trees to the filter and re-run from the halted node:\n\n```yaml\non:\n  push:\n    paths: [\"interfaces/**\", \"server/**\"]\n```", t: T(-2000) },
  { seq: 15, turnId: 'demo:turn-1', type: 'turn.completed', rowType: 'turn-end-ok',
    content: 'turn completed: demo:turn-1 · 12,410 ms', t: T(-1000) },
];

const el = h('div', { className: 'jx-shell', style: { minHeight: '100vh', background: 'var(--jx-bg-root)' } },
  h('div', { style: {
    fontFamily: 'var(--jx-font-mono)', fontSize: 'var(--jx-font-xs)', color: 'var(--jx-warn)',
    padding: '10px 24px', borderBottom: '1px solid var(--jx-border)', letterSpacing: 'var(--jx-ls-caps)',
    textTransform: 'uppercase',
  } }, 'component demo — fixed rows shaped from real captured events (sandbox is keyless; think events need a live model leg)'),
  h('div', { className: 'jx-transcript jx-transcript-v2' },
    h(Transcript, { rows, onApprove: () => {} })
  )
);

createRoot(document.getElementById('demo-root')).render(el);
