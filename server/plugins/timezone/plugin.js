/**
 * JEXI OS — Timezone Plugin (B121).
 * Mounts `time-now`: current local date/time for any IANA timezone,
 * computed with Intl (offline, free, no key) — plus the user's configured
 * request timezone when present. Reversible on unload.
 */

export const name = 'timezone';
export const version = '1.0.0';
export const inject = ['tools', 'events'];

const COMMON_ZONES = [
  'UTC', 'Africa/Nairobi', 'Europe/London', 'Europe/Paris', 'America/New_York',
  'America/Los_Angeles', 'Asia/Tokyo', 'Asia/Dubai', 'Asia/Kolkata', 'Australia/Sydney',
];

/** Apply is called at boot with the plugin context. Return a cleanup fn. */
export async function apply(ctx) {
  const unregister = ctx.tools.register({
    slug: 'time-now',
    name: 'Time Now',
    desc: 'Get the current local date and time for a timezone (IANA name, e.g. Africa/Nairobi). Free, offline, no key.',
    args: {
      timezone: { type: 'string', required: false, desc: 'IANA timezone name (default: UTC). Try a city zone like Africa/Nairobi.' },
    },
    handler: async (args) => {
      let tz = String((args && args.timezone) || '').trim();
      let ok = true;
      if (!tz) tz = 'UTC';
      let local;
      try {
        local = new Intl.DateTimeFormat('en-GB', {
          weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
          hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: tz,
        }).format(new Date());
      } catch {
        ok = false;
        local = `unknown timezone "${tz}" — use an IANA name like Africa/Nairobi`;
      }
      return {
        ok,
        kind: 'time',
        timezone: tz,
        local,
        utc: new Date().toISOString(),
        common: COMMON_ZONES,
      };
    },
  });
  return unregister;
}
