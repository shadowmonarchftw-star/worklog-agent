import assert from "node:assert/strict";
import test from "node:test";

import { createIdentityHandler } from "../app/api/automation/identity/route.js";
import {
  createInspectRepositoryHandler,
} from "../app/api/automation/inspect-repository/route.js";
import { createRecoverHandler } from "../app/api/automation/recover/route.js";
import { createRunHandler } from "../app/api/automation/run/route.js";
import {
  createSettingsHandlers,
} from "../app/api/automation/settings/route.js";
import { launchIdentity } from "../lib/automationAuth.mjs";
import { ProviderError } from "../lib/providerError.mjs";
import { AutomationSetupError } from "../lib/worklogService.mjs";

const capability = "route-capability";
const baseUrl = "http://127.0.0.1:3000";

function apiRequest(path, {
  body,
  host = "127.0.0.1:3000",
  method = "POST",
  origin,
  rawBody,
  token,
} = {}) {
  const headers = new Headers({ host });
  if (body !== undefined) headers.set("content-type", "application/json");
  if (origin) headers.set("origin", origin);
  if (token) headers.set("authorization", `Bearer ${token}`);
  return new Request(`${baseUrl}${path}`, {
    method,
    headers,
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
}

test("run route rejects unauthorized requests without calling the service", async () => {
  let calls = 0;
  const POST = createRunHandler({
    capability,
    execute: async () => {
      calls += 1;
    },
    loadInput: async () => ({}),
  });

  for (const token of [undefined, "wrong"]) {
    const response = await POST(apiRequest("/api/automation/run", { token }));
    assert.equal(response.status, 401);
  }
  assert.equal(calls, 0);
});

test("run route rejects non-loopback and hostile-origin requests untouched", async () => {
  let calls = 0;
  const POST = createRunHandler({
    capability,
    execute: async () => {
      calls += 1;
    },
    loadInput: async () => ({}),
  });

  const remote = await POST(apiRequest("/api/automation/run", {
    host: "worklog.example.com",
    token: capability,
  }));
  const hostile = await POST(apiRequest("/api/automation/run", {
    origin: "https://attacker.example",
    token: capability,
  }));

  assert.equal(remote.status, 403);
  assert.equal(hostile.status, 403);
  assert.equal(calls, 0);
});

test("run route executes a valid manual worklog", async () => {
  const inputs = [];
  const POST = createRunHandler({
    capability,
    execute: async (input) => {
      inputs.push(input);
      return { status: "success", attemptId: "attempt-1" };
    },
    loadInput: async (body) => ({ ...body, composed: true }),
  });

  const response = await POST(apiRequest("/api/automation/run", {
    token: capability,
    origin: baseUrl,
    body: { workDate: "2026-07-30", trigger: "manual" },
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    result: { status: "success", attemptId: "attempt-1" },
  });
  assert.deepEqual(inputs, [{
    workDate: "2026-07-30",
    trigger: "manual",
    composed: true,
  }]);
});

test("run route rejects malformed JSON without loading or executing", async () => {
  let loadCalls = 0;
  let executeCalls = 0;
  const POST = createRunHandler({
    capability,
    execute: async () => {
      executeCalls += 1;
    },
    loadInput: async () => {
      loadCalls += 1;
      return {};
    },
  });

  const response = await POST(apiRequest("/api/automation/run", {
    token: capability,
    rawBody: "{not-json",
  }));
  const responseBody = await response.json();

  assert.equal(response.status, 400);
  assert.deepEqual(responseBody, { error: "Malformed JSON request body." });
  assert.equal(loadCalls, 0);
  assert.equal(executeCalls, 0);
});

test("run route classifies malformed timezone input as validation", async () => {
  let executeCalls = 0;
  const POST = createRunHandler({
    capability,
    execute: async () => {
      executeCalls += 1;
    },
  });

  const response = await POST(apiRequest("/api/automation/run", {
    token: capability,
    body: { timezone: "Not/A_Timezone" },
  }));

  assert.equal(response.status, 400);
  assert.equal(executeCalls, 0);
});

test("run route never returns secrets from service failures", async () => {
  const POST = createRunHandler({
    capability,
    execute: async () => {
      throw new Error("Authorization: Bearer secret-service-token failed");
    },
    loadInput: async () => ({}),
  });

  const response = await POST(apiRequest("/api/automation/run", {
    token: capability,
    body: {},
  }));
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.doesNotMatch(JSON.stringify(body), /secret-service-token/);
});

test("run route classifies validation, provider, internal, and conflict outcomes", async () => {
  const cases = [
    {
      execute: async () => {
        throw new AutomationSetupError("GitHub token is required.");
      },
      status: 400,
      message: /GitHub token is required/,
    },
    {
      execute: async () => {
        throw new ProviderError(
          "github",
          "GitHub unavailable Authorization: Bearer secret-upstream-token",
        );
      },
      status: 502,
      message: /GitHub unavailable/,
      absent: /secret-upstream-token/,
    },
    {
      execute: async () => {
        const error = new Error("database secret-password failed");
        error.code = "SQLITE_BUSY";
        throw error;
      },
      status: 500,
      message: /Automation failed/,
      absent: /secret-password|SQLITE_BUSY/,
    },
    {
      execute: async () => ({ outcome: "already_running", attempt: null }),
      status: 409,
      message: /already_running/,
    },
  ];

  for (const example of cases) {
    const POST = createRunHandler({
      capability,
      execute: example.execute,
      loadInput: async () => ({}),
    });
    const response = await POST(apiRequest("/api/automation/run", {
      token: capability,
      body: {},
    }));
    const serialized = JSON.stringify(await response.json());
    assert.equal(response.status, example.status);
    assert.match(serialized, example.message);
    if (example.absent) assert.doesNotMatch(serialized, example.absent);
  }
});

test("recover route requires capability and dispatches only valid requests", async () => {
  let calls = 0;
  const POST = createRecoverHandler({
    capability,
    recover: async (input) => {
      calls += 1;
      return { results: [], input };
    },
    loadInput: async () => ({ ownerId: "owner-1" }),
  });

  assert.equal(
    (await POST(apiRequest("/api/automation/recover"))).status,
    401,
  );
  assert.equal(calls, 0);

  const response = await POST(apiRequest("/api/automation/recover", {
    token: capability,
  }));
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.deepEqual(await response.json(), {
    result: { results: [], input: { ownerId: "owner-1" } },
  });
});

test("recover route shares sanitized error and conflict classification", async () => {
  const cases = [
    {
      recover: async () => {
        throw new SyntaxError(
          "Unexpected token in persisted JSON secret-parser-detail",
        );
      },
      status: 500,
      message: /Recovery failed/,
      absent: /Unexpected token|secret-parser-detail/,
    },
    {
      recover: async () => {
        throw new ProviderError(
          "google_sheets",
          "Sheets unavailable Bearer secret-recovery-token",
        );
      },
      status: 502,
      message: /Sheets unavailable/,
      absent: /secret-recovery-token/,
    },
    {
      recover: async () => {
        throw new Error("database secret-recovery-password failed");
      },
      status: 500,
      message: /Recovery failed/,
      absent: /secret-recovery-password/,
    },
    {
      recover: async () => ({ outcome: "already_running", attempt: null }),
      status: 409,
      message: /already_running/,
    },
  ];

  for (const example of cases) {
    const POST = createRecoverHandler({
      capability,
      recover: example.recover,
      loadInput: async () => ({}),
    });
    const response = await POST(apiRequest("/api/automation/recover", {
      token: capability,
    }));
    const serialized = JSON.stringify(await response.json());
    assert.equal(response.status, example.status);
    assert.match(serialized, example.message);
    if (example.absent) assert.doesNotMatch(serialized, example.absent);
  }
});

test("settings route keeps automation configuration and status separate", async () => {
  let settings = {
    enabled: false,
    time: "17:30",
    days: [1, 2, 3, 4, 5],
    startAtLogin: false,
    startAtLoginConfigured: false,
    capability: "must-not-leak",
  };
  const { GET, POST } = createSettingsHandlers({
    getSettings: () => settings,
    getStatus: () => ({ nextRun: null, lastAttempt: null }),
    saveSettings: (patch) => {
      settings = { ...settings, ...patch };
      return settings;
    },
  });

  const getResponse = await GET(apiRequest("/api/automation/settings", {
    method: "GET",
  }));
  const getBody = await getResponse.json();
  assert.deepEqual(Object.keys(getBody).sort(), ["settings", "status"]);
  assert.equal(getBody.settings.capability, undefined);

  const postResponse = await POST(apiRequest("/api/automation/settings", {
    origin: baseUrl,
    body: { enabled: true, time: "09:15", days: [1, 3, 5] },
  }));
  assert.equal(postResponse.status, 200);
  assert.equal((await postResponse.json()).settings.enabled, true);
});

test("settings mutation rejects hostile origins and invalid fields untouched", async () => {
  let calls = 0;
  const { POST } = createSettingsHandlers({
    getSettings: () => ({}),
    getStatus: () => ({}),
    saveSettings: () => {
      calls += 1;
      return {};
    },
  });

  const hostile = await POST(apiRequest("/api/automation/settings", {
    origin: "https://attacker.example",
    body: { enabled: true },
  }));
  const missingOrigin = await POST(apiRequest("/api/automation/settings", {
    body: { enabled: true },
  }));
  const unknown = await POST(apiRequest("/api/automation/settings", {
    origin: baseUrl,
    body: { githubToken: "secret" },
  }));
  const malformed = await POST(apiRequest("/api/automation/settings", {
    origin: baseUrl,
    body: { enabled: "yes", days: [0], time: "9:00" },
  }));

  assert.equal(hostile.status, 403);
  assert.equal(missingOrigin.status, 403);
  assert.equal(unknown.status, 400);
  assert.equal(malformed.status, 400);
  assert.equal(calls, 0);
});

test("identity route proves the nonce only to a valid capability", async () => {
  const GET = createIdentityHandler({
    capability,
    nonce: "nonce-1",
  });

  assert.equal(
    (await GET(apiRequest("/api/automation/identity", {
      method: "GET",
    }))).status,
    401,
  );
  const response = await GET(apiRequest("/api/automation/identity", {
    method: "GET",
    token: capability,
  }));
  const body = await response.json();

  assert.deepEqual(body, { identity: launchIdentity("nonce-1") });
  assert.doesNotMatch(JSON.stringify(body), /route-capability|nonce-1/);
});

test("repository inspection route is authenticated and validates its path", async () => {
  const calls = [];
  const POST = createInspectRepositoryHandler({
    capability,
    inspect: async (repositoryPath) => {
      calls.push(repositoryPath);
      return { path: repositoryPath, displayName: "Shopify-GF" };
    },
  });

  assert.equal(
    (await POST(apiRequest("/api/automation/inspect-repository", {
      body: { path: "/Users/success/Shopify-GF" },
    }))).status,
    401,
  );
  assert.equal(
    (await POST(apiRequest("/api/automation/inspect-repository", {
      token: capability,
      origin: baseUrl,
      body: { path: "" },
    }))).status,
    400,
  );
  const response = await POST(apiRequest("/api/automation/inspect-repository", {
    token: capability,
    origin: baseUrl,
    body: { path: "/Users/success/Shopify-GF" },
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    repository: {
      path: "/Users/success/Shopify-GF",
      displayName: "Shopify-GF",
    },
  });
  assert.deepEqual(calls, ["/Users/success/Shopify-GF"]);
});
