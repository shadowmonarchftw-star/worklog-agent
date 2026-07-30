import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  AUTOMATION_SETTINGS_DEFAULTS,
  claimAutomationAttempt,
  cleanupAutomationAttempts,
  getAutomationSettings,
  getAutomationStatus,
  interruptStaleAttempts,
  normalizeIntendedRow,
  releaseAutomationLease,
  renewAutomationLease,
  saveAutomationSettings,
  transitionAutomationAttempt,
} from "../lib/automationStore.mjs";
import { createLocalDb } from "../lib/localDb.mjs";

const T0 = "2026-07-30T10:00:00.000Z";

function tempDbHandles() {
  const dir = mkdtempSync(path.join(tmpdir(), "automation-store-"));
  const dbPath = path.join(dir, "test.sqlite");
  return {
    first: createLocalDb(dbPath),
    second: createLocalDb(dbPath),
  };
}

test("automation settings have separate defaults and validate time and weekdays", () => {
  const { first } = tempDbHandles();

  assert.deepEqual(getAutomationSettings(first), AUTOMATION_SETTINGS_DEFAULTS);
  assert.deepEqual(AUTOMATION_SETTINGS_DEFAULTS, {
    enabled: false,
    time: "17:30",
    days: [1, 2, 3, 4, 5],
    startAtLogin: false,
    startAtLoginConfigured: false,
  });
  assert.throws(
    () => saveAutomationSettings(first, { time: "7:30" }),
    /HH:mm/,
  );
  assert.throws(
    () => saveAutomationSettings(first, { days: [0, 1] }),
    /ISO weekday/,
  );
  assert.throws(
    () => saveAutomationSettings(first, { days: [] }),
    /ISO weekday/,
  );
});

test("first enable opts into login start while explicit opt-out persists", () => {
  const { first } = tempDbHandles();

  assert.deepEqual(saveAutomationSettings(first, { enabled: true }), {
    enabled: true,
    time: "17:30",
    days: [1, 2, 3, 4, 5],
    startAtLogin: true,
    startAtLoginConfigured: true,
  });
  saveAutomationSettings(first, { startAtLogin: false });
  saveAutomationSettings(first, { enabled: false });
  saveAutomationSettings(first, { enabled: true });
  first.close();

  const reopened = createLocalDb(first.name);
  assert.equal(getAutomationSettings(reopened).startAtLogin, false);
  assert.equal(getAutomationSettings(reopened).startAtLoginConfigured, true);
});

test("two handles atomically allow exactly one active claimant", () => {
  const { first, second } = tempDbHandles();
  const input = {
    workDate: "2026-07-30",
    trigger: "automatic",
    ownerId: "runner-a",
    now: T0,
  };

  const claims = [
    claimAutomationAttempt(first, input),
    claimAutomationAttempt(second, { ...input, ownerId: "runner-b" }),
  ];

  assert.deepEqual(
    claims.map(({ outcome }) => outcome),
    ["claimed", "already_running"],
  );
  const activeCount = first
    .prepare("SELECT COUNT(*) AS count FROM automation_attempts WHERE status = 'running'")
    .get().count;
  assert.equal(activeCount, 1);
});

test("lease lasts five minutes, is owner checked, and expires for another owner", () => {
  const { first, second } = tempDbHandles();
  const claim = claimAutomationAttempt(first, {
    workDate: "2026-07-30",
    trigger: "automatic",
    ownerId: "runner-a",
    now: T0,
  });

  assert.equal(
    renewAutomationLease(first, {
      ownerId: "runner-b",
      now: "2026-07-30T10:01:00.000Z",
    }),
    false,
  );
  assert.equal(
    renewAutomationLease(first, {
      ownerId: "runner-a",
      now: "2026-07-30T10:01:00.000Z",
    }),
    true,
  );
  assert.equal(releaseAutomationLease(first, { ownerId: "runner-b" }), false);
  assert.equal(
    claimAutomationAttempt(second, {
      workDate: "2026-07-31",
      trigger: "automatic",
      ownerId: "runner-b",
      now: "2026-07-30T10:06:01.000Z",
    }).outcome,
    "claimed",
  );
  assert.equal(
    first
      .prepare("SELECT status FROM automation_attempts WHERE id = ?")
      .get(claim.attempt.id).status,
    "interrupted",
  );
});

test("an orphaned stale running attempt is interrupted before a new claim", () => {
  const { first } = tempDbHandles();
  const stale = claimAutomationAttempt(first, {
    workDate: "2026-07-30",
    trigger: "manual",
    ownerId: "runner-a",
    now: T0,
  });
  first
    .prepare(
      `UPDATE automation_lease
       SET owner_id = NULL, attempt_id = NULL, expires_at = NULL
       WHERE singleton = 1`,
    )
    .run();

  const next = claimAutomationAttempt(first, {
    workDate: "2026-07-31",
    trigger: "manual",
    ownerId: "runner-b",
    now: "2026-07-30T10:05:01.000Z",
  });

  assert.equal(next.outcome, "claimed");
  assert.equal(
    first
      .prepare("SELECT status FROM automation_attempts WHERE id = ?")
      .get(stale.attempt.id).status,
    "interrupted",
  );
});

