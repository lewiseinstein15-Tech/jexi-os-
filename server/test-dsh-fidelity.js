/**
 * B109 — DSH-FIDELITY regression suite.
 *
 * Verifies the B108 implementations now match DeepSeek Harness semantics
 * exactly, ported from their source:
 *  - TitleNormalize: DSH normalize.ts (escape/control stripping, UTF-8 BYTE
 *    truncation without splitting code points, word-capped fallback).
 *  - SessionTitles: pinned user-rename (generation stops), source kinds,
 *    messageSeqs, session/title log event.
 *  - SessionStats: the projection fold (turns/steps/toolMs/llmMs).
 *  - SessionReference: dsh-session: URIs, mention parsing, security-wrapped
 *    snapshots, budgets (max 3 / 64 KB).
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// Isolate stores FIRST (config reads env at import).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-dshf-'));
process.env.DATA_DIR = path.join(TMP, 'data');
process.env.WORKSPACE_DIR = path.join(TMP, 'ws');

let passed = 0, failedCount = 0;
const ok = (c, n) => { if (c) { passed++; console.log(`  ✅ ${n}`); } else { failedCount++; console.log(`  ❌ ${n}`); } };

const { cleanTitleText, truncateTitleUtf8, normalizeSessionTitle, fallbackSessionTitle } = await import('./src/services/TitleNormalize.js');
const { setStoredTitle, getStoredTitle, getStoredTitleRecord, maybeAutoTitle, setTitleGenerator, cleanTitle, fallbackTitleFor } = await import('./src/services/SessionTitles.js');
const { sessionStats } = await import('./src/services/SessionStats.js');
const {
  encodeSessionReferenceUri, decodeSessionReferenceUri, formatSessionReferenceMention,
  parseSessionReferenceText, resolveSessionReferences, hasSessionMentions, SESSION_REFERENCE_SCHEME,
} = await import('./src/services/SessionReference.js');
const { appendConversationEvent, conversationSummary, loadConversationEvents } = await import('./src/services/SessionConversations.js');
const { appendEvent, getEvents } = await import('./src/services/EventLog.js');

console.log('\n== 1. TitleNormalize — DSH normalize.ts port ==');
ok(cleanTitleText('  spaced   out  ') === 'spaced out', 'whitespace collapsed + trimmed (DSH cleanTitleText)');
ok(cleanTitleText('bad\u001B]0;title\u0007text') === 'badtext', 'OSC escapes stripped (DSH OSC_SEQUENCE)');
ok(cleanTitleText('a\u001B[31mred\u001B[0m') === 'ared', 'CSI/SGR color codes stripped (DSH CSI_SEQUENCE)');
ok(cleanTitleText('tab\there') === 'tab here', 'control whitespace normalized');
ok(cleanTitleText('zw\u200Bsp') === 'zwsp', 'zero-width space stripped (DSH DIRECTIONAL_CONTROL)');
ok(truncateTitleUtf8('héllo', 2) === 'h', 'UTF-8 byte truncation does NOT split code points (é = 2 bytes)');
ok(truncateTitleUtf8('héllo', 4) === 'hél', 'byte budget: h(1)+é(2)+l(1) = 4 bytes');
ok(truncateTitleUtf8('hello', 100) === 'hello', 'within budget unchanged');
ok(Buffer.byteLength(truncateTitleUtf8('a'.repeat(200), 60), 'utf8') <= 60, 'byte budget honored');
ok(normalizeSessionTitle('  "Quoted Title"  ', 60) === '"Quoted Title"', 'normalize = clean + byte-truncate');
const fb = fallbackSessionTitle('help me build a todo app with dark mode and offline support please thank you', 4, 80);
ok(fb === 'help me build a', `fallback = leading ${'4'} WORDS, not the sentence (got "${fb}")`);
const fbBytes = fallbackSessionTitle('word '.repeat(100), 100, 20);
ok(Buffer.byteLength(fbBytes, 'utf8') <= 20, 'fallback respects the BYTE cap');

console.log('\n== 2. SessionTitles — DSH source kinds + pinning ==');
const r = setStoredTitle('pin-conv', '  My Pinned Title  ', 'user');
ok(r.ok === true && r.title === 'My Pinned Title' && r.source === 'user', 'user rename stored with source=user');
ok(getStoredTitleRecord('pin-conv').source === 'user', 'source persisted');
setTitleGenerator(async () => 'Auto Would Be This');
ok(await maybeAutoTitle('pin-conv') === false, 'user-pinned title STOPS automatic generation (DSH pins)');
// llm source + messageSeqs
setTitleGenerator(async () => 'Auto Title');
for (let i = 0; i < 5; i++) appendConversationEvent('llm-conv', { role: 'user', text: `q${i} about building a calculator app`, kind: 'chat' });
ok(await maybeAutoTitle('llm-conv') === true, 'llm title generated');
const rec = getStoredTitleRecord('llm-conv');
ok(rec.source === 'llm', 'llm source recorded');
ok(Array.isArray(rec.messageSeqs) && rec.messageSeqs.length >= 4, `messageSeqs recorded (${rec.messageSeqs.length})`);
const titleEvents = getEvents({ session: 'llm-conv', type: 'session_title' });
ok(titleEvents.length === 1, 'session/title log event emitted (DSH log-only event)');
ok(titleEvents[0].payload.title === 'Auto Title', 'log event carries the accepted title');
// DSH word-capped fallback flows into summaries
const s = conversationSummary('llm-conv');
ok(s.title === 'Auto Title' && s.titleSource === 'llm', 'summary uses stored title + source');
const untitled = conversationSummary('untitled-conv') === null ? null : conversationSummary('untitled-conv');
appendConversationEvent('untitled-conv', { role: 'user', text: 'please help me build a cross platform mobile app with push notifications and offline sync for android users', kind: 'chat' });
const u = conversationSummary('untitled-conv');
ok(u.title === 'please help me build a cross platform mobile', `fallback title is the leading 8 words (got "${u.title}")`);
ok(u.titleSource === 'fallback', 'fallback source reported');

console.log('\n== 3. SessionStats — DSH projection fold ==');
appendEvent('user_message', { text: 'hi' }, 'stats-conv');
appendEvent('tool_call', { tool: 'a', args: {} }, 'stats-conv');
appendEvent('tool_result', { tool: 'a', ok: true, durationMs: 100 }, 'stats-conv');
appendEvent('tool_call', { tool: 'b', args: {} }, 'stats-conv');
appendEvent('tool_result', { tool: 'b', ok: false, durationMs: 250 }, 'stats-conv');
appendEvent('coworker_result', { coworker: 'r', ok: true }, 'stats-conv');
const st = sessionStats('stats-conv');
ok(st.turns === 1, `turns = user_message count (${st.turns})`);
ok(st.steps === 3, `steps = closed execution steps (${st.steps})`);
ok(st.toolCalls === 2, `toolCalls (${st.toolCalls})`);
ok(st.toolMs === 350, `toolMs = Σ tool/call→result durations (${st.toolMs})`);
ok(st.messageCount >= 0, 'messageCount present');

console.log('\n== 4. SessionReference — DSH mention model ==');
const uri = encodeSessionReferenceUri('conv-abc123');
ok(uri.startsWith(SESSION_REFERENCE_SCHEME) && /^[A-Za-z0-9_-]+$/.test(uri.slice(SESSION_REFERENCE_SCHEME.length)), 'canonical base64url URI');
ok(decodeSessionReferenceUri(uri) === 'conv-abc123', 'round-trip decode');
ok(formatSessionReferenceMention('conv-abc123', 'The Moon Plan') === '@[The Moon Plan](dsh-session:' + uri.slice(SESSION_REFERENCE_SCHEME.length) + ')', 'markdown mention');
let threw = false;
try { decodeSessionReferenceUri('dsh-session:not!valid'); } catch { threw = true; }
ok(threw, 'invalid payload rejected');
const text = `Tell me about the moon plan ${formatSessionReferenceMention('conv-abc123', 'Moon Plan')} and also ${formatSessionReferenceMention('conv-abc123', 'Moon Plan dup')}`;
ok(hasSessionMentions(text) === true, 'mention detected');
const parsed = parseSessionReferenceText(text);
ok(parsed.references.length === 1 && parsed.references[0].sessionId === 'conv-abc123', 'duplicate mention deduped to one reference');
ok(!parsed.text.includes('dsh-session:'), 'mention replaced with readable @label in the prompt text');

console.log('\n== 5. Resolution: security wrapper + budgets ==');
// a referenced conversation with real content
for (let i = 0; i < 4; i++) {
  appendConversationEvent('conv-abc123', { role: 'user', text: `moon plan question ${i} about landing sites`, kind: 'chat' });
  appendConversationEvent('conv-abc123', { role: 'jexi', text: `moon plan answer ${i}`, kind: 'chat' });
}
const res = resolveSessionReferences(`What did we decide? ${formatSessionReferenceMention('conv-abc123', 'Moon Plan')}`);
ok(res.resolved === 1, 'one reference resolved');
ok(res.injected.includes('## Referenced sessions'), 'DSH PROMPT_PREFIX wording present');
ok(res.injected.includes('untrusted, read-only snapshot'), 'security guard wording present');
ok(res.injected.includes('<referenced-sessions>') && res.injected.includes('</referenced-sessions>'), 'DSH wrapper tags present');
ok(res.injected.includes('"title"') && res.injected.includes('recentMessages'), 'snapshot carries title + recent messages');
ok(res.text.includes('@Moon Plan') && !res.text.includes('dsh-session:'), 'prompt text has the readable label');
// unknown session → not resolved, no crash
const miss = resolveSessionReferences(`hello ${formatSessionReferenceMention('missing-conv', 'Nope')}`);
ok(miss.resolved === 0 && miss.injected === '', 'missing session resolves to nothing (no crash)');
// budget: max 3 references
const multi = resolveSessionReferences(
  `${formatSessionReferenceMention('conv-abc123', 'A')} ${formatSessionReferenceMention('missing-x', 'B')} ${formatSessionReferenceMention('conv-abc123', 'C')} ${formatSessionReferenceMention('missing-y', 'D')}`,
  { maxReferences: 3 }
);
ok(multi.resolved <= 3, `maxReferences honored (${multi.resolved})`);
ok(Buffer.byteLength(multi.injected, 'utf8') <= 70000, 'byte budget respected');

console.log(`\nB109 dsh-fidelity: ${passed} passed, ${failedCount} failed`);
process.exit(failedCount ? 1 : 0);
