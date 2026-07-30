import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("packages only Electron code and copies the standalone server as a resource", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );

  assert.deepEqual(packageJson.build.files, [
    "electron/**/*",
    "package.json",
    "!node_modules/**/*",
  ]);
  assert.deepEqual(packageJson.build.extraResources, [
    {
      from: ".next/standalone",
      to: "server",
      filter: ["**/*"],
    },
    {
      from: ".next/static",
      to: "server/.next/static",
      filter: ["**/*"],
    },
  ]);
  assert.equal(packageJson.build.compression, "maximum");
  assert.equal(
    packageJson.scripts.build,
    "next build && node scripts/prepare-standalone.cjs",
  );
});
