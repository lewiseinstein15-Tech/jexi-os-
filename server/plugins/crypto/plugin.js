/**
 * JEXI OS — Crypto Plugin (B122).
 * Mounts `crypto-price`: live prices + 24h change for any coin, via the free
 * CoinGecko API (no key). Common symbols map to CoinGecko ids; unknown
 * symbols pass through as ids. 60s cache to stay polite. Honest failure
 * when the API is unreachable.
 */

export const name = 'crypto';
export const version = '1.0.0';
export const inject = ['tools', 'events'];

const BASE = 'https://api.coingecko.com/api/v3/simple/price';

/** Common symbol → CoinGecko id map (symbols case-insensitive). */
const SYMBOL_TO_ID = {
  btc: 'bitcoin', eth: 'ethereum', sol: 'solana', xrp: 'ripple', ada: 'cardano',
  doge: 'dogecoin', dot: 'polkadot', ltc: 'litecoin', avax: 'avalanche-2',
  link: 'chainlink', uni: 'uniswap', shib: 'shiba-inu', bnb: 'binancecoin',
  ton: 'the-open-network', trx: 'tron', near: 'near', algo: 'algorand',
  atom: 'cosmos', matic: 'matic-network', pol: 'polygon-ecosystem-token',
  xlm: 'stellar', eos: 'eos', vet: 'vechain', fil: 'filecoin', aave: 'aave',
  op: 'optimism', arb: 'arbitrum', inj: 'injective-protocol', sui: 'sui',
  apt: 'aptos', sei: 'sei-network', pepe: 'pepe', wif: 'dogwifcoin',
  render: 'render-token', fet: 'fetch-ai', wld: 'worldcoin-wld', gala: 'gala',
};

const CACHE_TTL_MS = 60 * 1000;
let cache = { key: '', at: 0, data: null };

/** Resolve symbols/ids to CoinGecko ids. */
function resolveIds(input) {
  const raw = String(input || '')
    .toLowerCase()
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set();
  const ids = [];
  for (const r of raw) {
    const id = SYMBOL_TO_ID[r] || r;
    if (!seen.has(id)) { seen.add(id); ids.push(id); }
  }
  return ids;
}

/** Apply is called at boot with the plugin context. Return a cleanup fn. */
export async function apply(ctx) {
  const unregister = ctx.tools.register({
    slug: 'crypto-price',
    name: 'Crypto Price',
    desc: 'Get live crypto prices and 24h change (BTC, ETH, SOL, …). Free, no key.',
    args: {
      coins: { type: 'string', required: true, desc: 'Coin symbols or ids, comma-separated, e.g. "btc,eth,sol" (or full ids like "bitcoin")' },
      currency: { type: 'string', required: false, desc: 'Quote currency ISO code (default: usd)' },
    },
    handler: async (args) => {
      const ids = resolveIds(args && args.coins);
      if (!ids.length) return { ok: false, error: 'coins required — e.g. "btc,eth,sol"' };
      const currency = String((args && args.currency) || 'usd').toLowerCase().slice(0, 8);
      const key = `${ids.join(',')}|${currency}`;
      try {
        if (cache.data && cache.key === key && Date.now() - cache.at < CACHE_TTL_MS) {
          return { ok: true, kind: 'crypto', coins: cache.data, currency, at: new Date(cache.at).toISOString(), cached: true };
        }
        const url = `${BASE}?ids=${encodeURIComponent(ids.join(','))}&vs_currencies=${encodeURIComponent(currency)}&include_24hr_change=true`;
        const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
        if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
        const data = await res.json();
        const coins = ids.map((id) => {
          const c = data[id] || {};
          return {
            id,
            symbol: Object.keys(SYMBOL_TO_ID).find((s) => SYMBOL_TO_ID[s] === id) || id,
            price: c[currency] ?? null,
            change24h: c[`${currency}_24h_change`] ?? null,
          };
        }).filter((c) => c.price !== null);
        if (!coins.length) return { ok: false, error: `no data for "${String(args.coins).slice(0, 60)}" — check the symbols/ids` };
        cache = { key, at: Date.now(), data: coins };
        return { ok: true, kind: 'crypto', coins, currency, at: new Date().toISOString(), cached: false };
      } catch (e) {
        return { ok: false, error: `crypto service unreachable: ${(e && e.message) || e} — try again later` };
      }
    },
  });
  return unregister;
}
