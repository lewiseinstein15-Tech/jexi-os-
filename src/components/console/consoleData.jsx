/* Console mock data — the SAME data the approved preview shows.
   Real API wiring (/api/chat, missions, roster) lands in a later scope.
   Kept in one place so the swap is mechanical. */

export const HUD = {
  title: 'Fix the flaky auth test suite & verify the fix',
  status: 'run',
  statusLabel: 'Running',
  elapsed: '00:14:22',
  context: '72% warm',
  contextTone: 'warm',
  toolCalls: '38',
  agents: '3 active',
  agentsTone: 'acc',
  todos: '2 / 7',
  checks: '17 ✓',
  cost: '$0.4127',
  tokens: '81.2k',
  risk: 'medium',
  riskTone: 'warm',
  queue: '1 waiting',
};

export const NAV = [
  {
    group: 'Executive',
    items: [
      { id: 'missions', label: 'Missions', icon: 'missions', count: '1 live' },
      { id: 'chat', label: 'Chat', icon: 'chat', isNew: true },
      { id: 'workgraph', label: 'Work Graph', icon: 'workgraph', count: '7' },
      { id: 'agents', label: 'Agents', icon: 'agents', count: '9' },
      { id: 'sessions', label: 'Sessions', icon: 'sessions', count: '3' },
    ],
  },
  {
    group: 'Resources',
    items: [
      { id: 'memory', label: 'Memory', icon: 'memory' },
      { id: 'skills', label: 'Skills', icon: 'skills', count: '508' },
      { id: 'knowledge', label: 'Knowledge', icon: 'knowledge' },
      { id: 'connectors', label: 'Connectors', icon: 'connectors' },
    ],
  },
  {
    group: 'Extensions',
    items: [
      { id: 'plugins', label: 'Plugins', icon: 'plugins', count: '52' },
      { id: 'mcp', label: 'MCP Servers', icon: 'mcp', count: '42' },
      { id: 'scheduler', label: 'Scheduler', icon: 'scheduler', count: '4' },
    ],
  },
];

export const GRAPH_NODES = [
  { state: 'ok', title: 'Reproduce the flaky failure in a frozen workspace', sub: 'node --test auth.test.js → 2 failing · evidence captured', owner: 'ZO', tone: 'f2', verified: true },
  { state: 'ok', title: 'Trace the race in token-refresh scheduling', sub: 'timer drift 240ms · refresh fires after expiry window', owner: 'FO', tone: 'f1', verified: true },
  { state: 'run', title: 'Fix refresh scheduler ordering + add regression test', sub: 'src/auth/refresh.ts · patch 3 applied · node --test running', owner: 'FO', tone: 'f1', running: true },
  { state: 'pending', title: 'Independent verification pass on the fix', sub: 'frozen snapshot · failing spawn must refuse completion', owner: 'VE', tone: 'f3' },
  { state: 'pending', title: 'Ship: changelog, tag, release notes', sub: 'blocked by verification · queue state: waiting', owner: 'AT', tone: 'f4' },
];

export const MISSION_AGENTS = [
  { ini: 'FO', tone: 'f1', name: 'Forge', role: 'Senior Engineer', pill: 'run', pillLabel: 'Working', task: <><b>fix:</b> src/auth/refresh.ts — scheduler ordering</>, bar: 'warm', pct: 72 },
  { ini: 'VE', tone: 'f3', name: 'Vera', role: 'Verification Lead', pill: 'warn', pillLabel: 'Waiting', task: 'next: frozen-snapshot verification pass on patch 3', bar: '', pct: 34 },
  { ini: 'ZO', tone: 'f2', name: 'Zola', role: 'Research Specialist', pill: 'idle', pillLabel: 'Idle', task: 'last: reproduced flake — evidence #2184 delivered', bar: '', pct: 18 },
];

export const TOOL_CALLS = [
  { c: 'var(--jcx-ember)', n: 'code-write', a: 'src/auth/refresh.ts · +14 −6', d: '182ms' },
  { c: 'var(--jcx-down)', n: 'code-run', a: 'node --test auth.test.js · 2 failing (pre-patch)', d: '4.2s' },
  { c: 'var(--jcx-up)', n: 'code-run', a: 'node --test auth.test.js · 14 passing (patch 2)', d: '3.9s' },
  { c: 'var(--jcx-up)', n: 'memory-recall', a: '"token refresh race" · 3 lessons hit', d: '22ms' },
  { c: 'var(--jcx-up)', n: 'web-search', a: '"jest fake timers drift" · 5 results', d: '640ms' },
  { c: 'var(--jcx-gold)', n: 'terminal-send', a: 'git stash list · slow (1.1s) — retry advised', d: '1.1s' },
];

