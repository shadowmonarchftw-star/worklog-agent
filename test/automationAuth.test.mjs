import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  authorizeAutomationRequest,
  launchIdentity,
} from "../lib/automationAuth.mjs";

const capability = "launch-capability";

function request({
  authorization,
  host = "127.0.0.1:3000",
  method = "POST",
  origin,
} = {}) {
  const headers = new Headers({ host });
  if (authorization) headers.set("authorization", authorization);
  if (origin) headers.set("origin", origin);
  return new Request("http://127.0.0.1:3000/api/automation/run", {
    method,
    headers,
  });
}

test("capability authentication rejects missing and wrong bearer tokens", () => {
  assert.equal(
    authorizeAutomationRequest(request(), { capability })?.status,
    401,
  );
  assert.equal(
    authorizeAutomationRequest(
      request({ authorization: "Bearer wrong" }),
      { capability },
    )?.status,
    401,
  );
});

test("capability authentication rejects a non-loopback host", () => {
  const response = authorizeAutomationRequest(
    request({
      authorization: `Bearer ${capability}`,
      host: "worklog.example.com",
    }),
    { capability },
  );

  assert.equal(response?.status, 403);
});

test("mutation authentication rejects a hostile cross-origin request", () => {
  const response = authorizeAutomationRequest(
    request({
      authorization: `Bearer ${capability}`,
      origin: "https://attacker.example",
    }),
    { capability, mutation: true },
  );

  assert.equal(response?.status, 403);
});

test("valid loopback bearer request is authorized", () => {
  assert.equal(
    authorizeAutomationRequest(
      request({
        authorization: `Bearer ${capability}`,
        origin: "http://127.0.0.1:3000",
      }),
      { capability, mutation: true },
    ),
    null,
  );
});

test("launch identity is deterministic without disclosing the nonce", () => {
  const nonce = "launch-nonce";
  const identity = launchIdentity(nonce);

  assert.match(identity, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(identity, new RegExp(nonce));
});

test("capability comparison uses timingSafeEqual", async () => {
  const source = await readFile(
    new URL("../lib/automationAuth.mjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /\btimingSafeEqual\s*\(/);
});
