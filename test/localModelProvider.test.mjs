import assert from "node:assert/strict";
import test from "node:test";

import { generateLocalRollup, generateLocalSummary, listLocalModels } from "../lib/localModelProvider.mjs";

const BASE = {
  baseUrl: "http://127.0.0.1:11434/v1",
  model: "gemma3:4b",
  workDate: "2026-08-03",
  style: "standup",
  activity: "- Fixed the scheduler guard\n- Updated the README",
};

function reply(content, overrides = {}) {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
    text: async () => "",
    ...overrides,
  });
}

test("returns a cleaned summary and the model that answered", async () => {
  const result = await generateLocalSummary({
    ...BASE,
    fetchImpl: reply("**Worked on** the scheduler guard and the README."),
  });

  assert.equal(result.model, "gemma3:4b");
  assert.doesNotMatch(result.summary, /\*\*/);
  assert.match(result.summary, /scheduler guard/);
});

test("preserves bullets for the bullet-points style", async () => {
  const result = await generateLocalSummary({
    ...BASE,
    style: "bullet-points",
    fetchImpl: reply("- Fixed the guard\n- Updated docs"),
  });

  assert.match(result.summary, /^- Fixed the guard/m);
  assert.match(result.summary, /^- Updated docs/m);
});

test("sends the model and both prompt roles to the chat completions path", async () => {
  let seenUrl;
  let seenBody;
  await generateLocalSummary({
    ...BASE,
    fetchImpl: async (url, options) => {
      seenUrl = url;
      seenBody = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "Summary." } }] }),
        text: async () => "",
      };
    },
  });

  assert.equal(seenUrl, "http://127.0.0.1:11434/v1/chat/completions");
  assert.equal(seenBody.model, "gemma3:4b");
  assert.equal(seenBody.stream, false);
  assert.deepEqual(seenBody.messages.map(({ role }) => role), ["system", "user"]);
  assert.ok(seenBody.messages[1].content.includes("scheduler guard"));
});

test("trailing slashes in the base url do not produce a doubled path", async () => {
  let seenUrl;
  await generateLocalSummary({
    ...BASE,
    baseUrl: "http://127.0.0.1:11434/v1/",
    fetchImpl: async (url) => {
      seenUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "Summary." } }] }),
        text: async () => "",
      };
    },
  });

  assert.equal(seenUrl, "http://127.0.0.1:11434/v1/chat/completions");
});

test("sends an Authorization header only when an api key is set", async () => {
  let headers;
  const capture = async (_url, options) => {
    headers = options.headers;
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "Summary." } }] }),
      text: async () => "",
    };
  };

  await generateLocalSummary({ ...BASE, fetchImpl: capture });
  assert.equal(headers.Authorization, undefined);

  await generateLocalSummary({ ...BASE, apiKey: "proxy-key", fetchImpl: capture });
  assert.equal(headers.Authorization, "Bearer proxy-key");
});

test("an unreachable server names the address instead of failing generically", async () => {
  await assert.rejects(
    generateLocalSummary({
      ...BASE,
      fetchImpl: async () => {
        throw Object.assign(new Error("fetch failed"), { code: "ECONNREFUSED" });
      },
    }),
    (error) => {
      assert.equal(error.category, "local_model");
      assert.match(error.safeMessage, /Cannot reach the local model server/);
      assert.match(error.safeMessage, /127\.0\.0\.1:11434/);
      return true;
    },
  );
});

test("a missing model reports the model name", async () => {
  await assert.rejects(
    generateLocalSummary({
      ...BASE,
      fetchImpl: async () => ({
        ok: false,
        status: 404,
        json: async () => ({}),
        text: async () => "model not found",
      }),
    }),
    (error) => {
      assert.match(error.safeMessage, /gemma3:4b/);
      assert.match(error.safeMessage, /not available/);
      return true;
    },
  );
});

test("a rejected api key is reported as such", async () => {
  for (const status of [401, 403]) {
    await assert.rejects(
      generateLocalSummary({
        ...BASE,
        apiKey: "wrong",
        fetchImpl: async () => ({
          ok: false,
          status,
          json: async () => ({}),
          text: async () => "unauthorized",
        }),
      }),
      (error) => {
        assert.match(error.safeMessage, /rejected the API key/);
        return true;
      },
    );
  }
});

