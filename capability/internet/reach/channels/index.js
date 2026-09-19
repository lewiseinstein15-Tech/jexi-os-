// Phase 11 Scope D — channel registry.
//
// ORDER MATTERS: platform channels first (Scope E adds Twitter/X, Reddit,
// YouTube, Instagram, LinkedIn, GitHub, Bilibili, XiaoHongShu, Douyin, Weibo,
// WeChat, RSS, V2EX, Xueqiu, Xiaoyuzhou) — WebChannel LAST so it only ever
// catches what nothing else claimed.

import { WebChannel } from './web.channel.js';

export const ALL_CHANNELS = [
  new WebChannel(), // ← LAST: universal fallback
];

export function getChannel(name) {
  return ALL_CHANNELS.find((c) => c.name === name) || null;
}

/** Route a URL: first can_handle() match wins. */
export function route(url, channels = ALL_CHANNELS) {
  for (const ch of channels) {
    try {
      if (ch.can_handle(url)) return { channel: ch, reason: `${ch.name}.can_handle(${url}) === true` };
    } catch {
      // a broken can_handle must never take routing down
    }
  }
  return { channel: null, reason: `no channel can handle ${url}` };
}
