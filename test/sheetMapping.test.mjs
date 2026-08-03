import assert from "node:assert/strict";
import test from "node:test";

import { columnIndex, findDateRow, normalizeSheetColumn } from "../lib/googleSheets.mjs";
import { buildSheetWriteData } from "../lib/googleSheetsProvider.mjs";

test("column letters convert to zero-based indexes", () => {
  assert.equal(columnIndex("A"), 0);
  assert.equal(columnIndex("E"), 4);
  assert.equal(columnIndex("Z"), 25);
});

test("two-letter columns are not silently collapsed onto column A", () => {
  assert.equal(columnIndex("AA"), 26);
  assert.equal(columnIndex("AB"), 27);
  assert.equal(columnIndex("ZZ"), 701);
});

test("column input is trimmed and case-insensitive", () => {
  assert.equal(normalizeSheetColumn(" b "), "B");
  assert.equal(columnIndex("b"), 1);
});

test("an empty column means unmapped", () => {
  assert.equal(normalizeSheetColumn(""), "");
  assert.equal(columnIndex(null), null);
});

test("invalid columns are rejected instead of writing to the wrong cell", () => {
  assert.throws(() => normalizeSheetColumn("A1"), /not a valid sheet column/);
  assert.throws(() => normalizeSheetColumn("1"), /not a valid sheet column/);
  assert.throws(() => normalizeSheetColumn("AAA"), /not a valid sheet column/);
});

test("findDateRow honours a non-default date column", () => {
  const values = [["x", "Date"], ["x", "7/29/2026"], ["x", "7/30/2026"]];
  assert.equal(findDateRow(values, "2026-07-30", 1), 3);
  assert.equal(findDateRow(values, "2026-07-30", 0), null);
});

test("sheet writes follow a custom column mapping", () => {
  assert.deepEqual(
    buildSheetWriteData({
      tab: "Sheet1",
      rowNumber: 4,
      includeDate: true,
      row: { date: "7/30/2026", summary: "Shipped importer.", reference: "GitHub", hours: "8" },
      mapping: { date: "B", summary: "C", hours: "F", reference: "G" },
    }),
    [
      { range: "'Sheet1'!B4", values: [["7/30/2026"]] },
      { range: "'Sheet1'!C4", values: [["Shipped importer."]] },
      { range: "'Sheet1'!F4", values: [["8"]] },
      { range: "'Sheet1'!G4", values: [["GitHub"]] },
    ],
  );
});

test("an unmapped reference column is never written", () => {
  const ranges = buildSheetWriteData({
    tab: "Sheet1",
    rowNumber: 2,
    includeDate: false,
    row: { date: "7/30/2026", summary: "Work.", reference: "GitHub", hours: "8" },
    mapping: { date: "A", summary: "B", hours: "D", reference: "" },
  }).map((entry) => entry.range);
  assert.deepEqual(ranges, ["'Sheet1'!B2", "'Sheet1'!D2"]);
});

test("sheet writes reject an invalid mapping rather than guessing", () => {
  assert.throws(
    () => buildSheetWriteData({
      tab: "Sheet1",
      rowNumber: 2,
      includeDate: false,
      row: { date: "7/30/2026", summary: "Work.", hours: "8" },
      mapping: { date: "A", summary: "B2", hours: "D", reference: "" },
    }),
    /not a valid sheet column/,
  );
});
