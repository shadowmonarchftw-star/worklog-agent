import { buildSummaryPrompt, cleanSummaryText } from "./summaryPrompt.mjs";
import { ProviderError } from "./providerError.mjs";

const FALLBACK_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-flash-latest",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
];

export async function generateGeminiSummary({
  apiKey,
  workDate,
  style,
  activity,
  model,
  fetchImpl = fetch,
}) {
  const key = apiKey?.trim();
  if (!key) throw new Error("Missing Gemini API key.");
  const prompt = buildSummaryPrompt({ workDate, style, activity });
  const models = [...new Set([model, ...FALLBACK_MODELS].filter(Boolean))];
  let response;
  let usedModel;
  for (usedModel of models) {
    response = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${usedModel}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: prompt.system }] },
          contents: [{ role: "user", parts: [{ text: prompt.user }] }],
        }),
      },
    );
    if (response.ok) break;
    await response.text().catch(() => "");
    if (![429, 503].includes(response.status)) break;
  }
  if (!response?.ok) {
    throw new ProviderError("gemini", "Gemini request failed.");
  }
  const data = await response.json();
  const summary = data.candidates?.[0]?.content?.parts
    ?.map((part) => part.text).filter(Boolean).join("\n").trim();
  return {
    summary: summary
      ? cleanSummaryText(summary, { preserveBullets: style === "bullet-points" })
      : "No summary returned.",
    model: usedModel,
  };
}

export const geminiProvider = { generateSummary: generateGeminiSummary };
