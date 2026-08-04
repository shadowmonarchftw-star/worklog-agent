import { guardLocalRequest } from "../../../lib/localRouteAuth.mjs";
import { generateGeminiRollup } from "../../../lib/geminiProvider.mjs";
import { generateLocalRollup } from "../../../lib/localModelProvider.mjs";
import { getAppDb, getSetting, listHistory } from "../../../lib/localDb.mjs";
import { rollupPeriodRange, selectRollupDays } from "../../../lib/worklogRollup.mjs";
import { summaryProviderName } from "../../../lib/worklogService.mjs";

export async function POST(request) {
  const denied = guardLocalRequest(request, { mutation: true });
  if (denied) return denied;
  try {
    const body = await request.json();
    const { start, end } = rollupPeriodRange({
      period: body.period,
      reference: body.reference,
    });

    // The days come from the local database rather than the request so a rollup
    // can never be asked to summarise text the app did not generate.
    const db = getAppDb();
    const settings = getSetting(db, "app-settings") || {};
    const days = selectRollupDays(listHistory(db), { start, end });
    if (!days.length) {
      return Response.json(
        { error: "There are no saved summaries in this period yet." },
        { status: 400 },
      );
    }

    const shared = {
      period: body.period,
      start,
      end,
      days,
      preference: settings.summaryPreference,
    };

    if (summaryProviderName(settings) === "local") {
      if (!settings.localModelName?.trim()) {
        return Response.json(
          { error: "Missing local model name. Set one in Settings, then try again." },
          { status: 500 },
        );
      }
      const generated = await generateLocalRollup({
        ...shared,
        baseUrl: settings.localModelBaseUrl,
        model: settings.localModelName,
        apiKey: settings.localModelApiKey,
      });
      return Response.json({ ...generated, start, end, dayCount: days.length });
    }

    const geminiApiKey = settings.geminiApiKey?.trim() || process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      return Response.json(
        {
          error:
            "Missing Gemini API key. Paste one in the app or add GEMINI_API_KEY to .env.local, then try again.",
        },
        { status: 500 },
      );
    }

    const generated = await generateGeminiRollup({
      ...shared,
      apiKey: geminiApiKey,
      model: process.env.GEMINI_MODEL,
    });
    return Response.json({ ...generated, start, end, dayCount: days.length });
  } catch (error) {
    const status = ["gemini", "local_model"].includes(error.category) ? 502 : 400;
    return Response.json({ error: error.safeMessage || error.message }, { status });
  }
}
