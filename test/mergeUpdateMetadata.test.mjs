import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { mergeUpdateMetadata } = require("../scripts/merge-update-metadata.cjs");

const arm64Document = {
  version: "0.3.4",
  files: [{
    url: "AI-Worklog-Agent-0.3.4-arm64.dmg",
    sha512: "arm64-dmg-hash",
    size: 119995235,
  }, {
    url: "AI-Worklog-Agent-0.3.4-arm64-mac.zip",
    sha512: "arm64-zip-hash",
    size: 118000000,
  }],
  path: "AI-Worklog-Agent-0.3.4-arm64.dmg",
  sha512: "arm64-dmg-hash",
  releaseDate: "2026-08-03T07:43:40.643Z",
};

const x64Document = {
  version: "0.3.4",
  files: [{
    url: "AI-Worklog-Agent-0.3.4-x64.dmg",
    sha512: "x64-dmg-hash",
    size: 124000000,
  }, {
    url: "AI-Worklog-Agent-0.3.4-mac.zip",
    sha512: "x64-zip-hash",
    size: 122000000,
  }],
  path: "AI-Worklog-Agent-0.3.4-x64.dmg",
  sha512: "x64-dmg-hash",
  releaseDate: "2026-08-03T07:49:11.000Z",
};

test("merging keeps every architecture's files in one document", () => {
  const merged = mergeUpdateMetadata([arm64Document, x64Document]);
  assert.equal(merged.version, "0.3.4");
  assert.deepEqual(merged.files.map((file) => file.url).sort(), [
    "AI-Worklog-Agent-0.3.4-arm64-mac.zip",
    "AI-Worklog-Agent-0.3.4-arm64.dmg",
    "AI-Worklog-Agent-0.3.4-mac.zip",
    "AI-Worklog-Agent-0.3.4-x64.dmg",
  ]);
});

test("both architectures can still find a zip after merging", () => {
  const merged = mergeUpdateMetadata([arm64Document, x64Document]);
  // MacUpdater.filterFilesForArch selects on "arm64" appearing in the file name,
  // then requires a zip among what survives.
  const arm64Files = merged.files.filter((file) => file.url.includes("arm64"));
  const x64Files = merged.files.filter((file) => !file.url.includes("arm64"));
  assert.ok(arm64Files.some((file) => file.url.endsWith(".zip")), "arm64 needs a zip");
  assert.ok(x64Files.some((file) => file.url.endsWith(".zip")), "x64 needs a zip");
});

test("the legacy path field points at a non-arm64 build and matches its hash", () => {
  const merged = mergeUpdateMetadata([arm64Document, x64Document]);
  assert.equal(merged.path.includes("arm64"), false);
  const target = merged.files.find((file) => file.url === merged.path);
  assert.ok(target, "legacy path must name one of the listed files");
  assert.equal(merged.sha512, target.sha512);
});

test("the newest release date wins", () => {
  const merged = mergeUpdateMetadata([arm64Document, x64Document]);
  assert.equal(merged.releaseDate, "2026-08-03T07:49:11.000Z");
});

test("duplicate file entries are collapsed", () => {
  const merged = mergeUpdateMetadata([arm64Document, arm64Document]);
  assert.equal(merged.files.length, 2);
});

test("merging a single document still produces valid metadata", () => {
  const merged = mergeUpdateMetadata([x64Document]);
  assert.equal(merged.files.length, 2);
  assert.equal(merged.path, "AI-Worklog-Agent-0.3.4-mac.zip");
});

test("mismatched versions are refused instead of silently publishing one", () => {
  assert.throws(
    () => mergeUpdateMetadata([arm64Document, { ...x64Document, version: "0.3.5" }]),
    /mismatched versions/,
  );
});

test("merging nothing is an error", () => {
  assert.throws(() => mergeUpdateMetadata([]), /No update metadata/);
});
