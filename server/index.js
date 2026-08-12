import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import axios from 'axios';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { planner } from './src/services/Planner.js';
import { orchestrator } from './src/services/Orchestrator.js';
import { generateContent, resolveKeys, testAllProviders } from './src/services/LLMClient.js';
import { learnFromExchange } from './src/services/PreferenceLearner.js';
import { rollingConversationSummary } from './src/services/MemoryManager.js';
import {
  recordBoot, recordChat, recordVision, recordError,
  collectSystemStatus, readSourceFile,
} from './src/services/SelfMonitor.js';
import { loadSettings, saveSettings } from './src/services/SettingsManager.js';
import { providerHealthSnapshot } from './src/services/ProviderRouter.js';
import { AGENT_ROSTER, SKILL_REGISTRY, ROSTER_COUNT, SKILL_COUNT } from './src/services/AgentRoster.js';
import { DesktopManager, ensureBrowser, browserStatus, restartBrowser } from './src/services/DesktopManager.js';
import {
  addChat, getChatHistory, clearMemory, updateUserProfile, loadMemory,
  saveInternetKnowledge, saveCodingKnowledge, searchInternetKnowledge, searchCodingKnowledge,
  saveKnowledgeFile, searchKnowledge, getKnowledgeStructure, getKnowledgeStatus,
  hydrateFromRedis, isRedisActive, semanticRecall, backfillEmbeddings,
  resolveConversationalQuery,
} from './src/services/MemoryManager.js';
import { TOOL_REGISTRY } from './src/services/ToolRegistry.js';
import { importBookBuffer, importBookUrl, listBooks, deleteBook } from './src/services/BookLibrary.js';
import { mountMcp } from './mcp-server.js';
import { taskManager } from './src/services/TaskManager.js';
import { PORT, WORKSPACE_DIR, DATA_DIR, SERVER_ROOT } from './src/config.js';

// If REDIS_URL is set, pull JEXI's memory core from Redis so she remembers
// everything across restarts/redeploys (non-blocking).
hydrateFromRedis().catch((e) => { recordError('memory', (e && e.message) || String(e)); });

// Vector layer (TencentDB-Agent-Memory pattern): embed memories saved before
// the vector layer existed. Non-blocking; no-op without a Groq key.
backfillEmbeddings().catch((e) => { recordError('memory', (e && e.message) || String(e)); });

// Self-monitoring: she keeps a live error log and can diagnose her own system.
recordBoot();
process.on('uncaughtException', (e) => { recordError('process', e.message, e.stack); console.error('[FATAL]', e); process.exit(1); });
process.on('unhandledRejection', (e) => { recordError('process', (e && e.message) || String(e)); });

const app = express();

// === API ACCESS CONTROL (optional but recommended for production) ===
// Set JEXI_API_KEY in the host env (Render dashboard) and every AI-spend / data
// endpoint requires the `x-jexi-key` header (the Settings panel has a matching
// field). Without it, JEXI stays wide open — fine locally, risky on the public
// internet where strangers could burn your Groq/Gemini quota. When unset, local
// dev and self-hosted use are unchanged.
const API_KEY = process.env.JEXI_API_KEY || '';
const keyMatches = (sent) => {
  if (!API_KEY || !sent) return false;
  const a = Buffer.from(String(sent));
  const b = Buffer.from(API_KEY);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

// CORS: when CORS_ORIGINS is set (comma-separated origins), only browsers from
// those origins may call the API. Unset → open (local dev / curl / mobile).
// The Android/iOS Capacitor app and local dev tools always call from "localhost"
// origins (http://localhost on Android, capacitor://localhost and https://localhost
// on iOS). A remote attacker cannot spoof those — their Origin is their own domain —
// so they are always allowed. Without this, the app is silently CORS-blocked while
// the website works (the classic "website fine, app broken" failure).
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const NATIVE_APP_ORIGINS = ['http://localhost', 'https://localhost', 'capacitor://localhost', 'ionic://localhost'];
const CORS_ALLOWLIST = CORS_ORIGINS.length ? [...new Set([...CORS_ORIGINS, ...NATIVE_APP_ORIGINS])] : true;
app.use(cors({ origin: CORS_ALLOWLIST }));

// Cheap, always-open endpoints the infra + onboarding path needs. Everything
// else under /api/* (chat, vision, knowledge, memory, desktop, settings write,
// APK proxy) is gated when JEXI_API_KEY is set.
// NOTE: mounted on the app root (not '/api') so req.path keeps its full form.
const OPEN_PATHS = ['/api/health', '/api/settings/status'];
app.use((req, res, next) => {
  if (!API_KEY || req.method === 'OPTIONS') return next();
  if (!req.path.startsWith('/api')) return next();
  if (OPEN_PATHS.includes(req.path)) return next();
  if (keyMatches(req.headers['x-jexi-key'])) return next();
  res.status(401).json({ error: 'Unauthorized — this server is locked. Set the JEXI access key in Settings → System.' });
});

// Rate limiting: protects your AI quota from runaway loops / abuse.
const aiLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many requests — JEXI is throttling to protect your quota. Try again in a minute.' } });
const generalLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 600, standardHeaders: 'draft-7', legacyHeaders: false });
app.use(['/api/chat', '/api/vision', '/api/knowledge/search'], aiLimiter);
app.use('/api', generalLimiter);

