import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.WORKLOG_AGENT_DATA_DIR = mkdtempSync(path.join(tmpdir(), "worklog-guard-"));

import { guardLocalRequest } from "../lib/localRouteAuth.mjs";

const APP_ORIGIN = "http://127.0.0.1:3000";

function request(url, { method = "POST", ...headers } = {}) {
  return new Request(url, {
    method,
    headers: { host: "127.0.0.1:3000", ...headers },
    ...(method === "POST" ? { body: "{}" } : {}),
  });
}

test("a page on another site cannot drive a state-changing route", () => {
  const denied = guardLocalRequest(
    request(`${APP_ORIGIN}/api/local/settings`, {
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
    }),
    { mutation: true },
  );

  assert.equal(denied?.status, 403);
});

test("a cross-site request with no Origin header is still refused", () => {
  const denied = guardLocalRequest(
    request(`${APP_ORIGIN}/api/local/settings`, { "sec-fetch-site": "cross-site" }),
    { mutation: true },
  );

  assert.equal(denied?.status, 403);
});

test("the app's own requests pass", () => {
  assert.equal(
    guardLocalRequest(
      request(`${APP_ORIGIN}/api/local/settings`, {
        origin: APP_ORIGIN,
        "sec-fetch-site": "same-origin",
      }),
      { mutation: true },
    ),
    null,
  );
});

test("a request arriving on a non-loopback host is refused", () => {
  const denied = guardLocalRequest(
    new Request("http://192.168.1.50:3000/api/local/settings", {
      method: "POST",
      headers: { host: "192.168.1.50:3000", origin: "http://192.168.1.50:3000" },
      body: "{}",
    }),
    { mutation: true },
  );

  assert.equal(denied?.status, 403);
});

// Google redirects the user's browser to the OAuth callback as a top-level
// cross-site navigation. Requiring same-origin there would break sign-in, so
// read-only routes take the loopback check alone.
test("a cross-site top-level navigation still reaches a read-only route", () => {
  assert.equal(
    guardLocalRequest(
      request(`${APP_ORIGIN}/api/google/callback?code=abc`, {
        method: "GET",
        "sec-fetch-site": "cross-site",
        "sec-fetch-mode": "navigate",
      }),
    ),
    null,
  );
});

test("read-only routes are still refused off loopback", () => {
  const denied = guardLocalRequest(
    new Request("http://192.168.1.50:3000/api/google/callback", {
      headers: { host: "192.168.1.50:3000" },
    }),
  );

  assert.equal(denied?.status, 403);
});
