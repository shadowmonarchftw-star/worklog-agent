import { getAppDb, getSetting, setSetting } from "../../../../lib/localDb.mjs";

const settingsKey = "app-settings";

export async function GET() {
  const settings = getSetting(getAppDb(), settingsKey) || {};
  return Response.json({ settings });
}

export async function POST(request) {
  const { settings } = await request.json();
  setSetting(getAppDb(), settingsKey, settings || {});
  return Response.json({ ok: true });
}
