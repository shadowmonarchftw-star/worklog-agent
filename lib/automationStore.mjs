import { createHash, randomUUID } from "node:crypto";

import { getSetting, setSetting } from "./localDb.mjs";

const SETTINGS_KEY = "automation";
const LEASE_MS = 5 * 60 * 1000;
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const TERMINAL_STATUSES = new Set(["success", "no_activity", "failed"]);

export const AUTOMATION_SETTINGS_DEFAULTS = Object.freeze({
  enabled: false,
  time: "17:30",
  days: Object.freeze([1, 2, 3, 4, 5]),
  startAtLogin: false,
  startAtLoginConfigured: false,
});

function iso(value, field = "timestamp") {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new TypeError(`${field} must be a valid timestamp`);
  }
  return date.toISOString();
}

function leaseExpiry(now) {
  return new Date(new Date(now).valueOf() + LEASE_MS).toISOString();
}

function validateSettings(settings) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(settings.time)) {
    throw new TypeError("Automation time must use HH:mm");
  }
  if (
    !Array.isArray(settings.days) ||
    settings.days.length === 0 ||
    settings.days.some(
      (day) => !Number.isInteger(day) || day < 1 || day > 7,
    )
  ) {
    throw new TypeError("Automation days must be ISO weekday values 1 through 7");
  }
}

export function getAutomationSettings(db) {
  const stored = getSetting(db, SETTINGS_KEY) || {};
  const days = db
    .prepare("SELECT weekday FROM automation_days ORDER BY weekday")
    .all()
    .map(({ weekday }) => weekday);
  const settings = {
    ...AUTOMATION_SETTINGS_DEFAULTS,
    ...stored,
    days: days.length ? days : [...AUTOMATION_SETTINGS_DEFAULTS.days],
  };
  validateSettings(settings);
  return settings;
}

export function saveAutomationSettings(db, patch) {
  const save = db.transaction(() => {
    const current = getAutomationSettings(db);
    const next = { ...current, ...patch };

    if (
      patch.enabled === true &&
      current.enabled === false &&
      current.startAtLoginConfigured === false &&
      patch.startAtLogin === undefined
    ) {
      next.startAtLogin = true;
      next.startAtLoginConfigured = true;
    }
    if (patch.startAtLogin !== undefined) {
      next.startAtLoginConfigured = true;
    }

    next.days = [...new Set(next.days)].sort((a, b) => a - b);
    validateSettings(next);
    db.prepare("DELETE FROM automation_days").run();
    const insertDay = db.prepare(
      "INSERT INTO automation_days (weekday) VALUES (?)",
    );
    for (const day of next.days) insertDay.run(day);
    setSetting(db, SETTINGS_KEY, {
      enabled: Boolean(next.enabled),
      time: next.time,
      startAtLogin: Boolean(next.startAtLogin),
      startAtLoginConfigured: Boolean(next.startAtLoginConfigured),
    });
    return next;
  });
  return save();
}

function sanitize(value, maxLength) {
  if (value == null) return null;
  return String(value).replace(/\s+/g, " ").trim().slice(0, maxLength) || null;
}

export function normalizeIntendedRow(row) {
  const normalize = (value) =>
    String(value ?? "")
      .replace(/\s+/g, " ")
      .trim();
  return {
    date: normalize(row?.date),
    summary: normalize(row?.summary),
    reference: normalize(row?.reference),
    hours: normalize(row?.hours),
    comments: normalize(row?.comments),
  };
}

