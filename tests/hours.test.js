const test = require("node:test");
const assert = require("node:assert");
const {
  localParts,
  isWithinBusinessHours,
  isQuietHours,
  nextOpenTime,
  nextSendableTime,
} = require("../logic/hours.js");

const NY = { timezone: "America/New_York" };
const KARACHI = { timezone: "Asia/Karachi" };

test("TIMEZONE ROLLOVER: 23:30 UTC is still the previous day in New York", () => {
  const p = localParts("2026-01-15T23:30:00Z", NY);
  assert.deepEqual(
    { year: p.year, month: p.month, day: p.day, hour: p.hour },
    { year: 2026, month: 1, day: 15, hour: 18 },
  );
});

test("TIMEZONE ROLLOVER: 20:00 UTC is already the next day in Karachi", () => {
  const p = localParts("2026-01-15T20:00:00Z", KARACHI);
  assert.equal(p.day, 16);
  assert.equal(p.hour, 1);
});

test("DST: the same UTC clock time maps to different local hours in winter and summer", () => {
  assert.equal(localParts("2026-01-15T17:00:00Z", NY).hour, 12);
  assert.equal(localParts("2026-07-15T17:00:00Z", NY).hour, 13);
});

test("a fixed utc_offset_minutes is honoured when no zone lookup is wanted", () => {
  const p = localParts("2026-01-15T23:30:00Z", { utc_offset_minutes: -300 });
  assert.equal(p.day, 15);
  assert.equal(p.hour, 18);
});

test("business hours boundaries: open at 09:00, closed at 17:00", () => {
  // 2026-01-14 is a Wednesday. 14:00Z = 09:00 New York.
  assert.equal(isWithinBusinessHours("2026-01-14T13:59:00Z", NY), false);
  assert.equal(isWithinBusinessHours("2026-01-14T14:00:00Z", NY), true);
  assert.equal(isWithinBusinessHours("2026-01-14T21:59:00Z", NY), true);
  assert.equal(isWithinBusinessHours("2026-01-14T22:00:00Z", NY), false);
});

test("weekends are closed", () => {
  assert.equal(
    isWithinBusinessHours("2026-01-17T15:00:00Z", NY),
    false,
    "Saturday",
  );
  assert.equal(
    isWithinBusinessHours("2026-01-18T15:00:00Z", NY),
    false,
    "Sunday",
  );
  assert.equal(
    isWithinBusinessHours("2026-01-19T15:00:00Z", NY),
    true,
    "Monday",
  );
});

test("QUIET HOURS WRAP MIDNIGHT: 21:00 to 08:00 is one window", () => {
  assert.equal(
    isQuietHours("2026-01-15T01:00:00Z", NY),
    false,
    "20:00 local is still sendable",
  );
  assert.equal(
    isQuietHours("2026-01-15T02:00:00Z", NY),
    true,
    "21:00 local is the first quiet hour",
  );
  assert.equal(
    isQuietHours("2026-01-15T04:00:00Z", NY),
    true,
    "23:00 local is quiet",
  );
  assert.equal(
    isQuietHours("2026-01-15T10:00:00Z", NY),
    true,
    "05:00 local is quiet",
  );
  assert.equal(
    isQuietHours("2026-01-15T13:00:00Z", NY),
    false,
    "08:00 local is sendable",
  );
  assert.equal(
    isQuietHours("2026-01-15T17:00:00Z", NY),
    false,
    "midday is sendable",
  );
});

test("quiet hours can be disabled by setting start equal to end", () => {
  assert.equal(
    isQuietHours("2026-01-15T04:00:00Z", {
      timezone: "America/New_York",
      quiet_start_hour: 0,
      quiet_end_hour: 0,
    }),
    false,
  );
});

test("nextOpenTime returns the instant itself when already open", () => {
  const when = "2026-01-14T15:00:00Z";
  assert.equal(
    nextOpenTime(when, NY).toISOString(),
    new Date(when).toISOString(),
  );
});

test("nextOpenTime from before opening returns the same local day at 09:00", () => {
  // 2026-01-14 11:00Z = 06:00 New York, same weekday.
  assert.equal(
    nextOpenTime("2026-01-14T11:00:00Z", NY).toISOString(),
    "2026-01-14T14:00:00.000Z",
  );
});

test("nextOpenTime from a Saturday skips to Monday 09:00 local", () => {
  assert.equal(
    nextOpenTime("2026-01-17T15:00:00Z", NY).toISOString(),
    "2026-01-19T14:00:00.000Z",
  );
});

test("nextOpenTime crosses a DST boundary without drifting an hour", () => {
  // US DST starts Sunday 2026-03-08. Friday evening -> Monday 09:00 EDT = 13:00Z.
  assert.equal(
    nextOpenTime("2026-03-06T23:00:00Z", NY).toISOString(),
    "2026-03-09T13:00:00.000Z",
  );
});

test("nextSendableTime rolls a late-night touch to 08:00 the NEXT local morning", () => {
  // 2026-01-15T04:00Z = 2026-01-14 23:00 New York.
  assert.equal(
    nextSendableTime("2026-01-15T04:00:00Z", NY).toISOString(),
    "2026-01-15T13:00:00.000Z",
  );
});

test("nextSendableTime on an early morning stays on the SAME local day", () => {
  // 2026-01-15T10:00Z = 05:00 New York, same day - do not push a full day forward.
  assert.equal(
    nextSendableTime("2026-01-15T10:00:00Z", NY).toISOString(),
    "2026-01-15T13:00:00.000Z",
  );
});

test("nextSendableTime is a no-op outside quiet hours", () => {
  const when = "2026-01-15T17:00:00Z";
  assert.equal(
    nextSendableTime(when, NY).toISOString(),
    new Date(when).toISOString(),
  );
});

test("an invalid date is rejected rather than silently treated as now", () => {
  assert.throws(() => isWithinBusinessHours("not-a-date", NY), /invalid date/);
});

test("a config with no business days fails loudly instead of looping", () => {
  assert.throws(
    () =>
      nextOpenTime("2026-01-17T15:00:00Z", {
        timezone: "America/New_York",
        business_days: [],
      }),
    /no open window/,
  );
});
