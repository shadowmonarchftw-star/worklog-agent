import {
  buildWorklogRow,
  extractSpreadsheetId,
  findDateRow,
  formatSheetRange,
  normalizeSheetTab,
} from "../../../../lib/googleSheets.mjs";
import { getAppDb, getSetting, setSetting } from "../../../../lib/localDb.mjs";

const settingsKey = "app-settings";
const googleTokensKey = "google-tokens";

export async function POST(request) {
  try {
    const { workDate, summary, reference } = await request.json();
    const db = getAppDb();
    const settings = getSetting(db, settingsKey) || {};
    const tokens = getSetting(db, googleTokensKey);

    if (!tokens) {
      return Response.json({ error: "Connect Google first." }, { status: 400 });
    }

    const spreadsheetId = extractSpreadsheetId(settings.googleSheetLink);
    const sheetTab = normalizeSheetTab(settings.googleSheetTab);
    const accessToken = await getAccessToken({ db, settings, tokens });
    const row = buildWorklogRow({
      workDate,
      summary,
      reference,
      hours: settings.defaultHours || "8",
    });

    const valuesResponse = await sheetsFetch({
      accessToken,
      path: `${spreadsheetId}/values/${encodeURIComponent(formatSheetRange(sheetTab, "A:E"))}`,
    });

    const valuesData = await valuesResponse.json();
    const rowNumber = findDateRow(valuesData.values || [], workDate);

    if (rowNumber) {
      await sheetsFetch({
        accessToken,
        path: `${spreadsheetId}/values/${encodeURIComponent(formatSheetRange(sheetTab, `A${rowNumber}:E${rowNumber}`))}?valueInputOption=USER_ENTERED`,
        method: "PUT",
        body: { values: [row] },
      });
      return Response.json({ ok: true, action: "updated", rowNumber });
    }

    await sheetsFetch({
      accessToken,
      path: `${spreadsheetId}/values/${encodeURIComponent(formatSheetRange(sheetTab, "A:E"))}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      method: "POST",
      body: { values: [row] },
    });

    return Response.json({ ok: true, action: "appended" });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }
}

async function getAccessToken({ db, settings, tokens }) {
  if (tokens.expires_at && tokens.expires_at > Date.now() + 60_000 && tokens.access_token) {
    return tokens.access_token;
  }

  if (!tokens.refresh_token) {
    return tokens.access_token;
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
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
    throw new Error(`Google token refresh failed: ${await response.text()}`);
  }

  const refreshed = await response.json();
  const nextTokens = {
    ...tokens,
    ...refreshed,
    expires_at: Date.now() + refreshed.expires_in * 1000,
  };
  setSetting(db, googleTokensKey, nextTokens);
  return nextTokens.access_token;
}

async function sheetsFetch({ accessToken, path, method = "GET", body }) {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    throw new Error(`Google Sheets request failed: ${await response.text()}`);
  }

  return response;
}
