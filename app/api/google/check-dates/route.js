import { guardLocalRequest } from "../../../../lib/localRouteAuth.mjs";
import { getAppDb, getSetting, setSetting } from "../../../../lib/localDb.mjs";
import { readGoogleSheetRows } from "../../../../lib/googleSheetsProvider.mjs";

export async function POST(request) {
  const denied = guardLocalRequest(request, { mutation: true });
  if (denied) return denied;
  try {
    const { dates = [] } = await request.json();
    const db = getAppDb();
    const settings = getSetting(db, "app-settings") || {};
    const tokens = getSetting(db, "google-tokens");
    if (!tokens) return Response.json({ error: "Connect Google first." }, { status: 400 });
    const found = await readGoogleSheetRows({
      settings,
      tokens,
      workDates: dates,
      saveTokens: (next) => setSetting(db, "google-tokens", next),
    });
    const rows = Object.fromEntries(
      Object.entries(found).map(([date, row]) => [date, Boolean(row)]),
    );
    return Response.json({ rows });
  } catch (error) {
    return Response.json({ error: error.safeMessage || "Could not check Google Sheet dates." }, { status: 400 });
  }
}
