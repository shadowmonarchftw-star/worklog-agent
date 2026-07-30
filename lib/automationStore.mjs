import { createHash, randomUUID } from "node:crypto";

import {
  localDayUtcRange,
  localTimezone,
  nextScheduledAt,
} from "./localDate.mjs";
import { getSetting, setSetting } from "./localDb.mjs";

const SETTINGS_KEY = "automation-settings";
const LEASE_MS = 5 * 60 * 1000;
const STALE_MS = 30 * 60 * 1000;
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

function validateSettings(settings) {
  for (const field of [
    "enabled",
    "startAtLogin",
    "startAtLoginConfigured",
  ]) {
    if (typeof settings[field] !== "boolean") {
      throw new TypeError(`${field} must be a boolean`);
    }
  }
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
  const settings = {
    ...AUTOMATION_SETTINGS_DEFAULTS,
    ...(getSetting(db, SETTINGS_KEY) || {}),
  };
  settings.days = [...settings.days];
  validateSettings(settings);
  return settings;
}

export function saveAutomationSettings(db, patch) {
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
  if (current.startAtLoginConfigured) {
    next.startAtLoginConfigured = true;
  }

  next.days = [...new Set(next.days)].sort((left, right) => left - right);
  validateSettings(next);
  setSetting(db, SETTINGS_KEY, next);
  return next;
}

function leaseExpiry(now) {
  return new Date(new Date(now).valueOf() + LEASE_MS).toISOString();
}

function collapse(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function redactSecrets(value) {
  return String(value)
    .replace(
      /\bAuthorization\s*:\s*(?:Bearer|Basic)?\s*[^\s,;]+/gi,
      "Authorization: [REDACTED]",
    )
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "[REDACTED]")
    .replace(/\bgh[oprsu]_[A-Za-z0-9_]{16,}\b/g, "[REDACTED]")
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]")
    .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, "[REDACTED]")
    .replace(
      /(["']?(?:access_token|refresh_token|id_token|api_key|apikey|client_secret|clientSecret|oauth_token|token|key|secret|password|credential)["']?\s*[:=]\s*["']?)[^"'&\s,;}]+/gi,
      "$1[REDACTED]",
    );
}

function sanitize(value, maxLength) {
  if (value == null) return null;
  return collapse(redactSecrets(value)).slice(0, maxLength) || null;
}

export function normalizeIntendedRow(row) {
  return {
    date: collapse(row?.date),
    summary: collapse(row?.summary),
    reference: collapse(row?.reference),
    hours: collapse(row?.hours),
    comments: collapse(row?.comments),
  };
}

