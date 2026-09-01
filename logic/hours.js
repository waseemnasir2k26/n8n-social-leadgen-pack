/**
 * Business hours and quiet hours.
 *
 * Source of truth for the Code nodes in workflows/09-speed-to-lead-responder.json
 * ("Business Hours Check") and workflows/11-followup-sequence.json ("Quiet Hours Gate").
 *
 * Timezones are resolved with Intl (IANA zone names), so daylight saving is
 * handled by the runtime rather than by a hardcoded offset. A fixed
 * utc_offset_minutes is accepted as a fallback for runtimes without full ICU.
 */

// --- parity block: hours defaults ---
const HOURS_DEFAULTS = {
  timezone: 'UTC',
  business_days: [1, 2, 3, 4, 5],
  business_start_hour: 9,
  business_end_hour: 17,
  quiet_start_hour: 21,
  quiet_end_hour: 8
};
// --- end parity block ---

function withDefaults(config) {
  return Object.assign({}, HOURS_DEFAULTS, config || {});
}

function toDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) throw new Error('hours: invalid date input');
  return d;
}

/** Wall-clock parts of `when` in the configured zone. */
function localParts(when, config) {
  const cfg = withDefaults(config);
  const d = toDate(when);

  if (typeof cfg.utc_offset_minutes === 'number' && !cfg.timezone_wins) {
    const shifted = new Date(d.getTime() + cfg.utc_offset_minutes * 60000);
    return {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: shifted.getUTCHours(),
      minute: shifted.getUTCMinutes(),
      dow: shifted.getUTCDay()
    };
  }

  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: cfg.timezone,
    hour12: false,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
  const parts = {};
  fmt.formatToParts(d).forEach(function (p) { parts[p.type] = p.value; });
  const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    dow: dowMap[parts.weekday]
  };
}

/** Convert a wall-clock time in the configured zone back to a UTC Date. */
function fromLocal(parts, config) {
  const cfg = withDefaults(config);
  const guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute || 0);
  if (typeof cfg.utc_offset_minutes === 'number' && !cfg.timezone_wins) {
    return new Date(guess - cfg.utc_offset_minutes * 60000);
  }
  let ts = guess;
  for (let i = 0; i < 3; i++) {
    const p = localParts(new Date(ts), cfg);
    const actual = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    const drift = actual - guess;
    if (drift === 0) break;
    ts -= drift;
  }
  return new Date(ts);
}

function isBusinessDay(parts, cfg) {
  return cfg.business_days.indexOf(parts.dow) !== -1;
}

function isWithinBusinessHours(when, config) {
  const cfg = withDefaults(config);
  const p = localParts(when, cfg);
  if (!isBusinessDay(p, cfg)) return false;
  return p.hour >= cfg.business_start_hour && p.hour < cfg.business_end_hour;
}

/** Quiet hours wrap midnight: 21:00 -> 08:00 is a single closed window. */
function isQuietHours(when, config) {
  const cfg = withDefaults(config);
  const p = localParts(when, cfg);
  const start = cfg.quiet_start_hour;
  const end = cfg.quiet_end_hour;
  if (start === end) return false;
  if (start < end) return p.hour >= start && p.hour < end;
  return p.hour >= start || p.hour < end;
}

/** Next instant inside business hours, as a UTC Date. Returns `when` if already open. */
function nextOpenTime(when, config) {
  const cfg = withDefaults(config);
  const d = toDate(when);
  if (isWithinBusinessHours(d, cfg)) return d;

  let p = localParts(d, cfg);
  for (let i = 0; i < 14; i++) {
    const sameDayStillPossible = i === 0 && isBusinessDay(p, cfg) && p.hour < cfg.business_start_hour;
    if (sameDayStillPossible) {
      return fromLocal({ year: p.year, month: p.month, day: p.day, hour: cfg.business_start_hour, minute: 0 }, cfg);
    }
    const nextDayUtc = fromLocal({ year: p.year, month: p.month, day: p.day, hour: 12, minute: 0 }, cfg);
    const candidate = new Date(nextDayUtc.getTime() + 24 * 3600 * 1000);
    p = localParts(candidate, cfg);
    if (isBusinessDay(p, cfg)) {
      return fromLocal({ year: p.year, month: p.month, day: p.day, hour: cfg.business_start_hour, minute: 0 }, cfg);
    }
  }
  throw new Error('hours: no open window found in 14 days - check business_days config');
}

/** Next instant outside quiet hours, as a UTC Date. */
function nextSendableTime(when, config) {
  const cfg = withDefaults(config);
  const d = toDate(when);
  if (!isQuietHours(d, cfg)) return d;
  const p = localParts(d, cfg);
  const rollsOver = cfg.quiet_start_hour > cfg.quiet_end_hour && p.hour >= cfg.quiet_start_hour;
  const base = fromLocal({ year: p.year, month: p.month, day: p.day, hour: 12, minute: 0 }, cfg);
  const target = rollsOver ? localParts(new Date(base.getTime() + 24 * 3600 * 1000), cfg) : p;
  return fromLocal({ year: target.year, month: target.month, day: target.day, hour: cfg.quiet_end_hour, minute: 0 }, cfg);
}

module.exports = {
  HOURS_DEFAULTS: HOURS_DEFAULTS,
  withDefaults: withDefaults,
  localParts: localParts,
  fromLocal: fromLocal,
  isWithinBusinessHours: isWithinBusinessHours,
  isQuietHours: isQuietHours,
  nextOpenTime: nextOpenTime,
  nextSendableTime: nextSendableTime
};
