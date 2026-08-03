import { getAppDb, listSheetWrites } from "../../../../lib/localDb.mjs";
export async function GET() { return Response.json({ writes: listSheetWrites(getAppDb()) }); }
