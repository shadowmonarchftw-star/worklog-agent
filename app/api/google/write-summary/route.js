import { upsertGoogleSheetRow } from "../../../../lib/googleSheetsProvider.mjs";
import { buildWorklogRow } from "../../../../lib/googleSheets.mjs";
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

    const values = buildWorklogRow({
      workDate,
      summary,
      reference,
      hours: settings.defaultHours || "8",
    });
    const result = await upsertGoogleSheetRow({
      settings,
      tokens,
      workDate,
      row: {
        date: values[0], summary: values[1], reference: values[2],
        hours: values[3], comments: values[4],
      },
      saveTokens: (nextTokens) => setSetting(db, googleTokensKey, nextTokens),
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json({ error: error.safeMessage || error.message }, { status: 400 });
  }
}