export const EVENTS = [
  ['14:20:02', 'PLAN', 'Planner', '— intent ', 'code_fix · COMPLEX', ' → team: Forge (fix) → Vera (verify) → Atlas (ship)'],
  ['14:20:31', 'AGENT', 'Zola', '— flake reproduced in frozen workspace ', '2/14 failing · evidence #2184', ''],
  ['14:21:04', 'TOOL', 'Forge', '— ', 'code-run node --test auth.test.js', ' → 2 failing, 12 passing', true],
  ['14:23:47', 'AGENT', 'Forge', '— root cause found: refresh timer drifts ', '240ms', ' past expiry window'],
  ['14:26:12', 'TOOL', 'Forge', '— ', 'code-write src/auth/refresh.ts', ' patch 3 +14 −6'],
  ['14:26:40', 'TOOL', 'Forge', '— ', 'code-run node --test auth.test.js', ' → 14 passing', false, true],
  ['14:26:41', 'SYS', 'Observer', '— Snapshot frozen for verification — completion refused until Vera\'s spawn passes ', 'anti-fabrication guard', '', false],
];

export const LIVE_TICKER = [
  ['TOOL', 'Forge', 'code-run node --test auth.test.js', '→ 14 passing', 'var(--jcx-up)'],
  ['AGENT', 'Vera', 'verification pass armed on frozen snapshot', 'guard: failing spawn must refuse', 'var(--jcx-gold)'],
  ['TOOL', 'Forge', 'lint-check src/auth/refresh.ts', '0 problems', 'var(--jcx-up)'],
  ['AGENT', 'Forge', 'patch 4: tighten timer tolerance to 50ms', '+3 −1', 'var(--jcx-gold)'],
  ['SYS', 'Observer', 'event bus pressure', 'ring buffer 512/4096', 'var(--jcx-peach)'],
  ['TOOL', 'Atlas', 'screen-capture evidence for the release notes', 'saved #2190', 'var(--jcx-up)'],
];

