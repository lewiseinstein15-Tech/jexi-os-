import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { WORKSPACE_DIR } from '../config.js';

const execP = promisify(exec);

/**
 * DEVOPS AGENT — JEXI's deploy & infrastructure hands (skill: 17-devops-agent.md).
 * Lineage: agency-agents DevOps Automator, specialist-agent @devops,
 * AI-development-team DevOps Engineer. Real configs, verified where possible.
 */

export function detectStack(files) {
  const set = new Set(files);
  if (set.has('package.json')) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(WORKSPACE_DIR, 'package.json'), 'utf-8'));
      const hasReact = !!(pkg.dependencies?.react || pkg.devDependencies?.react);
      const hasExpress = !!(pkg.dependencies?.express);
      if (hasReact) return { type: 'node-react', build: 'npm run build', start: 'npm start', port: 5173, deps: 'npm ci' };
      if (hasExpress) return { type: 'node-server', build: null, start: 'npm start', port: Number(process.env.PORT) || 3000, deps: 'npm ci' };
      return { type: 'node', build: pkg.scripts?.build || null, start: pkg.scripts?.start || 'node index.js', port: 3000, deps: 'npm ci' };
    } catch (e) {}
  }
  if (set.has('requirements.txt') || set.has('pyproject.toml')) {
    return { type: 'python', build: null, start: 'gunicorn app:app', port: 8000, deps: 'pip install -r requirements.txt' };
  }
  if (set.has('index.html')) return { type: 'static', build: null, start: null, port: null, deps: null };
  return { type: 'unknown', build: null, start: null, port: null, deps: null };
}

export function dockerfileFor(stack) {
  if (stack.type === 'node-react' || stack.type === 'node' || stack.type === 'node-server') {
    return `# JEXI OS — generated Dockerfile (${stack.type})
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
${stack.build ? `RUN npm run build` : ''}

FROM node:22-slim
WORKDIR /app
COPY --from=build /app ./
ENV NODE_ENV=production
EXPOSE ${stack.port || 3000}
CMD ${stack.start ? JSON.stringify(stack.start.split(/\s+/)) : '["node", "index.js"]'}`;
  }
  if (stack.type === 'python') {
    return `# JEXI OS — generated Dockerfile (python)
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["gunicorn", "app:app"]`;
  }
  return null; // static → deploy as-is, no container needed
}

export function ciYamlFor(stack) {
  const install = stack.type === 'python' ? 'pip install -r requirements.txt' : (stack.deps || 'npm ci');
  const test = stack.type === 'node-react' ? 'npm run build' : stack.build || (stack.type === 'python' ? 'python -m py_compile *.py' : 'echo "no test step configured"');
  return `# JEXI OS — generated CI (${stack.type})
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Set up ${stack.type === 'python' ? 'Python' : 'Node'}
        uses: ${stack.type === 'python' ? 'actions/setup-python@v5' : 'actions/setup-node@v4'}
        with:
          ${stack.type === 'python' ? 'python-version: 3.12' : 'node-version: 22'}
      - name: Install
        run: ${install}
      - name: Build / test
        run: ${test}`;
}

async function verify(stack, sendEvent) {
  const files = fs.readdirSync(WORKSPACE_DIR).filter((f) => f.endsWith('.js') || f.endsWith('.mjs'));
  const checks = [];
  if (stack.type === 'python') {
    const r = await execP('python3 -m py_compile *.py', { cwd: WORKSPACE_DIR }).then(() => ({ ok: true })).catch(() => ({ ok: false }));
    checks.push(r.ok ? '✅ `python -m py_compile *.py` passed' : '⚠ `python -m py_compile` failed or python3 unavailable');
  } else if (files.length > 0) {
    const r = await execP(`node --check ${files.slice(0, 5).map((f) => `"${f}"`).join(' ')}`, { cwd: WORKSPACE_DIR }).then(() => ({ ok: true })).catch(() => ({ ok: false }));
    checks.push(r.ok ? `✅ \`node --check\` passed on ${files.length} JS file(s)` : '⚠ `node --check` reported errors (see above)');
  }
  return checks;
}

