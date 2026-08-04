import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  releasePageUrl,
  supportsInAppInstall,
} = require("../electron/updatePolicy.cjs");

test("macOS cannot install in place while the app is ad-hoc signed", () => {
  assert.equal(supportsInAppInstall({ platform: "darwin", codeSigned: false }), false);
  assert.equal(supportsInAppInstall({ platform: "darwin" }), false);
});

test("a Developer ID signed macOS build can install in place", () => {
  assert.equal(supportsInAppInstall({ platform: "darwin", codeSigned: true }), true);
});

test("Windows and Linux install in place regardless of signing", () => {
  assert.equal(supportsInAppInstall({ platform: "win32", codeSigned: false }), true);
  assert.equal(supportsInAppInstall({ platform: "linux", codeSigned: false }), true);
});

test("releasePageUrl points at the tag for the offered version", () => {
  assert.equal(
    releasePageUrl({ owner: "shadowmonarchftw-star", repo: "worklog-agent", version: "0.4.0" }),
    "https://github.com/shadowmonarchftw-star/worklog-agent/releases/tag/v0.4.0",
  );
});

test("releasePageUrl tolerates a version that already carries its v prefix", () => {
  assert.equal(
    releasePageUrl({ owner: "o", repo: "r", version: "v1.2.3" }),
    "https://github.com/o/r/releases/tag/v1.2.3",
  );
});

test("releasePageUrl falls back to the releases list when details are missing", () => {
  assert.equal(
    releasePageUrl({ owner: "o", repo: "r" }),
    "https://github.com/o/r/releases/latest",
  );
  assert.equal(releasePageUrl({}), null);
});

test("releasePageUrl refuses values that would escape the repository path", () => {
  assert.equal(releasePageUrl({ owner: "o/../evil", repo: "r", version: "1.0.0" }), null);
  assert.equal(releasePageUrl({ owner: "o", repo: "r", version: "1.0.0 evil" }), null);
});
