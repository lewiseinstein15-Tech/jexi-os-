import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { planner } from './src/services/Planner.js';
import { orchestrator } from './src/services/Orchestrator.js';
import { loadSettings, saveSettings } from './src/services/SettingsManager.js';
import { DesktopManager } from './src/services/DesktopManager.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Increased limit for code files

const workspaceDir = path.join(process.cwd(), 'jexi-workspace');
const MANAGER_URL = 'http://localhost:3001';

// === VIRTUAL DESKTOP ROUTES ===
const dm = new DesktopManager('proot');

app.get('/api/desktop/:id/screenshot', async (req, res) => {
  try { res.json({ success: true, image: await dm.takeScreenshot(req.params.id) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/desktop/:id/click', async (req, res) => {
  try { await dm.click(req.params.id, req.body.x, req.body.y); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/desktop/:id/type', async (req, res) => {
  try { await dm.type(req.params.id, req.body.text); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/desktop/:id/press', async (req, res) => {
  try { await dm.pressKey(req.params.id, req.body.key); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/desktop/:id/write-file', async (req, res) => {
  try { 
    await dm.writeFile(req.params.id, req.body.filename, req.body.content); 
    res.json({ success: true }); 
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/desktop/:id/execute', async (req, res) => {
  try { res.json({ success: true, output: await dm.executeCommand(req.params.id, req.body.command) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// === FILE VIEWER & PREVIEW ENDPOINTS ===
app.get('/api/files/:filename', (req, res) => { 
  try { 
    const filePath = path.join(workspaceDir, req.params.filename); 
    if (!fs.existsSync(filePath)) return res.status(404).send('File not found'); 
    const content = fs.readFileSync(filePath, 'utf-8'); 
    const ext = path.extname(req.params.filename).substring(1); 
    res.send(`<!DOCTYPE html><html><head><title>JEXI Workspace - ${req.params.filename}</title><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>body{background:#0a0a0a;color:#eee;font-family:monospace;padding:20px;margin:0}h2{color:#00FF9D;font-family:sans-serif}.toolbar{display:flex;gap:10px;margin-bottom:15px;align-items:center}a{color:#00d4ff;text-decoration:none;padding:8px 15px;background:#1a1a1a;border-radius:5px;font-family:sans-serif}a:hover{background:#00d4ff;color:#000}pre{background:#111;padding:15px;border-radius:8px;overflow-x:auto;border:1px solid #333;font-size:14px}.meta{color:#888;font-size:12px;margin-bottom:10px;font-family:sans-serif}</style></head><body><div class="toolbar"><h2>📄 ${req.params.filename}</h2><a href="http://localhost:3000">← Back to JEXI</a></div><div class="meta">Type: ${ext} | Size: ${content.length} chars</div><pre><code>${content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre></body></html>`); 
  } catch (e) { res.status(500).send('Error: ' + e.message); } 
});

app.get('/preview/:filename', (req, res) => {
  try {
    const filePath = path.join(workspaceDir, req.params.filename);
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
    if (fs.existsSync(workspaceDir)) { 
      files = fs.readdirSync(workspaceDir).map(name => { 
        const stat = fs.statSync(path.join(workspaceDir, name)); 
        return { name, size: stat.size, modified: stat.mtime }; 
      }); 
    } 
    res.send(`<!DOCTYPE html><html><head><title>JEXI Workspace</title><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>body{background:#0a0a0a;color:#eee;font-family:sans-serif;padding:20px;margin:0}h2{color:#00FF9D}.toolbar{display:flex;gap:10px;margin-bottom:20px;align-items:center}a{color:#00d4ff;text-decoration:none}.file-list{display:grid;gap:10px}.file-item{display:flex;justify-content:space-between;align-items:center;background:#111;padding:15px;border-radius:8px;border:1px solid #222;transition:0.2s}.file-item:hover{border-color:#00FF9D;background:#1a1a1a}.file-item a{color:#fff;text-decoration:none;font-size:16px;flex:1}.file-meta{color:#888;font-size:12px}.empty{text-align:center;color:#666;padding:40px}</style></head><body><div class="toolbar"><h2>📁 JEXI WORKSPACE</h2><a href="http://localhost:3000">← Back to JEXI</a></div>${files.length === 0 ? '<div class="empty">No files generated yet.</div>' : `<div class="file-list">${files.map(f => `<div class="file-item"><a href="/api/files/${f.name}">📄 ${f.name}</a><span class="file-meta">${(f.size/1024).toFixed(1)} KB</span></div>`).join('')}</div>`}</body></html>`); 
  } catch (e) { res.status(500).send('Error: ' + e.message); } 
});

// === SETTINGS ENDPOINTS ===
app.get('/api/settings', (req, res) => res.json(loadSettings()));
app.post('/api/settings', (req, res) => res.json({ success: saveSettings(req.body) }));

// === CHAT API ===
app.post('/api/chat', async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ success: false, error: "No query provided" });

  try { await fetch(`${MANAGER_URL}/api/chat/add`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'user', text: query }) }); } catch(e){}

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const sendEvent = (type, data) => res.write(JSON.stringify({ type, ...data }) + '\n');

  try {
    const plan = await planner.analyzeIntent(query);
    sendEvent("log", { agent: "Planner", message: `Intent: ${plan.intent}` });
    const results = await orchestrator.executePlan(plan, query, sendEvent);

    try { await fetch(`${MANAGER_URL}/api/chat/add`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'jexi', text: results.summary }) }); } catch(e){}

    sendEvent("done", { success: results.success, query, summary: results.summary, sources: results.sources, statistics: results.statistics });
  } catch (error) {
    sendEvent("log", { agent: "System", message: `Critical Error: ${error.message}` });
    sendEvent("done", { success: false, error: error.message });
  } finally { res.end(); }
});

app.listen(process.env.PORT || 7860, '0.0.0.0', () => console.log('🧠 JEXI OS BRAIN running on port ' + (process.env.PORT || 7860)));
