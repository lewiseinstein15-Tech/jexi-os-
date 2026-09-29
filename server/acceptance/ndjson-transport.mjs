/**
 * Real-socket transport check for the deck's live bridge.
 *
 * This is NOT a model. It is a tiny HTTP server that serves the real deck and
 * streams genuine NDJSON over a genuine socket, deliberately cutting every
 * line at awkward byte boundaries so the browser's reassembly is exercised
 * for real — mid-line chunks, mid-word chunks, a blank line, a malformed
 * line, and a terminal event with no trailing newline.
 *
 * What this proves : the browser transport and rendering.
 * What this does NOT prove : that any model works. The provider key for the
 * live run expired during this session, so the model leg is covered by
 * tests/tickets/jexi-lean-lane-streaming.test.js instead.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, '..', 'public');
const PORT = Number(process.env.PORT || 3199);

const SCRIPT = [
  { type: 'log', agent: 'JEXI', message: 'transport fixture — not a model' },
  { type: 'agent.plan', intent: 'code', tools: [{ slug: 'fs_read' }], codeMode: false },
  { type: 'stream', text: 'A passing suite ' },
  { type: 'stream', text: 'proves the code meets ' },
  { type: 'stream', text: 'the assertions, and nothing more.' },
  { type: 'log', agent: 'JEXI', message: 'stream complete' },
  { type: 'done', success: true, summary: 'A passing suite proves the code meets the assertions, and nothing more.' },
];

const server = http.createServer((req, res) => {
  if (req.url === '/api/chat' && req.method === 'POST') {
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    let i = 0;
    let carry = '';                 // tail of a line split across two writes
    const pump = () => {
      if (carry) { res.write(carry); carry = ''; }   // finish the split line FIRST
      if (i >= SCRIPT.length) { res.end(); return; }
      const n = i;                  // index of the event about to be written
      const ev = SCRIPT[i++];
      const line = JSON.stringify(ev) + '\n';
      if (n === 3) { res.write(line.slice(0, 7)); carry = line.slice(7); return setTimeout(pump, 40); }
      if (n === 4) { res.write(line); res.write('\n'); return setTimeout(pump, 40); }   // blank line
      if (n === 5) { res.write('{ not json at all\n'); return setTimeout(pump, 40); }  // malformed line
      if (n === 6) { const l2 = line.slice(0, line.length - 1); res.write(l2); return setTimeout(pump, 40); } // no trailing newline
      res.write(line);
      setTimeout(pump, 40);
    };
    setTimeout(pump, 30);
    return;
  }
  const f = req.url === '/' || req.url.startsWith('/?') ? 'index.html' : req.url.slice(1);
  const p = path.join(PUBLIC, f);
  if (!p.startsWith(PUBLIC) || !fs.existsSync(p)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(p));
});

server.listen(PORT, '127.0.0.1', () => console.log(`transport fixture on http://127.0.0.1:${PORT}`));