test("other error statuses do not leak the response body", async () => {
  await assert.rejects(
    generateLocalSummary({
      ...BASE,
      fetchImpl: async () => ({
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => "Authorization: Bearer super-secret-value",
      }),
    }),
    (error) => {
      assert.equal(error.category, "local_model");
      assert.doesNotMatch(error.safeMessage, /super-secret-value/);
      return true;
    },
  );
});

test("an empty completion is an error rather than an empty worklog", async () => {
  for (const body of [{ choices: [] }, { choices: [{ message: { content: "  " } }] }, {}]) {
    await assert.rejects(
      generateLocalSummary({
        ...BASE,
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => body,
          text: async () => "",
        }),
      }),
      (error) => {
        assert.match(error.safeMessage, /empty summary/);
        return true;
      },
    );
  }
});

test("a stalled server aborts instead of holding the run open", async () => {
  // AbortSignal.timeout uses an unref'd timer. A real request keeps the loop
  // alive; a stub that never settles does not, so hold it open explicitly.
  const keepAlive = setTimeout(() => {}, 5_000);
  try {
    await assert.rejects(
      generateLocalSummary({
        ...BASE,
        timeoutMs: 10,
        fetchImpl: (_url, options) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener("abort", () => {
              reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            });
          }),
      }),
      (error) => {
        assert.match(error.safeMessage, /did not respond/);
        return true;
      },
    );
  } finally {
    clearTimeout(keepAlive);
  }
});

test("a missing model name is rejected before any request is made", async () => {
  let called = false;
  await assert.rejects(
    generateLocalSummary({
      ...BASE,
      model: "",
      fetchImpl: async () => {
        called = true;
        return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
      },
    }),
    /model name/i,
  );
  assert.equal(called, false);
});

test("generateLocalRollup sends the period prompt to the local server", async () => {
  let sent;
  const result = await generateLocalRollup({
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "gemma3:4b",
    period: "month",
    start: "2026-08-01",
    end: "2026-08-31",
    days: [{ workDate: "2026-08-03", summary: "Shipped the export fix." }],
    fetchImpl: async (_url, options) => {
      sent = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "**Steady** month." } }] }),
        text: async () => "",
      };
    },
  });

  assert.match(sent.messages[1].content, /month of 2026-08-01 to 2026-08-31/);
  assert.match(sent.messages[1].content, /Shipped the export fix/);
  assert.equal(result.summary, "Steady month.");
  assert.equal(result.model, "gemma3:4b");
});

test("listLocalModels returns sorted model ids from an OpenAI-compatible server", async () => {
  let requested;
  const models = await listLocalModels({
    baseUrl: "http://127.0.0.1:11434/v1/",
    fetchImpl: async (url) => {
      requested = String(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: "qwen3:8b" }, { id: "gemma3:4b" }] }),
        text: async () => "",
      };
    },
  });

  assert.equal(requested, "http://127.0.0.1:11434/v1/models");
  assert.deepEqual(models, ["gemma3:4b", "qwen3:8b"]);
});

test("listLocalModels reports an unreachable server as a provider error", async () => {
  await assert.rejects(
    () => listLocalModels({
      baseUrl: "http://127.0.0.1:11434/v1",
      fetchImpl: async () => { throw new Error("ECONNREFUSED"); },
    }),
    (error) => error.category === "local_model" && /Cannot reach/.test(error.safeMessage),
  );
});

test("listLocalModels returns nothing when the server has no model list", async () => {
  const models = await listLocalModels({
    baseUrl: "http://127.0.0.1:11434/v1",
    fetchImpl: async () => ({ ok: false, status: 404, text: async () => "" }),
  });

  assert.deepEqual(models, []);
});

test("listLocalModels does not follow redirects to another host", async () => {
  let options;
  await listLocalModels({
    baseUrl: "http://127.0.0.1:11434/v1",
    fetchImpl: async (_url, init) => {
      options = init;
      return { ok: false, status: 302, text: async () => "" };
    },
  });

  assert.equal(options.redirect, "manual");
});
