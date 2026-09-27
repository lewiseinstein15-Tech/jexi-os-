// Quick probe: is the model ladder live in this sandbox (via Pollinations keyless leg)?
import { generateContent } from '../server/src/providers/runtime/LLMClient.js';
import { canChat } from '../server/src/providers/index.js';

const t0 = Date.now();
try {
  const out = await generateContent('Reply with exactly: PONG', 'You are a probe. Reply with exactly one word.');
  console.log('generateContent ok:', JSON.stringify(String(out).trim().slice(0, 80)));
  console.log('latency:', Date.now() - t0, 'ms');
} catch (e) {
  console.log('generateContent FAILED:', String(e && e.message || e).slice(0, 200));
}
console.log('canChat():', canChat());
console.log('canChat([tool_calling]):', canChat(['tool_calling']));
