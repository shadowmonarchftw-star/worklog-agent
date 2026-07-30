import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createLocalDb,
  getSetting,
  listHistory,
  saveHistoryEntry,
  setSetting,
} from "../lib/localDb.mjs";

function tempDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "worklog-db-"));
  return createLocalDb(path.join(dir, "test.sqlite"));
}

test("settings persist JSON values", () => {
  const db = tempDb();

  setSetting(db, "github", {
    author: "asha",
    selectedRepos: ["owner/app"],
  });

  assert.deepEqual(getSetting(db, "github"), {
    author: "asha",
    selectedRepos: ["owner/app"],
  });
});

test("history entries persist newest first and replace same work date", () => {
  const db = tempDb();

  saveHistoryEntry(db, {
    id: "first",
    developerName: "Asha",
    workDate: "2026-07-23",
    style: "standup",
    repos: ["owner/app"],
    activity: "old",
    summary: "Old summary",
    createdAt: "2026-07-23T10:00:00.000Z",
  });
  saveHistoryEntry(db, {
    id: "second",
    developerName: "Asha",
    workDate: "2026-07-23",
    style: "standup",
    repos: ["owner/app"],
    activity: "new",
    summary: "New summary",
    createdAt: "2026-07-23T11:00:00.000Z",
  });

  const history = listHistory(db);

  assert.equal(history.length, 1);
  assert.equal(history[0].id, "second");
  assert.equal(history[0].summary, "New summary");
  assert.deepEqual(history[0].repos, ["owner/app"]);
});