function mapAttempt(row) {
  if (!row) return null;
  return {
    id: row.id,
    workDate: row.work_date,
    trigger: row.trigger,
    status: row.status,
    ownerId: row.owner_id,
    retryOfId: row.retry_of_id,
    intendedRow: row.intended_row_json
      ? JSON.parse(row.intended_row_json)
      : null,
    intendedRowHash: row.intended_row_hash,
    preWriteRowHash: row.pre_write_row_hash,
    historyId: row.history_id,
    retryDueAt: row.retry_due_at,
    sheetAction: row.sheet_action,
    sheetRow: row.sheet_row,
    errorCategory: row.error_category,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function interruptStaleRows(db, now) {
  const cutoff = new Date(new Date(now).valueOf() - LEASE_MS).toISOString();
  const result = db.prepare(
    `UPDATE automation_attempts
     SET status = 'interrupted', updated_at = ?, completed_at = ?
     WHERE status = 'running' AND updated_at <= ?
       AND id NOT IN (
         SELECT attempt_id FROM automation_lease
         WHERE singleton = 1 AND attempt_id IS NOT NULL AND expires_at > ?
       )`,
  ).run(now, now, cutoff, now);
  db.prepare(
    `UPDATE automation_lease
     SET owner_id = NULL, attempt_id = NULL, expires_at = NULL
     WHERE singleton = 1 AND (
       expires_at <= ?
       OR attempt_id IN (
         SELECT id FROM automation_attempts WHERE status != 'running'
       )
     )`,
  ).run(now);
  return result.changes;
}

export function claimAutomationAttempt(
  db,
  { workDate, trigger, ownerId, now = new Date().toISOString() },
) {
  if (!["automatic", "manual"].includes(trigger)) {
    throw new TypeError("trigger must be automatic or manual");
  }
  const claimedAt = iso(now, "now");
  const claim = db.transaction(() => {
    interruptStaleRows(db, claimedAt);
    const lease = db
      .prepare("SELECT attempt_id, expires_at FROM automation_lease WHERE singleton = 1")
      .get();
    if (lease.attempt_id && lease.expires_at > claimedAt) {
      return { outcome: "already_running", attempt: null };
    }

    let retryOfId = null;
    if (trigger === "automatic") {
      const prior = db
        .prepare(
          `SELECT id, status FROM automation_attempts
           WHERE work_date = ? AND trigger = 'automatic'
           ORDER BY created_at, id`,
        )
        .all(workDate);
      if (prior.length >= 2 || prior.some(({ status }) => status === "success")) {
        return { outcome: "retry_limit", attempt: null };
      }
      retryOfId = prior[0]?.id || null;
    }

    const id = randomUUID();
    db.prepare(
      `INSERT INTO automation_attempts
        (id, work_date, trigger, status, owner_id, retry_of_id, created_at, updated_at)
       VALUES (?, ?, ?, 'running', ?, ?, ?, ?)`,
    ).run(id, workDate, trigger, ownerId, retryOfId, claimedAt, claimedAt);
    db.prepare(
      `UPDATE automation_lease
       SET owner_id = ?, attempt_id = ?, expires_at = ?
       WHERE singleton = 1`,
    ).run(ownerId, id, leaseExpiry(claimedAt));
    return {
      outcome: "claimed",
      attempt: mapAttempt(
        db.prepare("SELECT * FROM automation_attempts WHERE id = ?").get(id),
      ),
    };
  });

  return claim.immediate();
}

export function renewAutomationLease(
  db,
  { ownerId, now = new Date().toISOString() },
) {
  const renewedAt = iso(now, "now");
  return (
    db
      .prepare(
        `UPDATE automation_lease
         SET expires_at = ?
         WHERE singleton = 1 AND owner_id = ? AND attempt_id IS NOT NULL
           AND expires_at > ?`,
      )
      .run(leaseExpiry(renewedAt), ownerId, renewedAt).changes === 1
  );
}

export function releaseAutomationLease(db, { ownerId }) {
  return (
    db
      .prepare(
        `UPDATE automation_lease
         SET owner_id = NULL, attempt_id = NULL, expires_at = NULL
         WHERE singleton = 1 AND owner_id = ?`,
      )
      .run(ownerId).changes === 1
  );
}

export function transitionAutomationAttempt(
  db,
  {
    attemptId,
    to,
    ownerId,
    now = new Date().toISOString(),
    intendedRow,
    preWriteRowHash,
    historyId,
    retryDueAt,
    sheetAction,
    sheetRow,
    errorCategory,
    errorMessage,
  },
) {
  const transitionedAt = iso(now, "now");
  const transition = db.transaction(() => {
    const row = db
      .prepare("SELECT * FROM automation_attempts WHERE id = ?")
      .get(attemptId);
    if (!row) throw new Error("Automation attempt not found");
    const allowed =
      (row.status === "running" && TERMINAL_STATUSES.has(to)) ||
      (row.status === "interrupted" && ["success", "failed"].includes(to));
    if (!allowed) {
      throw new Error(`Invalid automation transition: ${row.status} -> ${to}`);
    }
    if (row.status === "running" && ownerId !== row.owner_id) {
      throw new Error("Automation transition owner does not match");
    }

    let intendedRowJson = row.intended_row_json;
    let intendedRowHash = row.intended_row_hash;
    if (intendedRow !== undefined) {
      const normalized = normalizeIntendedRow(intendedRow);
      intendedRowJson = JSON.stringify(normalized);
      intendedRowHash = createHash("sha256")
        .update(intendedRowJson)
        .digest("hex");
    }

    db.prepare(
      `UPDATE automation_attempts SET
        status = @status,
        intended_row_json = @intendedRowJson,
        intended_row_hash = @intendedRowHash,
        pre_write_row_hash = COALESCE(@preWriteRowHash, pre_write_row_hash),
        history_id = COALESCE(@historyId, history_id),
        retry_due_at = COALESCE(@retryDueAt, retry_due_at),
        sheet_action = COALESCE(@sheetAction, sheet_action),
        sheet_row = COALESCE(@sheetRow, sheet_row),
        error_category = @errorCategory,
        error_message = @errorMessage,
        updated_at = @updatedAt,
        completed_at = @completedAt
       WHERE id = @id`,
    ).run({
      id: attemptId,
      status: to,
      intendedRowJson,
      intendedRowHash,
      preWriteRowHash: preWriteRowHash ?? null,
      historyId: historyId ?? null,
      retryDueAt: retryDueAt ? iso(retryDueAt, "retryDueAt") : null,
      sheetAction: sheetAction ?? null,
      sheetRow: sheetRow ?? null,
      errorCategory: sanitize(errorCategory, 80),
      errorMessage: sanitize(errorMessage, 1000),
      updatedAt: transitionedAt,
      completedAt: transitionedAt,
    });
    if (row.status === "running") {
      releaseAutomationLease(db, { ownerId });
    }
    return mapAttempt(
      db.prepare("SELECT * FROM automation_attempts WHERE id = ?").get(attemptId),
    );
  });
  return transition.immediate();
}

export function interruptStaleAttempts(
  db,
  { now = new Date().toISOString() } = {},
) {
  const interruptedAt = iso(now, "now");
  const interrupt = db.transaction(() => {
    return interruptStaleRows(db, interruptedAt);
  });
  return interrupt.immediate();
}

function latestAttempt(db, where = "1 = 1") {
  return mapAttempt(
    db
      .prepare(
        `SELECT * FROM automation_attempts
         WHERE ${where}
         ORDER BY created_at DESC, id DESC LIMIT 1`,
      )
      .get(),
  );
}

export function getAutomationStatus(db) {
  return {
    lastAttempt: latestAttempt(db),
    lastSuccess: latestAttempt(db, "status = 'success'"),
    lastError: latestAttempt(db, "status = 'failed'"),
  };
}

export function cleanupAutomationAttempts(
  db,
  { now = new Date().toISOString() } = {},
) {
  const cutoff = new Date(new Date(iso(now, "now")).valueOf() - RETENTION_MS)
    .toISOString();
  return db
    .prepare(
      `DELETE FROM automation_attempts
       WHERE status != 'running' AND completed_at < ?`,
    )
    .run(cutoff).changes;
}