export async function runDevOpsAgent({ query, sendEvent }) {
  if (!fs.existsSync(WORKSPACE_DIR)) fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  const files = fs.readdirSync(WORKSPACE_DIR).filter((f) => !f.startsWith('.'));
  if (files.length === 0) {
    return { success: true, summary: '### 🚀 DEVOPS AGENT\n\nThe workspace is empty — build something first, then ask me to deploy it (e.g. *"deploy this app"*, *"make a dockerfile"*, *"add github actions"*).' };
  }

  sendEvent?.('log', { agent: 'DevOps Agent', message: `🔎 Detecting stack from ${files.length} file(s)...` });
  const stack = detectStack(files);
  const wantDocker = /docker|container/i.test(query);
  const wantCi = /ci\/?cd|github actions|workflow/i.test(query);

  const parts = [`### 🚀 DEVOPS AGENT\n\n**Detected stack:** \`${stack.type}\` from ${files.slice(0, 12).map((f) => `\`${f}\``).join(', ')}${files.length > 12 ? '…' : ''}`];

  // Verification pass
  const checks = await verify(stack, sendEvent);
  if (checks.length) parts.push(`\n**Verified:** ${checks.join(' · ')}`);

  // Dockerfile
  if (wantDocker || stack.type === 'unknown' || !wantCi) {
    const df = dockerfileFor(stack);
    if (df) {
      parts.push(`\n## Dockerfile\n\n\`\`\`dockerfile\n${df}\n\`\`\`\n\nSay *"write the dockerfile to my workspace"* and I will save it as \`Dockerfile\`.`);
    } else {
      parts.push('\n## Dockerfile\n\nThis is a **static site** — no container needed. Deploy it directly to any static host (Vercel, Netlify, Cloudflare Pages).');
    }
  }

  // CI
  if (wantCi) {
    parts.push(`\n## CI (GitHub Actions)\n\n\`\`\`yaml\n${ciYamlFor(stack)}\n\`\`\`\n\nSay *"write the CI workflow"* and I will save it to \`.github/workflows/ci.yml\`.`);
  }

  // Deploy steps
  const steps = deploySteps(stack);
  parts.push(`\n## Deploy steps (copy-paste)\n${steps}`);

  return { success: true, summary: parts.join('\n') };
}

export function deploySteps(stack) {
  if (stack.type === 'static') {
    return `1. Push this folder to GitHub (I can do it: *"push to github"*).
2. On **Vercel/Netlify/Cloudflare Pages**: *Import repository* → the build command is empty, output directory is the folder root.
3. Done — you get a public HTTPS link.`;
  }
  if (stack.type === 'node-react') {
    return `1. Push to GitHub (*"push to github"*).
2. **Render/Railway/Vercel**: import the repo.
3. Build command: \`npm ci && npm run build\` · Start command: \`npm start\` · (Vercel auto-detects the framework.)
4. Add env vars: \`PORT\` and any secrets your app reads (names only — never paste real values here).`;
  }
  if (stack.type === 'node-server') {
    return `1. Push to GitHub (*"push to github"*).
2. **Render/Railway**: import the repo, type = Node.
3. Build command: \`${stack.deps || 'npm ci'}\` · Start command: \`${stack.start}\`.
4. Set env vars: \`PORT\` plus your app's config keys.`;
  }
  if (stack.type === 'python') {
    return `1. Push to GitHub (*"push to github"*).
2. **Render/Railway**: import the repo, type = Python.
3. Build command: \`pip install -r requirements.txt\` · Start command: \`${stack.start}\`.
4. Set env vars your app needs (names only).`;
  }
  return `1. Push the project to GitHub (*"push to github"*).
2. Import it on Render/Railway/Vercel and let the platform detect the stack.
3. Set the env vars your app reads.`;
}
