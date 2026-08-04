import { guardLocalRequest } from "../../../../lib/localRouteAuth.mjs";
import { getAppDb, getSetting } from "../../../../lib/localDb.mjs";

export async function GET(request) {
  const denied = guardLocalRequest(request);
  if (denied) return denied;
  const tokens = getSetting(getAppDb(), "google-tokens");
  return Response.json({ connected: Boolean(tokens?.refresh_token || tokens?.access_token) });
}
