/**
 * JEXI OS — GitHub Repository Analyzer regression suite (B154).
 * URL parsing, GitHub-API analysis (mocked fetch), LLM report path,
 * deterministic fallback, honest failures, git-clone fallback, and the
 * Universal Link Agent routing (github links never hit the article deep-read).
 */

import { classifyGithubUrl, analyzeGithubRepo } from './src/services/GitHubRepo.js';
import { classifyLink, UniversalLinkAgent } from './src/services/UniversalLinkAgent.js';

let passed = 0;
let failed = 0;
const ok = (cond, name) => {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
};

console.log('\n== classifyGithubUrl ==');
{
  let r = classifyGithubUrl('https://github.com/octocat/Hello-World');
  ok(r.type === 'repo' && r.owner === 'octocat' && r.repo === 'Hello-World', 'plain repo URL');
  r = classifyGithubUrl('https://github.com/lewiseinstein15-Tech/jexi-os-/');
  ok(r.type === 'repo' && r.owner === 'lewiseinstein15-Tech' && r.repo === 'jexi-os-', 'owner/repo with trailing dash + slash');
  r = classifyGithubUrl('https://www.github.com/foo/bar.git');
  ok(r.type === 'repo' && r.repo === 'bar', 'www + .git suffix stripped');
  r = classifyGithubUrl('https://github.com/foo/bar/tree/main/src/utils');
  ok(r.type === 'repo' && r.ref === 'main' && r.path === 'src/utils', 'tree ref + path parsed');
  r = classifyGithubUrl('https://github.com/foo/bar/blob/main/README.md');
  ok(r.type === 'repo' && r.ref === 'main' && r.path === 'README.md', 'blob path parsed');
  r = classifyGithubUrl('https://github.com/foo/bar?tab=readme-ov-file');
  ok(r.type === 'repo' && r.repo === 'bar', 'query string ignored');
  r = classifyGithubUrl('https://github.com/features');
  ok(r.type === 'other', 'github.com site section → other');
  r = classifyGithubUrl('https://gist.github.com/octocat/abc123');
  ok(r.type === 'gist', 'gist → gist');
  r = classifyGithubUrl('https://raw.githubusercontent.com/foo/bar/main/README.md');
  ok(r.type === 'file' && r.owner === 'foo' && r.path === 'README.md', 'raw file → file');
  r = classifyGithubUrl('https://example.com/article');
  ok(r.type === 'other', 'non-github → other');
  r = classifyGithubUrl('not a url');
  ok(r.type === 'other', 'garbage → other');
}

console.log('\n== classifyLink routing ==');
{
  ok(classifyLink('https://github.com/octocat/Hello-World').type === 'github-repo', 'github repo → github-repo');
  ok(classifyLink('https://github.com/foo/bar/tree/main').type === 'github-repo', 'github tree URL → github-repo');
  ok(classifyLink('https://example.com/article').type === 'article', 'website → article (unchanged)');
  ok(classifyLink('https://youtube.com/watch?v=abc').type === 'video', 'youtube → video (unchanged)');
}

console.log('\n== analyzeGithubRepo — API + deterministic fallback (no LLM) ==');
{
  const meta = { full_name: 'octocat/Hello-World', description: 'My first repository', language: 'HTML', stargazers_count: 2500, forks_count: 1200, open_issues_count: 4, license: { spdx_id: 'MIT' }, archived: false, topics: ['demo'], size: 100, updated_at: '2024-01-01T00:00:00Z', default_branch: 'main' };
  const tree = { tree: [
    { path: 'README.md', type: 'blob' },
    { path: 'index.html', type: 'blob' },
    { path: 'styles/style.css', type: 'blob' },
    { path: 'node_modules/x/index.js', type: 'blob' },
    { path: 'src/app.js', type: 'blob' },
  ] };
  const readme = '# Hello World\n\nMy first repository on GitHub!';
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push(String(url));
    const accept = (opts.headers && opts.headers.Accept) || '';
    if (String(url).includes('/repos/octocat/Hello-World') && !String(url).includes('/git/trees')) {
      if (accept.includes('raw')) return { ok: true, status: 200, async text() { return readme; } };
      return { ok: true, status: 200, async json() { return meta; } };
    }
    if (String(url).includes('/git/trees/main')) return { ok: true, status: 200, async json() { return tree; } };
    if (String(url).startsWith('https://raw.githubusercontent.com/octocat/Hello-World/main/README.md')) return { ok: true, status: 200, async text() { return readme; } };
    if (String(url).includes('package.json')) return { ok: true, status: 200, async text() { return '{ "name": "hello-world", "scripts": { "test": "echo hi" } }'; } };
    return { ok: false, status: 404, async json() { return {}; }, async text() { return ''; } };
  };

  const events = [];
  const out = await analyzeGithubRepo('https://github.com/octocat/Hello-World', { instruction: 'analyze this repo', sendEvent: (t) => events.push(t), fetchImpl, gitClone: null, generateContent: null });
  ok(out.success === true, 'analysis succeeds without LLM');
  ok(/OVERVIEW/.test(out.summary) && /octocat\/Hello-World/.test(out.summary), 'deterministic report has OVERVIEW + repo name');
  ok(/2500/.test(out.summary) && /HTML/.test(out.summary), 'metadata (stars, language) present');
  ok(/index\.html/.test(out.summary), 'file tree present');
  ok(/node_modules/.test(out.summary) === false, 'junk dir (node_modules) excluded');
  ok(out.meta.kind === 'github-repo' && out.meta.filesCount === 4, 'meta carries kind + file count');
  ok(events.includes('link.content-ready') && events.includes('link.answer') && events.includes('done'), 'event stream emitted');
}

