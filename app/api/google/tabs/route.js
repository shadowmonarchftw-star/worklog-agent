import { extractSpreadsheetId } from "../../../../lib/googleSheets.mjs";
import { getAppDb, getSetting } from "../../../../lib/localDb.mjs";

export async function GET() {
  try {
    const db = getAppDb();
    const settings = getSetting(db, "app-settings") || {};
    const tokens = getSetting(db, "google-tokens");
    if (!tokens?.access_token) return Response.json({ error: "Connect Google first." }, { status: 400 });
    const id = extractSpreadsheetId(settings.googleSheetLink);
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties`, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    if (!response.ok) return Response.json({ error: "Could not load spreadsheet tabs." }, { status: 400 });
    const data = await response.json();
    return Response.json({ tabs: (data.sheets || []).map((sheet) => sheet.properties?.title).filter(Boolean) });
  } catch (error) { return Response.json({ error: error.safeMessage || error.message }, { status: 400 }); }
}
