/**
 * JEXI OS — IP Geolocation Plugin (B122).
 * Mounts `ip-geo`: location, network and timezone info for any IP — or your
 * own IP when no address is given — via the free ipwho.is API (no key).
 */

export const name = 'ipgeo';
export const version = '1.0.0';
export const inject = ['tools', 'events'];

const BASE = 'https://ipwho.is';

/** Apply is called at boot with the plugin context. Return a cleanup fn. */
export async function apply(ctx) {
  const unregister = ctx.tools.register({
    slug: 'ip-geo',
    name: 'IP Geolocation',
    desc: 'Location, network and timezone for an IP address (omit for your own IP). Free, no key.',
    args: {
      ip: { type: 'string', required: false, desc: 'IPv4/IPv6 address to look up (default: the caller\'s own IP)' },
    },
    handler: async (args) => {
      const ip = String((args && args.ip) || '').trim();
      try {
        const url = ip ? `${BASE}/${encodeURIComponent(ip)}` : BASE;
        const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
        if (!res.ok) throw new Error(`ipwho.is HTTP ${res.status}`);
        const data = await res.json();
        if (!data || data.success === false) {
          return { ok: false, error: (data && data.message) || `lookup failed for "${ip || 'your IP'}"` };
        }
        const tz = data.timezone || {};
        return {
          ok: true,
          kind: 'ipgeo',
          ip: data.ip,
          type: data.type || null,
          continent: data.continent || null,
          country: data.country || null,
          countryCode: data.country_code || null,
          region: data.region || null,
          city: data.city || null,
          latitude: data.latitude ?? null,
          longitude: data.longitude ?? null,
          postal: data.postal || null,
          callingCode: data.calling_code || null,
          isEu: !!data.is_eu,
          flag: data.flag ? data.flag.emoji || data.flag.img || null : null,
          connection: data.connection ? {
            isp: data.connection.isp || null,
            org: data.connection.org || null,
            asn: data.connection.asn || null,
          } : null,
          timezone: tz.id || null,
          localTime: tz.current_time || null,
        };
      } catch (e) {
        return { ok: false, error: `geo service unreachable: ${(e && e.message) || e} — try again later` };
      }
    },
  });
  return unregister;
}
