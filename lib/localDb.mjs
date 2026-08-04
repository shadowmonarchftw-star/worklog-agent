import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { protectSetting, revealSetting } from "./secureSettings.mjs";

let appDb;

export function appDataDir() {
  if (process.env.WORKLOG_AGENT_DATA_DIR) {
    return process.env.WORKLOG_AGENT_DATA_DIR;
  }

  if (process.platform === "darwin") {
    return path.join(homedir(), "Library", "Application Support", "AI Worklog Agent");
  }

  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || homedir(), "AI Worklog Agent");
  }

  return path.join(process.env.XDG_DATA_HOME || path.join(homedir(), ".local", "share"), "ai-worklog-agent");
}

export function createLocalDb(dbPath = path.join(appDataDir(), "worklog.sqlite")) {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS history (
      id TEXT PRIMARY KEY,
      developer_name TEXT NOT NULL,
      work_date TEXT NOT NULL UNIQUE,
      style TEXT NOT NULL,
      repos TEXT NOT NULL,
      activity TEXT NOT NULL,
      summary TEXT NOT NULL,
      commit_count INTEGER NOT NULL DEFAULT 0,
      pull_request_count INTEGER NOT NULL DEFAULT 0,
      activity_source TEXT NOT NULL DEFAULT 'github',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sheet_writes (
      id TEXT PRIMARY KEY,
      work_date TEXT NOT NULL,
      tab TEXT NOT NULL,
      row_number INTEGER NOT NULL,
      action TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  for (const column of [
    ["commit_count", "INTEGER NOT NULL DEFAULT 0"],
    ["pull_request_count", "INTEGER NOT NULL DEFAULT 0"],
    ["activity_source", "TEXT NOT NULL DEFAULT 'github'"],
    ["edited_summary", "TEXT"],
  ]) {
    if (!db.pragma("table_info('history')").some((item) => item.name === column[0])) db.exec(`ALTER TABLE history ADD COLUMN ${column[0]} ${column[1]}`);
  }

  const legacyAutomationDays = db
    .pragma("table_info('automation_days')")
    .some(({ name }) => name === "weekday");
  if (legacyAutomationDays) {
    const legacySettingsRow = db
      .prepare("SELECT value, updated_at FROM settings WHERE key = 'automation'")
      .get();
    const legacyDays = db
      .prepare("SELECT weekday FROM automation_days ORDER BY weekday")
      .all()
      .map(({ weekday }) => weekday);
    let migratedSettings;
    if (legacySettingsRow) {
      const parsed = JSON.parse(legacySettingsRow.value);
      migratedSettings = JSON.stringify({ ...parsed, days: legacyDays });
    }
    let archiveVersion = 1;
    while (
      db
        .prepare(
          `SELECT 1 FROM sqlite_master
           WHERE type = 'table' AND name = ?`,
        )
        .get(`automation_days_legacy_v${archiveVersion}`)
    ) {
      archiveVersion += 1;
    }
    const suffix = `_legacy_v${archiveVersion}`;
    db.pragma("foreign_keys = OFF");
    try {
      const migrateLegacyAutomation = db.transaction(() => {
        if (migratedSettings) {
          db.prepare(
            `INSERT INTO settings (key, value, updated_at)
             VALUES ('automation-settings', ?, ?)
             ON CONFLICT(key) DO NOTHING`,
          ).run(migratedSettings, legacySettingsRow.updated_at);
        }
        db.exec(`
        DROP INDEX IF EXISTS automation_attempts_one_running_idx;
        DROP INDEX IF EXISTS automation_attempts_work_date_idx;
        DROP INDEX IF EXISTS automation_attempts_status_idx;
        DROP INDEX IF EXISTS automation_attempts_created_at_idx;
        DROP INDEX IF EXISTS automation_attempts_completed_at_idx;
        ALTER TABLE automation_lease
          RENAME TO automation_lease${suffix};
        ALTER TABLE automation_attempts
          RENAME TO automation_attempts${suffix};
        ALTER TABLE automation_days
          RENAME TO automation_days${suffix};
        `);
      });
      migrateLegacyAutomation.immediate();
    } catch (error) {
      throw error;
    } finally {
      db.pragma("foreign_keys = ON");
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS automation_days (
      id TEXT PRIMARY KEY,
      work_date TEXT NOT NULL UNIQUE,
      timezone TEXT NOT NULL,
      since TEXT NOT NULL,
      until TEXT NOT NULL,
      terminal_outcome TEXT CHECK (
        terminal_outcome IN ('success', 'no_activity', 'failed')
      ),
      success_attempt_id TEXT REFERENCES automation_attempts(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS automation_attempts (
      id TEXT PRIMARY KEY,
      day_id TEXT NOT NULL REFERENCES automation_days(id) ON DELETE CASCADE,
      work_date TEXT NOT NULL,
      trigger TEXT NOT NULL CHECK (trigger IN ('automatic', 'manual')),
      status TEXT NOT NULL CHECK (
        status IN ('running', 'success', 'no_activity', 'failed', 'interrupted')
      ),
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

    CREATE TABLE IF NOT EXISTS automation_lease (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      owner_id TEXT,
      attempt_id TEXT REFERENCES automation_attempts(id) ON DELETE SET NULL,
      expires_at TEXT
    );

    INSERT OR IGNORE INTO automation_lease (singleton) VALUES (1);

    CREATE UNIQUE INDEX IF NOT EXISTS automation_attempts_one_running_idx
      ON automation_attempts(status) WHERE status = 'running';
    CREATE INDEX IF NOT EXISTS automation_attempts_work_date_idx
      ON automation_attempts(work_date);
    CREATE INDEX IF NOT EXISTS automation_attempts_status_idx
      ON automation_attempts(status);
    CREATE INDEX IF NOT EXISTS automation_attempts_created_at_idx
      ON automation_attempts(created_at);
    CREATE INDEX IF NOT EXISTS automation_attempts_completed_at_idx
      ON automation_attempts(completed_at);
  `);
  return db;
}

export function getAppDb() {
  appDb ||= createLocalDb();
  return appDb;
}

export function setSetting(db, key, value) {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, JSON.stringify(protectSetting(key, value)), new Date().toISOString());
}

export function getSetting(db, key) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? revealSetting(key, JSON.parse(row.value)) : null;
}

export function saveSheetWrite(db, entry) {
  db.prepare("INSERT INTO sheet_writes (id, work_date, tab, row_number, action, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(entry.id, entry.workDate, entry.tab, entry.rowNumber, entry.action, entry.createdAt);
}

export function listSheetWrites(db) {
  return db.prepare("SELECT * FROM sheet_writes ORDER BY created_at DESC LIMIT 50").all().map((row) => ({ id: row.id, workDate: row.work_date, tab: row.tab, rowNumber: row.row_number, action: row.action, createdAt: row.created_at }));
}

export function saveHistoryEntry(db, entry) {
  db.prepare(
    `INSERT INTO history
      (id, developer_name, work_date, style, repos, activity, summary, edited_summary, commit_count, pull_request_count, activity_source, created_at)
     VALUES
      (@id, @developerName, @workDate, @style, @repos, @activity, @summary, @editedSummary, @commitCount, @pullRequestCount, @activitySource, @createdAt)
     ON CONFLICT(work_date) DO UPDATE SET
      developer_name = excluded.developer_name,
      style = excluded.style,
      repos = excluded.repos,
      activity = excluded.activity,
      summary = excluded.summary,
      edited_summary = excluded.edited_summary,
      commit_count = excluded.commit_count,
      pull_request_count = excluded.pull_request_count,
      activity_source = excluded.activity_source,
      created_at = excluded.created_at`,
  ).run({
    ...entry,
    editedSummary: entry.editedSummary?.trim() || null,
    commitCount: entry.commitCount || 0,
    pullRequestCount: entry.pullRequestCount || 0,
    activitySource: entry.activitySource || "github",
    repos: JSON.stringify(entry.repos || []),
  });
  const saved = db.prepare("SELECT * FROM history WHERE work_date = ?").get(
    entry.workDate,
  );
  return {
    id: saved.id,
    developerName: saved.developer_name,
    workDate: saved.work_date,
    style: saved.style,
    repos: JSON.parse(saved.repos),
    activity: saved.activity,
    summary: saved.summary,
    editedSummary: saved.edited_summary || "",
    commitCount: saved.commit_count,
    pullRequestCount: saved.pull_request_count,
    activitySource: saved.activity_source,
    createdAt: saved.created_at,
  };
}

export function listHistory(db) {
  return db
    .prepare("SELECT * FROM history ORDER BY created_at DESC LIMIT 20")
    .all()
    .map((row) => ({
      id: row.id,
      developerName: row.developer_name,
      workDate: row.work_date,
      style: row.style,
      repos: JSON.parse(row.repos),
      activity: row.activity,
      summary: row.summary,
      editedSummary: row.edited_summary || "",
      commitCount: row.commit_count,
      pullRequestCount: row.pull_request_count,
      activitySource: row.activity_source,
      createdAt: row.created_at,
    }));
}

// Only a rewrite carries information about how the user wants to sound, and only
// one written in the style being asked for: a bullet-point example would pull a
// concise summary toward bullets and fight the style instruction.
export function listSummaryExamples(db, { style, limit = 3 } = {}) {
  return db
    .prepare(
      `SELECT summary, edited_summary FROM history
       WHERE style = ?
         AND edited_summary IS NOT NULL
         AND TRIM(edited_summary) <> ''
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(style || "concise", Math.max(0, limit) * 2)
    .filter((row) => row.edited_summary.trim() !== row.summary.trim())
    .slice(0, Math.max(0, limit))
    .map((row) => row.edited_summary.trim());
}

export function deleteHistoryEntry(db, id) {
  db.prepare("DELETE FROM history WHERE id = ?").run(id);
}
