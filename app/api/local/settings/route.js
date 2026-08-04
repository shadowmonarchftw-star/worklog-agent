import { guardLocalRequest } from "../../../../lib/localRouteAuth.mjs";
import { getAppDb, getSetting, setSetting } from "../../../../lib/localDb.mjs";
import { UNREADABLE_CREDENTIALS_FIELD } from "../../../../lib/secureSettings.mjs";

const settingsKey = "app-settings";

export async function GET(request) {
  const denied = guardLocalRequest(request);
  if (denied) return denied;
  const settings = getSetting(getAppDb(), settingsKey) || {};
  return Response.json({ settings });
}

export async function POST(request) {
  const denied = guardLocalRequest(request, { mutation: true });
  if (denied) return denied;
  const { settings } = await request.json();
  // Never persist the read-time diagnostic marker back into stored settings.
  const { [UNREADABLE_CREDENTIALS_FIELD]: _ignored, ...clean } = settings || {};
  setSetting(getAppDb(), settingsKey, clean);
  return Response.json({ ok: true });
}
