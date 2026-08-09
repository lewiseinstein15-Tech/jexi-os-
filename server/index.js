import express from 'express';
import cors from 'cors';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { planner } from './src/services/Planner.js';
import { orchestrator } from './src/services/Orchestrator.js';
import { generateContent, resolveKeys } from './src/services/LLMClient.js';
import {
  recordBoot, recordChat, recordVision, recordError,
  collectSystemStatus, readSourceFile,
} from './src/services/SelfMonitor.js';
import { loadSettings, saveSettings } from './src/services/SettingsManager.js';
import { DesktopManager, ensureBrowser, browserStatus, restartBrowser } from './src/services/DesktopManager.js';
import {
  addChat, getChatHistory, clearMemory, updateUserProfile, loadMemory,
  saveInternetKnowledge, saveCodingKnowledge, searchInternetKnowledge, searchCodingKnowledge,
  saveKnowledgeFile, searchKnowledge, getKnowledgeStructure, getKnowledgeStatus,
  hydrateFromRedis, isRedisActive,
} from './src/services/MemoryManager.js';
import { importBookBuffer, importBookUrl, listBooks, deleteBook } from './src/services/BookLibrary.js';
import { PORT, WORKSPACE_DIR, DATA_DIR, SERVER_ROOT } from './src/config.js';

// If REDIS_URL is set, pull JEXI's memory core from Redis so she remembers
// everything across restarts/redeploys (non-blocking).
hydrateFromRedis().catch((e) => { recordError('memory', (e && e.message) || String(e)); });

// Self-monitoring: she keeps a live error log and can diagnose her own system.
recordBoot();
process.on('uncaughtException', (e) => { recordError('process', e.message, e.stack); console.error('[FATAL]', e); process.exit(1); });
process.on('unhandledRejection', (e) => { recordError('process', (e && e.message) || String(e)); });

const app = express();
app.use(cors());
app.use(express.json({ limit: '30mb' })); // Room for base64 book uploads + code files + images

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

// === MEMORY CORE ENDPOINTS (JEXI's mind) ===
app.get('/api/memory', (req, res) => res.json(loadMemory()));
app.post('/api/memory/clear', (req, res) => { clearMemory(); res.json({ success: true }); });
app.post('/api/memory/user', (req, res) => { updateUserProfile(req.body); res.json({ success: true }); });
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
    if (!groqKey && !geminiKey) {
      return res.status(400).json({ success: false, error: 'No AI keys configured. Add GROQ_API_KEY or GEMINI_API_KEY (Render env or Settings).' });
    }
    const text = await generateContent(
      prompt || 'Describe what you see in this image in 2-3 warm sentences.',
      'You are JEXI OS, created by Lewis Einstein (an AI & ML Engineer). You now have eyes through the user\'s camera. ' +
      'Describe what you see warmly and precisely: who or what is in frame, expressions, lighting, surroundings. ' +
      'Be honest if the image is unclear or if no face is visible. Keep it natural and short (2-4 sentences).',
      image,
      { temperature: 0.5 }
    );
    res.json({ success: true, text });
  } catch (e) {
    recordError('vision', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/chat', async (req, res) => {
  const { query, image } = req.body;
  recordChat();
  if (!query && !image) return res.status(400).json({ success: false, error: 'No query provided' });

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const sendEvent = (type, data) => { try { res.write(JSON.stringify({ type, ...data }) + '\n'); } catch (e) {} };

  try {
    const plan = await planner.analyzeIntent(query, { image });
    sendEvent('log', { agent: 'Planner', message: `Intent: ${plan.intent} — ${plan.reasoning}` });
    const results = await orchestrator.executePlan(plan, query, sendEvent, { image });

    sendEvent('log', { agent: 'JEXI', message: '🎯 Mission complete — here is the result.' });
    sendEvent('done', { success: results.success, query, summary: results.summary, sources: results.sources || [], statistics: results.statistics, files: results.files || [] });
  } catch (error) {
    recordError('chat', error.message);
    sendEvent('log', { agent: 'System', message: `Critical Error: ${error.message}` });
    sendEvent('done', { success: false, error: error.message });
  } finally { res.end(); }
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
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🧠 JEXI OS BRAIN running on port ${PORT}`);
  // Boot-time browser self-check (non-blocking): confirms in the deploy logs whether
  // Chromium can actually launch here (free hosts may lack its system libraries) and
  // warms the browser so the first visitor sees the desktop instantly.
  setTimeout(async () => {
    try {
      const { ok, error } = await ensureBrowser();
      if (ok) console.log('✅ [Desktop] Chromium ready - JEXI has eyes.');
      else { console.log(`⚠️ [Desktop] ${error}`); recordError('desktop', error); }
    } catch (e) { console.log(`⚠️ [Desktop] browser self-check failed: ${e.message}`); }
  }, 4000);
});
