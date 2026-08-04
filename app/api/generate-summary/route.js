import { guardLocalRequest } from "../../../lib/localRouteAuth.mjs";
import { generateGeminiSummary } from "../../../lib/geminiProvider.mjs";
import { generateLocalSummary } from "../../../lib/localModelProvider.mjs";
import { getAppDb, listSummaryExamples } from "../../../lib/localDb.mjs";
import { summaryProviderName } from "../../../lib/worklogService.mjs";

export async function POST(request) {
  const denied = guardLocalRequest(request, { mutation: true });
  if (denied) return denied;
  try {
    const body = await request.json();
    const style = body.style?.trim() || "concise";
    const shared = {
      workDate: body.workDate,
      style: body.style,
      activity: body.activity,
      preference: body.preference,
      // Read here rather than sent by the client: the rewrites live in the same
      // local database, and the browser has no reason to carry them twice.
      examples: listSummaryExamples(getAppDb(), { style }),
    };

    if (summaryProviderName(body) === "local") {
      if (!body.localModelName?.trim()) {
        return Response.json(
          { error: "Missing local model name. Set one in Settings, then try again." },
          { status: 500 },
        );
      }
      return Response.json(await generateLocalSummary({
        ...shared,
        baseUrl: body.localModelBaseUrl,
        model: body.localModelName,
        apiKey: body.localModelApiKey,
      }));
    }

    const geminiApiKey = body.geminiApiKey?.trim() || process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      return Response.json(
        {
          error:
            "Missing Gemini API key. Paste one in the app or add GEMINI_API_KEY to .env.local, then try again.",
        },
        { status: 500 },
      );
    }

    return Response.json(await generateGeminiSummary({
      ...shared,
      apiKey: geminiApiKey,
      model: process.env.GEMINI_MODEL,
    }));
  } catch (error) {
    const status = ["gemini", "local_model"].includes(error.category) ? 502 : 400;
    return Response.json({ error: error.safeMessage || error.message }, { status });
  }
}
