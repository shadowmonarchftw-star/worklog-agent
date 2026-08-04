import assert from "node:assert/strict";
import test from "node:test";

import { generateGeminiRollup, generateGeminiSummary } from "../lib/geminiProvider.mjs";

const BASE = {
  apiKey: "test-key",
  model: "gemini-3.6-flash",
  workDate: "2026-08-04",
  style: "concise",
  activity: "- Fixed the scheduler guard",
};

// Captures the prompt Gemini was actually sent, so a field dropped between the
// route and buildSummaryPrompt cannot pass unnoticed.
function capturingFetch(sent) {
  return async (_url, options) => {
    sent.push(JSON.parse(options.body));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "Fixed the scheduler guard." }] } }],
      }),
      text: async () => "",
    };
  };
}

test("forwards the user's style preference into the prompt", async () => {
  const sent = [];

  await generateGeminiSummary({
    ...BASE,
    preference: "Always mention the ticket number.",
    fetchImpl: capturingFetch(sent),
  });

  assert.match(sent[0].contents[0].parts[0].text, /Always mention the ticket number/);
});

test("forwards rewritten summaries as voice examples", async () => {
  const sent = [];

  await generateGeminiSummary({
    ...BASE,
    examples: ["Shipped the login form."],
    fetchImpl: capturingFetch(sent),
  });

  const prompt = sent[0].contents[0].parts[0].text;
  assert.match(prompt, /rewrote/i);
  assert.match(prompt, /Shipped the login form/);
});

test("keeps the API key out of the prompt body", async () => {
  const sent = [];

  await generateGeminiSummary({ ...BASE, fetchImpl: capturingFetch(sent) });

  assert.doesNotMatch(JSON.stringify(sent[0]), /test-key/);
});

test("generateGeminiRollup sends the period prompt and cleans the answer", async () => {
  const sent = [];

  const result = await generateGeminiRollup({
    apiKey: "test-key",
    model: "gemini-3.6-flash",
    period: "week",
    start: "2026-08-03",
    end: "2026-08-09",
    days: [{ workDate: "2026-08-03", summary: "Shipped the export fix." }],
    fetchImpl: capturingFetch(sent),
  });

  const prompt = sent[0].contents[0].parts[0].text;
  assert.match(prompt, /week of 2026-08-03 to 2026-08-09/);
  assert.match(prompt, /Shipped the export fix/);
  assert.equal(result.summary, "Fixed the scheduler guard.");
});
