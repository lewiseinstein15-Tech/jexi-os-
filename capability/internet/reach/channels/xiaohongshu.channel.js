// Phase 11 Scope E — XiaoHongShu channel (Tier 2 — login wall, reported honestly).
import { makeWallChannel, loginWallDetected } from './wall.factory.js';
import { probeCheck } from './_shared.js';

export class XiaoHongShuChannel extends makeWallChannel({
  name: 'xiaohongshu',
  description: 'XiaoHongShu (RED) notes (login-gated for anonymous readers — honest AUTH_REQUIRED)',
  hosts: ['xiaohongshu.com', 'xhslink.com'],
  wallMarkers: ['扫码登录', '登录后', '当前环境异常'],
}) {
  check = probeCheck('https://www.xiaohongshu.com/', (status, body) => {
    if (status === 200 && loginWallDetected(body)) return { status: 'off', message: 'AUTH_REQUIRED: xiaohongshu gates notes behind login/verification' };
    if (status === 200) return { status: 'warn', message: 'reachable (HTTP 200); notes are login-gated per-read' };
    return { status: 'error', message: `HTTP ${status}` };
  }).bind(this);
}
