/**
 * JEXI OS — Phase 6 Scope B: scheduler triggers — cron.
 *
 * A real 5-field cron parser/evaluator (minute hour day-of-month month
 * day-of-week). Supports `*`, `*\/n`, `a-b`, `a-b/n`, and comma lists.
 *
 * day-of-month + day-of-week follow the classic vixie-cron rule: when BOTH are
 * restricted the day matches if EITHER matches; otherwise only the restricted
 * field is consulted.
 *
 * Field order: minute(0-59) hour(0-23) dayOfMonth(1-31) month(1-12)
 * dayOfWeek(0-6, 0 and 7 both mean Sunday).
 */

function expandField(spec, min, max, { sunday7 = false } = {}) {
  const out = new Set();
  for (const part of String(spec).split(',')) {
    const piece = part.trim();
    if (!piece) throw new Error(`empty cron segment in "${spec}"`);
    const [range, stepRaw] = piece.split('/');
    const step = stepRaw === undefined ? 1 : Number(stepRaw);
    if (!Number.isInteger(step) || step < 1) throw new Error(`bad cron step "${piece}"`);

    let lo = min;
    let hi = max;
    if (range !== '*') {
      const m = /^(\d+)(?:-(\d+))?$/.exec(range);
      if (!m) throw new Error(`bad cron field "${piece}"`);
      lo = Number(m[1]);
      hi = m[2] === undefined ? lo : Number(m[2]);
      if (lo > hi) throw new Error(`inverted cron range "${piece}"`);
    }
    for (let v = lo; v <= hi; v += step) {
      if (v < min || v > max) throw new Error(`cron value ${v} out of range [${min},${max}]`);
      out.add(v);
    }
  }
  if (sunday7) out.add(0);
  if (out.size === 0) throw new Error(`cron field "${spec}" matched nothing`);
  return out;
}

/** Parse a 5-field cron expression into sets of allowed values. */
export function parseCron(expr) {
  if (typeof expr !== 'string') throw new Error('cron expression must be a string');
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`cron expression needs 5 fields, got ${fields.length}`);
  const parsed = {
    expr: expr.trim(),
    raw: fields,
    minute: expandField(fields[0], 0, 59),
    hour: expandField(fields[1], 0, 23),
    dayOfMonth: expandField(fields[2], 1, 31),
    month: expandField(fields[3], 1, 12),
    dayOfWeek: expandField(fields[4], 0, 6, { sunday7: true }),
  };
  parsed.domRestricted = fields[2] !== '*';
  parsed.dowRestricted = fields[4] !== '*';
  return parsed;
}

function dayMatches(parsed, date) {
  const dom = parsed.dayOfMonth.has(date.getDate());
  const dow = parsed.dayOfWeek.has(date.getDay());
  if (parsed.domRestricted && parsed.dowRestricted) return dom || dow;
  if (parsed.domRestricted) return dom;
  if (parsed.dowRestricted) return dow;
  return true;
}

/** True when `date` (to the minute) satisfies the cron expression. */
export function cronMatches(exprOrParsed, date = new Date()) {
  const parsed = typeof exprOrParsed === 'string' ? parseCron(exprOrParsed) : exprOrParsed;
  return (
    parsed.minute.has(date.getMinutes()) &&
    parsed.hour.has(date.getHours()) &&
    parsed.month.has(date.getMonth() + 1) &&
    dayMatches(parsed, date)
  );
}

/** The first matching time strictly after `from` (minute granularity). */
export function nextCronDate(exprOrParsed, from = new Date()) {
  const parsed = typeof exprOrParsed === 'string' ? parseCron(exprOrParsed) : exprOrParsed;
  const d = new Date(from.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1); // strictly after `from`

  const limit = new Date(d.getTime());
  limit.setFullYear(limit.getFullYear() + 4);

  while (d < limit) {
    if (!parsed.month.has(d.getMonth() + 1)) {
      d.setMonth(d.getMonth() + 1, 1);
      d.setHours(0, 0, 0);
      continue;
    }
    if (!dayMatches(parsed, d)) {
      d.setDate(d.getDate() + 1);
      d.setHours(0, 0, 0);
      continue;
    }
    if (!parsed.hour.has(d.getHours())) {
      d.setHours(d.getHours() + 1, 0, 0);
      continue;
    }
    if (!parsed.minute.has(d.getMinutes())) {
      d.setMinutes(d.getMinutes() + 1, 0, 0);
      continue;
    }
    return new Date(d.getTime());
  }
  return null;
}