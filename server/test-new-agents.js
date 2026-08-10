// Smoke tests for the round-2 specialists: GitHub, Data, DevOps, Writer,
// Translator, Perf. Tests only pure/parsing functions — no network, no AI calls,
// no writes outside a temp workspace dir.
import fs from 'fs';
import os from 'os';
import path from 'path';

// Redirect the workspace BEFORE the services load their config.
const tmpWs = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-agents-test-'));
process.env.WORKSPACE_DIR = tmpWs;

let failures = 0;
const ok = (cond, label) => {
  if (!cond) failures++;
  console.log(`${cond ? '✅' : '❌'} ${label}`);
};

const { parseGithubRequest, inferCommitMessage } = await import('./src/services/GitHubAgent.js');
const { parseCsv, parseJson, computeStats, extractData } = await import('./src/services/DataAgent.js');
const { detectStack, dockerfileFor, ciYamlFor, deploySteps } = await import('./src/services/DevOpsAgent.js');
const { parseLanguages, extractText } = await import('./src/services/TranslatorAgent.js');
const { scanPerf } = await import('./src/services/PerfAgent.js');

console.log('\n== GITHUB AGENT ==');
ok(parseGithubRequest('push my code to github').action === 'push', 'push → action push');
ok(parseGithubRequest('commit and push to github').action === 'commit', 'commit+push → commit (orchestrator chains push)');
ok(parseGithubRequest('open a pull request').action === 'pr_create', 'PR → pr_create');
ok(parseGithubRequest('create a repo called jexi-cli --public').action === 'repo_create', 'repo create routed');
ok(parseGithubRequest('create a repo called jexi-cli --public').args.name === 'jexi-cli', 'repo name extracted');
ok(parseGithubRequest('git status').action === 'status', 'status routed');
ok(inferCommitMessage(' M index.html\n M styles.css\n') === 'Add built web app +1 more', 'commit message from files');

console.log('\n== DATA AGENT ==');
const csv = 'name,age,score\nAlice,30,90\nBob,25,80\nCarol,35,95\n';
const table = parseCsv(csv);
ok(table && table.columns.join(',') === 'name,age,score', 'CSV columns parsed');
ok(table && table.rows.length === 3, 'CSV rows parsed');
const stats = computeStats(table.rows, table.columns);
ok(stats.columns.age.mean === 30, 'mean of age = 30');
ok(stats.columns.score.max === 95 && stats.columns.score.median === 90, 'max/median of score');
ok(stats.columns.name.unique === 3, 'unique count for categorical');
ok(parseJson('[{"a":1,"b":2}]').rows.length === 1, 'JSON array parsed');
ok(extractData(csv + ' analyze this data', tmpWs)?.rows.length === 3, 'inline CSV detected in query');

console.log('\n== DEVOPS AGENT ==');
fs.writeFileSync(path.join(tmpWs, 'package.json'), JSON.stringify({ dependencies: { react: '^18' }, scripts: { build: 'vite build', start: 'vite preview' } }));
const stack = detectStack(fs.readdirSync(tmpWs));
ok(stack.type === 'node-react', 'react detected from package.json');
const df = dockerfileFor(stack);
ok(df.includes('FROM node:22-slim') && df.includes('npm run build'), 'dockerfile has build stage');
ok(ciYamlFor(stack).includes('actions/setup-node@v4'), 'CI has setup-node');
ok(deploySteps(stack).includes('npm ci && npm run build'), 'deploy steps match stack');
ok(dockerfileFor({ type: 'static' }) === null, 'static site needs no Dockerfile');

console.log('\n== TRANSLATOR AGENT ==');
ok(parseLanguages('translate this to french').target === 'French', 'target French');
ok(parseLanguages('translate to Swahili').target === 'Swahili', 'target Swahili');
ok(parseLanguages('translate from spanish to english').source === 'Spanish' && parseLanguages('translate from spanish to english').target === 'English', 'source+target');
ok(extractText('translate "good morning" to French') === '"good morning"', 'text extracted');
ok(extractText('translate this text: hello world') === 'hello world', 'text after colon');

console.log('\n== PERF AGENT ==');
const perfFiles = [
  { name: 'index.html', code: '<html><head><script src="a.js"></script><script src="b.js"></script></head><body><img src="x.png"><img src="y.png"></body></html>' },
  { name: 'app.js', code: 'for (let i=0;i<n;i++){ fetch("/api"); }\nfor (let j=0;j<m;j++){ }' },
  { name: 'main.js', code: 'console.log(1);console.log(2);console.log(3);console.log(4);' },
];
const rep = scanPerf(perfFiles);
const high = rep.findings.filter((f) => f.severity === 'high');
ok(high.length >= 2, `2+ high-severity findings (blocking scripts + fetch-in-loop) — got ${high.length}`);
ok(rep.findings.some((f) => f.issue.includes('render-blocking')), 'blocking script detected');
ok(rep.findings.some((f) => f.issue.includes('N+1')), 'fetch-in-loop detected');
ok(rep.totalSizeKb !== '0.0', 'total size computed');

console.log(`\n${failures === 0 ? 'ALL NEW-AGENT TESTS PASSED' : failures + ' NEW-AGENT TEST(S) FAILED'}`);
fs.rmSync(tmpWs, { recursive: true, force: true });
process.exit(failures === 0 ? 0 : 1);
