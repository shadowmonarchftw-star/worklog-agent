import assert from "node:assert/strict";
import test from "node:test";

import { enumerateDates } from "../lib/localDate.mjs";

test("enumerateDates walks each calendar day inclusively", () => {
  assert.deepEqual(
    enumerateDates("2026-07-29", "2026-08-02"),
    ["2026-07-29", "2026-07-30", "2026-07-31", "2026-08-01", "2026-08-02"],
  );
});

test("a single-day range returns that day", () => {
  assert.deepEqual(enumerateDates("2026-07-30", "2026-07-30"), ["2026-07-30"]);
});

test("an inverted range returns nothing", () => {
  assert.deepEqual(enumerateDates("2026-07-30", "2026-07-29"), []);
});

test("enumerateDates crosses a leap day", () => {
  assert.deepEqual(
    enumerateDates("2028-02-27", "2028-03-01"),
    ["2028-02-27", "2028-02-28", "2028-02-29", "2028-03-01"],
  );
});

test("enumerateDates crosses a year boundary", () => {
  assert.deepEqual(
    enumerateDates("2026-12-30", "2027-01-02"),
    ["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"],
  );
});

test("results do not shift in far-east or far-west timezones", () => {
  const expected = ["2026-07-29", "2026-07-30", "2026-07-31"];
  const previous = process.env.TZ;
  try {
    for (const timezone of ["Pacific/Kiritimati", "Etc/GMT+12", "UTC", "Asia/Kolkata"]) {
      process.env.TZ = timezone;
      assert.deepEqual(enumerateDates("2026-07-29", "2026-07-31"), expected, timezone);
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("results do not skip or repeat across a DST transition", () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = "America/New_York";
    assert.deepEqual(
      enumerateDates("2026-03-07", "2026-03-10"),
      ["2026-03-07", "2026-03-08", "2026-03-09", "2026-03-10"],
    );
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("enumerateDates rejects malformed dates", () => {
  assert.throws(() => enumerateDates("7/29/2026", "2026-07-31"), /YYYY-MM-DD/);
  assert.throws(() => enumerateDates("2026-07-29", ""), /YYYY-MM-DD/);
});
