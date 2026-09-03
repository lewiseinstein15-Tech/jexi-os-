/**
 * B173 — THINKING STREAM TESTS (dsh ReasoningRow parity).
 *
 *   reasoning channel   — delta.reasoning_content / delta.reasoning stream
 *                         to onThink, NEVER into the answer text
 *   end-to-end          — generateContent with a mocked SSE provider:
 *                         think tokens → onThink, answer → onToken
 *   sanitize            — model ids masked in think text, numbers survive
 *   engine + UI         — think events build the Think row; auto-collapse
 *                         when the answer starts; reasoning survives `done`
 *   dead-air narration  — rotating phase words replace flat "thinking…"
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
let failures = 0;
const ok = (name, cond) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) failures += 1;
};

/* ══════════════ 1. END-TO-END: reasoning vs answer channels ══════════════ */
console.log('\n== 1. reasoning streams on its own channel ==');
{
  process.env.OPENROUTER_API_KEY = 'sk-test-b173';
  const { generateContent } = await import('./src/services/LLMClient.js');

  const chunk = (delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}`;
  const sse = [
    chunk({ reasoning_content: 'Let me think ' }),
    chunk({ reasoning_content: 'about this carefully.' }),
    chunk({ content: ' Nairobi is' }),
    chunk({ content: ' the capital.' }),
    'data: [DONE]',
    '',
  ].join('\n');

  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    body: {
      getReader() {
        const enc = new TextEncoder();
        let sent = false;
        return {
          read: async () => {
            if (sent) return { done: true, value: undefined };
            sent = true;
            return { done: false, value: enc.encode(sse) };
          },
        };
      },
    },
  });

  const thought = [];
  const answered = [];
  const answer = await generateContent('what is the capital of kenya?', 'test', null, {
    onToken: (t, meta) => answered.push([t, meta]),
    onThink: (t, meta) => thought.push([t, meta]),
  });
  globalThis.fetch = realFetch;
  delete process.env.OPENROUTER_API_KEY;

  const thinkText = thought.map(([t]) => t).join('');
  const answerDeltas = answered.map(([t]) => t).join('');
  ok(`reasoning reached onThink (${thinkText.slice(0, 30)}…)`, thinkText.includes('Let me think') && thinkText.includes('carefully'));
  ok('reasoning NEVER leaks into the answer text', !String(answer).includes('Let me think') && answerDeltas.includes('Nairobi'));
  ok('answer streamed via onToken', answerDeltas.includes('the capital.'));
  ok('both channels carry provider+model meta (named coworker)', thought[0][1]?.provider === 'openrouter' && answered[0][1]?.provider === 'openrouter');
  ok('final text is the answer only', String(answer).includes('Nairobi') && !String(answer).includes('think'));
}

/* ══════════════ 2. THINK-TEXT SANITIZE ══════════════ */
console.log('\n== 2. think text sanitized ==');
{
  const { sanitizeStreamText } = await import('./src/services/ModelCoworkers.js');
  const out = sanitizeStreamText('I will use deepseek-ai/deepseek-v4-flash-0731 for this, taking 2.5s');
  ok('model ids masked inside reasoning (people name replaces the id)', !out.includes('deepseek') && !out.includes('v4-flash') && /[A-Z][a-z]+/.test(out));
  ok('numbers with units survive', out.includes('2.5s'));
}

/* ══════════════ 3. ENGINE + UI WIRING ══════════════ */
console.log('\n== 3. engine + UI wiring ==');
{
  const hook = fs.readFileSync(path.join(ROOT, 'src/hooks/useJexiEngine.js'), 'utf-8');
  ok("engine consumes 'think' events into message.thinking", hook.includes("data.type === 'think'") && hook.includes('thinking: (last.thinking') );
  ok('think row created before the first answer token', hook.includes("next.push({ role: 'jexi', text: '', thinking: delta"));
  ok('first answer token stamps thinkMs (live phase ends)', hook.includes('thinkMs = Date.now() - thinkT0'));
  ok('reasoning + thinkMs survive the done event', hook.includes('cur.thinking ? { thinking: cur.thinking }'));

  const tr = fs.readFileSync(path.join(ROOT, 'src/components/ThinkRow.jsx'), 'utf-8');
  ok('ThinkRow: live label with timer + coworker name', tr.includes('Thinking') && tr.includes('elapsed.toFixed(1)') && tr.includes('{by}'));
  ok('ThinkRow: auto-collapses when the answer starts', tr.includes('if (!active) setExpanded(false)'));
  ok('ThinkRow: tap to expand/collapse after the turn', tr.includes('tap to') && tr.includes('setExpanded((e) => !e)'));

  const chat = fs.readFileSync(path.join(ROOT, 'src/components/ChatWindow.jsx'), 'utf-8');
  // B205 — ThinkRow + NarrationFeed were unified into AgentThinking (the
  // arena-style panel): reasoning still renders above the answer, now with
  // narrations + agent activity in the same collapsible block.
  ok('ChatWindow renders the thinking panel above the answer', chat.includes('<AgentThinking') && chat.includes('thinking={msg.thinking}'));

  const pipe = fs.readFileSync(path.join(ROOT, 'src/components/AgentPipeline.jsx'), 'utf-8');
  ok('dead-air narration replaces flat "thinking…"', pipe.includes('reading your message…') && pipe.includes('planning the best approach') && !pipe.includes('"detail">thinking…'));

  const idx = fs.readFileSync('./index.js', 'utf-8');
  ok('chat route sanitizes think text (model ids never leak, B174c: math-normalized first)',
    idx.includes("type === 'think'") && idx.includes('sanitizeStreamText(normalizeMathDelimiters(data.text))'));
  const al = fs.readFileSync('./src/services/AgentLoop.js', 'utf-8');
  const st = fs.readFileSync('./src/services/SimpleTask.js', 'utf-8');
  ok("AgentLoop + SimpleTask emit 'think' events with the writer name", al.includes("emit('think'") && st.includes("emit('think'"));
  const wr = fs.readFileSync('./src/services/WorkerRouter.js', 'utf-8');
  ok('WorkerRouter forwards onThink through both lanes', wr.includes('onThink') && wr.split('onThink').length >= 3);
}

console.log(`\n${failures === 0 ? '🎉 ALL B173 THINKING-STREAM CHECKS PASSED' : `💥 ${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);