/* ── chat transcript: the exact JEXI ↔ agent flow the preview mocks up ── */
export const CHAT = [
  {
    ts: '14:28:37', kind: 'director', name: 'JEXI', role: 'Director', pill: ['run', 'Dispatched'],
    bubble: true,
    text: (<>Mission accepted: fix the flaky auth test. Dispatching to <b>Forge</b> for the fix and <b>Vera</b> for verification. Frozen-workspace rules apply — completion is refused until her spawn passes.</>),
  },
  {
    ts: '14:28:39', kind: 'agent', ini: 'FO', tone: 'f1', name: 'Forge', role: 'Senior Engineer',
    text: 'Reproducing the failure in a frozen workspace first.',
    term: {
      tool: 'term_execute', cmd: '$ node --test auth.test.js', ms: '4.2s',
      out: '<span class="bad">✗ auth.test.js</span>\n  <span class="bad">✗ token refresh (2 failing)</span>\n    <span class="dim">-</span> expected: 200, received: 401\n    <span class="dim">-</span> refresh fired after expiry window\n  <span class="good">✓ 12 passing</span> <span class="dim">(12.4ms avg)</span>\n<span class="dim">frozen snapshot: ws-2184 · evidence #2184 saved</span>',
    },
  },
  {
    ts: '14:28:44', kind: 'agent', ini: 'FO', tone: 'f1', name: 'Forge', role: 'Senior Engineer',
    text: 'Traced the race to token-refresh scheduling. Patching src/auth/refresh.ts.',
    diff: {
      file: 'src/auth/refresh.ts', hunk: '@@ -18,6 +18,9 @@', stat: '+3 −1',
      lines: [
        ['hunk', '…scheduler setup…'],
        ['del', '- scheduleRefresh(ttl)'],
        ['add', '+ const GRACE_MS = 250; // fire BEFORE expiry, never after'],
        ['add', '+ scheduleRefresh(ttl - GRACE_MS)'],
      ],
    },
  },
  {
    ts: '14:28:51', kind: 'agent', ini: 'FO', tone: 'f1', name: 'Forge', role: 'Senior Engineer',
    text: 'Patch applied. Running the suite.',
    status: ['running…', 'var(--jcx-ember)'],
    call: {
      name: 'term_execute', desc: 'node --test auth.test.js', status: '14 passing · 3.9s',
      args: '{"cmd":["node","--test","auth.test.js"],"cwd":"ws-2184","timeout":30000}',
      result: '<span class="good">✓ auth.test.js — 14 passing (0 failing)</span>\n  <span class="good">✓ token refresh</span> <span class="dim">fires 250ms before expiry — 20/20 trials</span>\n<span class="dim">duration 3912ms · exit 0 · TAP 14/14</span>',
    },
  },
  {
    ts: '14:28:53', kind: 'agent', ini: 'VE', tone: 'f3', name: 'Vera', role: 'Verification Lead',
    bubble: true,
    text: (<>Taking it. Frozen snapshot + failing-spawn guard in place. Verifying. <span className="status" style={{ color: 'var(--jcx-gold)' }}>verifying…</span></>),
  },
  {
    ts: '14:29:04', kind: 'director', name: 'JEXI', role: 'Director',
    text: (<>Noted. Completion stays <b>refused</b> until Vera's spawn passes on the frozen bytes — the anti-fabrication gate is holding the queue.</>),
  },
];

/* ── work graph full canvas (7 nodes, 6 edges) ── */
export const CANVAS_NODES = [
  { x: 16, y: 58, state: 'ok', title: 'Parse intent', sub: 'code_fix · COMPLEX · budget $1.50', owner: 'J', tone: 'jexi', foot: 'JEXI · plan stage' },
  { x: 16, y: 198, state: 'ok', title: 'Compose team', sub: 'Forge fix → Vera verify → Atlas ship', owner: 'J', tone: 'jexi', foot: 'workforce registry · 3 assigned' },
  { x: 300, y: 58, state: 'ok', title: 'Reproduce the flaky failure', sub: 'node --test → 2 failing · evidence #2184', owner: 'ZO', tone: 'f2', badge: 'VERIFIED' },
  { x: 300, y: 198, state: 'ok', title: 'Trace token-refresh race', sub: 'timer drift 240ms past expiry window', owner: 'FO', tone: 'f1', badge: 'VERIFIED' },
  { x: 584, y: 128, state: 'run', title: 'Fix scheduler ordering + regression test', sub: 'src/auth/refresh.ts · patch 3 · tests running', owner: 'FO', tone: 'f1', foot: 'running…', running: true },
  { x: 868, y: 58, state: 'pending', title: 'Independent verification', sub: 'frozen snapshot · Vera\'s spawn decides', owner: 'VE', tone: 'f3', foot: 'queued' },
  { x: 868, y: 228, state: 'pending', title: 'Ship: changelog, tag, notes', sub: 'blocked by verification · queue: waiting', owner: 'AT', tone: 'f4', foot: 'waiting' },
];

export const CANVAS_EDGES = [
  'M254 88 C 277 88, 277 88, 300 88',
  'M254 228 C 277 228, 277 228, 300 228',
  'M254 96 C 277 96, 277 220, 300 220',
  'M538 88 C 561 88, 561 158, 584 158',
  'M538 228 C 561 228, 561 172, 584 172',
  'M822 165 C 845 165, 845 98, 868 98',
  'M822 172 C 845 172, 845 258, 868 258',
];

/* ── agents fleet ── */
export const FLEET = [
  { ini: 'FO', tone: 'f1', name: 'Forge', role: 'Senior Engineer', task: ['fix:', ' src/auth/refresh.ts — scheduler ordering'], chips: ['code-write', 'term_execute', 'git-ops'], pill: ['run', 'Working'], pct: 72, bar: 'warm' },
  { ini: 'VE', tone: 'f3', name: 'Vera', role: 'Verification Lead', task: ['', 'next: frozen-snapshot verification pass on patch 3'], chips: ['test_run', 'diff-read'], pill: ['warn', 'Waiting'], pct: 34, bar: '' },
  { ini: 'ZO', tone: 'f2', name: 'Zola', role: 'Research Specialist', task: ['', 'last: reproduced flake — evidence #2184 delivered'], chips: ['web-search', 'fetch'], pill: ['idle', 'Idle'], pct: 18, bar: '' },
  { ini: 'AT', tone: 'f4', name: 'Atlas', role: 'Release Operator', task: ['', 'queued: changelog + tag after verification passes'], chips: ['git-ops', 'screen-capture'], pill: ['warn', 'Queued'], pct: 12, bar: '' },
  { ini: 'AD', tone: 'f2', name: 'Ada', role: 'Archivist', task: ['', 'last: indexed 14 events into episodic memory'], chips: ['memory-write'], pill: ['idle', 'Idle'], pct: 9, bar: '' },
  { ini: 'NO', tone: 'f3', name: 'Nova', role: 'Static Analyst', task: ['', 'last: tsserver sweep — 0 new diagnostics'], chips: ['lsp-diagnostics'], pill: ['idle', 'Idle'], pct: 15, bar: '' },
  { ini: 'QU', tone: 'f1', name: 'Quill', role: 'Docs Writer', task: ['', 'standby: release notes draft after ship node'], chips: ['file-write'], pill: ['idle', 'Idle'], pct: 6, bar: '' },
  { ini: 'RU', tone: 'f4', name: 'Rune', role: 'Scheduler Warden', task: ['', 'watching 4 cron jobs · last fire 02:30 OK'], chips: ['cron-manage'], pill: ['ok', 'Healthy'], pct: 22, bar: '' },
  { ini: 'SG', tone: 'f2', name: 'Sage', role: 'Budget Sentinel', task: ['', 'context 72% warm — compaction armed at 85%'], chips: ['context-budget'], pill: ['ok', 'Watching'], pct: 41, bar: '' },
];

/* ── sessions ── */
export const SESSIONS = {
  roots: [
    {
      dot: 'var(--jcx-ember)', title: 'Fix the flaky auth test suite', pill: ['run', 'Live'],
      meta: 'sess_01H9XK4 · 2,184 events · running · server/data/sessions/01H9XK4.jsonl',
      children: [
        { dot: 'var(--jcx-up)', title: 'child · repro in frozen workspace', pill: ['ok', 'Done'], meta: 'sess_01H9XM1 · 412 events · 6m 12s · spawned by Forge' },
        { dot: 'var(--jcx-gold)', title: 'child · verify patch 3', pill: ['warn', 'Armed'], meta: 'sess_01H9XN7 · 38 events · armed · spawned by Vera' },
      ],
    },
    { dot: 'var(--jcx-up)', title: 'Overnight research: MCP grants posture', pill: ['ok', 'Done'], meta: 'sess_01H7PP2 · 1,907 events · 4h 41m · resumed once' },
    { dot: 'var(--jcx-up)', title: 'Boot + ONE-KEY probe', pill: ['ok', 'Done'], meta: 'sess_01H5KK8 · 742 events · 22m 03s' },
  ],
  jsonl: [
    '{"ts":"2026-09-16T14:26:12Z","type":"tool_use",',
    ' "agent":"Forge","tool":"code-write",',
    ' "path":"src/auth/refresh.ts","patch":"+14 -6"}',
    '',
    '{"ts":"2026-09-16T14:26:40Z","type":"tool_result",',
    ' "tool":"code-run","status":"ok",',
    ' "passed":14,"failed":0,"ms":3912}',
    '',
    '{"ts":"2026-09-16T14:26:41Z","type":"gate",',
    ' "gate":"verification","state":"refused",',
    ' "reason":"awaiting Vera spawn on frozen bytes"}',
  ],
};

/* ── memory tiers ── */
export const MEMORY = [
  {
    tier: 'Working', pct: 72, cnt: '6 items',
    rows: [
      ['mission', 'Fix the flaky auth test suite & verify', 'now'],
      ['team', 'Forge (fix) → Vera (verify) → Atlas (ship)', 'now'],
      ['budget', '$0.4127 of $1.50 · tokens 81.2k', 'now'],
      ['gate', 'completion refused until Vera spawn passes', '14:26'],
    ],
  },
  {
    tier: 'Session', pct: 38, cnt: '41 items',
    rows: [
      ['fact', 'flake reproduced: 2/14 failing on frozen ws-2184', '14:20'],
      ['fact', 'root cause: refresh timer drifts 240ms past expiry', '14:23'],
      ['patch', 'patch 3 applied — +14 −6, GRACE_MS=250', '14:26'],
      ['test', 'node --test → 14 passing, 0 failing (3.9s)', '14:26'],
    ],
  },
  {
    tier: 'Episodic', pct: 54, cnt: '128 episodes',
    rows: [
      ['#2184', 'auth flake reproduction — evidence bundle saved', 'today'],
      ['#2171', 'rate-limiter boot crash — fixed via ipKeyGenerator', '2d ago'],
      ['#2106', 'ONE-KEY probe — all tools keyless except model', '4d ago'],
      ['#2098', 'SIGKILL mid-graph — checkpoint + lease recovery OK', '5d ago'],
    ],
  },
  {
    tier: 'Semantic', pct: 29, cnt: '87 lessons',
    rows: [
      ['lesson', 'refresh timers need grace windows — fire BEFORE expiry', 'durable'],
      ['lesson', 'freeze snapshots before verification spawns', 'durable'],
      ['lesson', 'test parsers must accept TAP and spec-reporter', 'durable'],
      ['lesson', 'fetch UAs need a contact URL or hosts return 403', 'durable'],
    ],
  },
];

/* ── skills ── */
export const SKILLS = [
  ['node-test-runner', 'v3.2 · code', 'spawn node --test on frozen bytes · parses TAP + spec output', '4,128 runs', 97, ['ok', 'Core']],
  ['tap-parser', 'v2.8 · test', 'TAP 13 → structured verdicts with failure positions', '3,942 runs', 98, ['ok', 'Core']],
  ['git-ops', 'v4.1 · ops', 'stage / commit / push with SHA triple-verification', '2,206 runs', 96, ['ok', 'Core']],
  ['screenshot-capture', 'v1.9 · web', 'headless Chromium at target viewport, console-error audit', '871 runs', 93, ['ok', 'Core']],
  ['sqlite-query', 'v2.3 · data', 'read-only SQL against mission + memory stores', '1,530 runs', 99, ['ok', 'Core']],
  ['onekey-probe', 'v1.0 · plugin', 'sample plugin: 2-step credential audit (discover → verify)', '12 runs', 100, ['info', 'Plugin']],
  ['image-search', 'v2.0 · web', 'licensed image lookup with compliant UA + contact URL', '644 runs', 91, ['ok', 'Core']],
  ['cron-schedule', 'v1.4 · ops', 'register cron jobs with SQLite-persisted run rows', '301 runs', 95, ['ok', 'Core']],
];

/* ── knowledge ── */
export const ZETTELS = [
  ['Z-0912', 'token-refresh race — grace windows beat exact timers', '7 links'],
  ['Z-0908', 'frozen-snapshot protocol for verification spawns', '12 links'],
  ['Z-0891', 'ONE-KEY invariant — only the model provider needs a key', '21 links'],
  ['Z-0877', 'TAP vs spec-reporter — parse both or false failures', '5 links'],
  ['Z-0864', 'fetch UA policy — contact URL or 403', '4 links'],
  ['Z-0859', 'community MCP servers ship disabled — force-gate', '9 links'],
];

export const KNOWLEDGE_GRAPH = {
  edges: [
    ['M150 150 L 260 80', false], ['M150 150 L 262 190', false], ['M150 150 L 88 228', false],
    ['M260 80 L 400 120', true], ['M262 190 L 400 120', false], ['M262 190 L 372 244', false],
  ],
  nodes: [
    [150, 150, 26, 'Z-0912', true], [260, 80, 20, 'Z-0908'], [262, 190, 20, 'Z-0891'],
    [88, 228, 16, 'Z-0877'], [400, 120, 16, 'Z-0864'], [372, 244, 16, 'Z-0859'],
  ],
};

/* ── connectors ── */
export const CONNECTORS = [
  { dot: 'var(--jcx-up)', name: 'filesystem', desc: 'workspace jail · read/write under approved roots', grants: ['Forge', 'Quill'], pill: ['ok', 'Connected'] },
  { dot: 'var(--jcx-up)', name: 'git', desc: 'local repos · commit / push via workforce token vault', grants: ['Forge', 'Atlas'], pill: ['ok', 'Connected'] },
  { dot: 'var(--jcx-up)', name: 'browser worker', desc: 'local Chromium registered live · screenshots + render audits', grants: ['all Executive'], pill: ['ok', 'Connected'] },
  { dot: 'var(--jcx-up)', name: 'sqlite', desc: 'mission / memory / scheduler stores · read-only grants', grants: ['Vera', 'Sage'], pill: ['ok', 'Connected'] },
  { dot: 'var(--jcx-gold)', name: 'fetch + search', desc: 'compliant UA with contact URL · rate-limit backoff armed', grants: ['Zola'], pill: ['warn', 'Throttled'] },
  { dot: 'var(--jcx-ink-3)', name: 'model provider bridge', desc: 'the ONE key — Gemini credential from the user vault', grants: ['JEXI core'], pill: ['ok', 'Healthy'] },
];

/* ── plugins ── */
export const PLUGINS = [
  ['onekey-probe', 'v1.0.0', 'sample credential-audit plugin · contributes 1 skill (2 steps)', 'skills: 1', ['ok', 'Enabled']],
  ['pdf-toolkit', 'v2.4.1', 'extract / merge / fill · URL fetch subject to UA policy', 'skills: 6', ['ok', 'Enabled']],
  ['office-suite', 'v1.8.0', 'docx / xlsx / pptx generation through the document skills', 'skills: 9', ['ok', 'Enabled']],
  ['market-adapters', 'v0.9.3', 'broker feed adapters · paper mode enforced by default', 'skills: 4', ['warn', 'Draft']],
  ['evidence-bundler', 'v1.2.2', 'bundle screenshots + TAP output into verification artifacts', 'skills: 2', ['ok', 'Enabled']],
];

/* ── mcp registry ── */
export const MCP = [
  { name: 'filesystem', meta: 'stdio · local', grants: ['Forge · rw', 'Quill · rw', 'Ada · ro'], pill: ['ok', 'Enabled'] },
  { name: 'git', meta: 'stdio · local', grants: ['Forge · rw', 'Atlas · rw'], pill: ['ok', 'Enabled'] },
  { name: 'sqlite', meta: 'stdio · local', grants: ['Vera · ro', 'Sage · ro'], pill: ['ok', 'Enabled'] },
  { name: 'browser', meta: 'worker · local Chromium', grants: ['Executive group · rw'], pill: ['ok', 'Enabled'] },
  { name: 'fetch', meta: 'stdio · local', grants: ['Zola · ro'], pill: ['ok', 'Enabled'] },
  { name: 'github-community', meta: 'http · community', note: 'enable requires force — shipped disabled by policy', pill: ['idle', 'Disabled'] },
  { name: 'slack-community', meta: 'http · community', note: 'enable requires force — shipped disabled by policy', pill: ['idle', 'Disabled'] },
  { name: '+ 35 more community servers', meta: 'http · community', note: 'same force-gate posture · enableMcpServer refuses without force', pill: ['idle', 'Disabled'] },
];

/* ── scheduler ── */
export const CRON = [
  { dot: 'var(--jcx-up)', name: 'overnight-research dispatch', desc: 'skill: web-research · scope: MCP posture watch', next: '30 2 * * * · next 02:30', pill: ['ok', 'Last OK'] },
  { dot: 'var(--jcx-up)', name: 'nightly dependency audit', desc: 'skill: audit-deps · opens findings as missions', next: '0 3 * * * · next 03:00', pill: ['ok', 'Last OK'] },
  { dot: 'var(--jcx-up)', name: 'memory compaction', desc: 'head+tail compaction · keeps 40-event range', next: '0 * * * * · next 15:00', pill: ['ok', 'Last OK'] },
  { dot: 'var(--jcx-gold)', name: 'weekly roster sync', desc: 'workforce registry vs Employees index reconciliation', next: '0 6 * * 1 · next Mon 06:00', pill: ['warn', 'Pending'] },
];

export const CRON_RUNS = [
  ['14:00:00', 'memory compaction', '412ms', ['ok', 'OK']],
  ['13:00:00', 'memory compaction', '388ms', ['ok', 'OK']],
  ['02:30:00', 'overnight-research', '4h 41m', ['ok', 'OK']],
  ['02:00:00', 'nightly dep audit', '6m 12s', ['ok', 'OK']],
  ['01:00:00', 'memory compaction', '401ms', ['warn', 'Skipped (pressure cool)']],
];
