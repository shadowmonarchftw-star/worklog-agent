import assert from "node:assert/strict";
import test from "node:test";

import { createHistoryEntry, upsertHistoryEntry } from "../lib/worklogHistory.mjs";

test("createHistoryEntry captures summary metadata without secrets", () => {
  const entry = createHistoryEntry({
    developerName: "Asha",
    workDate: "2026-07-23",
    style: "standup",
    selectedRepos: ["owner/app"],
    activity: "repo: owner/app\n- commit abc123 fix export",
    summary: "Fixed export flow.",
    geminiApiKey: "secret",
    githubToken: "secret",
  });

  assert.equal(entry.developerName, "Asha");
  assert.equal(entry.workDate, "2026-07-23");
  assert.deepEqual(entry.repos, ["owner/app"]);
  assert.equal(entry.summary, "Fixed export flow.");
  assert.equal("geminiApiKey" in entry, false);
  assert.equal("githubToken" in entry, false);
});

test("upsertHistoryEntry replaces same date and keeps newest first", () => {
  const first = createHistoryEntry({
    developerName: "Asha",
    workDate: "2026-07-22",
    style: "standup",
    selectedRepos: [],
    activity: "old",
    summary: "Old",
  });
  const replacement = createHistoryEntry({
    developerName: "Asha",
    workDate: "2026-07-22",
    style: "standup",
    selectedRepos: [],
    activity: "new",
    summary: "New",
  });

  const history = upsertHistoryEntry([first], replacement);

  assert.equal(history.length, 1);
  assert.equal(history[0].summary, "New");
});
