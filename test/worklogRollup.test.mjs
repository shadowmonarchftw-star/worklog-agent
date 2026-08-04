import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRollupPrompt,
  rollupPeriodRange,
  selectRollupDays,
} from "../lib/worklogRollup.mjs";

test("a week runs Monday to Sunday around the reference date", () => {
  // 2026-08-04 is a Tuesday.
  assert.deepEqual(rollupPeriodRange({ period: "week", reference: "2026-08-04" }), {
    start: "2026-08-03",
    end: "2026-08-09",
  });
  // A Sunday belongs to the week that started six days earlier, not the next one.
  assert.deepEqual(rollupPeriodRange({ period: "week", reference: "2026-08-09" }), {
    start: "2026-08-03",
    end: "2026-08-09",
  });
});

test("a month runs from the first to the last day, including February in a leap year", () => {
  assert.deepEqual(rollupPeriodRange({ period: "month", reference: "2026-08-04" }), {
    start: "2026-08-01",
    end: "2026-08-31",
  });
  assert.deepEqual(rollupPeriodRange({ period: "month", reference: "2024-02-15" }), {
    start: "2024-02-01",
    end: "2024-02-29",
  });
});

test("rollupPeriodRange rejects an unusable period or reference date", () => {
  assert.throws(
    () => rollupPeriodRange({ period: "quarter", reference: "2026-08-04" }),
    /period must be week or month/i,
  );
  assert.throws(
    () => rollupPeriodRange({ period: "week", reference: "04/08/2026" }),
    /YYYY-MM-DD/,
  );
});

const history = [
  { workDate: "2026-08-05", summary: "Generated Wednesday.", editedSummary: "" },
  { workDate: "2026-08-03", summary: "Generated Monday.", editedSummary: "Rewritten Monday." },
  { workDate: "2026-08-10", summary: "Next week.", editedSummary: "" },
  { workDate: "2026-07-31", summary: "Last week.", editedSummary: "" },
];

test("selectRollupDays keeps the range in date order and prefers the user's rewrite", () => {
  assert.deepEqual(selectRollupDays(history, { start: "2026-08-03", end: "2026-08-09" }), [
    { workDate: "2026-08-03", summary: "Rewritten Monday." },
    { workDate: "2026-08-05", summary: "Generated Wednesday." },
  ]);
});

test("selectRollupDays drops days with nothing written", () => {
  assert.deepEqual(
    selectRollupDays(
      [
        { workDate: "2026-08-03", summary: "   ", editedSummary: "" },
        { workDate: "2026-08-04", summary: "Real work." },
      ],
      { start: "2026-08-03", end: "2026-08-09" },
    ),
    [{ workDate: "2026-08-04", summary: "Real work." }],
  );
});

test("buildRollupPrompt states the period and lists each day it was given", () => {
  const prompt = buildRollupPrompt({
    period: "week",
    start: "2026-08-03",
    end: "2026-08-09",
    days: [
      { workDate: "2026-08-03", summary: "Rewritten Monday." },
      { workDate: "2026-08-05", summary: "Generated Wednesday." },
    ],
  });

  assert.match(prompt.system, /week/i);
  assert.match(prompt.user, /2026-08-03/);
  assert.match(prompt.user, /Rewritten Monday/);
  assert.match(prompt.user, /Generated Wednesday/);
  assert.match(prompt.user, /2 day/);
  // Same grounding rule as the daily prompt: no invented outcomes.
  assert.match(prompt.system, /Do not invent/i);
  assert.match(prompt.user, /Do not use Markdown/i);
});

test("buildRollupPrompt carries the user's standing preference", () => {
  const prompt = buildRollupPrompt({
    period: "month",
    start: "2026-08-01",
    end: "2026-08-31",
    days: [{ workDate: "2026-08-03", summary: "Work." }],
    preference: "Mention the ticket number.",
  });

  assert.match(prompt.user, /Mention the ticket number/);
});

test("buildRollupPrompt refuses a period with no days", () => {
  assert.throws(
    () =>
      buildRollupPrompt({
        period: "week",
        start: "2026-08-03",
        end: "2026-08-09",
        days: [],
      }),
    /no summaries/i,
  );
});
