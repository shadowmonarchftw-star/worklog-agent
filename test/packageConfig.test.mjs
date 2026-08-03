import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("packages only Electron code and copies the standalone server as a resource", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );

  assert.deepEqual(packageJson.build.files.slice(0, 3), [
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
    {
      from: "build/icon.png",
      to: "tray-icon.png",
    },
  ]);
  assert.equal(packageJson.build.compression, "maximum");
  assert.equal(packageJson.build.mac.icon, "build/icon.png");
  assert.equal(packageJson.build.win.icon, "build/icon.png");
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
  assert.match(macWorkflow, /unpacked_dir: mac\r?\n/);
  assert.match(macWorkflow, /matrix\.unpacked_dir/);
});

test("every third-party module the Electron main process requires is packaged", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const packaged = new Set(
    packageJson.build.files
      .filter((entry) => entry.startsWith("node_modules/"))
      .map((entry) => entry.replace(/^node_modules\//, "").replace(/\/\*\*\/\*$/, "")),
  );

  // build.files excludes node_modules wholesale, so anything the main process
  // requires at load time must be re-included by name or the packaged app dies
  // with MODULE_NOT_FOUND before it can start its server.
  //
  // Only unindented requires are checked: those run on load. Indented ones sit
  // inside a branch or function, and the dev-only `require("next")` in
  // app-server.cjs is deliberately never reached in a packaged build.
  const sources = ["main.cjs", "app-server.cjs", "scheduler.cjs", "shutdown.cjs",
    "lifecycle.cjs", "external-links.cjs", "preload.cjs"];
  const required = new Set();
  for (const file of sources) {
    const code = await readFile(new URL(`../electron/${file}`, import.meta.url), "utf8");
    for (const match of code.matchAll(/^[^\s].*?require\(\s*["']([^"']+)["']\s*\)/gm)) {
      const name = match[1];
      if (name.startsWith(".") || name.startsWith("node:") || name === "electron") continue;
      required.add(name.split("/").slice(0, name.startsWith("@") ? 2 : 1).join("/"));
    }
  }

  assert.ok(required.size > 0, "expected at least one third-party require");
  for (const name of required) {
    assert.ok(
      packaged.has(name),
      `electron/ requires "${name}" but build.files does not package node_modules/${name}`,
    );
  }
});

test("packaged third-party modules include their transitive dependencies", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const packaged = new Set(
    packageJson.build.files
      .filter((entry) => entry.startsWith("node_modules/"))
      .map((entry) => entry.replace(/^node_modules\//, "").replace(/\/\*\*\/\*$/, "")),
  );

  for (const name of [...packaged]) {
    let manifest;
    try {
      manifest = JSON.parse(
        await readFile(new URL(`../node_modules/${name}/package.json`, import.meta.url), "utf8"),
      );
    } catch {
      continue;
    }
    for (const dependency of Object.keys(manifest.dependencies || {})) {
      assert.ok(
        packaged.has(dependency),
        `node_modules/${name} depends on "${dependency}", which build.files does not package`,
      );
    }
  }
});

test("release publishes the metadata the in-app updater needs", async () => {
  const release = await readFile(
    new URL("../.github/workflows/release.yml", import.meta.url), "utf8",
  );
  const windows = await readFile(
    new URL("../.github/workflows/windows-installer.yml", import.meta.url), "utf8",
  );
  const macos = await readFile(
    new URL("../.github/workflows/macos-installer.yml", import.meta.url), "utf8",
  );

  // v0.3.4 shipped an updater that could never see a release because these
  // files were built but never uploaded.
  assert.match(windows, /release\/latest\.yml/);
  assert.match(macos, /release\/latest-mac-\$\{\{ matrix\.arch \}\}\.yml/);
  assert.match(macos, /release\/\*\.zip/);

  assert.match(release, /merge-update-metadata\.cjs/);
  assert.match(release, /test -f release\/latest\.yml/);
  assert.match(release, /test -f release\/latest-mac\.yml/);
});

test("macOS builds a zip so the updater can download an update", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  // electron-updater's MacUpdater throws ERR_UPDATER_ZIP_FILE_NOT_FOUND when the
  // published metadata offers only a dmg.
  assert.ok(
    packageJson.build.mac.target.includes("zip"),
    "mac target must include zip for auto-update to work",
  );
  assert.ok(packageJson.build.mac.target.includes("dmg"));
  // The CLI target list overrides build.mac.target, so the script must ask for
  // the zip too or the config above is silently ignored.
  assert.match(packageJson.scripts["dist:mac"], /--mac dmg zip/);
});

test("installer artifact names contain no spaces so update metadata matches uploads", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );

  // GitHub rewrites spaces to dots when a release asset is uploaded, while
  // electron-builder writes hyphens into latest*.yml. A name containing a
  // space therefore produces an update feed that 404s on download.
  const names = [
    packageJson.build.artifactName,
    packageJson.build.mac?.artifactName,
    packageJson.build.win?.artifactName,
  ].filter(Boolean);

  assert.ok(names.length >= 2, "expected default and per-platform artifact names");
  for (const name of names) {
    assert.doesNotMatch(name, /\s/, `artifactName must not contain spaces: ${name}`);
    assert.doesNotMatch(
      name,
      /\$\{productName\}/,
      `artifactName must not interpolate productName, which contains spaces: ${name}`,
    );
  }
});
