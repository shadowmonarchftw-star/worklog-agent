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

export function findDateRow(values, workDate) {
  const target = formatSheetDate(workDate);
  const index = values.findIndex((row) => row?.[0] === target);
  return index === -1 ? null : index + 1;
}

export function normalizeSheetTab(tabName) {
  return tabName?.trim() || "Sheet1";
}

export function formatSheetRange(tabName, range) {
  const safeTab = normalizeSheetTab(tabName).replace(/'/g, "''");
  return `'${safeTab}'!${range}`;
}
