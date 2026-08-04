import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { isTrustedExternalUrl } = require("../electron/external-links.cjs");

test("allows Google OAuth pages to open in the system browser", () => {
  assert.equal(
    isTrustedExternalUrl("https://accounts.google.com/o/oauth2/v2/auth?client_id=test"),
    true,
  );
});

test("does not open local or unrelated URLs externally", () => {
  assert.equal(isTrustedExternalUrl("http://127.0.0.1:3000/api/google/callback"), false);
  assert.equal(isTrustedExternalUrl("https://example.com"), false);
  assert.equal(isTrustedExternalUrl("javascript:alert(1)"), false);
});

test("the preload bridge exposes a version reader", () => {
  const source = readFileSync(
    new URL("../electron/preload.cjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /getAppVersion:\s*\(\)\s*=>\s*ipcRenderer\.invoke\("app:version"\)/);
});