function mapAttempt(row) {
  if (!row) return null;
  return {
    id: row.id,
    dayId: row.day_id,
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

function fetchAttempt(db, id) {
  return db.prepare("SELECT * FROM automation_attempts WHERE id = ?").get(id);
}

function requireRunningOwner(db, attemptId, ownerId) {
  const row = fetchAttempt(db, attemptId);
  if (!row) throw new Error("Automation attempt not found");
  if (row.status !== "running") {
    throw new Error("Automation checkpoint requires a running attempt");
  }
  if (row.owner_id !== ownerId) {
    throw new Error("Automation checkpoint owner does not match");
  }
  return row;
}

function ensureDay(
  db,
  { workDate, timezone, since, until, now },
) {
  let day = db
    .prepare("SELECT * FROM automation_days WHERE work_date = ?")
    .get(workDate);
  if (!day) {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO automation_days
        (id, work_date, timezone, since, until, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, workDate, timezone, since, until, now, now);
    day = db.prepare("SELECT * FROM automation_days WHERE id = ?").get(id);
  }
  return day;
}

function expireLeaseOwner(db, now) {
  const lease = db.prepare(
    `SELECT attempt_id, expires_at FROM automation_lease
     WHERE singleton = 1`,
  ).get();
  if (!lease?.attempt_id || !lease.expires_at || lease.expires_at > now) {
    return 0;
  }
  const result = db.prepare(
    `UPDATE automation_attempts
     SET status = 'interrupted', updated_at = ?, completed_at = ?
     WHERE id = ? AND status = 'running'`,
  ).run(now, now, lease.attempt_id);
  db.prepare(
    `UPDATE automation_lease
     SET owner_id = NULL, attempt_id = NULL, expires_at = NULL
     WHERE singleton = 1`,
  ).run();
  return result.changes;
}

export function claimAutomationAttempt(
  db,
  {
    workDate,
    trigger,
    ownerId,
    timezone = localTimezone(),
    since,
    until,
    now = new Date().toISOString(),
  },
) {
  if (!["automatic", "manual"].includes(trigger)) {
    throw new TypeError("trigger must be automatic or manual");
  }
  const claimedAt = iso(now, "now");
  const range = since && until
    ? { since: iso(since, "since"), until: iso(until, "until") }
    : localDayUtcRange(workDate, timezone);

  const claim = db.transaction(() => {
    expireLeaseOwner(db, claimedAt);
    const lease = db.prepare(
      `SELECT attempt_id, expires_at FROM automation_lease
       WHERE singleton = 1`,
    ).get();
    if (lease.attempt_id && lease.expires_at > claimedAt) {
      return { outcome: "already_running", attempt: null };
    }

    const day = ensureDay(db, {
      workDate,
      timezone,
      ...range,
      now: claimedAt,
    });
    if (trigger === "automatic" && day.terminal_outcome) {
      return { outcome: "retry_limit", attempt: null };
    }

    let retryOfId = null;
    if (trigger === "automatic") {
      const prior = db.prepare(
        `SELECT id, status FROM automation_attempts
         WHERE day_id = ? AND trigger = 'automatic'
         ORDER BY created_at, id`,
      ).all(day.id);
      if (
        prior.length >= 2 ||
        (prior.length === 1 &&
          !["failed", "interrupted"].includes(prior[0].status))
      ) {
        return { outcome: "retry_limit", attempt: null };
      }
      retryOfId = prior[0]?.id || null;
    }

    const id = randomUUID();
    db.prepare(
      `INSERT INTO automation_attempts
        (id, day_id, work_date, trigger, status, owner_id, retry_of_id,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?)`,
    ).run(
      id,
      day.id,
      workDate,
      trigger,
      ownerId,
      retryOfId,
      claimedAt,
      claimedAt,
    );
    db.prepare(
      `UPDATE automation_days SET updated_at = ? WHERE id = ?`,
    ).run(claimedAt, day.id);
    db.prepare(
      `UPDATE automation_lease
       SET owner_id = ?, attempt_id = ?, expires_at = ?
       WHERE singleton = 1`,
    ).run(ownerId, id, leaseExpiry(claimedAt));
    return { outcome: "claimed", attempt: mapAttempt(fetchAttempt(db, id)) };
  });
  return claim.immediate();
}

export function renewAutomationLease(
  db,
  { ownerId, now = new Date().toISOString() },
) {
  const renewedAt = iso(now, "now");
  return db.prepare(
    `UPDATE automation_lease
     SET expires_at = ?
     WHERE singleton = 1 AND owner_id = ? AND attempt_id IS NOT NULL
       AND expires_at > ?`,
  ).run(leaseExpiry(renewedAt), ownerId, renewedAt).changes === 1;
}

export function releaseAutomationLease(db, { ownerId }) {
  return db.prepare(
    `UPDATE automation_lease
     SET owner_id = NULL, attempt_id = NULL, expires_at = NULL
     WHERE singleton = 1 AND owner_id = ?`,
  ).run(ownerId).changes === 1;
}

export function checkpointAutomationIntent(
  db,
  {
    attemptId,
    ownerId,
    intendedRow,
    now = new Date().toISOString(),
  },
) {
  const checkpointedAt = iso(now, "now");
  const checkpoint = db.transaction(() => {
    const row = requireRunningOwner(db, attemptId, ownerId);
    const intendedRowJson = JSON.stringify(normalizeIntendedRow(intendedRow));
    const intendedRowHash = createHash("sha256")
      .update(intendedRowJson)
      .digest("hex");
    if (
      row.intended_row_json &&
      (row.intended_row_json !== intendedRowJson ||
        row.intended_row_hash !== intendedRowHash)
    ) {
      throw new Error("Automation intended row is immutable once checkpointed");
    }
    if (!row.intended_row_json) {
      db.prepare(
        `UPDATE automation_attempts
         SET intended_row_json = ?, intended_row_hash = ?, updated_at = ?
         WHERE id = ?`,
      ).run(intendedRowJson, intendedRowHash, checkpointedAt, attemptId);
    }
    return mapAttempt(fetchAttempt(db, attemptId));
  });
  return checkpoint.immediate();
}

export function checkpointAutomationPreWrite(
  db,
  {
    attemptId,
    ownerId,
    preWriteRowHash,
    now = new Date().toISOString(),
  },
) {
  const checkpointedAt = iso(now, "now");
  if (
    preWriteRowHash !== "row_absent" &&
    !/^[a-f0-9]{64}$/.test(preWriteRowHash)
  ) {
    throw new TypeError("preWriteRowHash must be row_absent or a SHA-256 hash");
  }
  const checkpoint = db.transaction(() => {
    const row = requireRunningOwner(db, attemptId, ownerId);
    if (!row.intended_row_json) {
      throw new Error("Automation prewrite checkpoint requires an intended row");
    }
    if (
      row.pre_write_row_hash &&
      row.pre_write_row_hash !== preWriteRowHash
    ) {
      throw new Error("Automation prewrite evidence is immutable once checkpointed");
    }
    if (!row.pre_write_row_hash) {
      db.prepare(
        `UPDATE automation_attempts
         SET pre_write_row_hash = ?, updated_at = ? WHERE id = ?`,
      ).run(preWriteRowHash, checkpointedAt, attemptId);
    }
    return mapAttempt(fetchAttempt(db, attemptId));
  });
  return checkpoint.immediate();
}

export function checkpointAutomationHistory(
  db,
  {
    attemptId,
    ownerId,
    historyId,
    now = new Date().toISOString(),
  },
) {
  const checkpointedAt = iso(now, "now");
  if (typeof historyId !== "string" || !historyId.trim()) {
    throw new TypeError("historyId must be a non-empty string");
  }
  const checkpoint = db.transaction(() => {
    const row = requireRunningOwner(db, attemptId, ownerId);
    if (row.history_id && row.history_id !== historyId) {
      throw new Error("Automation history ID is immutable once checkpointed");
    }
    if (!row.history_id) {
      db.prepare(
        `UPDATE automation_attempts
         SET history_id = ?, updated_at = ? WHERE id = ?`,
      ).run(historyId, checkpointedAt, attemptId);
    }
    return mapAttempt(fetchAttempt(db, attemptId));
  });
  return checkpoint.immediate();
}

function immutableAuditValue(field, current, incoming) {
  if (current !== null && incoming !== null && current !== incoming) {
    throw new Error(`Automation ${field} is immutable once persisted`);
  }
  return incoming;
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
  if (intendedRow !== undefined || preWriteRowHash !== undefined) {
    throw new Error("Use running-state checkpoint APIs for write evidence");
  }
  const transitionedAt = iso(now, "now");
  const transition = db.transaction(() => {
    const row = fetchAttempt(db, attemptId);
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

    const nextHistoryId = historyId ?? null;
    const nextRetryDueAt = retryDueAt ? iso(retryDueAt, "retryDueAt") : null;
    const nextSheetAction = sheetAction ?? null;
    const nextSheetRow = sheetRow ?? null;
    immutableAuditValue("history ID", row.history_id, nextHistoryId);
    immutableAuditValue("retry due time", row.retry_due_at, nextRetryDueAt);
    immutableAuditValue("sheet action", row.sheet_action, nextSheetAction);
    immutableAuditValue("sheet row", row.sheet_row, nextSheetRow);

    db.prepare(
      `UPDATE automation_attempts SET
        status = @status,
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
      historyId: nextHistoryId,
      retryDueAt: nextRetryDueAt,
      sheetAction: nextSheetAction,
      sheetRow: nextSheetRow,
      errorCategory: sanitize(errorCategory, 200),
      errorMessage: sanitize(errorMessage, 2000),
      updatedAt: transitionedAt,
      completedAt: transitionedAt,
    });
    const automaticAttemptCount = to === "failed" && row.trigger === "automatic"
      ? db.prepare(
        `SELECT COUNT(*) AS count FROM automation_attempts
         WHERE day_id = ? AND trigger = 'automatic'`,
      ).get(row.day_id).count
      : 0;
    const closesDay =
      to === "success" ||
      to === "no_activity" ||
      (to === "failed" && automaticAttemptCount >= 2);
    if (closesDay) {
      db.prepare(
        `UPDATE automation_days SET
          terminal_outcome = ?,
          success_attempt_id = ?,
          updated_at = ?,
          completed_at = ?
         WHERE id = ?`,
      ).run(
        to,
        to === "success" ? attemptId : null,
        transitionedAt,
        transitionedAt,
        row.day_id,
      );
    } else {
      db.prepare(
        "UPDATE automation_days SET updated_at = ? WHERE id = ?",
      ).run(transitionedAt, row.day_id);
    }
    if (row.status === "running") {
      releaseAutomationLease(db, { ownerId });
    }
    return mapAttempt(fetchAttempt(db, attemptId));
  });
  return transition.immediate();
}

function interruptStaleRows(db, now) {
  const cutoff = new Date(new Date(now).valueOf() - STALE_MS).toISOString();
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

export function interruptStaleAttempts(
  db,
  { now = new Date().toISOString() } = {},
) {
  const interruptedAt = iso(now, "now");
  return db.transaction(() => interruptStaleRows(db, interruptedAt)).immediate();
}

function latestAttempt(db, where = "1 = 1", terminal = false) {
  const order = terminal
    ? "completed_at DESC, id DESC"
    : "created_at DESC, id DESC";
  return mapAttempt(db.prepare(
    `SELECT * FROM automation_attempts
     WHERE ${where}
     ORDER BY ${order} LIMIT 1`,
  ).get());
}

export function getAutomationStatus(
  db,
  {
    now = new Date().toISOString(),
    timezone = localTimezone(),
  } = {},
) {
  const settings = getAutomationSettings(db);
  return {
    nextRun: settings.enabled
      ? nextScheduledAt({ now, time: settings.time, days: settings.days, timezone })
      : null,
    lastAttempt: latestAttempt(db),
    lastSuccess: latestAttempt(db, "status = 'success'", true),
    lastError: latestAttempt(db, "status = 'failed'", true),
  };
}

export function cleanupAutomationAttempts(
  db,
  { now = new Date().toISOString() } = {},
) {
  const cutoff = new Date(new Date(iso(now, "now")).valueOf() - RETENTION_MS)
    .toISOString();
  const cleanup = db.transaction(() => {
    const count = db.prepare(
      `SELECT COUNT(*) AS count FROM automation_attempts
       WHERE status != 'running' AND completed_at < ?`,
    ).get(cutoff).count;
    db.prepare(
      `DELETE FROM automation_days
       WHERE completed_at < ?
         AND NOT EXISTS (
           SELECT 1 FROM automation_attempts
           WHERE day_id = automation_days.id AND status = 'running'
         )`,
    ).run(cutoff);
    db.prepare(
      `DELETE FROM automation_attempts
       WHERE status != 'running' AND completed_at < ?`,
    ).run(cutoff);
    db.prepare(
      `DELETE FROM automation_days
       WHERE updated_at < ?
         AND NOT EXISTS (
           SELECT 1 FROM automation_attempts
           WHERE day_id = automation_days.id
         )`,
    ).run(cutoff);
    return count;
  });
  return cleanup.immediate();
}
