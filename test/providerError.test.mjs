import assert from "node:assert/strict";
import test from "node:test";

import {
  ProviderError,
  redactProviderSecrets,
} from "../lib/providerError.mjs";

test("ProviderError serializes only typed safe fields", () => {
  const error = new ProviderError(
    "github",
    "GitHub could not be reached.",
    { rawBody: "ghp_abcdefghijklmnopqrstuvwxyz123456" },
  );

  assert.deepEqual(JSON.parse(JSON.stringify(error)), {
    name: "ProviderError",
    category: "github",
    safeMessage: "GitHub could not be reached.",
  });
  assert.equal(JSON.stringify(error).includes("ghp_"), false);
});

test("redaction removes provider keys, OAuth secrets, headers, and credential URL params", () => {
  const input = [
    "github_pat_11AAabcdefghijklmnopqrstuvwxyz",
    "ghp_abcdefghijklmnopqrstuvwxyz123456",
    "AIzaSyabcdefghijklmnopqrstuvwxyz123456",
    "Authorization: Bearer header-token",
    "client_secret=client-value",
    "access_token=access-value",
    "refresh_token=refresh-value",
    "https://example.test/cb?code=oauth-code&token=url-token&safe=yes",
  ].join(" ");
  const redacted = redactProviderSecrets(input);

  for (const secret of [
    "github_pat_11AAabcdefghijklmnopqrstuvwxyz",
    "ghp_abcdefghijklmnopqrstuvwxyz123456",
    "AIzaSyabcdefghijklmnopqrstuvwxyz123456",
    "header-token",
    "client-value",
    "access-value",
    "refresh-value",
    "oauth-code",
    "url-token",
  ]) {
    assert.equal(redacted.includes(secret), false, secret);
  }
  assert.match(redacted, /\[REDACTED\]/);
});
