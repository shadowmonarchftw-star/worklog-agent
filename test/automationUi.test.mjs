import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Settings exposes complete automatic worklog controls", async () => {
  const [settings, automation, page, preload] = await Promise.all([
    readFile(new URL("../app/components/SettingsView.jsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/AutomationSection.jsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.jsx", import.meta.url), "utf8"),
    readFile(new URL("../electron/preload.cjs", import.meta.url), "utf8"),
  ]);
  const source = [settings, automation, page, preload].join("\n");

  assert.match(source, /Automation/);
  assert.match(source, /Enable automatic worklogs/);
  assert.match(source, /Start at login/);
  assert.match(source, /type="time"/);
  assert.match(source, /Run now/);
  assert.match(source, /Next run/);
  assert.match(source, /Last successful write/);
  assert.match(source, /saveAutomationSettings/);
  assert.match(source, /getAutomationStatus/);
  assert.match(source, /runAutomation/);
});

test("Settings exposes GitHub and local repository activity sources", async () => {
  const [settings, preload] = await Promise.all([
    readFile(new URL("../app/components/SettingsView.jsx", import.meta.url), "utf8"),
    readFile(new URL("../electron/preload.cjs", import.meta.url), "utf8"),
  ]);
  assert.match(settings, /Local repositories/);
  assert.match(settings, /Additional author emails/);
  assert.match(preload, /chooseLocalRepository/);
  assert.match(preload, /inspectLocalRepository/);
});
