import assert from "node:assert/strict";
import test from "node:test";

import {
  isoWeekday,
  localDateAt,
  localDayUtcRange,
  nextScheduledAt,
} from "../lib/localDate.mjs";

test("localDateAt returns the local calendar date instead of the UTC date", () => {
  assert.equal(
    localDateAt(new Date("2026-07-30T20:30:00.000Z"), "Asia/Kathmandu"),
    "2026-07-31",
  );
});

test("isoWeekday returns Monday as 1 and Sunday as 7", () => {
  assert.equal(isoWeekday("2026-07-27", "Asia/Kathmandu"), 1);
  assert.equal(isoWeekday("2026-08-02", "America/New_York"), 7);
});

test("localDayUtcRange returns Kathmandu workday boundaries", () => {
  assert.deepEqual(localDayUtcRange("2026-07-30", "Asia/Kathmandu"), {
    since: "2026-07-29T18:15:00.000Z",
    until: "2026-07-30T18:15:00.000Z",
  });
});

test("localDayUtcRange follows New York's spring DST transition", () => {
  assert.deepEqual(localDayUtcRange("2026-03-08", "America/New_York"), {
    since: "2026-03-08T05:00:00.000Z",
    until: "2026-03-09T04:00:00.000Z",
  });
});

test("nextScheduledAt returns the next selected local run", () => {
  assert.equal(
    nextScheduledAt({
      now: new Date("2026-07-30T03:00:00.000Z"),
      time: "09:15",
      days: [1, 3, 5],
      timezone: "Asia/Kathmandu",
    }),
    "2026-07-31T03:30:00.000Z",
  );
});

test("nextScheduledAt skips today's run after its scheduled time", () => {
  assert.equal(
    nextScheduledAt({
      now: new Date("2026-03-08T14:00:00.000Z"),
      time: "09:00",
      days: [7],
      timezone: "America/New_York",
    }),
    "2026-03-15T13:00:00.000Z",
  );
});
