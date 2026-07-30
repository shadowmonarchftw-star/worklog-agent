import {
  extractSpreadsheetId,
  findDateRow,
  formatSheetRange,
  normalizeSheetTab,
} from "./googleSheets.mjs";
import { ProviderError } from "./providerError.mjs";

function rowObject(row) {
  if (!row) return null;
  return {
    date: String(row[0] ?? ""),
    summary: String(row[1] ?? ""),
    reference: String(row[2] ?? ""),
    hours: String(row[3] ?? ""),
    comments: String(row[4] ?? ""),
  };
}

function rowValues(row) {
  return [row.date, row.summary, row.reference, row.hours, row.comments];
}

async function accessToken({ settings, tokens, fetchImpl, saveTokens }) {
  if (tokens.expires_at > Date.now() + 60_000 && tokens.access_token) {
    return tokens.access_token;
  }
  if (!tokens.refresh_token) return tokens.access_token;
  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
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
  const next = { ...tokens, ...refreshed, expires_at: Date.now() + refreshed.expires_in * 1000 };
  await saveTokens?.(next);
  return next.access_token;
}

async function request({ accessToken: token, path, method = "GET", body, fetchImpl }) {
  const response = await fetchImpl(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
    method,
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
  const spreadsheetId = extractSpreadsheetId(input.settings.googleSheetLink);
  const tab = normalizeSheetTab(input.settings.googleSheetTab);
  const token = await accessToken(input);
  const path = `${spreadsheetId}/values/${encodeURIComponent(formatSheetRange(tab, "A:E"))}`;
  const response = await request({ accessToken: token, path, fetchImpl: input.fetchImpl || fetch });
  const data = await response.json();
  return { spreadsheetId, tab, token, values: data.values || [], fetchImpl: input.fetchImpl || fetch };
}

export async function readGoogleSheetRow(input) {
  const data = await context(input);
  const number = findDateRow(data.values, input.workDate);
  return number ? rowObject(data.values[number - 1]) : null;
}

export async function upsertGoogleSheetRow(input) {
  const data = await context(input);
  const number = findDateRow(data.values, input.workDate);
  const range = number ? `A${number}:E${number}` : "A:E";
  const suffix = number
    ? "?valueInputOption=USER_ENTERED"
    : ":append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS";
  await request({
    accessToken: data.token,
    path: `${data.spreadsheetId}/values/${encodeURIComponent(formatSheetRange(data.tab, range))}${suffix}`,
    method: number ? "PUT" : "POST",
    body: { values: [rowValues(input.row)] },
    fetchImpl: data.fetchImpl,
  });
  return number
    ? { action: "updated", rowNumber: number }
    : { action: "appended" };
}

export const googleSheetsProvider = {
  readRow: readGoogleSheetRow,
  upsertRow: upsertGoogleSheetRow,
};
