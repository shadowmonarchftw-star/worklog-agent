import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Worker } from "node:worker_threads";

import {
  AUTOMATION_SETTINGS_DEFAULTS,
  checkpointAutomationHistory,
  checkpointAutomationIntent,
  checkpointAutomationPreWrite,
  claimAutomationAttempt,
  claimAutomationRecovery,
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
const CLAIM_WINDOW = {
  timezone: "Asia/Kathmandu",
  since: "2026-07-29T18:15:00.000Z",
  until: "2026-07-30T18:15:00.000Z",
};

function tempDbHandles() {
  const dir = mkdtempSync(path.join(tmpdir(), "automation-store-"));
  const dbPath = path.join(dir, "test.sqlite");
  return {
    first: createLocalDb(dbPath),
    second: createLocalDb(dbPath),
  };
}

function insertHistory(db, id) {
  db.prepare(
    `INSERT INTO history
      (id, developer_name, work_date, style, repos, activity, summary, created_at)
     VALUES (?, '', ?, 'standup', '[]', 'activity', 'summary', ?)`,
  ).run(id, `2026-07-${id === "history-1" ? "30" : "31"}`, T0);
}

function claim(db, overrides = {}) {
  return claimAutomationAttempt(db, {
    workDate: "2026-07-30",
    trigger: "manual",
    ownerId: "runner",
    now: T0,
    ...CLAIM_WINDOW,
    ...overrides,
  });
}

test("settings use exact JSON key, validate values, and preserve explicit login choice", () => {
  const { first } = tempDbHandles();
  assert.deepEqual(getAutomationSettings(first), AUTOMATION_SETTINGS_DEFAULTS);

  assert.throws(() => saveAutomationSettings(first, { enabled: 1 }), /boolean/);
  assert.throws(
    () => saveAutomationSettings(first, { startAtLogin: "yes" }),
    /boolean/,
  );
  assert.throws(
    () => saveAutomationSettings(first, { startAtLoginConfigured: 1 }),
    /boolean/,
  );
  assert.throws(() => saveAutomationSettings(first, { time: "7:30" }), /HH:mm/);
  assert.throws(() => saveAutomationSettings(first, { days: [0, 1] }), /ISO weekday/);

  saveAutomationSettings(first, { enabled: true });
  saveAutomationSettings(first, { startAtLogin: false });
  const settings = saveAutomationSettings(first, {
    enabled: false,
    startAtLoginConfigured: false,
  });
  assert.equal(settings.startAtLogin, false);
  assert.equal(settings.startAtLoginConfigured, true);
  assert.deepEqual(
    JSON.parse(
      first.prepare("SELECT value FROM settings WHERE key = ?").get(
        "automation-settings",
      ).value,
    ).days,
    [1, 2, 3, 4, 5],
  );
  assert.equal(
    first.prepare("SELECT value FROM settings WHERE key = 'automation'").get(),
    undefined,
  );
});

test("first enable configures login start once and opt-out survives restart", () => {
  const { first } = tempDbHandles();
  assert.equal(saveAutomationSettings(first, { enabled: true }).startAtLogin, true);
  saveAutomationSettings(first, { startAtLogin: false });
  saveAutomationSettings(first, { enabled: false });
  saveAutomationSettings(first, {
    enabled: true,
    startAtLoginConfigured: false,
  });
  const dbPath = first.name;
  first.close();

  const reopened = createLocalDb(dbPath);
  assert.deepEqual(getAutomationSettings(reopened), {
    enabled: true,
    time: "17:30",
    days: [1, 2, 3, 4, 5],
    startAtLogin: false,
    startAtLoginConfigured: true,
  });
});

test("claim durably creates one work-date day and links attempts to it", () => {
  const { first } = tempDbHandles();
  const initial = claim(first, { trigger: "automatic" });

  transitionAutomationAttempt(first, {
    attemptId: initial.attempt.id,
    to: "failed",
    ownerId: "runner",
    now: "2026-07-30T10:01:00.000Z",
    retryDueAt: "2026-07-30T10:02:00.000Z",
  });
  const retry = claim(first, {
    trigger: "automatic",
    ownerId: "retry",
    now: "2026-07-30T10:02:00.000Z",
  });

  const day = first.prepare("SELECT * FROM automation_days").get();
  assert.equal(day.id, initial.attempt.dayId);
  assert.equal(retry.attempt.dayId, day.id);
  assert.equal(day.work_date, "2026-07-30");
  assert.equal(day.timezone, "Asia/Kathmandu");
  assert.equal(day.since, CLAIM_WINDOW.since);
  assert.equal(day.until, CLAIM_WINDOW.until);
  assert.equal(day.terminal_outcome, null);
  assert.equal(day.success_attempt_id, null);
  assert.equal(day.created_at, T0);
  assert.equal(day.updated_at, "2026-07-30T10:02:00.000Z");
  assert.equal(day.completed_at, null);
  assert.equal(
    first.prepare("SELECT day_id FROM automation_attempts WHERE id = ?").get(
      initial.attempt.id,
    ).day_id,
    day.id,
  );
});

test("success and no activity close a day while failure leaves it retryable", () => {
  for (const terminal of ["success", "no_activity", "failed"]) {
    const { first } = tempDbHandles();
    const started = claim(first, { trigger: "automatic" });
    transitionAutomationAttempt(first, {
      attemptId: started.attempt.id,
      to: terminal,
      ownerId: "runner",
      now: "2026-07-30T10:01:00.000Z",
    });
    const day = first.prepare("SELECT * FROM automation_days").get();

    assert.equal(day.terminal_outcome, terminal === "failed" ? null : terminal);
    assert.equal(
      day.success_attempt_id,
      terminal === "success" ? started.attempt.id : null,
    );
    assert.equal(
      day.completed_at,
      terminal === "failed" ? null : "2026-07-30T10:01:00.000Z",
    );
  }
});

test("two worker threads race separate handles and only one claim acquires the lease", async () => {
  const { first, second } = tempDbHandles();
  const dbPath = first.name;
  first.close();
  second.close();
  const startSignal = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const workers = ["runner-a", "runner-b"].map(
    (ownerId) =>
      new Worker(new URL("./fixtures/automationClaimWorker.mjs", import.meta.url), {
        workerData: { dbPath, ownerId, startSignal },
      }),
  );
  const ready = workers.map(
    (worker) =>
      new Promise((resolve, reject) => {
        const onMessage = (message) => {
          if (message.type === "ready") {
            worker.off("message", onMessage);
            resolve();
          }
        };
        worker.on("message", onMessage);
        worker.once("error", reject);
      }),
  );
  const claimResults = workers.map(
    (worker) =>
      new Promise((resolve, reject) => {
        const onMessage = (message) => {
          if (message.type === "result") {
            worker.off("message", onMessage);
            resolve(message.claim);
          }
        };
        worker.on("message", onMessage);
        worker.once("error", reject);
      }),
  );
  await Promise.all(ready);
  Atomics.store(new Int32Array(startSignal), 0, 1);
  Atomics.notify(new Int32Array(startSignal), 0, workers.length);
  const claims = await Promise.all(claimResults);

  assert.deepEqual(
    claims.map(({ outcome }) => outcome).sort(),
    ["already_running", "claimed"],
  );
  const verificationDb = createLocalDb(dbPath);
  assert.equal(
    verificationDb.prepare(
      "SELECT COUNT(*) AS count FROM automation_attempts WHERE status = 'running'",
    ).get().count,
    1,
  );
  assert.equal(
    verificationDb.prepare(
      `SELECT COUNT(*) AS count FROM automation_lease
       WHERE attempt_id IS NOT NULL AND expires_at > ?`,
    ).get(T0).count,
    1,
  );
});

test("lease is five minutes, owner checked, and expired lease is acquirable", () => {
  const { first, second } = tempDbHandles();
  const started = claim(first, { ownerId: "runner-a" });
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

  const next = claim(second, {
    workDate: "2026-07-31",
    since: "2026-07-30T18:15:00.000Z",
    until: "2026-07-31T18:15:00.000Z",
    ownerId: "runner-b",
    now: "2026-07-30T10:06:01.000Z",
  });
  assert.equal(next.outcome, "claimed");
  assert.equal(
    first.prepare("SELECT status FROM automation_attempts WHERE id = ?").get(
      started.attempt.id,
    ).status,
    "interrupted",
  );
});

test("expired runner lease rejects every running checkpoint and terminal transition", () => {
  {
    const { first } = tempDbHandles();
    insertHistory(first, "history-1");
    const started = claim(first);
    assert.throws(
      () =>
        checkpointAutomationHistory(first, {
          attemptId: started.attempt.id,
          ownerId: "runner",
          historyId: "history-1",
          now: "2026-07-30T10:05:01.000Z",
        }),
      /lease/,
    );
  }
  {
    const { first } = tempDbHandles();
    const started = claim(first);
    assert.throws(
      () =>
        checkpointAutomationIntent(first, {
          attemptId: started.attempt.id,
          ownerId: "runner",
          intendedRow: { date: "2026-07-30" },
          now: "2026-07-30T10:05:01.000Z",
        }),
      /lease/,
    );
  }
  {
    const { first } = tempDbHandles();
    const started = claim(first);
    checkpointAutomationIntent(first, {
      attemptId: started.attempt.id,
      ownerId: "runner",
      intendedRow: { date: "2026-07-30" },
      now: "2026-07-30T10:01:00.000Z",
    });
    assert.throws(
      () =>
        checkpointAutomationPreWrite(first, {
          attemptId: started.attempt.id,
          ownerId: "runner",
          preWriteRowHash: "row_absent",
          now: "2026-07-30T10:05:01.000Z",
        }),
      /lease/,
    );
  }
  {
    const { first } = tempDbHandles();
    const started = claim(first);
    assert.throws(
      () =>
        transitionAutomationAttempt(first, {
          attemptId: started.attempt.id,
          ownerId: "runner",
          to: "failed",
          now: "2026-07-30T10:05:01.000Z",
        }),
      /lease/,
    );
  }
});

test("interrupted recovery requires a separately claimed live recovery lease", () => {
  const { first } = tempDbHandles();
  const started = claim(first);
  interruptStaleAttempts(first, { now: "2026-07-30T10:30:00.000Z" });

  assert.throws(
    () =>
      transitionAutomationAttempt(first, {
        attemptId: started.attempt.id,
        ownerId: "recovery",
        to: "success",
        now: "2026-07-30T10:31:00.000Z",
      }),
    /lease/,
  );
  assert.equal(
    claimAutomationRecovery(first, {
      attemptId: started.attempt.id,
      ownerId: "recovery",
      now: "2026-07-30T10:31:00.000Z",
    }).outcome,
    "claimed",
  );
  assert.equal(
    transitionAutomationAttempt(first, {
      attemptId: started.attempt.id,
      ownerId: "recovery",
      to: "success",
      now: "2026-07-30T10:32:00.000Z",
    }).status,
    "success",
  );

  const second = claim(first, {
    workDate: "2026-07-31",
    ownerId: "second",
    since: "2026-07-30T18:15:00.000Z",
    until: "2026-07-31T18:15:00.000Z",
    now: "2026-07-30T10:33:00.000Z",
  });
  interruptStaleAttempts(first, { now: "2026-07-30T11:03:00.000Z" });
  claimAutomationRecovery(first, {
    attemptId: second.attempt.id,
    ownerId: "expired-recovery",
    now: "2026-07-30T11:04:00.000Z",
  });
  assert.throws(
    () =>
      transitionAutomationAttempt(first, {
        attemptId: second.attempt.id,
        ownerId: "expired-recovery",
        to: "failed",
        now: "2026-07-30T11:09:01.000Z",
      }),
    /lease/,
  );
});

test("expired attempt A cannot recover after retry B succeeds or downgrade its day", () => {
  const { first } = tempDbHandles();
  const attemptA = claim(first, {
    trigger: "automatic",
    ownerId: "runner-a",
  });
  const attemptB = claim(first, {
    trigger: "automatic",
    ownerId: "runner-b",
    now: "2026-07-30T10:05:01.000Z",
  });
  transitionAutomationAttempt(first, {
    attemptId: attemptB.attempt.id,
    ownerId: "runner-b",
    to: "success",
    now: "2026-07-30T10:06:00.000Z",
  });

  assert.throws(
    () =>
      claimAutomationRecovery(first, {
        attemptId: attemptA.attempt.id,
        ownerId: "stale-recovery",
        now: "2026-07-30T10:07:00.000Z",
      }),
    /terminal|superseded/,
  );
  const day = first.prepare("SELECT * FROM automation_days").get();
  assert.equal(day.terminal_outcome, "success");
  assert.equal(day.success_attempt_id, attemptB.attempt.id);
  assert.equal(day.completed_at, "2026-07-30T10:06:00.000Z");
});

test("later terminal attempts cannot overwrite a successful day", () => {
  const { first } = tempDbHandles();
  const successful = claim(first);
  transitionAutomationAttempt(first, {
    attemptId: successful.attempt.id,
    ownerId: "runner",
    to: "success",
    now: "2026-07-30T10:01:00.000Z",
  });
  const later = claim(first, {
    ownerId: "manual-later",
    now: "2026-07-30T10:02:00.000Z",
  });
  transitionAutomationAttempt(first, {
    attemptId: later.attempt.id,
    ownerId: "manual-later",
    to: "no_activity",
    now: "2026-07-30T10:03:00.000Z",
  });

  const day = first.prepare("SELECT * FROM automation_days").get();
  assert.equal(day.terminal_outcome, "success");
  assert.equal(day.success_attempt_id, successful.attempt.id);
  assert.equal(day.completed_at, "2026-07-30T10:01:00.000Z");
});

test("stale sweep uses thirty minutes independently of lease expiry", () => {
  const { first } = tempDbHandles();
  const started = claim(first);
  first.prepare(
    `UPDATE automation_lease
     SET owner_id = NULL, attempt_id = NULL, expires_at = NULL`,
  ).run();

  assert.equal(
    interruptStaleAttempts(first, { now: "2026-07-30T10:29:59.000Z" }),
    0,
  );
  assert.equal(
    interruptStaleAttempts(first, { now: "2026-07-30T10:30:00.000Z" }),
    1,
  );
  assert.equal(
    first.prepare("SELECT status FROM automation_attempts WHERE id = ?").get(
      started.attempt.id,
    ).status,
    "interrupted",
  );
});

test("automatic runs allow only a failed retry and no activity blocks retry", () => {
  for (const terminal of ["success", "no_activity"]) {
    const { first } = tempDbHandles();
    const started = claim(first, { trigger: "automatic" });
    transitionAutomationAttempt(first, {
      attemptId: started.attempt.id,
      to: terminal,
      ownerId: "runner",
      now: "2026-07-30T10:01:00.000Z",
    });
    assert.equal(
      claim(first, {
        trigger: "automatic",
        ownerId: "retry",
        now: "2026-07-30T10:02:00.000Z",
      }).outcome,
      "retry_limit",
    );
  }

  const { first } = tempDbHandles();
  const initial = claim(first, { trigger: "automatic" });
  transitionAutomationAttempt(first, {
    attemptId: initial.attempt.id,
    to: "failed",
    ownerId: "runner",
    now: "2026-07-30T10:01:00.000Z",
  });
  const retry = claim(first, {
    trigger: "automatic",
    ownerId: "retry",
    now: "2026-07-30T10:02:00.000Z",
  });
  transitionAutomationAttempt(first, {
    attemptId: retry.attempt.id,
    to: "failed",
    ownerId: "retry",
    now: "2026-07-30T10:03:00.000Z",
  });
  assert.equal(
    claim(first, {
      trigger: "automatic",
      ownerId: "third",
      now: "2026-07-30T10:04:00.000Z",
    }).outcome,
    "retry_limit",
  );
  assert.equal(
    claim(first, {
      trigger: "manual",
      ownerId: "manual",
      now: "2026-07-30T10:05:00.000Z",
    }).outcome,
    "claimed",
  );
});

test("a failed automatic retry closes the day as terminal failure", () => {
  const { first } = tempDbHandles();
  const initial = claim(first, { trigger: "automatic" });
  transitionAutomationAttempt(first, {
    attemptId: initial.attempt.id,
    to: "failed",
    ownerId: "runner",
    now: "2026-07-30T10:01:00.000Z",
  });
  const retry = claim(first, {
    trigger: "automatic",
    ownerId: "retry",
    now: "2026-07-30T10:02:00.000Z",
  });
  transitionAutomationAttempt(first, {
    attemptId: retry.attempt.id,
    to: "failed",
    ownerId: "retry",
    now: "2026-07-30T10:03:00.000Z",
  });

  const day = first.prepare("SELECT * FROM automation_days").get();
  assert.equal(day.terminal_outcome, "failed");
  assert.equal(day.success_attempt_id, null);
  assert.equal(day.completed_at, "2026-07-30T10:03:00.000Z");
});

test("store keeps retry due only for the first automatic failure", () => {
  const { first: db } = tempDbHandles();
  const initial = claimAutomationAttempt(db, {
    workDate: "2026-07-30",
    trigger: "automatic",
    ownerId: "owner-1",
    now: "2026-07-30T12:00:00.000Z",
    ...CLAIM_WINDOW,
  });
  const failedFirst = transitionAutomationAttempt(db, {
    attemptId: initial.attempt.id,
    ownerId: "owner-1",
    to: "failed",
    now: "2026-07-30T12:00:00.000Z",
    retryDueAt: "2026-07-30T12:15:00.000Z",
  });
  assert.equal(failedFirst.retryDueAt, "2026-07-30T12:15:00.000Z");

  const second = claimAutomationAttempt(db, {
    workDate: "2026-07-30",
    trigger: "automatic",
    ownerId: "owner-2",
    now: "2026-07-30T12:15:00.000Z",
    ...CLAIM_WINDOW,
  });
  const failedSecond = transitionAutomationAttempt(db, {
    attemptId: second.attempt.id,
    ownerId: "owner-2",
    to: "failed",
    now: "2026-07-30T12:15:00.000Z",
    retryDueAt: "2026-07-30T12:30:00.000Z",
  });
  const day = db.prepare(
    "SELECT terminal_outcome FROM automation_days WHERE work_date = ?",
  ).get("2026-07-30");

  assert.equal(failedSecond.retryDueAt, null);
  assert.equal(day.terminal_outcome, "failed");
  db.close();
});

test("store discards retry due time for manual failures", () => {
  const { first: db } = tempDbHandles();
  const claimed = claimAutomationAttempt(db, {
    workDate: "2026-07-30",
    trigger: "manual",
    ownerId: "owner-1",
    now: "2026-07-30T12:00:00.000Z",
    ...CLAIM_WINDOW,
  });
  const failed = transitionAutomationAttempt(db, {
    attemptId: claimed.attempt.id,
    ownerId: "owner-1",
    to: "failed",
    now: "2026-07-30T12:00:00.000Z",
    retryDueAt: "2026-07-30T12:15:00.000Z",
  });

  assert.equal(failed.retryDueAt, null);
  db.close();
});

test("running checkpoints persist immutable intent and prewrite evidence", () => {
  const { first } = tempDbHandles();
  const started = claim(first);
  const intendedRow = {
    date: " 2026-07-30 ",
    summary: " Shipped   feature ",
    reference: " PR #42 ",
    hours: " 7.5 ",
    comments: " Good\n day ",
  };
  const intent = checkpointAutomationIntent(first, {
    attemptId: started.attempt.id,
    ownerId: "runner",
    intendedRow,
    now: "2026-07-30T10:01:00.000Z",
  });
  assert.deepEqual(intent.intendedRow, normalizeIntendedRow(intendedRow));
  assert.match(intent.intendedRowHash, /^[a-f0-9]{64}$/);
  assert.throws(
    () =>
      checkpointAutomationIntent(first, {
        attemptId: started.attempt.id,
        ownerId: "runner",
        intendedRow: { ...intendedRow, summary: "changed" },
        now: "2026-07-30T10:01:01.000Z",
      }),
    /immutable/,
  );

  const prewrite = checkpointAutomationPreWrite(first, {
    attemptId: started.attempt.id,
    ownerId: "runner",
    preWriteRowHash: "row_absent",
    now: "2026-07-30T10:02:00.000Z",
  });
  assert.equal(prewrite.preWriteRowHash, "row_absent");
  assert.throws(
    () =>
      checkpointAutomationPreWrite(first, {
        attemptId: started.attempt.id,
        ownerId: "runner",
        preWriteRowHash: "a".repeat(64),
        now: "2026-07-30T10:02:01.000Z",
      }),
    /immutable/,
  );
});

test("checkpoints require running owner and prewrite requires intended row", () => {
  const { first } = tempDbHandles();
  const started = claim(first);
  assert.throws(
    () =>
      checkpointAutomationPreWrite(first, {
        attemptId: started.attempt.id,
        ownerId: "runner",
        preWriteRowHash: "row_absent",
        now: T0,
      }),
    /intended row/,
  );
  assert.throws(
    () =>
      checkpointAutomationIntent(first, {
        attemptId: started.attempt.id,
        ownerId: "wrong",
        intendedRow: {},
        now: T0,
      }),
    /lease/,
  );
});

test("history checkpoint is running-owner checked, immutable, and idempotent", () => {
  const { first } = tempDbHandles();
  insertHistory(first, "history-1");
  insertHistory(first, "history-2");
  const started = claim(first);

  const checkpointed = checkpointAutomationHistory(first, {
    attemptId: started.attempt.id,
    ownerId: "runner",
    historyId: "history-1",
    now: "2026-07-30T10:01:00.000Z",
  });
  assert.equal(checkpointed.historyId, "history-1");
  assert.equal(
    checkpointAutomationHistory(first, {
      attemptId: started.attempt.id,
      ownerId: "runner",
      historyId: "history-1",
      now: "2026-07-30T10:01:01.000Z",
    }).historyId,
    "history-1",
  );
  assert.throws(
    () =>
      checkpointAutomationHistory(first, {
        attemptId: started.attempt.id,
        ownerId: "runner",
        historyId: "history-2",
        now: "2026-07-30T10:01:02.000Z",
      }),
    /immutable/,
  );
  assert.throws(
    () =>
      checkpointAutomationHistory(first, {
        attemptId: started.attempt.id,
        ownerId: "wrong",
        historyId: "history-1",
        now: "2026-07-30T10:01:03.000Z",
      }),
    /lease/,
  );
});

test("audit fields reject replacement and allow idempotent interrupted recovery", () => {
  const { first } = tempDbHandles();
  insertHistory(first, "history-1");
  insertHistory(first, "history-2");
  const started = claim(first);
  checkpointAutomationHistory(first, {
    attemptId: started.attempt.id,
    ownerId: "runner",
    historyId: "history-1",
    now: "2026-07-30T10:01:00.000Z",
  });
  first.prepare(
    `UPDATE automation_attempts SET
      status = 'interrupted',
      retry_due_at = ?,
      sheet_action = 'append',
      sheet_row = 14,
      completed_at = ?
     WHERE id = ?`,
  ).run(
    "2026-07-30T10:10:00.000Z",
    "2026-07-30T10:31:00.000Z",
    started.attempt.id,
  );
  claimAutomationRecovery(first, {
    attemptId: started.attempt.id,
    ownerId: "recovery",
    now: "2026-07-30T10:31:00.000Z",
  });

  for (const conflicting of [
    { historyId: "history-2" },
    { retryDueAt: "2026-07-30T10:11:00.000Z" },
    { sheetAction: "update" },
    { sheetRow: 15 },
  ]) {
    assert.throws(
      () =>
        transitionAutomationAttempt(first, {
          attemptId: started.attempt.id,
          to: "success",
          ownerId: "recovery",
          now: "2026-07-30T10:32:00.000Z",
          ...conflicting,
        }),
      /immutable/,
    );
  }

  const recovered = transitionAutomationAttempt(first, {
    attemptId: started.attempt.id,
    to: "success",
    ownerId: "recovery",
    now: "2026-07-30T10:32:00.000Z",
    historyId: "history-1",
    retryDueAt: "2026-07-30T10:10:00.000Z",
    sheetAction: "append",
    sheetRow: 14,
  });
  assert.equal(recovered.historyId, "history-1");
  assert.equal(recovered.retryDueAt, "2026-07-30T10:10:00.000Z");
  assert.equal(recovered.sheetAction, "append");
  assert.equal(recovered.sheetRow, 14);
});

test("full transition matrix accepts only running terminals and recovery outcomes", () => {
  const statuses = ["running", "success", "no_activity", "failed", "interrupted"];
  const targets = ["running", "success", "no_activity", "failed", "interrupted"];
  for (const from of statuses) {
    for (const to of targets) {
      const { first } = tempDbHandles();
      const started = claim(first);
      if (from !== "running") {
        first.prepare(
          `UPDATE automation_attempts
           SET status = ?, completed_at = ? WHERE id = ?`,
        ).run(from, from === "interrupted" ? T0 : "2026-07-30T10:00:01.000Z", started.attempt.id);
        first.prepare(
          `UPDATE automation_lease
           SET owner_id = NULL, attempt_id = NULL, expires_at = NULL`,
        ).run();
        if (from === "interrupted") {
          claimAutomationRecovery(first, {
            attemptId: started.attempt.id,
            ownerId: "recovery",
            now: "2026-07-30T10:06:00.000Z",
          });
        }
      }
      const allowed =
        (from === "running" && ["success", "no_activity", "failed"].includes(to)) ||
        (from === "interrupted" && ["success", "failed"].includes(to));
      const action = () =>
        transitionAutomationAttempt(first, {
          attemptId: started.attempt.id,
          to,
          ownerId: from === "running" ? "runner" : "recovery",
          now: from === "interrupted"
            ? "2026-07-30T10:07:00.000Z"
            : "2026-07-30T10:01:00.000Z",
        });
      if (allowed) assert.doesNotThrow(action, `${from} -> ${to}`);
      else assert.throws(action, /transition/, `${from} -> ${to}`);
    }
  }
});

test("recovery transitions preserve checkpoint evidence and reject overwrite input", () => {
  const { first } = tempDbHandles();
  const started = claim(first);
  const intendedRow = {
    date: "2026-07-30",
    summary: "Original",
    reference: "",
    hours: "8",
    comments: "",
  };
  checkpointAutomationIntent(first, {
    attemptId: started.attempt.id,
    ownerId: "runner",
    intendedRow,
    now: "2026-07-30T10:01:00.000Z",
  });
  checkpointAutomationPreWrite(first, {
    attemptId: started.attempt.id,
    ownerId: "runner",
    preWriteRowHash: "row_absent",
    now: "2026-07-30T10:02:00.000Z",
  });
  first.prepare(
    `UPDATE automation_attempts
     SET status = 'interrupted', completed_at = ? WHERE id = ?`,
  ).run("2026-07-30T10:32:00.000Z", started.attempt.id);
  claimAutomationRecovery(first, {
    attemptId: started.attempt.id,
    ownerId: "recovery",
    now: "2026-07-30T10:32:00.000Z",
  });

  assert.throws(
    () =>
      transitionAutomationAttempt(first, {
        attemptId: started.attempt.id,
        to: "success",
        ownerId: "recovery",
        now: "2026-07-30T10:33:00.000Z",
        intendedRow: { ...intendedRow, summary: "Changed" },
      }),
    /checkpoint/,
  );
  const recovered = transitionAutomationAttempt(first, {
    attemptId: started.attempt.id,
    to: "success",
    ownerId: "recovery",
    now: "2026-07-30T10:33:00.000Z",
    sheetAction: "append",
    sheetRow: 14,
  });
  assert.deepEqual(recovered.intendedRow, normalizeIntendedRow(intendedRow));
  assert.equal(recovered.preWriteRowHash, "row_absent");
});

test("persisted error category and message redact credential forms", () => {
  const { first } = tempDbHandles();
  const started = claim(first);
  const secrets = [
    "Bearer eyJhbGciOi-secret",
    "ghp_abcdefghijklmnopqrstuvwxyz123456",
    "sk-proj-abcdefghijklmnopqrstuvwxyz",
    "client_secret=super-secret",
    "access_token=oauth-token",
    "api_key=my-api-key",
    "token=generic-token",
    "clientSecret=camel-secret",
    "key=generic-key",
    "Authorization: Basic dXNlcjpwYXNz",
    "https://example.test/?refresh_token=refresh-me&ok=yes",
  ];
  transitionAutomationAttempt(first, {
    attemptId: started.attempt.id,
    to: "failed",
    ownerId: "runner",
    now: "2026-07-30T10:01:00.000Z",
    errorCategory: `oauth ${secrets.join(" ")}`,
    errorMessage: `request failed ${secrets.join(" ")}`,
  });

  const row = first.prepare(
    "SELECT error_category, error_message FROM automation_attempts WHERE id = ?",
  ).get(started.attempt.id);
  for (const secret of [
    "eyJhbGciOi-secret",
    "ghp_abcdefghijklmnopqrstuvwxyz123456",
    "sk-proj-abcdefghijklmnopqrstuvwxyz",
    "super-secret",
    "oauth-token",
    "my-api-key",
    "generic-token",
    "camel-secret",
    "generic-key",
    "dXNlcjpwYXNz",
    "refresh-me",
  ]) {
    assert.equal(row.error_category.includes(secret), false);
    assert.equal(row.error_message.includes(secret), false);
  }
  assert.match(row.error_message, /\[REDACTED\]/);
});

test("status computes next run and orders success and error by completion", () => {
  const { first } = tempDbHandles();
  saveAutomationSettings(first, {
    enabled: true,
    time: "17:30",
    days: [4, 5],
  });

  const success = claim(first, {
    workDate: "2026-07-29",
    since: "2026-07-28T18:15:00.000Z",
    until: "2026-07-29T18:15:00.000Z",
  });
  transitionAutomationAttempt(first, {
    attemptId: success.attempt.id,
    to: "success",
    ownerId: "runner",
    now: "2026-07-30T10:02:00.000Z",
  });
  const failed = claim(first, {
    workDate: "2026-07-30",
    ownerId: "failed",
    now: "2026-07-30T10:02:30.000Z",
  });
  transitionAutomationAttempt(first, {
    attemptId: failed.attempt.id,
    to: "failed",
    ownerId: "failed",
    now: "2026-07-30T10:03:00.000Z",
  });

  const status = getAutomationStatus(first, {
    now: "2026-07-30T10:00:00.000Z",
    timezone: "Asia/Kathmandu",
  });
  assert.equal(status.nextRun, "2026-07-30T11:45:00.000Z");
  assert.equal(status.lastSuccess.id, success.attempt.id);
  assert.equal(status.lastError.id, failed.attempt.id);
});

test("cleanup removes completed attempts and their old closed days after 90 days", () => {
  const { first } = tempDbHandles();
  const started = claim(first, {
    workDate: "2026-04-01",
    since: "2026-03-31T18:15:00.000Z",
    until: "2026-04-01T18:15:00.000Z",
    now: "2026-04-01T10:00:00.000Z",
  });
  transitionAutomationAttempt(first, {
    attemptId: started.attempt.id,
    to: "no_activity",
    ownerId: "runner",
    now: "2026-04-01T10:01:00.000Z",
  });

  assert.equal(
    cleanupAutomationAttempts(first, { now: "2026-07-30T10:08:00.000Z" }),
    1,
  );
  assert.equal(
    first.prepare("SELECT COUNT(*) AS count FROM automation_days").get().count,
    0,
  );
});

test("cleanup removes old failed attempts and an empty open day", () => {
  const { first } = tempDbHandles();
  const started = claim(first, {
    workDate: "2026-04-01",
    since: "2026-03-31T18:15:00.000Z",
    until: "2026-04-01T18:15:00.000Z",
    now: "2026-04-01T10:00:00.000Z",
  });
  transitionAutomationAttempt(first, {
    attemptId: started.attempt.id,
    to: "failed",
    ownerId: "runner",
    now: "2026-04-01T10:01:00.000Z",
  });

  assert.equal(
    cleanupAutomationAttempts(first, { now: "2026-07-30T10:08:00.000Z" }),
    1,
  );
  assert.equal(
    first.prepare("SELECT COUNT(*) AS count FROM automation_attempts").get().count,
    0,
  );
  assert.equal(
    first.prepare("SELECT COUNT(*) AS count FROM automation_days").get().count,
    0,
  );
});
