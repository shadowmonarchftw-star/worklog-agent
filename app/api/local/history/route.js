import {
  deleteHistoryEntry,
  getAppDb,
  listHistory,
  saveHistoryEntry,
} from "../../../../lib/localDb.mjs";

export async function GET() {
  return Response.json({ history: listHistory(getAppDb()) });
}

export async function POST(request) {
  const { entry } = await request.json();
  saveHistoryEntry(getAppDb(), entry);
  return Response.json({ history: listHistory(getAppDb()) });
}

export async function DELETE(request) {
  const { id } = await request.json();
  deleteHistoryEntry(getAppDb(), id);
  return Response.json({ history: listHistory(getAppDb()) });
}
