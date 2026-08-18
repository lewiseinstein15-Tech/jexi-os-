/**
 * JEXI OS — Currency Plugin (B121).
 * Mounts `currency-convert`: live exchange rates (free open.er-api.com, no
 * key) and amount conversion between ISO currency codes. Honest failure
 * when the rate service is unreachable.
 */

export const name = 'currency';
export const version = '1.0.0';
export const inject = ['tools', 'events'];

const BASE = 'https://open.er-api.com/v6/latest/USD';
let cache = { at: 0, rates: null };

async function rates() {
  // 6-hour cache — the free API updates daily.
  if (cache.rates && Date.now() - cache.at < 6 * 60 * 60 * 1000) return cache.rates;
  const res = await fetch(BASE, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`rate service HTTP ${res.status}`);
  const data = await res.json();
  if (!data || data.result !== 'success' || !data.rates) throw new Error('rate service returned no data');
  cache = { at: Date.now(), rates: data.rates };
  return data.rates;
}

/** Apply is called at boot with the plugin context. Return a cleanup fn. */
export async function apply(ctx) {
  const unregister = ctx.tools.register({
    slug: 'currency-convert',
    name: 'Currency Convert',
    desc: 'Convert an amount between currencies with live rates (ISO codes, e.g. USD→KES). Free, no key.',
    args: {
      from: { type: 'string', required: true, desc: 'Source ISO currency code, e.g. USD' },
      to: { type: 'string', required: true, desc: 'Target ISO currency code, e.g. KES' },
      amount: { type: 'number', required: true, desc: 'Amount to convert' },
    },
    handler: async (args) => {
      const from = String((args && args.from) || '').trim().toUpperCase().slice(0, 3);
      const to = String((args && args.to) || '').trim().toUpperCase().slice(0, 3);
      const amount = Number(args && args.amount);
      if (!from || !to || !Number.isFinite(amount)) return { ok: false, error: 'from, to (ISO codes) and amount are required' };
      try {
        const ratesData = await rates();
        const fromUsd = from === 'USD' ? 1 : ratesData[from];
        const toUsd = to === 'USD' ? 1 : ratesData[to];
        if (!fromUsd || !toUsd) return { ok: false, error: `unknown currency code "${!fromUsd ? from : to}"` };
        const converted = amount * (toUsd / fromUsd);
        return {
          ok: true,
          kind: 'currency',
          from, to, amount,
          converted: Math.round(converted * 100) / 100,
          rate: Math.round((toUsd / fromUsd) * 10000) / 10000,
          at: new Date().toISOString(),
        };
      } catch (e) {
        return { ok: false, error: `currency service unreachable: ${(e && e.message) || e} — try again later` };
      }
    },
  });
  return unregister;
}