app.use(express.json({ limit: '30mb' })); // Room for base64 book uploads + code files + images

// === MODEL CONTEXT PROTOCOL (MCP) — let Claude Desktop / Cursor / any MCP
// client connect to JEXI's tools and data at /mcp (read-only + ask_jexi only).
mountMcp(app);

// Every instance has its own id (Render injects RENDER_INSTANCE_ID automatically).
// A load balancer can see which instance answered, and you can verify stickiness.
const INSTANCE_ID = process.env.RENDER_INSTANCE_ID || Math.random().toString(36).slice(2, 8);

fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

// === VIRTUAL DESKTOP ROUTES (JEXI's eyes & hands) ===
const dm = new DesktopManager('playwright');

app.get('/api/desktop/coder/screenshot', async (req, res) => {
  try { res.json({ success: true, image: await dm.takeScreenshot('coder') }); }
  catch (e) { recordError('desktop', e.message); res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/desktop/coder/click', async (req, res) => {
  try { await dm.click('coder', req.body.x, req.body.y); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/desktop/coder/type', async (req, res) => {
  try { await dm.type('coder', req.body.text); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/desktop/coder/press', async (req, res) => {
  try { await dm.pressKey('coder', req.body.key); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/desktop/coder/write-file', async (req, res) => {
  try {
    const out = await dm.writeFile('coder', req.body.filename, req.body.content);
    res.json({ success: true, output: out });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/desktop/coder/execute', async (req, res) => {
  try { res.json({ success: true, output: await dm.executeCommand('coder', req.body.command) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// --- New browser actions (JEXI's eyes) ---
app.post('/api/desktop/coder/goto', async (req, res) => {
  try { res.json({ success: true, ...(await dm.goto('coder', req.body.url)) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/desktop/coder/page-text', async (req, res) => {
  try { res.json({ success: true, text: await dm.pageText('coder') }); }
  catch (e) { res.status(500).json({ error: e.message, text: '' }); }
});

app.post('/api/desktop/coder/click-text', async (req, res) => {
  try { res.json({ success: await dm.clickText('coder', req.body.text) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/desktop/coder/elements', async (req, res) => {
  try { res.json({ success: true, ...(await dm.interactiveMap('coder')) }); }
  catch (e) { res.status(500).json({ error: e.message, elements: [] }); }
});

app.post('/api/desktop/coder/click-index', async (req, res) => {
  try { res.json({ success: true, ...(await dm.clickIndex('coder', req.body.index)) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/desktop/coder/type-index', async (req, res) => {
  try { res.json({ success: true, ...(await dm.typeIndex('coder', req.body.index, req.body.text)) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/desktop/coder/scroll', async (req, res) => {
  try { res.json({ success: true, ...(await dm.scroll('coder', req.body.direction)) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/desktop/coder/back', async (req, res) => {
  try { res.json({ success: true, ...(await dm.back('coder')) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/desktop/coder/forward', async (req, res) => {
  try { res.json({ success: true, ...(await dm.forward('coder')) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/desktop/coder/screenshot-json', async (req, res) => {
  try { res.json({ success: true, image: await dm.takeScreenshot('coder') }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/desktop/status', (req, res) => res.json({ ok: true, ...browserStatus() }));

// Alias under /coder/ — ComputerUseAgent pings this path. Without it the agent
// ALWAYS believed the browser was offline (404) and never attempted real navigation.
app.get('/api/desktop/coder/status', (req, res) => res.json({ ok: true, ...browserStatus() }));
app.post('/api/desktop/coder/status', (req, res) => res.json({ ok: true, ...browserStatus() }));

// Force-restart JEXI's eyes (self-heal button in the Virtual Desktop viewer).
app.post('/api/desktop/restart', async (req, res) => {
  try {
    const result = await restartBrowser();
    res.json({ success: true, ...result });
  } catch (e) {
    recordError('desktop', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// === FILE VIEWER & PREVIEW ENDPOINTS ===
app.get('/api/files/:filename', (req, res) => {
  try {
    const filePath = path.join(WORKSPACE_DIR, req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).send('File not found');
    const content = fs.readFileSync(filePath, 'utf-8');
    const ext = path.extname(req.params.filename).substring(1);
    res.send(`<!DOCTYPE html><html><head><title>JEXI Workspace - ${req.params.filename}</title><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>body{background:#0a0a0a;color:#eee;font-family:monospace;padding:20px;margin:0}h2{color:#00FF9D;font-family:sans-serif}.toolbar{display:flex;gap:10px;margin-bottom:15px;align-items:center}a{color:#00d4ff;text-decoration:none;padding:8px 15px;background:#1a1a1a;border-radius:5px;font-family:sans-serif}a:hover{background:#00d4ff;color:#000}pre{background:#111;padding:15px;border-radius:8px;overflow-x:auto;border:1px solid #333;font-size:14px}.meta{color:#888;font-size:12px;margin-bottom:10px;font-family:sans-serif}</style></head><body><div class="toolbar"><h2>📄 ${req.params.filename}</h2><a href="/">← Back to JEXI</a></div><div class="meta">Type: ${ext} | Size: ${content.length} chars</div><pre><code>${content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre></body></html>`);
  } catch (e) { res.status(500).send('Error: ' + e.message); }
});

app.get('/preview/:filename', (req, res) => {
  try {
    const filePath = path.join(WORKSPACE_DIR, req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).send('File not found');
    const content = fs.readFileSync(filePath, 'utf-8');
    const ext = path.extname(req.params.filename).substring(1);
    if (ext === 'html') res.type('text/html');
    else if (ext === 'css') res.type('text/css');
    else if (ext === 'js') res.type('application/javascript');
    else res.type('text/plain');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(content);
  } catch (e) { res.status(500).send('Error: ' + e.message); }
});

app.get('/workspace', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  try {
    let files = [];
    if (fs.existsSync(WORKSPACE_DIR)) {
      files = fs.readdirSync(WORKSPACE_DIR).map(name => {
        const stat = fs.statSync(path.join(WORKSPACE_DIR, name));
        return { name, size: stat.size, modified: stat.mtime };
      });
    }
    res.send(`<!DOCTYPE html><html><head><title>JEXI Workspace</title><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>body{background:#0a0a0a;color:#eee;font-family:sans-serif;padding:20px;margin:0}h2{color:#00FF9D}.toolbar{display:flex;gap:10px;margin-bottom:20px;align-items:center}a{color:#00d4ff;text-decoration:none}.file-list{display:grid;gap:10px}.file-item{display:flex;justify-content:space-between;align-items:center;background:#111;padding:15px;border-radius:8px;border:1px solid #222;transition:0.2s}.file-item:hover{border-color:#00FF9D;background:#1a1a1a}.file-item a{color:#fff;text-decoration:none;font-size:16px;flex:1}.file-meta{color:#888;font-size:12px}.empty{text-align:center;color:#666;padding:40px}</style></head><body><div class="toolbar"><h2>📁 JEXI WORKSPACE</h2><a href="/">← Back to JEXI</a></div>${files.length === 0 ? '<div class="empty">No files generated yet.</div>' : `<div class="file-list">${files.map(f => `<div class="file-item"><a href="/api/files/${f.name}">📄 ${f.name}</a><span class="file-meta">${(f.size/1024).toFixed(1)} KB</span></div>`).join('')}</div>`}</body></html>`);
  } catch (e) { res.status(500).send('Error: ' + e.message); }
});

// === SETTINGS ENDPOINTS ===
app.get('/api/settings', (req, res) => res.json(loadSettings()));
app.post('/api/settings', (req, res) => res.json({ success: saveSettings(req.body) }));

// Reports WHERE each credential is configured (env / settings file / none) so the
// Settings panel can show "ACTIVE — from Render environment" instead of an empty
// input. NEVER returns actual key values.
app.get('/api/settings/status', (req, res) => {
  const settings = loadSettings();
  const statusOf = (envVars, settingKey) => {
    const envVal = envVars.map(v => process.env[v]).find(Boolean);
    if (envVal) return { configured: true, source: 'env' };
    if (settings[settingKey]) return { configured: true, source: 'settings' };
    return { configured: false, source: 'none' };
  };
  res.json({
    groq: statusOf(['GROQ_API_KEY'], 'groqKey'),
    gemini: statusOf(['GEMINI_API_KEY'], 'geminiKey'),
    openrouter: statusOf(['OPENROUTER_API_KEY'], 'openrouterKey'),
    huggingface: statusOf(['HF_TOKEN'], 'hfKey'),
    cerebras: statusOf(['CEREBRAS_API_KEY'], 'cerebrasKey'),
    deepinfra: statusOf(['DEEPINFRA_API_KEY'], 'deepinfraKey'),
    mistral: statusOf(['MISTRAL_API_KEY'], 'mistralKey'),
    github: statusOf(['GITHUB_TOKEN', 'GH_TOKEN'], 'githubToken'),
  });
});

// === AGENT ROSTER (the 79-specialist catalog + 226-skill registry) ===
app.get('/api/roster', (req, res) => {
  res.json({
    agents: AGENT_ROSTER,
    skills: SKILL_REGISTRY,
    agentCount: AGENT_ROSTER.length,
    skillCount: SKILL_REGISTRY.length,
  });
});

// === MEMORY CORE ENDPOINTS (JEXI's mind) ===
app.get('/api/memory', (req, res) => res.json(loadMemory()));
app.post('/api/memory/clear', (req, res) => { clearMemory(); res.json({ success: true }); });
app.post('/api/memory/user', (req, res) => { updateUserProfile(req.body); res.json({ success: true }); });

// Semantic memory search — hybrid vector + keyword recall across everything
// JEXI remembers (TencentDB-Agent-Memory pattern). Requires ?q= (min 3 chars).
app.get('/api/memory/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 3) return res.json({ query: q, results: [] });
  const results = await semanticRecall(q, { limit: 5 });
  res.json({ query: q, results });
});
app.post('/api/chat/add', (req, res) => {
  try { addChat(req.body.role, req.body.text); res.json({ success: true }); }
  catch (e) { res.json({ success: false }); }
});
app.get('/api/chat/history', (req, res) => res.json(getChatHistory(Number(req.query.n) || 50)));

// === KNOWLEDGE LIBRARY ENDPOINTS ===
app.get('/api/knowledge/structure', (req, res) => res.json(getKnowledgeStructure()));
app.get('/api/knowledge/status', (req, res) => res.json(getKnowledgeStatus()));
app.get('/api/knowledge/search', (req, res) => res.json(searchKnowledge(req.query.query || '')));
app.post('/api/knowledge/save', (req, res) => {
  try {
    const file = saveKnowledgeFile(req.body.category, req.body.filename, req.body.content);
    res.json({ success: true, file });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// === THE USER'S OWN BOOK LIBRARY (PDF / TXT / Markdown → knowledge) ===
app.post('/api/knowledge/books/upload', async (req, res) => {
  try { res.json(await importBookBuffer(req.body || {})); }
  catch (e) { recordError('knowledge', e.message); res.status(400).json({ success: false, error: e.message }); }
});

app.post('/api/knowledge/books/url', async (req, res) => {
  try { res.json(await importBookUrl(req.body || {})); }
  catch (e) { recordError('knowledge', e.message); res.status(400).json({ success: false, error: e.message }); }
});

app.get('/api/knowledge/books', (req, res) => res.json(listBooks()));

app.delete('/api/knowledge/books/:name', (req, res) => {
  try { res.json(deleteBook(req.params.name)); }
  catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

app.get('/api/knowledge/books/:name/file', (req, res) => {
  try {
    const file = path.basename(req.params.name); // basename blocks path traversal
    const fp = path.join(DATA_DIR, 'books', file);
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Original file not stored (only link-imported books lack a local copy).' });
    res.download(fp, file);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// === APK UPDATE PROXY (in-app updates for the Android app) ===
// GitHub's release-asset server does NOT send CORS headers, so a fetch of the
// APK straight from the app's WebView is blocked by the browser. This route
// streams the newest APK through the backend (CORS is fully open here), so the
// JEXI app can download it into its own storage and open the Android package
// installer directly — no browser download step, no missing install prompt.
const APK_DOWNLOAD_URL = 'https://github.com/lewiseinstein15-Tech/jexi-os-/releases/latest/download/app-debug.apk';

app.get('/api/update/apk', async (req, res) => {
  try {
    const upstream = await axios({
      method: 'GET',
      url: APK_DOWNLOAD_URL,
      responseType: 'stream',
      timeout: 90000,
      maxRedirects: 5,
      headers: { 'User-Agent': 'JEXI-OS-Update/1.0' },
    });
    const len = upstream.headers['content-length'];
    res.setHeader('Content-Type', upstream.headers['content-type'] || 'application/vnd.android.package-archive');
    if (len) res.setHeader('Content-Length', len);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', 'attachment; filename="app-debug.apk"');
    upstream.data.on('error', (e) => res.destroy(e));
    upstream.data.pipe(res);
  } catch (e) {
    recordError('update', e.message);
    res.status(502).json({ success: false, error: 'Could not fetch the newest APK: ' + e.message });
  }
});

// === CHAT API ===
// === VISION ENDPOINT (JEXI's camera eyes) ===
// Accepts a base64 image from the user's webcam and asks the AI to describe it.
// Works with either a Groq (llama-4-scout is multimodal) or Gemini key.
app.post('/api/vision', async (req, res) => {
  try {
    const { image, prompt } = req.body;
    recordVision();
    if (!image) return res.status(400).json({ success: false, error: 'No image provided' });
    const { groqKey, geminiKey } = resolveKeys();
    if (!groqKey && !geminiKey && !process.env.OPENROUTER_API_KEY) {
      return res.status(400).json({ success: false, error: 'No AI keys configured. Add GROQ_API_KEY, GEMINI_API_KEY or OPENROUTER_API_KEY (Render env or Settings).' });
    }
    const text = await generateContent(
      prompt || 'Describe what you see in this image in 2-3 warm sentences.',
      'You are JEXI OS, created by Lewis Einstein (an AI & ML Engineer). You now have eyes through the user\'s camera. ' +
      'Describe what you see warmly and precisely: who or what is in frame, expressions, lighting, surroundings. ' +
      'Be honest if the image is unclear or if no face is visible. Keep it natural and short (2-4 sentences).',
      image,
      // prefer Gemini first — its vision (gemini-2.5-flash) is far sharper than
      // Groq's llama-4-scout, and it is a key the user already has. Seed-family
      // vision (via OpenRouter) is tried last when OPENROUTER_API_KEY is set.
      { prefer: 'gemini', temperature: 0.5 }
    );
    res.json({ success: true, text });
  } catch (e) {
    recordError('vision', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// --- CONTINUATION MEMORY ---
// Lets a follow-up "yes / go ahead / do it" RESUME the user's original task
// instead of re-planning the bare confirmation (which matched no intent and
// made JEXI fall into research — "she searched again" instead of acting).
// The original request is kept for ~15 minutes so conversations flow naturally:
//   user: "I want to track my water intake" → JEXI offers to build it
//   user: "yes"                            → JEXI builds the app (resumes task)
//   user: "no / never mind"                → pending task cleared, no search
const RESUME_TTL_MS = 15 * 60 * 1000;
let pendingTask = null; // { at, query }

const CONFIRM_RE = /^(yes|yeah|yep|yup|sure|ok|okay|k|go ahead|do it|do that|do it now|please|please do|yes please|absolutely|alright|alrighty|proceed|sounds good|fine|make it|build it|go on|sure do it|yes do it)\b[\s.,!?]*$/i;
const DECLINE_RE = /^(no|nope|never ?mind|cancel|stop|forget it|skip|don'?t|no thanks)\b[\s.,!?]*$/i;

app.post('/api/chat', async (req, res) => {
  const { query, image } = req.body;
  recordChat();
  if (!query && !image) return res.status(400).json({ success: false, error: 'No query provided' });

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const sendEvent = (type, data) => { try { res.write(JSON.stringify({ type, ...data }) + '\n'); } catch (e) {} };

  // Heartbeat: Cloudflare's proxy in front of Render kills streams that stay
  // silent too long (deep-reads and LLM calls pause for 10-30s). A tiny event
  // every 10s keeps the connection alive — the frontend ignores unknown types.
  const heartbeat = setInterval(() => { try { res.write('{"type":"heartbeat"}\n'); } catch (e) {} }, 10000);

  // Hard deadline: no single request may hold the connection forever (a
  // pathological research pass, browser hang, or provider stall). On fire it
  // emits a readable done event instead of leaving the UI spinning forever.
  const CHAT_DEADLINE_MS = 15 * 60 * 1000;
  let finished = false;
  const finish = () => { clearInterval(heartbeat); try { res.end(); } catch (e) {} };
  const deadline = setTimeout(() => {
    if (finished) return;
    finished = true;
    recordError('chat', 'request exceeded 15min deadline');
    sendEvent('log', { agent: 'System', message: '⏱ Deadline reached (15 min) — the task is still running server-side. Ask me to continue and I will pick it up.' });
    sendEvent('done', { success: false, error: 'The task exceeded the 15-minute safety deadline. It may still be running server-side — ask me to continue.', summary: '⏱ **Deadline reached.** This task ran longer than 15 minutes, so the connection was closed as a safety valve. The work may still be completing on the server — send **"continue"** and I will resume it.' });
    finish();
  }, CHAT_DEADLINE_MS);

  try {
    const raw = String(query || '').trim();
    const hasPending = pendingTask && Date.now() - pendingTask.at < RESUME_TTL_MS;
    let effectiveQuery = raw;
    let plan;

    if (!image && DECLINE_RE.test(raw) && hasPending) {
      // "no / cancel" — clear the pending task, answer WITHOUT searching.
      pendingTask = null;
      sendEvent('log', { agent: 'Planner', message: '✖ Declined — pending task cleared, nothing will run.' });
      sendEvent('done', { success: true, query, summary: '### 🧠 JEXI OS\n\n👍 Understood — I won\'t go ahead with that. Tell me what you\'d like next and I\'ll take it from there.' });
      return;
    }

    if (!image && CONFIRM_RE.test(raw) && hasPending) {
      // "yes / go ahead" — resume the ORIGINAL request so the action actually
      // happens (build the app, run the research, etc.) instead of searching
      // the word "yes".
      const original = pendingTask.query;
      sendEvent('log', { agent: 'Planner', message: `✓ Confirmed — resuming your original task: “${original.slice(0, 90)}”` });
      plan = await planner.planConfirmed(original);
      effectiveQuery = original;
      pendingTask = { at: Date.now(), query: original }; // keep ORIGINAL as the resume target
    } else {
      // CONTINUITY — resolve follow-up messages against the recent conversation
      // before planning, so "give me a roadmap for a beginner in this course"
      // becomes "…in computer science" (ChatGPT-style context awareness). Only
      // triggers on context-dependent messages; self-contained ones pass free.
      const resolved = await resolveConversationalQuery(query);
      if (resolved.resolved && resolved.query && resolved.query !== raw) {
        effectiveQuery = resolved.query;
        sendEvent('log', {
          agent: 'Context Agent',
          message: `🧠 Continuity — resolved “${raw.slice(0, 60)}” → “${resolved.query.slice(0, 100)}” (${resolved.reason}).`,
        });
      }
      plan = await planner.analyzeIntent(effectiveQuery, { image });
      pendingTask = { at: Date.now(), query: effectiveQuery };
    }

    sendEvent('log', { agent: 'Planner', message: `Intent: ${plan.intent} — ${plan.reasoning}` });
    // Structured plan event — the frontend's agent Core needs the composed
    // team (roster) to draw its orbital ring segments before agents start.
    sendEvent('plan', {
      intent: plan.intent,
      steps: plan.steps || [],
      roster: plan.roster || [],
      skillsLine: plan.skillsLine || '',
      rosterCatalogSize: plan.rosterCatalogSize || ROSTER_COUNT,
      skillCatalogSize: plan.skillCatalogSize || SKILL_COUNT,
      // AUTO TOOL ROUTING — the tool set derived for this task (Tool Router).
      tools: plan.tools || [],
      toolsLine: plan.toolsLine || '',
      toolCount: plan.toolCount || 0,
    });
    const results = await orchestrator.executePlan(plan, effectiveQuery, sendEvent, { image });

    sendEvent('log', { agent: 'JEXI', message: '🎯 Mission complete — here is the result.' });
    // Contract: a successful done ALWAYS carries a readable summary — the
    // frontend never renders a blank answer (an empty summary previously left
    // users staring at the activity log with no chat reply).
    const finalSummary = results.summary && String(results.summary).trim()
      ? results.summary
      : results.success
        ? '✅ Task completed — the team finished, but returned no readable summary. Check the activity log above to see what ran.'
        : (results.error || 'The task failed — check the activity log for details.');
    sendEvent('done', { success: results.success, query, summary: finalSummary, sources: results.sources || [], statistics: results.statistics, files: results.files || [] });

    // Mem0-style preference learning — fire-and-forget in the background so it
    // never delays the reply or breaks the stream. JEXI learns what the user
    // likes and how they like things done, then applies it to every future task.
    learnFromExchange(effectiveQuery).catch(() => {});
    // Context compaction — compress older turns into the running conversation
    // summary (Context Manager). Fire-and-forget so the NEXT turn has it ready.
    rollingConversationSummary().catch(() => {});
  } catch (error) {
    recordError('chat', error.message);
    sendEvent('log', { agent: 'System', message: `Critical Error: ${error.message}` });
    sendEvent('done', { success: false, error: error.message });
  } finally { finished = true; clearTimeout(deadline); finish(); }
});

// LIVE PROVIDER TEST — fires one tiny request through EVERY configured provider
// and reports which keys actually work end-to-end (configured ≠ working). Useful
// right after adding a key on Render: redeploy, then hit /api/health/providers.
app.get('/api/health/providers', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const result = await testAllProviders();
    res.json({ ok: true, time: new Date().toISOString(), ...result, catalog: TOOL_REGISTRY.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e && e.message) || String(e) });
  }
});

// === BACKGROUND TASKS (roadmap stage 8 — the task.* event vocabulary) ===
// Unlike /api/chat (synchronous — the connection stays open until the mission
// ends), tasks run in the background and stream `task.*` events to any number
// of subscribers. The list survives restarts (DATA_DIR/tasks.json).
app.get('/api/tasks', (req, res) => {
  res.json({ tasks: taskManager.list().map((t) => taskManager.publicTask(t, false)) });
});

app.post('/api/tasks', (req, res) => {
  const { query, image } = req.body || {};
  if (!query || !String(query).trim()) {
    return res.status(400).json({ success: false, error: 'No query provided' });
  }
  const task = taskManager.createTask(String(query).trim(), image || null);
  res.json({ success: true, task: taskManager.publicTask(task, false) });
});

app.get('/api/tasks/:id', (req, res) => {
  const task = taskManager.get(req.params.id);
  if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
  res.json({ success: true, task: taskManager.publicTask(task, true) });
});

// NDJSON live stream — replays history then pushes live task.* events.
// Ends when the task reaches a terminal state.
app.get('/api/tasks/:id/events', (req, res) => {
  const task = taskManager.get(req.params.id);
  if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  taskManager.subscribe(req.params.id, res);
});

app.post('/api/tasks/:id/cancel', (req, res) => {
  const task = taskManager.cancel(req.params.id);
  if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
  res.json({ success: true, task: taskManager.publicTask(task, false) });
});

// Re-run a mission (same query, fresh task) — the honest "continue where it
// stopped" for tasks that failed, were cancelled, or finished long ago.
app.post('/api/tasks/:id/rerun', (req, res) => {
  const old = taskManager.get(req.params.id);
  if (!old) return res.status(404).json({ success: false, error: 'Task not found' });
  const task = taskManager.createTask(old.query, old.image);
  res.json({ success: true, task: taskManager.publicTask(task, false) });
});

app.delete('/api/tasks/:id', (req, res) => {
  res.json({ success: taskManager.remove(req.params.id) });
});

// Health endpoint used by the load balancer's active probes (and the keep-alive
// cron) — must be fast, never cached, and identify the exact instance.
app.get('/api/health', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    name: 'JEXI OS Brain',
    version: '1.0.0',
    instanceId: INSTANCE_ID,
    uptime: Math.round(process.uptime()),
    redis: isRedisActive(),
    port: PORT,
    providers: providerHealthSnapshot(),
    time: new Date().toISOString(),
  });
});

// === SELF-MONITORING (JEXI diagnoses her own system + reads her own source) ===
app.get('/api/self/status', (req, res) => res.json(collectSystemStatus()));
app.get('/api/self/source', (req, res) => res.json(readSourceFile(req.query.path || '')));

// === SINGLE-CONTAINER MODE ===
// When the frontend is built into server/public (Hugging Face Spaces Docker image),
// serve it from here so the whole app runs on ONE free host — same origin, no CORS.
const publicDir = path.join(SERVER_ROOT, 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/desktop-api')) return next();
    res.sendFile(path.join(publicDir, 'index.html'));
  });
} else {
  // API-only deployment (Render): give the bare domain a friendly status page
  // instead of Express's default "Cannot GET /".
  app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const providers = providerHealthSnapshot();
    const configured = providers.filter(p => p.configured).length;
    const rows = providers.map(p => {
      const status = p.configured ? (p.inCooldown ? 'cooldown' : 'configured') : 'not set';
      const color = p.configured ? (p.inCooldown ? '#FBBF24' : '#00FF9D') : '#616166';
      return `<tr><td style="padding:6px 10px;border-bottom:1px solid #1F1F23;color:#E5E5E7">${p.provider}</td><td style="padding:6px 10px;border-bottom:1px solid #1F1F23;color:${color}">${status}</td></tr>`;
    }).join('');
    res.send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>JEXI OS Brain</title></head>
<body style="margin:0;background:#030303;color:#E5E5E7;font-family:Inter,-apple-system,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh">
<div style="max-width:560px;padding:40px 24px;width:100%">
<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
<span style="width:10px;height:10px;border-radius:50%;background:#00FF9D;box-shadow:0 0 12px #00FF9D"></span>
<span style="font-size:14px;letter-spacing:2px;text-transform:uppercase;color:#00FF9D">JEXI OS Brain</span>
</div>
<h1 style="margin:0 0 4px;font-size:28px;color:#F5F5F7">Online</h1>
<p style="margin:0 0 24px;color:#A1A1AA;font-size:14px">v1.0.0 · up ${Math.round(process.uptime())}s · port ${PORT} · redis ${isRedisActive() ? 'on' : 'off'}</p>
<p style="margin:0 0 12px;color:#A1A1AA;font-size:13px">${configured} of ${providers.length} AI providers configured</p>
<table style="border-collapse:collapse;width:100%;background:#0A0A0B;border:1px solid #1F1F23;border-radius:12px;overflow:hidden;font-size:13px">${rows}</table>
<div style="margin-top:20px;font-size:13px;color:#A1A1AA">
<a href="/api/health" style="color:#00FF9D;text-decoration:none">/api/health</a> ·
<a href="/api/roster" style="color:#00FF9D;text-decoration:none">/api/roster</a> ·
<a href="/api/health/providers" style="color:#00FF9D;text-decoration:none">live key test</a>
</div>
</div></body></html>`);
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🧠 JEXI OS BRAIN running on port ${PORT}`);
  // Chromium is launched LAZILY on first desktop/QA use, never held resident at
  // boot: on small hosts (512MB) a permanently-open browser + concurrent page
  // parsing during search was OOM-killing the process mid-request.
});
