import { failure } from './storage.js';

function iso(clock) {
  const date = new Date(clock());
  if (Number.isNaN(date.valueOf())) throw failure('E_CLOCK');
  return date.toISOString();
}

function positiveInteger(value, code) {
  if (!Number.isSafeInteger(value) || value < 1) throw failure(code);
  return value;
}

/** In-process cron-style pings for active goals. Schedules are intentionally not restart-resumed. */
export function createHeartbeat({ goals, clock = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const schedules = new Map();
  const listeners = new Map();
  let nextSchedule = 1;
  let nextSubscription = 1;

  function fire(schedule) {
    if (schedule.cancelled || !schedules.has(schedule.id)) return;
    schedule.pings += 1;
    const event = {
      scheduleId: schedule.id,
      goalId: schedule.goalId,
      ping: schedule.pings,
      firedAt: iso(clock),
    };
    for (const callback of listeners.values()) {
      try {
        const outcome = callback(event);
        Promise.resolve(outcome).catch(() => {});
      } catch { /* a listener cannot stop the scheduler */ }
    }
    if (schedule.cancelled || !schedules.has(schedule.id)) return;
    if (schedule.maxPings !== null && schedule.pings >= schedule.maxPings) {
      schedules.delete(schedule.id);
      return;
    }
    schedule.nextFireAt = iso(() => clock() + schedule.everyMs);
    schedule.timer = setTimer(() => fire(schedule), schedule.everyMs);
  }

  return {
    schedule(goalId, { everyMs, maxPings } = {}) {
      const goal = goals.get(goalId);
      if (goal.status === 'completed') throw failure('E_GOAL_COMPLETE');
      const cadence = positiveInteger(everyMs, 'E_HEARTBEAT_INTERVAL');
      const cap = maxPings == null ? null : positiveInteger(maxPings, 'E_HEARTBEAT_MAX_PINGS');
      const schedule = {
        id: `heartbeat-${nextSchedule++}`,
        goalId,
        everyMs: cadence,
        maxPings: cap,
        pings: 0,
        cancelled: false,
        timer: null,
        nextFireAt: iso(() => clock() + cadence),
      };
      schedules.set(schedule.id, schedule);
      schedule.timer = setTimer(() => fire(schedule), cadence);
      return { scheduleId: schedule.id, nextFireAt: schedule.nextFireAt };
    },

    cancel(scheduleId) {
      const schedule = schedules.get(scheduleId);
      if (!schedule) throw failure('E_HEARTBEAT_NOT_FOUND');
      schedule.cancelled = true;
      clearTimer(schedule.timer);
      schedules.delete(scheduleId);
      return { cancelled: true };
    },

    onFire(callback) {
      if (typeof callback !== 'function') throw failure('E_HEARTBEAT_CALLBACK');
      const subscriptionId = `subscription-${nextSubscription++}`;
      listeners.set(subscriptionId, callback);
      let unsubscribed = false;
      return {
        unsubscribe() {
          if (!unsubscribed) listeners.delete(subscriptionId);
          unsubscribed = true;
          return { unsubscribed: true };
        },
      };
    },

    close() {
      for (const schedule of schedules.values()) {
        schedule.cancelled = true;
        clearTimer(schedule.timer);
      }
      schedules.clear();
      listeners.clear();
    },
  };
}

export default createHeartbeat;
