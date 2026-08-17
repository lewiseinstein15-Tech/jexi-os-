/**
 * JEXI OS — Weather Plugin (B97).
 *
 * The FIRST plugin that proves the DeepSeek-Harness-style seam: it mounts a
 * real tool (`weather-now`) into JEXI's gated ToolRuntime WITHOUT touching
 * core code. Free, no key (wttr.in public API). Unloading the plugin
 * removes the tool (reversible effect).
 */

export const name = 'weather';
export const version = '1.0.0';
export const inject = ['tools', 'events'];

/** Apply is called at boot with the plugin context. Return a cleanup fn. */
export async function apply(ctx) {
  const unregister = ctx.tools.register({
    slug: 'weather-now',
    name: 'Weather Now',
    desc: 'Get the current weather for a city or location (free, no key).',
    args: { city: { type: 'string', required: true, desc: 'City or location name' } },
    handler: async (args) => {
      const city = String((args && args.city) || '').trim();
      if (!city) return { ok: false, error: 'city required' };
      try {
        const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, { signal: AbortSignal.timeout(12000) });
        if (!res.ok) return { ok: false, error: `weather service HTTP ${res.status}` };
        const data = await res.json();
        const cur = data.current_condition && data.current_condition[0];
        const area = data.nearest_area && data.nearest_area[0];
        if (!cur) return { ok: false, error: 'no weather data returned' };
        return {
          ok: true,
          kind: 'weather',
          city: city,
          area: area ? area.areaName[0].value : city,
          tempC: cur.temp_C,
          tempF: cur.temp_F,
          feelsC: cur.FeelsLikeC,
          humidity: cur.humidity,
          windKph: cur.windspeedKmph,
          desc: cur.weatherDesc && cur.weatherDesc[0] ? cur.weatherDesc[0].value : '',
        };
      } catch (e) {
        return { ok: false, error: (e && e.message) || 'weather fetch failed' };
      }
    },
  });

  ctx.events.emit('weather/plugin-ready', { note: 'weather-now tool mounted' });

  // Reversible effect: unload removes the tool.
  return () => {
    unregister();
    ctx.events.emit('weather/plugin-unloaded', {});
  };
}
