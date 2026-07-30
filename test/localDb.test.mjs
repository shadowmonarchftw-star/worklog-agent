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

test("automation schema includes days, attempts, lease, foreign keys, and indexes", () => {
  const db = tempDb();

  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name LIKE 'automation_%'
       ORDER BY name`,
    )
    .all()
    .map(({ name }) => name);
  assert.deepEqual(tables, [
    "automation_attempts",
    "automation_days",
    "automation_lease",
  ]);

  assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
  assert.deepEqual(
    db
      .prepare("SELECT singleton FROM automation_lease")
      .all()
      .map(({ singleton }) => singleton),
    [1],
  );

  const indexes = db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'index' AND tbl_name = 'automation_attempts'
         AND name NOT LIKE 'sqlite_autoindex%'`,
    )
    .all()
    .map(({ name }) => name);
  assert.ok(indexes.includes("automation_attempts_work_date_idx"));
  assert.ok(indexes.includes("automation_attempts_status_idx"));
  assert.ok(indexes.includes("automation_attempts_created_at_idx"));

  const foreignKeys = db.pragma("foreign_key_list('automation_attempts')");
  assert.ok(
    foreignKeys.some(
      ({ table, from, to }) =>
        table === "history" && from === "history_id" && to === "id",
    ),
  );
});