test("automatic attempts allow one retry while manual runs can follow completion", () => {
  const { first } = tempDbHandles();
  const claim = (trigger, ownerId, now) =>
    claimAutomationAttempt(first, {
      workDate: "2026-07-30",
      trigger,
      ownerId,
      now,
    });

  const initial = claim("automatic", "a", T0);
  transitionAutomationAttempt(first, {
    attemptId: initial.attempt.id,
    to: "failed",
    ownerId: "a",
    now: "2026-07-30T10:01:00.000Z",
    retryDueAt: "2026-07-30T10:02:00.000Z",
    errorCategory: " network/token ",
    errorMessage: " failed\n badly ",
  });
  const retry = claim("automatic", "b", "2026-07-30T10:02:00.000Z");
  transitionAutomationAttempt(first, {
    attemptId: retry.attempt.id,
    to: "success",
    ownerId: "b",
    now: "2026-07-30T10:03:00.000Z",
  });

  assert.equal(
    claim("automatic", "c", "2026-07-30T10:04:00.000Z").outcome,
    "retry_limit",
  );
  assert.equal(
    claim("manual", "manual", "2026-07-30T10:05:00.000Z").outcome,
    "claimed",
  );
});

test("manual claim reports already running while a lease is active", () => {
  const { first } = tempDbHandles();
  claimAutomationAttempt(first, {
    workDate: "2026-07-30",
    trigger: "automatic",
    ownerId: "automatic",
    now: T0,
  });

  const manual = claimAutomationAttempt(first, {
    workDate: "2026-07-30",
    trigger: "manual",
    ownerId: "manual",
    now: "2026-07-30T10:00:01.000Z",
  });

  assert.equal(manual.outcome, "already_running");
});

test("transitions enforce normal and recovery matrices", () => {
  const { first } = tempDbHandles();
  const normal = claimAutomationAttempt(first, {
    workDate: "2026-07-30",
    trigger: "manual",
    ownerId: "a",
    now: T0,
  });
  assert.throws(
    () =>
      transitionAutomationAttempt(first, {
        attemptId: normal.attempt.id,
        to: "interrupted",
        ownerId: "a",
        now: T0,
      }),
    /transition/,
  );
  transitionAutomationAttempt(first, {
    attemptId: normal.attempt.id,
    to: "no_activity",
    ownerId: "a",
    now: T0,
  });
  assert.throws(
    () =>
      transitionAutomationAttempt(first, {
        attemptId: normal.attempt.id,
        to: "success",
        ownerId: "a",
        now: T0,
      }),
    /transition/,
  );

  const recovery = claimAutomationAttempt(first, {
    workDate: "2026-07-31",
    trigger: "manual",
    ownerId: "b",
    now: "2026-07-31T10:00:00.000Z",
  });
  interruptStaleAttempts(first, {
    now: "2026-07-31T10:06:00.000Z",
  });
  transitionAutomationAttempt(first, {
    attemptId: recovery.attempt.id,
    to: "failed",
    now: "2026-07-31T10:07:00.000Z",
  });
});

test("transition persists normalized immutable intent and deterministic status", () => {
  const { first } = tempDbHandles();
  const claimed = claimAutomationAttempt(first, {
    workDate: "2026-07-30",
    trigger: "automatic",
    ownerId: "a",
    now: T0,
  });
  const intendedRow = {
    date: " 2026-07-30 ",
    summary: "  Shipped   the feature ",
    reference: " PR #42 ",
    hours: " 7.5 ",
    comments: "  Good\n day ",
    ignored: "secret",
  };

  transitionAutomationAttempt(first, {
    attemptId: claimed.attempt.id,
    to: "success",
    ownerId: "a",
    now: "2026-07-30T10:01:00.000Z",
    intendedRow,
    preWriteRowHash: "row_absent",
    historyId: null,
    sheetAction: "append",
    sheetRow: 14,
  });

  const row = first
    .prepare("SELECT * FROM automation_attempts WHERE id = ?")
    .get(claimed.attempt.id);
  assert.equal(row.intended_row_json, JSON.stringify(normalizeIntendedRow(intendedRow)));
  assert.match(row.intended_row_hash, /^[a-f0-9]{64}$/);
  assert.equal(row.pre_write_row_hash, "row_absent");
  assert.equal(row.sheet_action, "append");
  assert.equal(row.sheet_row, 14);
  assert.throws(
    () =>
      transitionAutomationAttempt(first, {
        attemptId: claimed.attempt.id,
        to: "success",
        now: T0,
        intendedRow: { ...intendedRow, summary: "changed" },
      }),
    /transition/,
  );

  const status = getAutomationStatus(first);
  assert.equal(status.lastAttempt.id, claimed.attempt.id);
  assert.equal(status.lastSuccess.id, claimed.attempt.id);
  assert.equal(status.lastError, null);
});

test("error fields are sanitized, stale runs interrupt, and cleanup removes old attempts", () => {
  const { first } = tempDbHandles();
  const stale = claimAutomationAttempt(first, {
    workDate: "2026-04-01",
    trigger: "manual",
    ownerId: "old",
    now: "2026-04-01T10:00:00.000Z",
  });
  assert.equal(
    interruptStaleAttempts(first, {
      now: "2026-04-01T10:06:00.000Z",
    }),
    1,
  );
  transitionAutomationAttempt(first, {
    attemptId: stale.attempt.id,
    to: "failed",
    now: "2026-04-01T10:07:00.000Z",
    errorCategory: " github\n auth ",
    errorMessage: " token\t expired ",
  });
  const failed = first
    .prepare("SELECT * FROM automation_attempts WHERE id = ?")
    .get(stale.attempt.id);
  assert.equal(failed.error_category, "github auth");
  assert.equal(failed.error_message, "token expired");
  assert.equal(getAutomationStatus(first).lastError.id, stale.attempt.id);

  assert.equal(
    cleanupAutomationAttempts(first, {
      now: "2026-07-30T10:08:00.000Z",
    }),
    1,
  );
  assert.equal(
    first
      .prepare("SELECT COUNT(*) AS count FROM automation_attempts")
      .get().count,
    0,
  );
});
