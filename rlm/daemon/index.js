import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { error } from './recovery.js';
export function createDaemon({ directory = path.resolve('.jexi/rlm-daemon') } = {}) {
  directory = path.resolve(directory);
  const endpoint = path.join(directory, 'daemon.sock');
  function request(op, args = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ socketPath: endpoint, path: '/', method: 'POST', agent: false }, res => {
        let data = ''; res.on('data', d => { data += d; }); res.on('end', () => { try { const r = JSON.parse(data); r.error ? reject(error(r.error)) : resolve(r.value); } catch (e) { reject(e); } });
      });
      req.setTimeout(30000, () => req.destroy(error('E_DAEMON_TIMEOUT'))); req.on('error', reject); req.end(JSON.stringify({ op, ...args }));
    });
  }
  return {
    async start() {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      try { return await request('info'); } catch (e) { if (!['ENOENT', 'ECONNREFUSED'].includes(e.code)) throw e; }
      const lock = path.join(directory, 'owner.json');
      if (fs.existsSync(lock)) {
        const { pid } = JSON.parse(fs.readFileSync(lock));
        let alive = false;
        try { process.kill(pid, 0); alive = !fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].startsWith('Z'); } catch {}
        if (alive) throw error('E_DAEMON_STARTING');
        fs.unlinkSync(lock);
      }
      const fd = fs.openSync(lock, 'wx', 0o600); fs.writeFileSync(fd, JSON.stringify({ pid: process.pid })); fs.closeSync(fd);
      fs.rmSync(endpoint, { force: true });
      const child = fork(fileURLToPath(new URL('./supervisor.js', import.meta.url)), [directory], { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(error('E_DAEMON_START_TIMEOUT')); }, 10000);
        child.once('error', e => { clearTimeout(timer); reject(e); });
        child.once('exit', () => { clearTimeout(timer); reject(error('E_DAEMON_START_FAILED')); });
        child.once('message', info => { clearTimeout(timer); child.disconnect(); child.unref(); resolve({ pid: info.pid, endpoint: info.endpoint, startedAt: info.startedAt }); });
      });
    },
    listSessions: () => request('list'),
    open: id => request('open', { id }),
    eval: (id, code, ctx = {}) => request('eval', { id, code, ctx }),
    detach: id => request('detach', { id }),
    attach: id => request('attach', { id }),
    recover: id => request('recover', { id }),
    stop: () => request('stop'),
  };
}
const daemon = createDaemon();
export default daemon;
