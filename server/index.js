import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { planner } from './src/services/Planner.js';
import { orchestrator } from './src/services/Orchestrator.js';
import { loadSettings, saveSettings } from './src/services/SettingsManager.js';
import { DesktopManager, browserStatus } from './src/services/DesktopManager.js';
import {
  addChat, getChatHistory, clearMemory, updateUserProfile, loadMemory,
  saveInternetKnowledge, saveCodingKnowledge, searchInternetKnowledge, searchCodingKnowledge,
  saveKnowledgeFile, searchKnowledge, getKnowledgeStructure, getKnowledgeStatus,
  hydrateFromRedis,
} from './src/services/MemoryManager.js';
import { PORT, WORKSPACE_DIR, SERVER_ROOT } from './src/config.js';

// If REDIS_URL is set, pull JEXI's memory core from Redis so she remembers
// everything across restarts/redeploys (non-blocking).
hydrateFromRedis().catch(() => {});

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' })); // Increased for code files + images

fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

// === VIRTUAL DESKTOP ROUTES (JEXI's eyes & hands) ===
const dm = new DesktopManager('playwright');

app.get('/api/desktop/coder/screenshot', async (req, res) => {
  try { res.json({ success: true, image: await dm.takeScreenshot('coder') }); }
  catch (e) { res.status(500).json({ error: e.message }); }
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

// === CHAT API ===
app.post('/api/chat', async (req, res) => {
  const { query, image } = req.body;
  if (!query && !image) return res.status(400).json({ success: false, error: 'No query provided' });

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const sendEvent = (type, data) => { try { res.write(JSON.stringify({ type, ...data }) + '\n'); } catch (e) {} };

  try {
    const plan = await planner.analyzeIntent(query, { image });
    sendEvent('log', { agent: 'Planner', message: `Intent: ${plan.intent} — ${plan.reasoning}` });
    const results = await orchestrator.executePlan(plan, query, sendEvent, { image });

    sendEvent('done', { success: results.success, query, summary: results.summary, sources: results.sources || [], statistics: results.statistics, files: results.files || [] });
  } catch (error) {
    sendEvent('log', { agent: 'System', message: `Critical Error: ${error.message}` });
    sendEvent('done', { success: false, error: error.message });
  } finally { res.end(); }
});

app.get('/api/health', (req, res) => res.json({ ok: true, name: 'JEXI OS Brain', version: '1.0.0', port: PORT }));

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

app.listen(PORT, '0.0.0.0', () => console.log(`🧠 JEXI OS BRAIN running on port ${PORT}`));
