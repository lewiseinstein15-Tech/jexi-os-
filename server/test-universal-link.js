/**
 * JEXI OS — Universal Link Agent regression suite (B91).
 * Video/social/article classification + instruction execution (mocked deps).
 */

import { classifyLink, UniversalLinkAgent } from './src/services/UniversalLinkAgent.js';

let passed = 0;
let failed = 0;
const ok = (cond, name) => {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
};

console.log('\n== Classification ==');
ok(classifyLink('https://youtube.com/watch?v=abc123').type === 'video' && classifyLink('https://youtube.com/watch?v=abc123').platform === 'youtube', 'youtube → video');
ok(classifyLink('https://www.tiktok.com/@x/video/123').type === 'video' && classifyLink('https://www.tiktok.com/@x/video/123').platform === 'tiktok', 'tiktok → video');
ok(classifyLink('https://www.instagram.com/reel/xyz/').type === 'video' && classifyLink('https://www.instagram.com/reel/xyz/').platform === 'instagram', 'instagram reel → video');
ok(classifyLink('https://vimeo.com/123').type === 'video', 'vimeo → video');
ok(classifyLink('https://www.facebook.com/watch?v=1').type === 'social', 'facebook → social');
ok(classifyLink('https://x.com/someuser/status/1').type === 'social', 'x → social');
ok(classifyLink('https://example.com/article').type === 'article', 'website → article');
ok(classifyLink('not a url').type === 'invalid', 'garbage → invalid');

console.log('\n== Video: instruction applied to transcript+frames ==');
{
  let analyzed = 0;
  const agent = new UniversalLinkAgent({
    analyzeVideo: async (url, ev) => { analyzed += 1; return { summary: 'A cooking video showing how to make pancakes from scratch.', transcript: 'step 1 mix flour and eggs. step 2 add water and whisk until smooth.', frames: ['f1', 'f2'] }; },
    readPage: null,
    generateContent: async (prompt) => `### 🍳 Recipe\n\nFrom the video: mix flour, add water.`,
  });
  const events = [];
  const out = await agent.run({ url: 'https://youtube.com/watch?v=abc', instruction: 'extract the recipe', sendEvent: (t) => events.push(t) });
  ok(out.success === true, 'succeeds');
  ok(analyzed === 1, 'video analyzer used');
  ok(/mix flour/.test(out.summary), 'instruction applied to video content');
  ok(events.includes('link.start') && events.includes('link.classify') && events.includes('link.content-ready'), 'event stream emitted');
  ok(out.meta.kind === 'video' && out.meta.frames === 2, 'meta carries frames count');
}

console.log('\n== Social: browser read then instruction ==');
{
  const agent = new UniversalLinkAgent({
    analyzeVideo: null,
    readPage: async () => ({ title: 'Facebook post', text: 'Check out this new product launch today!' }),
    generateContent: async (prompt) => '### 📣 Post summary\n\nNew product launch announced.',
  });
  const out = await agent.run({ url: 'https://www.facebook.com/watch?v=1', instruction: 'summarize this post' });
  ok(out.success === true, 'succeeds');
  ok(/product launch/.test(out.summary), 'instruction applied to social content');
}

console.log('\n== Article: deep-read then instruction ==');
{
  const agent = new UniversalLinkAgent({
    analyzeVideo: null,
    readPage: async () => ({ title: 'TechCrunch', text: 'Startup raises $50M series B to expand AI platform.' }),
    generateContent: async (prompt) => '### 📰 Summary\n\nStartup raised $50M.',
  });
  const out = await agent.run({ url: 'https://techcrunch.com/2026/08/16/startup', instruction: 'summarize' });
  ok(out.success === true && /50M/.test(out.summary), 'article summary correct');
}

console.log('\n== No readable content / analyzer failure → honest ==');
{
  const agent = new UniversalLinkAgent({ analyzeVideo: null, readPage: async () => ({ text: '' }), generateContent: null });
  const out = await agent.run({ url: 'https://example.com/empty' });
  ok(out.success === false && /no readable content/.test(out.summary), 'empty content → honest failure');
}
{
  const agent = new UniversalLinkAgent({ analyzeVideo: null, readPage: async () => { throw new Error('login wall'); }, generateContent: null });
  const out = await agent.run({ url: 'https://example.com/wall' });
  ok(out.success === false && /login-walled/.test(out.summary), 'read failure → honest with hint');
}

console.log('\n== No LLM → content passthrough fallback ==');
{
  const agent = new UniversalLinkAgent({ analyzeVideo: null, readPage: async () => ({ title: 'Page', text: 'Some real content here to show.' }), generateContent: null });
  const out = await agent.run({ url: 'https://example.com/x', instruction: '' });
  ok(out.success === true && /Some real content/.test(out.summary), 'passthrough fallback works');
}

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
