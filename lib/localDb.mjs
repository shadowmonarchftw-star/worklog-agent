import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

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
      created_at TEXT NOT NULL
    );
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
  ).run(key, JSON.stringify(value), new Date().toISOString());
}

export function getSetting(db, key) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? JSON.parse(row.value) : null;
}

export function saveHistoryEntry(db, entry) {
  db.prepare(
    `INSERT INTO history
      (id, developer_name, work_date, style, repos, activity, summary, created_at)
     VALUES
      (@id, @developerName, @workDate, @style, @repos, @activity, @summary, @createdAt)
     ON CONFLICT(work_date) DO UPDATE SET
      id = excluded.id,
      developer_name = excluded.developer_name,
      style = excluded.style,
      repos = excluded.repos,
      activity = excluded.activity,
      summary = excluded.summary,
      created_at = excluded.created_at`,
  ).run({
    ...entry,
    repos: JSON.stringify(entry.repos || []),
  });
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
      createdAt: row.created_at,
    }));
}

export function deleteHistoryEntry(db, id) {
  db.prepare("DELETE FROM history WHERE id = ?").run(id);
}
