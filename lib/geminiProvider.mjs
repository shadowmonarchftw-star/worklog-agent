import { buildSummaryPrompt, cleanSummaryText } from "./summaryPrompt.mjs";
import { buildRollupPrompt } from "./worklogRollup.mjs";
import { ProviderError } from "./providerError.mjs";

const FALLBACK_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-flash-latest",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
];

// Daily summaries and period rollups differ only in the prompt, so the model
// fallback ladder and the response shape live in one place.
async function requestGemini({ apiKey, prompt, model, signal, fetchImpl }) {
  const key = apiKey?.trim();
  if (!key) throw new Error("Missing Gemini API key.");
  const models = [...new Set([model, ...FALLBACK_MODELS].filter(Boolean))];
  let response;
  let usedModel;
  for (usedModel of models) {
    response = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${usedModel}:generateContent`,
      {
        method: "POST",
        signal,
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
  return {
    text: data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text).filter(Boolean).join("\n").trim(),
    model: usedModel,
  };
}

export async function generateGeminiSummary({
  apiKey,
  workDate,
  style,
  activity,
  preference,
  examples,
  model,
  signal,
  fetchImpl = fetch,
}) {
  const prompt = buildSummaryPrompt({
    workDate,
    style,
    activity,
    preference,
    examples,
  });
  const { text, model: usedModel } = await requestGemini({
    apiKey, prompt, model, signal, fetchImpl,
  });
  return {
    summary: text
      ? cleanSummaryText(text, { preserveBullets: style === "bullet-points" })
      : "No summary returned.",
    model: usedModel,
  };
}

export async function generateGeminiRollup({
  apiKey,
  period,
  start,
  end,
  days,
  preference,
  model,
  signal,
  fetchImpl = fetch,
}) {
  const prompt = buildRollupPrompt({ period, start, end, days, preference });
  const { text, model: usedModel } = await requestGemini({
    apiKey, prompt, model, signal, fetchImpl,
  });
  return {
    summary: text ? cleanSummaryText(text) : "No summary returned.",
    model: usedModel,
  };
}

export const geminiProvider = {
  generateSummary: generateGeminiSummary,
  generateRollup: generateGeminiRollup,
};
