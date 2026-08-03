export function extractSpreadsheetId(value) {
  const cleanValue = value?.trim();

  if (!cleanValue) {
    throw new Error("Google spreadsheet id or link is required.");
  }

  const urlMatch = cleanValue.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch?.[1]) {
    return urlMatch[1];
  }

  if (/^[a-zA-Z0-9-_]{10,}$/.test(cleanValue)) {
    return cleanValue;
  }

  throw new Error("Could not find a Google spreadsheet id in that link.");
}

export function formatSheetDate(workDate) {
  const [year, month, day] = workDate.split("-").map(Number);
  return `${month}/${day}/${year}`;
}

export function buildWorklogRow({ workDate, summary, reference = "", hours = "8" }) {
  return [formatSheetDate(workDate), summary, reference, String(hours || ""), ""];
}

export function findDateRow(values, workDate, dateIndex = 0) {
  const target = formatSheetDate(workDate);
  const index = values.findIndex((row) => row?.[dateIndex] === target);
  return index === -1 ? null : index + 1;
}

export function normalizeSheetColumn(column) {
  const value = String(column ?? "").trim().toUpperCase();
  if (!value) return "";
  if (!/^[A-Z]{1,2}$/.test(value)) {
    throw new Error(`"${column}" is not a valid sheet column. Use A through ZZ.`);
  }
  return value;
}

export function columnIndex(column) {
  const value = normalizeSheetColumn(column);
  if (!value) return null;
  return [...value].reduce((total, letter) => total * 26 + (letter.charCodeAt(0) - 64), 0) - 1;
}

export function normalizeSheetTab(tabName) {
  return tabName?.trim() || "Sheet1";
}

export function formatSheetRange(tabName, range) {
  const safeTab = normalizeSheetTab(tabName).replace(/'/g, "''");
  return `'${safeTab}'!${range}`;
}
