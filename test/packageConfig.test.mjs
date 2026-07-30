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
      filter: ["server.js", "package.json", ".next/**/*"],
    },
    {
      from: ".next/standalone/node_modules",
      to: "server/node_modules",
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

test("installer workflows smoke-test unpacked apps before installers", async () => {
  const [windowsWorkflow, macWorkflow] = await Promise.all([
    readFile(new URL("../.github/workflows/windows-installer.yml", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/macos-installer.yml", import.meta.url), "utf8"),
  ]);

  for (const workflow of [windowsWorkflow, macWorkflow]) {
    assert.match(workflow, /dist:dir/);
    assert.match(workflow, /smoke-packaged-app\.cjs/);
  }
  assert.match(windowsWorkflow, /win-unpacked[\\/]AI Worklog Agent\.exe/);
  assert.match(macWorkflow, /unpacked_dir: mac-arm64/);
  assert.match(macWorkflow, /unpacked_dir: mac\n/);
  assert.match(macWorkflow, /matrix\.unpacked_dir/);
});
