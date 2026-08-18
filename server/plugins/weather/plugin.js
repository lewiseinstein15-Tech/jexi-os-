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
        // Primary: wttr.in (free, no key). Fallback: open-meteo geocoding +
        // forecast (also free, no key) so a flaky provider never fails the
        // tool for the user.
        try {
          const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, { signal: AbortSignal.timeout(10000) });
          if (res.ok) {
            const data = await res.json();
            const cur = data.current_condition && data.current_condition[0];
            const area = data.nearest_area && data.nearest_area[0];
            if (cur) {
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
                provider: 'wttr.in',
              };
            }
          }
        } catch { /* fall through to open-meteo */ }
        const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`, { signal: AbortSignal.timeout(10000) });
        if (!geo.ok) return { ok: false, error: `weather geocoding HTTP ${geo.status}` };
        const geoData = await geo.json();
        const place = geoData && geoData.results && geoData.results[0];
        if (!place) return { ok: false, error: `weather service: no location found for "${city}"` };
        const wx = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m`, { signal: AbortSignal.timeout(10000) });
        if (!wx.ok) return { ok: false, error: `weather forecast HTTP ${wx.status}` };
        const w = await wx.json();
        const c = w && w.current;
        if (!c) return { ok: false, error: 'no weather data returned' };
        return {
          ok: true,
          kind: 'weather',
          city: city,
          area: place.name,
          tempC: String(c.temperature_2m),
          humidity: String(c.relative_humidity_2m),
          feelsC: String(c.apparent_temperature),
          windKph: String(c.wind_speed_10m),
          desc: `weather code ${c.weather_code}`,
          provider: 'open-meteo',
        };
      } catch (e) {
        return { ok: false, error: `weather fetch failed: ${(e && e.message) || e}` };
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
