import { guardLocalRequest } from "../../../../lib/localRouteAuth.mjs";
import {
  deleteHistoryEntry,
  getAppDb,
  listHistory,
  saveHistoryEntry,
} from "../../../../lib/localDb.mjs";

export async function GET(request) {
  const denied = guardLocalRequest(request);
  if (denied) return denied;
  return Response.json({ history: listHistory(getAppDb()) });
}

export async function POST(request) {
  const denied = guardLocalRequest(request, { mutation: true });
  if (denied) return denied;
  const { entry } = await request.json();
  saveHistoryEntry(getAppDb(), entry);
  return Response.json({ history: listHistory(getAppDb()) });
}

export async function DELETE(request) {
  const denied = guardLocalRequest(request, { mutation: true });
  if (denied) return denied;
  const { id } = await request.json();
  deleteHistoryEntry(getAppDb(), id);
  return Response.json({ history: listHistory(getAppDb()) });
}
