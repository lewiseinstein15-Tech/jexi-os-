// Phase 11 Scope E — Weibo channel (Tier 2 — login wall, reported honestly).
import { makeWallChannel, loginWallDetected } from './wall.factory.js';
import { probeCheck } from './_shared.js';

export class WeiboChannel extends makeWallChannel({
  name: 'weibo',
  description: 'Weibo posts/profiles (login-gated for anonymous readers — honest AUTH_REQUIRED)',
  hosts: ['weibo.com', 'weibo.cn', 't.cn'],
  wallMarkers: ['扫码登录', '登录后查看', '微博登录'],
}) {
  check = probeCheck('https://weibo.com/', (status, body) => {
    if (status === 200 && loginWallDetected(body)) return { status: 'off', message: 'AUTH_REQUIRED: weibo gates posts behind login' };
    if (status === 200) return { status: 'warn', message: 'reachable (HTTP 200); posts are login-gated per-read' };
    return { status: 'error', message: `HTTP ${status}` };
  }).bind(this);
}
