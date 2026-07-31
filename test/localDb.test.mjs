import assert from "node:assert/strict";
import Database from "better-sqlite3";
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
  assert.equal(history[0].id, "first");
  assert.equal(history[0].summary, "New summary");
  assert.deepEqual(history[0].repos, ["owner/app"]);
});

test("replacing history for a completed work date preserves referenced history ID", () => {
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
  db.prepare(
    `INSERT INTO automation_days
      (id, work_date, timezone, since, until, terminal_outcome,
       success_attempt_id, created_at, updated_at, completed_at)
     VALUES (
       'day-1', '2026-07-23', 'UTC',
       '2026-07-23T00:00:00.000Z', '2026-07-24T00:00:00.000Z',
       NULL, NULL, '2026-07-23T10:00:00.000Z',
       '2026-07-23T10:00:00.000Z', NULL
     )`,
  ).run();
  db.prepare(
    `INSERT INTO automation_attempts
      (id, day_id, work_date, trigger, status, owner_id, history_id,
       created_at, updated_at, completed_at)
     VALUES (
       'attempt-1', 'day-1', '2026-07-23', 'manual', 'success',
       'runner', 'first', '2026-07-23T10:00:00.000Z',
       '2026-07-23T10:01:00.000Z', '2026-07-23T10:01:00.000Z'
     )`,
  ).run();

  const saved = saveHistoryEntry(db, {
    id: "second",
    developerName: "Asha",
    workDate: "2026-07-23",
    style: "standup",
    repos: ["owner/app"],
    activity: "new",
    summary: "New summary",
    createdAt: "2026-07-23T11:00:00.000Z",
  });

  assert.equal(saved.id, "first");
  assert.equal(saved.summary, "New summary");
  assert.equal(
    db.prepare("SELECT history_id FROM automation_attempts WHERE id = ?").get(
      "attempt-1",
    ).history_id,
    "first",
  );
});

test("automation schema includes durable days, linked attempts, lease, and indexes", () => {
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
    db.prepare("SELECT singleton FROM automation_lease").all().map(
      ({ singleton }) => singleton,
    ),
    [1],
  );

  const dayColumns = db.pragma("table_info('automation_days')").map(
    ({ name }) => name,
  );
  assert.deepEqual(dayColumns, [
    "id",
    "work_date",
    "timezone",
    "since",
    "until",
    "terminal_outcome",
    "success_attempt_id",
    "created_at",
    "updated_at",
    "completed_at",
  ]);

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
        table === "automation_days" && from === "day_id" && to === "id",
    ),
  );
  assert.ok(
    foreignKeys.some(
      ({ table, from, to }) =>
        table === "history" && from === "history_id" && to === "id",
    ),
  );
});

test("legacy automation schema upgrade archives every populated row", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "worklog-legacy-db-"));
  const dbPath = path.join(dir, "test.sqlite");
  const legacy = new Database(dbPath);
  legacy.exec(`
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE history (
      id TEXT PRIMARY KEY,
      developer_name TEXT NOT NULL,
      work_date TEXT NOT NULL UNIQUE,
      style TEXT NOT NULL,
      repos TEXT NOT NULL,
      activity TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE automation_days (
      weekday INTEGER PRIMARY KEY CHECK (weekday BETWEEN 1 AND 7)
    );
    CREATE TABLE automation_attempts (
      id TEXT PRIMARY KEY,
      work_date TEXT NOT NULL,
      trigger TEXT NOT NULL,
      status TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      retry_of_id TEXT REFERENCES automation_attempts(id) ON DELETE SET NULL,
      intended_row_json TEXT,
      intended_row_hash TEXT,
      pre_write_row_hash TEXT,
      history_id TEXT REFERENCES history(id) ON DELETE SET NULL,
      retry_due_at TEXT,
      sheet_action TEXT,
      sheet_row INTEGER,
      error_category TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE automation_lease (
      singleton INTEGER PRIMARY KEY,
      owner_id TEXT,
      attempt_id TEXT REFERENCES automation_attempts(id) ON DELETE SET NULL,
      expires_at TEXT
    );
    CREATE INDEX automation_attempts_work_date_idx
      ON automation_attempts(work_date);
    INSERT INTO automation_days VALUES (1), (5);
    INSERT INTO settings (key, value, updated_at) VALUES (
      'automation',
      '{"enabled":true,"time":"18:45","startAtLogin":false,"startAtLoginConfigured":true}',
      '2026-07-30T09:00:00.000Z'
    );
    INSERT INTO automation_attempts (
      id, work_date, trigger, status, owner_id, intended_row_json,
      created_at, updated_at
    ) VALUES (
      'legacy-attempt', '2026-07-30', 'automatic', 'running',
      'legacy-owner', '{"date":"2026-07-30"}',
      '2026-07-30T10:00:00.000Z', '2026-07-30T10:01:00.000Z'
    );
    INSERT INTO automation_lease
      (singleton, owner_id, attempt_id, expires_at)
    VALUES (
      1, 'legacy-owner', 'legacy-attempt', '2026-07-30T10:05:00.000Z'
    );
  `);
  legacy.close();

  const upgraded = createLocalDb(dbPath);

  assert.deepEqual(getSetting(upgraded, "automation-settings"), {
    enabled: true,
    time: "18:45",
    days: [1, 5],
    startAtLogin: false,
    startAtLoginConfigured: true,
  });
  assert.deepEqual(getSetting(upgraded, "automation"), {
    enabled: true,
    time: "18:45",
    startAtLogin: false,
    startAtLoginConfigured: true,
  });
  assert.deepEqual(
    upgraded.prepare(
      "SELECT weekday FROM automation_days_legacy_v1 ORDER BY weekday",
    ).all(),
    [{ weekday: 1 }, { weekday: 5 }],
  );
  assert.deepEqual(
    upgraded.prepare(
      `SELECT id, work_date, status, owner_id, intended_row_json
       FROM automation_attempts_legacy_v1`,
    ).get(),
    {
      id: "legacy-attempt",
      work_date: "2026-07-30",
      status: "running",
      owner_id: "legacy-owner",
      intended_row_json: '{"date":"2026-07-30"}',
    },
  );
  assert.deepEqual(
    upgraded.prepare(
      `SELECT singleton, owner_id, attempt_id, expires_at
       FROM automation_lease_legacy_v1`,
    ).get(),
    {
      singleton: 1,
      owner_id: "legacy-owner",
      attempt_id: "legacy-attempt",
      expires_at: "2026-07-30T10:05:00.000Z",
    },
  );
  assert.equal(
    upgraded.prepare("SELECT COUNT(*) AS count FROM automation_attempts").get()
      .count,
    0,
  );
  assert.deepEqual(upgraded.pragma("foreign_key_check"), []);
});
