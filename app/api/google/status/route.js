import { getAppDb, getSetting } from "../../../../lib/localDb.mjs";

export async function GET() {
  const tokens = getSetting(getAppDb(), "google-tokens");
  return Response.json({ connected: Boolean(tokens?.refresh_token || tokens?.access_token) });
}