console.log('\n== analyzeGithubRepo — LLM report path ==');
{
  const meta = { full_name: 'foo/bar', description: 'A bot', language: 'JavaScript', stargazers_count: 10, forks_count: 1, open_issues_count: 0, license: null, archived: false, topics: [], size: 5, updated_at: '2024-02-02T00:00:00Z', default_branch: 'main' };
  const fetchImpl = async (url, opts = {}) => {
    const accept = (opts.headers && opts.headers.Accept) || '';
    if (String(url).includes('/repos/foo/bar') && !String(url).includes('/git/trees')) {
      if (accept.includes('raw')) return { ok: true, status: 200, async text() { return 'README content here'; } };
      return { ok: true, status: 200, async json() { return meta; } };
    }
    if (String(url).includes('/git/trees/main')) return { ok: true, status: 200, async json() { return { tree: [{ path: 'README.md', type: 'blob' }, { path: 'src/bot.js', type: 'blob' }] }; } };
    return { ok: false, status: 404, async text() { return ''; } };
  };
  let llmPrompt = '';
  const out = await analyzeGithubRepo('https://github.com/foo/bar', {
    sendEvent: () => {}, fetchImpl, gitClone: null,
    generateContent: async (prompt) => { llmPrompt = prompt; return '## OVERVIEW\n\nA bot built in JavaScript.'; },
  });
  ok(out.success === true && /A bot built in JavaScript/.test(out.summary), 'LLM report used as summary');
  ok(/## ARCHITECTURE/.test(llmPrompt) && /foo\/bar/.test(llmPrompt), 'prompt demands structured sections + repo context');
  ok(/README content here/.test(llmPrompt), 'README injected into prompt');
}

console.log('\n== analyzeGithubRepo — honest failures ==');
{
  const fetchImpl = async () => ({ ok: false, status: 404, async json() { return {}; }, async text() { return ''; } });
  const out = await analyzeGithubRepo('https://github.com/missing/repo', { sendEvent: () => {}, fetchImpl, gitClone: null });
  ok(out.success === false && /not found/.test(out.error) && /missing\/repo/.test(out.summary), '404 → honest failure naming the repo');
}
{
  const fetchImpl = async () => { const e = new Error('rate limit'); e.code = 'RATE_LIMITED'; throw e; };
  const out = await analyzeGithubRepo('https://github.com/foo/bar', { sendEvent: () => {}, fetchImpl, gitClone: null });
  ok(out.success === false && /rate limit|reach GitHub/i.test(out.summary), 'rate-limited + no git → honest failure');
}
{
  // API down but git clone works → real analysis via clone.
  const fetchImpl = async () => { const e = new Error('network down'); e.code = 'RATE_LIMITED'; throw e; };
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-gh-test-'));
  fs.writeFileSync(path.join(dir, 'README.md'), '# Mock Repo\n\nCloned fallback works.');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'console.log(1);');
  const out = await analyzeGithubRepo('https://github.com/foo/bar', {
    sendEvent: () => {}, fetchImpl,
    gitClone: async () => dir,
  });
  ok(out.success === true, 'git-clone fallback produces an analysis');
  ok(out.meta.method === 'git-clone', 'meta records fallback method');
  ok(/Mock Repo/.test(out.summary), 'cloned README used in report');
}

console.log('\n== UniversalLinkAgent — github routing ==');
{
  let githubUsed = 0;
  let pageUsed = 0;
  const agent = new UniversalLinkAgent({
    analyzeVideo: null,
    readPage: async () => { pageUsed++; return { title: 'Page', text: 'A full length article text with plenty of content for the reader.' }; },
    analyzeGithubRepo: async (url, opts) => { githubUsed++; return { success: true, summary: '## OVERVIEW\n\nRepo report.', meta: { kind: 'github-repo', owner: 'octocat', repo: 'Hello-World' } }; },
    generateContent: null,
  });
  const g = await agent.run({ url: 'https://github.com/octocat/Hello-World', instruction: 'analyze' });
  ok(g.success === true && githubUsed === 1 && pageUsed === 0, 'github link → github analyzer (never the article reader)');
  ok(/Repo report/.test(g.summary), 'github report returned as summary');
  const a = await agent.run({ url: 'https://example.com/article', instruction: 'summarize' });
  ok(a.success === true && pageUsed === 1 && githubUsed === 1, 'regular link → article reader (unchanged)');
}
{
  // No analyzer wired → honest degradation, not a silent failure.
  const agent = new UniversalLinkAgent({ analyzeVideo: null, readPage: null, analyzeGithubRepo: null, generateContent: null });
  const out = await agent.run({ url: 'https://github.com/foo/bar' });
  ok(out.success === false && /could not/.test(out.summary), 'no analyzer → honest failure message');
}

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
