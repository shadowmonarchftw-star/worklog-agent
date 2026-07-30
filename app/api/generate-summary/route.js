import { buildSummaryPrompt, cleanSummaryText } from "../../../lib/summaryPrompt.mjs";

export async function POST(request) {
  try {
    const body = await request.json();
    const prompt = buildSummaryPrompt(body);
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

    const models = [
      process.env.GEMINI_MODEL,
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-flash-latest",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
    ].filter(Boolean);

    let response;
    let errorText = "";
    let usedModel = "";

    for (const model of models) {
      usedModel = model;
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "x-goog-api-key": geminiApiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: prompt.system }],
            },
            contents: [
              {
                role: "user",
                parts: [{ text: prompt.user }],
              },
            ],
          }),
        },
      );

      if (response.ok) {
        break;
      }

      errorText = await response.text();
      if (![429, 503].includes(response.status)) {
        break;
      }
    }

    if (!response?.ok) {
      return Response.json(
        { error: `Gemini request failed: ${errorText}` },
        { status: 502 },
      );
    }

    const data = await response.json();
    const summary = data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text)
      ?.filter(Boolean)
      ?.join("\n")
      ?.trim();

    return Response.json({
      summary: summary
        ? cleanSummaryText(summary, { preserveBullets: body.style === "bullet-points" })
        : "No summary returned.",
      model: usedModel,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }
}
