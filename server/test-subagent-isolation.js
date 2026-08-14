// B50 P4 — SUBAGENT ISOLATION + REUSABLE AGENT DEFINITIONS.
// Proves: agent definition files load (frontmatter + body); a task declared
// `context: fork` (or a definition declaring fork) runs isolated and the
// parent receives ONLY summary + status + artifacts — never the full
// intermediate transcript.
import { loadAgentDefinition, listAgentDefinitions, wantsIsolation } from './src/services/AgentDefinitions.js';
import { runIsolatedSubagent, runSubagents } from './src/services/SubagentRuntime.js';

let passed = 0;
let failed = 0;
const check = (name, ok) => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? '✅' : '❌'} ${name}`);
};

// 1. Reusable agent definition files exist and load.
const defs = listAgentDefinitions();
check('server/agents has 3 definition files', defs.includes('researcher') && defs.includes('security-auditor') && defs.includes('code-reviewer'));
for (const slug of ['researcher', 'security-auditor', 'code-reviewer']) {
  const d = loadAgentDefinition(slug);
  check(`${slug} definition loads with frontmatter`, !!d && !!d.meta.name && !!d.meta.description);
  check(`${slug} definition declares isolation (context: fork)`, wantsIsolation(d));
  check(`${slug} has allowed-tools`, (d.meta['allowed-tools'] || []).length > 0);
  check(`${slug} has a system prompt body`, (d.systemPrompt || '').length > 100);
}
check('unknown definition returns null', loadAgentDefinition('nope') === null);

// 2. runIsolatedSubagent returns ONLY summary/status/artifacts (no full answer).
//    The subagent is mocked via the opts hook: we simulate a LONG transcript
//    so the isolation boundary is measurable.
// The secret marker sits DEEP inside the transcript (beyond the 350-char
// parent-visible summary window) so any leak into parent data is detectable.
const LONG_TRANSCRIPT = 'x'.repeat(600) + 'INTERMEDIATE-TRANSCRIPT-MARKER-' + 'y'.repeat(5000) + ' END-OF-TRANSCRIPT';
let capturedParentPayload = null;
const res = await runIsolatedSubagent({
  name: 'forked-researcher',
  query: 'research X',
  sendEvent: (t, d) => { if (t === 'subagent.done') capturedParentPayload = d; },
  opts: {
    // Simulate the child AgentLoop completing with a huge answer.
    __mockAnswer: LONG_TRANSCRIPT,
  },
});
check('isolated run returns status PASS', res.status === 'PASS');
check('isolated run returns a summary (bounded)', typeof res.summary === 'string' && res.summary.length < 4000);
check('isolated run returns artifacts', Array.isArray(res.artifacts));
check('isolated result does NOT carry the full transcript', !JSON.stringify(res).includes('x'.repeat(500)));
check('parent subagent.done preview is a small summary', !JSON.stringify(capturedParentPayload || {}).includes('INTERMEDIATE-TRANSCRIPT-MARKER'));

// 3. runSubagents with an isolated task: parent aggregate only sees summaries.
{
  const results = await runSubagents({
    sendEvent: () => {},
    opts: { __mockAnswer: LONG_TRANSCRIPT },
    tasks: [
      { name: 'sub-a', query: 'task a', context: 'fork' },
      { name: 'sub-b', query: 'task b' },
    ],
  });
  const forked = results.subagents.find((r) => r.name === 'sub-a');
  const normal = results.subagents.find((r) => r.name === 'sub-b');
  check('forked task is marked isolated', forked && forked.isolated === true);
  check('forked task result has summary, no full answer field', forked && typeof forked.summary === 'string' && !('answer' in forked));
  check('normal task keeps the full answer', normal && typeof normal.answer === 'string');
  // Isolation contract: the FORKED subagent's parent-visible data (summary +
  // artifacts + status) never contains the deep-transcript marker.
  check('forked subagent did NOT leak transcript into parent-visible data', !JSON.stringify(forked).includes('INTERMEDIATE-TRANSCRIPT-MARKER'));
  check('counts report isolated count', results.counts.isolated >= 1);
}

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
