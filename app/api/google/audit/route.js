import { guardLocalRequest } from "../../../../lib/localRouteAuth.mjs";
import { getAppDb, listSheetWrites } from "../../../../lib/localDb.mjs";
export async function GET(request) {
  const denied = guardLocalRequest(request);
  if (denied) return denied;
  return Response.json({ writes: listSheetWrites(getAppDb()) });
}
