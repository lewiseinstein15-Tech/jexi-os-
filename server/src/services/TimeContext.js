/**
 * B104 — TIME CONTEXT (mirror of DeepSeek Harness
 * `packages/context/time-context`).
 *
 * The model always knows the current date/time: every LLM call's system
 * prompt carries one small time block, so "today", "this week", deadlines
 * and date math are never guesses. The frontend sends the user's real
 * timezone (`x-jexi-tz`); the server falls back to UTC.
 */

let currentTimeZone = null;

/** Set the request timezone (from the x-jexi-tz header). Safe: invalid → UTC. */
export function setRequestTimeZone(tz) {
  const candidate = String(tz || '').trim();
  if (!candidate) { currentTimeZone = null; return; }
  try {
    // Validate by actually formatting in that zone.
    new Intl.DateTimeFormat('en-GB', { timeZone: candidate }).format(new Date());
    currentTimeZone = candidate;
  } catch {
    currentTimeZone = null; // unknown zone → UTC fallback
  }
}

/** The currently active zone (or UTC). */
export function requestTimeZone() {
  return currentTimeZone || 'UTC';
}

/** One compact line naming the current date/time + zone. */
export function timeContextBlock() {
  const now = new Date();
  const tz = requestTimeZone();
  let local;
  try {
    local = new Intl.DateTimeFormat('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: tz,
    }).format(now);
  } catch {
    local = now.toUTCString();
  }
  // B172 — KV-CACHE STABILITY (dsh prefix-stable discipline): the time block
  // is rounded to the MINUTE so repeated calls within a minute share an
  // identical prompt prefix → provider-side cache hits → faster + cheaper.
  // Seconds-level clock detail was never useful to the model anyway.
  const rounded = new Date(Math.floor(now.getTime() / 60000) * 60000);
  let rLocal;
  try {
    rLocal = new Intl.DateTimeFormat('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: tz,
    }).format(rounded);
  } catch { rLocal = rounded.toUTCString(); }
  return `\n[Current date and time: ${rLocal} (${tz}, minute precision). Use these for anything time-related — dates, deadlines, "today", "this week", scheduling, age calculations.]\n`;
}

/** Append the time block to a system prompt, idempotently. */
export function appendTimeContext(system) {
  const base = String(system || '');
  if (base.includes('Current date and time:')) return base;
  return `${base}${timeContextBlock()}`;
}
