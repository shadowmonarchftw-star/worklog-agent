import { generateGeminiSummary } from "../../../lib/geminiProvider.mjs";

export async function POST(request) {
  try {
    const body = await request.json();
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
      apiKey: geminiApiKey,
      workDate: body.workDate,
      style: body.style,
      activity: body.activity,
      preference: body.preference,
      model: process.env.GEMINI_MODEL,
    }));
  } catch (error) {
    const status = error.category === "gemini" ? 502 : 400;
    return Response.json({ error: error.safeMessage || error.message }, { status });
  }
}
