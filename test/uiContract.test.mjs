import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("UI removes Developer field and exposes redesigned views", async () => {
  const files = [
    "../app/page.jsx",
    "../app/components/AppShell.jsx",
    "../app/components/DashboardView.jsx",
    "../app/components/SettingsView.jsx",
  ];
  const source = (
    await Promise.all(
      files.map((file) => readFile(new URL(file, import.meta.url), "utf8")),
    )
  ).join("\n");

  assert.doesNotMatch(source, /developerName|>Developer</);
  assert.match(source, /Dashboard/);
  assert.match(source, /Settings/);
  assert.match(source, /Monitored repos/i);
  assert.match(source, /Selected date activity/i);
});

test("Settings explains branch coverage for both activity sources", async () => {
  const settings = await readFile(
    new URL("../app/components/SettingsView.jsx", import.meta.url),
    "utf8",
  );

  assert.match(settings, /all local branches/i);
  assert.match(settings, /default branch/i);
});

test("Settings reports the running build version", async () => {
  const settings = await readFile(
    new URL("../app/components/SettingsView.jsx", import.meta.url),
    "utf8",
  );
  const page = await readFile(
    new URL("../app/page.jsx", import.meta.url),
    "utf8",
  );

  assert.match(settings, /appVersion/);
  assert.match(settings, />Version</);
  // A build running from source must not be mistaken for an installed release.
  assert.match(settings, /development/);
  assert.match(page, /getAppVersion/);
});
