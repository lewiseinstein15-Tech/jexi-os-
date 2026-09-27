/**
 * FINAL PART D — narration replay page (screenshot harness).
 *
 * Mounts the REAL Transcript component (interfaces/ui/web/console/components/
 * transcript/Transcript.jsx) with a REAL recorded NDJSON event sequence —
 * the same user→think→steps→terminal→tool→answer→footer order SIM-23 pins.
 * The console's real stylesheet (index.css, 647 jx-* rules + jexi-theme) is
 * loaded, so this is a pixel-faithful render of the narration rebuild.
 * Temporary harness: deleted after the screenshots are taken.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import './interfaces/console/index.css';
import './interfaces/console/jexi-theme.css';
import Transcript from './interfaces/ui/web/console/components/transcript/Transcript.jsx';

const rows = [
  { seq: 1, turnId: 't1', rowType: 'text', voice: 'user', type: 'message.delta', content: 'run ls -la and then search the web for the latest JEXI OS release notes' },
  {
    seq: 2, turnId: 't1', rowType: 'narration', narrationType: 'recon', type: 'narration.line', t: 1,
    content: 'User wants a directory listing plus fresh release notes. Two lanes: terminal first (deterministic), then web_search for the notes. Budget stays under the round cap; nothing here needs authorization.',
  },
  {
    seq: 3, turnId: 't1', rowType: 'narration', narrationType: 'decision', type: 'narration.line', t: 2,
    content: 'plan · 2 steps\n1. terminal — run ls -la (deterministic, no auth)\n2. web_search — latest JEXI OS release notes',
  },
  { seq: 4, turnId: 't1', rowType: 'narration', narrationType: 'progress', type: 'narration.line', t: 3, content: 'Agent: working — plan locked: [terminal: ls -la] → [web_search: JEXI OS release notes]' },
  {
    seq: 5, turnId: 't1', rowType: 'command-use', type: 'narration.line',
    commandUse: {
      id: 'cmd-1', status: 'done', cmd: 'ls -la', exit: 0, duration_ms: 18,
      output: 'total 108\ndrwxrwxr-x 25 z z 4096 Sep 27 16:09 .\ndrwxr-xr-x 20 z z 12288 Sep 27 16:02 ..\ndrwxrwxr-x 7 z z 4096 Sep 27 16:01 .git\ndrwxrwxr-x 4 z z 4096 Sep 27 16:03 director\ndrwxrwxr-x 2 z z 4096 Sep 27 16:09 notes\ndrwxrwxr-x 7 z z 4096 Sep 27 16:01 phase31\ndrwxrwxr-x 3 z z 4096 Sep 27 16:01 sandboxes',
      errput: '',
    },
    content: '$ ls -la',
  },
  {
    seq: 6, turnId: 't1', rowType: 'tool-use', type: 'narration.line',
    toolUse: { id: 'tu-1', tool: 'web-search', slug: 'web_search', status: 'success', duration_ms: 2100, detail: 'query: "JEXI OS release notes" — 10 sources fetched' },
    content: '10 sources fetched',
  },
  {
    seq: 7, turnId: 't1', rowType: 'tool-use', type: 'narration.line',
    toolUse: { id: 'tu-2', tool: 'deep-read', slug: 'deep-read', status: 'running', duration_ms: 0, detail: 'reading https://github.com/lewiseinstein15-Tech/jexi-os-/releases' },
    content: '$ deep-read https://github.com/lewiseinstein15-Tech/jexi-os-/releases',
  },
  {
    seq: 8, turnId: 't1', rowType: 'text', type: 'message.delta', voice: 'jexi',
    content: [
      '## What I found',
      '',
      'The terminal ran `ls -la` in **18 ms** (exit 0) — the workspace holds the `.git` tree, `director/`, `notes/`, `phase31/` and `sandboxes/`. The release notes confirm the OS is at **v1.6.2** with the narration rebuild shipped.',
      '',
      '### Release comparison',
      '',
      '| Version | Narration | Terminal visibility |',
      '|---------|-----------|---------------------|',
      '| v1.6.1  | steps only | hidden logs |',
      '| v1.6.2  | think → steps → tools → answer | inline `command` NDJSON events |',
      '',
      '```js',
      '// every shell run now streams as NDJSON, in order:',
      '{ type: "command", status: "running", id: "cmd-1", cmd: "ls -la" }',
      '{ type: "command.done", id: "cmd-1", exit: 0, duration_ms: 18 }',
      '```',
      '',
      'The quadratic release-timing constant stays elegant: $t_{release} = \\sqrt{2}\\,s$ where $s$ is the sprint length.',
    ].join('\n'),
  },
  { seq: 9, turnId: 't1', rowType: 'turn-end-ok', type: 'turn.completed', content: 'turn completed: t1 · 2,481 ms' },
];

function App() {
  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: '24px 16px' }}>
      <Transcript rows={rows} onApprove={() => {}} />
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
