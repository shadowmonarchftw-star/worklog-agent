import { buildSummaryPrompt, cleanSummaryText } from "./summaryPrompt.mjs";
import { buildRollupPrompt } from "./worklogRollup.mjs";
import { ProviderError } from "./providerError.mjs";

// A local model runs on the user's own hardware, so it is far slower than a
// hosted API. Nothing else bounds this call: the automation lease is renewed
// while a run is in flight, so a stalled server would hold the attempt open
// until interruptStale reaps it half an hour later.
const DEFAULT_TIMEOUT_MS = 120_000;

export const LOCAL_MODEL_DEFAULT_BASE_URL = "http://127.0.0.1:11434/v1";

function completionsUrl(baseUrl) {
  return `${String(baseUrl).trim().replace(/\/+$/, "")}/chat/completions`;
}

function displayHost(baseUrl) {
  try {
    return new URL(baseUrl).host;
  } catch {
    return String(baseUrl);
  }
}

// Daily summaries and period rollups differ only in the prompt, so the timeout,
// reachability, and credential handling stay in one place.
async function requestLocalModel({
  baseUrl = LOCAL_MODEL_DEFAULT_BASE_URL,
  model,
  apiKey,
  prompt,
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
}) {
  const modelName = model?.trim();
  if (!modelName) {
    throw new ProviderError("local_model", "Missing local model name.");
  }

  const key = apiKey?.trim();
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let response;
  try {
    response = await fetchImpl(completionsUrl(baseUrl), {
      method: "POST",
      signal: combined,
      headers: {
        "Content-Type": "application/json",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({
        model: modelName,
        stream: false,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
      }),
    });
  } catch (error) {
    if (timeout.aborted) {
      throw new ProviderError(
        "local_model",
        `The local model did not respond within ${Math.round(timeoutMs / 1000)} seconds.`,
        { cause: error },
      );
    }
    if (signal?.aborted) throw error;
    throw new ProviderError(
      "local_model",
      `Cannot reach the local model server at ${displayHost(baseUrl)}. Start it and try again.`,
      { cause: error },
    );
  }

  if (!response.ok) {
    // The body can echo back a request that carried an Authorization header, so
    // it is read and discarded rather than surfaced.
    await response.text?.().catch(() => "");
    if (response.status === 404) {
      throw new ProviderError(
        "local_model",
        `Model ${modelName} is not available on the local model server.`,
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new ProviderError("local_model", "The local model server rejected the API key.");
    }
    throw new ProviderError(
      "local_model",
      `The local model server returned an error (${response.status}).`,
    );
  }

  const data = await response.json().catch(() => ({}));
  const content = data?.choices?.[0]?.message?.content;
  const text = typeof content === "string" ? content.trim() : "";
  if (!text) {
    throw new ProviderError("local_model", "The local model returned an empty summary.");
  }

  return { text, model: modelName };
}

export async function generateLocalSummary({
  workDate,
  style,
  activity,
  preference,
  examples,
  ...connection
}) {
  const { text, model } = await requestLocalModel({
    ...connection,
    prompt: buildSummaryPrompt({ workDate, style, activity, preference, examples }),
  });
  return {
    summary: cleanSummaryText(text, { preserveBullets: style === "bullet-points" }),
    model,
  };
}

export async function generateLocalRollup({
  period,
  start,
  end,
  days,
  preference,
  ...connection
}) {
  const { text, model } = await requestLocalModel({
    ...connection,
    prompt: buildRollupPrompt({ period, start, end, days, preference }),
  });
  return { summary: cleanSummaryText(text), model };
}

export const localModelProvider = {
  generateSummary: generateLocalSummary,
  generateRollup: generateLocalRollup,
};
