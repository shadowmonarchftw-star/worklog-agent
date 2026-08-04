import { guardLocalRequest } from "../../../../lib/localRouteAuth.mjs";
import { getAppDb, getSetting, setSetting } from "../../../../lib/localDb.mjs";

const settingsKey = "app-settings";
const googleTokensKey = "google-tokens";
const redirectUri = "http://127.0.0.1:3000/api/google/callback";

export async function GET(request) {
  const denied = guardLocalRequest(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    return html(`Google connection failed: ${error}`);
  }

  if (!code) {
    return html("Google connection failed: missing code.");
  }

  const db = getAppDb();
  const settings = getSetting(db, settingsKey) || {};

  if (!settings.googleClientId || !settings.googleClientSecret) {
    return html("Google connection failed: missing Client ID or Client Secret in Settings.");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: settings.googleClientId,
      client_secret: settings.googleClientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    return html(`Google token exchange failed: ${await response.text()}`);
  }

  const tokens = await response.json();
  if (tokens.expires_in) {
    tokens.expires_at = Date.now() + tokens.expires_in * 1000;
  }
  setSetting(db, googleTokensKey, tokens);

  return html("Google connected. You can close this tab and return to AI Worklog Agent.");
}

function html(message) {
  return new Response(
    `<!doctype html><html><body style="font-family: monospace; padding: 24px;">${message}</body></html>`,
    { headers: { "Content-Type": "text/html" } },
  );
}
