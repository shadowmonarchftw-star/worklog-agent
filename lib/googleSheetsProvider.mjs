import {
  columnIndex,
  extractSpreadsheetId,
  findDateRow,
  formatSheetRange,
  normalizeSheetColumn,
  normalizeSheetTab,
} from "./googleSheets.mjs";
import { ProviderError } from "./providerError.mjs";

const defaultMapping = Object.freeze({ date: "A", summary: "B", hours: "D", reference: "" });

function rowObject(row, mapping) {
  if (!row) return null;
  return {
    date: String(row[columnIndex(mapping.date)] ?? ""),
    summary: String(row[columnIndex(mapping.summary)] ?? ""),
    reference: String(row[columnIndex(mapping.reference)] ?? ""),
    hours: String(row[columnIndex(mapping.hours)] ?? ""),
  };
}

export function buildSheetWriteData({ tab, rowNumber, includeDate, row, mapping: supplied }) {
  const mapping = normalizeMapping(supplied || defaultMapping);
  const data = [];
  if (includeDate) data.push({ range: formatSheetRange(tab, `${mapping.date}${rowNumber}`), values: [[row.date]] });
  data.push({ range: formatSheetRange(tab, `${mapping.summary}${rowNumber}`), values: [[row.summary]] });
  data.push({ range: formatSheetRange(tab, `${mapping.hours}${rowNumber}`), values: [[row.hours]] });
  if (mapping.reference) data.push({ range: formatSheetRange(tab, `${mapping.reference}${rowNumber}`), values: [[row.reference]] });
  return data;
}

function normalizeMapping(mapping) {
  try {
    return {
      date: normalizeSheetColumn(mapping.date) || defaultMapping.date,
      summary: normalizeSheetColumn(mapping.summary) || defaultMapping.summary,
      hours: normalizeSheetColumn(mapping.hours) || defaultMapping.hours,
      reference: normalizeSheetColumn(mapping.reference),
    };
  } catch (error) {
    throw new ProviderError("google_sheets", error.message);
  }
}

function sheetMapping(settings) {
  return normalizeMapping({
    date: settings.googleDateColumn,
    summary: settings.googleSummaryColumn,
    hours: settings.googleHoursColumn,
    reference: settings.googleReferenceColumn,
  });
}

async function accessToken({ settings, tokens, fetchImpl, saveTokens, signal }) {
  if (tokens.expires_at > Date.now() + 60_000 && tokens.access_token) {
    return tokens.access_token;
  }
  if (!tokens.refresh_token) return tokens.access_token;
  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: settings.googleClientId,
      client_secret: settings.googleClientSecret,
      refresh_token: tokens.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) {
    await response.text().catch(() => "");
    throw new ProviderError("google_oauth", "Google token refresh failed.");
  }
  const refreshed = await response.json();
  signal?.throwIfAborted();
  const next = { ...tokens, ...refreshed, expires_at: Date.now() + refreshed.expires_in * 1000 };
  await saveTokens?.(next);
  return next.access_token;
}

async function request({
  accessToken: token,
  path,
  method = "GET",
  body,
  fetchImpl,
  signal,
}) {
  const response = await fetchImpl(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
    method,
    signal,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    await response.text().catch(() => "");
    throw new ProviderError("google_sheets", "Google Sheets request failed.");
  }
  return response;
}

async function context(input) {
  const fetchImpl = input.fetchImpl || fetch;
  const spreadsheetId = extractSpreadsheetId(input.settings.googleSheetLink);
  const tab = normalizeSheetTab(input.settings.googleSheetTab);
  const token = await accessToken({ ...input, fetchImpl });
  const path = `${spreadsheetId}/values/${encodeURIComponent(formatSheetRange(tab, "A:ZZ"))}`;
  const response = await request({
    accessToken: token,
    path,
    fetchImpl,
    signal: input.signal,
  });
  const data = await response.json();
  return { spreadsheetId, tab, token, values: data.values || [], fetchImpl, mapping: sheetMapping(input.settings) };
}

export async function readGoogleSheetRow(input) {
  const data = await context(input);
  const number = findDateRow(data.values, input.workDate, columnIndex(data.mapping.date));
  return number ? rowObject(data.values[number - 1], data.mapping) : null;
}

export async function readGoogleSheetRows(input) {
  const data = await context(input);
  const dateIndex = columnIndex(data.mapping.date);
  return Object.fromEntries((input.workDates || []).map((workDate) => {
    const number = findDateRow(data.values, workDate, dateIndex);
    return [workDate, number ? rowObject(data.values[number - 1], data.mapping) : null];
  }));
}

export async function inspectGoogleSheet(input) {
  const data = await context(input);
  const headerRow = data.values.find((row) => {
    const cells = row.map((cell) => String(cell || "").trim().toLowerCase());
    return cells.includes("date") && (cells.includes("task") || cells.includes("summary")) && cells.includes("hours");
  });
  if (!headerRow) throw new ProviderError("google_sheets", "Sheet headers not found. Expected Date, Task, and Hours.");
  return { tab: data.tab, headers: headerRow };
}

export async function upsertGoogleSheetRow(input) {
  const data = await context(input);
  const number = findDateRow(data.values, input.workDate, columnIndex(data.mapping.date));
  const rowNumber = number || data.values.length + 1;
  await request({
    accessToken: data.token,
    path: `${data.spreadsheetId}/values:batchUpdate`,
    method: "POST",
    body: {
      valueInputOption: "USER_ENTERED",
      data: buildSheetWriteData({
        tab: data.tab,
        rowNumber,
        includeDate: !number,
        row: input.row,
        mapping: data.mapping,
      }),
    },
    fetchImpl: data.fetchImpl,
    signal: input.signal,
  });
  return number
    ? { action: "updated", rowNumber: number }
    : { action: "appended", rowNumber };
}

export const googleSheetsProvider = {
  readRow: readGoogleSheetRow,
  upsertRow: upsertGoogleSheetRow,
};
