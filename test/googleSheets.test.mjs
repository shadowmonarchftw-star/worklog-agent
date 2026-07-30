import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWorklogRow,
  extractSpreadsheetId,
  findDateRow,
  formatSheetDate,
  formatSheetRange,
} from "../lib/googleSheets.mjs";

test("extractSpreadsheetId reads id from normal Google Sheets URL", () => {
  assert.equal(
    extractSpreadsheetId("https://docs.google.com/spreadsheets/d/abc123DEF456/edit#gid=0"),
    "abc123DEF456",
  );
});

test("extractSpreadsheetId accepts raw spreadsheet id", () => {
  assert.equal(extractSpreadsheetId("abc123DEF456-_"), "abc123DEF456-_");
});

test("extractSpreadsheetId rejects invalid values", () => {
  assert.throws(() => extractSpreadsheetId("https://example.com/nope"), /spreadsheet id/i);
});

test("formatSheetDate matches office sheet date format", () => {
  assert.equal(formatSheetDate("2026-07-30"), "7/30/2026");
});

test("buildWorklogRow maps generated summary to office columns", () => {
  assert.deepEqual(
    buildWorklogRow({
      workDate: "2026-07-30",
      summary: "Fixed rate imports.",
      reference: "worklog-agent",
      hours: "8",
    }),
    ["7/30/2026", "Fixed rate imports.", "worklog-agent", "8", ""],
  );
});

test("findDateRow returns one-based row number", () => {
  assert.equal(findDateRow([["Date"], ["7/29/2026"], ["7/30/2026"]], "2026-07-30"), 3);
});

test("formatSheetRange quotes sheet tabs safely", () => {
  assert.equal(formatSheetRange("July Worklog", "A:E"), "'July Worklog'!A:E");
});
