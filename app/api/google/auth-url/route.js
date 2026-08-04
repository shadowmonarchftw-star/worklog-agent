import { guardLocalRequest } from "../../../../lib/localRouteAuth.mjs";
import { getAppDb, getSetting } from "../../../../lib/localDb.mjs";

const settingsKey = "app-settings";
const redirectUri = "http://127.0.0.1:3000/api/google/callback";

export async function GET(request) {
  const denied = guardLocalRequest(request);
  if (denied) return denied;
  const settings = getSetting(getAppDb(), settingsKey) || {};

  if (!settings.googleClientId) {
    return Response.json({ error: "Missing Google Client ID in Settings." }, { status: 400 });
  }

  const params = new URLSearchParams({
    client_id: settings.googleClientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/spreadsheets",
    access_type: "offline",
    prompt: "consent",
  });

  return Response.json({
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
  });
}
