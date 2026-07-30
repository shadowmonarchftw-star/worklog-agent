import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createScheduler } = require("../electron/scheduler.cjs");

function fakeClock(now = "2026-07-30T17:29:59+05:45") {
  const timers = [];
  return {
    timezone: "Asia/Kathmandu",
    now: () => new Date(now),
    setNow(value) {
      now = value;
    },
    setInterval(callback, delay) {
      const timer = { callback, delay };
      timers.push(timer);
      return timer;
    },
    clearInterval(timer) {
      timers.splice(timers.indexOf(timer), 1);
    },
    timers,
  };
}

function harness(overrides = {}) {
  const calls = { recover: 0, run: [], notify: [] };
  const clock = overrides.clock || fakeClock();
  let settings = {
    enabled: true,
    time: "17:30",
    days: [1, 2, 3, 4, 5],
    ...overrides.settings,
  };
  let status = overrides.status || {
    nextRun: "2026-07-30T11:45:00.000Z",
    lastAttempt: null,
  };
  const scheduler = createScheduler({
    clock,
    loadSettings: async () => settings,
    loadStatus: async () => status,
    recover: overrides.recover || (async () => {
      calls.recover += 1;
      return { results: [] };
    }),
    run: overrides.run || (async (input) => {
      calls.run.push(input);
      return { status: "success", action: "updated" };
    }),
    notify: (payload) => calls.notify.push(payload),
  });
  return {
    calls,
    clock,
    scheduler,
    setSettings(value) {
      settings = value;
    },
    setStatus(value) {
      status = value;
    },
  };
}

test("runs exactly once when a selected weekday reaches the due minute", async () => {
  const { calls, scheduler } = harness();

  await scheduler.tick(new Date("2026-07-30T17:29:59+05:45"));
  assert.equal(calls.run.length, 0);
  await scheduler.tick(new Date("2026-07-30T17:30:00+05:45"));
  assert.equal(calls.run.length, 1);

  const result = await scheduler.tick(
    new Date("2026-07-30T17:31:00+05:45"),
  );
  assert.equal(calls.run.length, 1);
  assert.equal(result.status.nextRun, "2026-07-30T11:45:00.000Z");
  assert.deepEqual(calls.run[0], {
    trigger: "automatic",
    workDate: "2026-07-30",
    timezone: "Asia/Kathmandu",
  });
});

test("does not run while disabled or on an unselected weekday", async () => {
  const disabled = harness({ settings: { enabled: false } });
  await disabled.scheduler.tick(new Date("2026-07-30T18:00:00+05:45"));
  assert.equal(disabled.calls.run.length, 0);

  const weekend = harness();
  await weekend.scheduler.tick(new Date("2026-08-01T18:00:00+05:45"));
  assert.equal(weekend.calls.run.length, 0);
});

test("catches up once later on the same selected workday", async () => {
  const { calls, scheduler } = harness();

  await scheduler.tick(new Date("2026-07-30T22:00:00+05:45"));
  await scheduler.tick(new Date("2026-07-30T22:01:00+05:45"));

  assert.equal(calls.run.length, 1);
});

test("uses persisted retry due time and never retries terminal outcomes", async () => {
  const retry = harness({
    status: {
      nextRun: null,
      lastAttempt: {
        workDate: "2026-07-30",
        status: "failed",
        retryDueAt: "2026-07-30T12:00:00.000Z",
      },
    },
  });

  await retry.scheduler.tick(new Date("2026-07-30T17:44:59+05:45"));
  assert.equal(retry.calls.run.length, 0);
  await retry.scheduler.tick(new Date("2026-07-30T17:45:00+05:45"));
  assert.equal(retry.calls.run.length, 1);

  for (const status of ["success", "no_activity"]) {
    const terminal = harness({
      status: {
        nextRun: null,
        lastAttempt: { workDate: "2026-07-30", status },
      },
    });
    await terminal.scheduler.tick(new Date("2026-07-30T18:00:00+05:45"));
    assert.equal(terminal.calls.run.length, 0);
  }
});

test("starts one-minute wakes only after recovery and stops them", async () => {
  const { calls, clock, scheduler } = harness();

  await scheduler.start();
  assert.equal(calls.recover, 1);
  assert.equal(clock.timers.length, 1);
  assert.equal(clock.timers[0].delay, 60_000);
  scheduler.stop();
  assert.equal(clock.timers.length, 0);
});

test("start evaluates same-day catch-up immediately after recovery", async () => {
  const events = [];
  const { scheduler } = harness({
    clock: fakeClock("2026-07-30T18:00:00+05:45"),
    recover: async () => {
      events.push("recover");
      return { results: [] };
    },
    run: async () => {
      events.push("run");
      return { status: "no_activity" };
    },
  });

  await scheduler.start();

  assert.deepEqual(events, ["recover", "run"]);
  scheduler.stop();
});

test("resume awaits recovery before evaluating catch-up", async () => {
  let releaseRecovery;
  const events = [];
  const recovery = new Promise((resolve) => {
    releaseRecovery = () => {
      events.push("recovered");
      resolve({ results: [] });
    };
  });
  const { scheduler } = harness({
    recover: async () => recovery,
    run: async () => {
      events.push("run");
      return { status: "no_activity" };
    },
  });

  const resumed = scheduler.resume(
    new Date("2026-07-30T18:00:00+05:45"),
  );
  await Promise.resolve();
  assert.deepEqual(events, []);
  releaseRecovery();
  await resumed;
  assert.deepEqual(events, ["recovered", "run"]);
});

test("recovery failure blocks a run, sanitizes notification, and retries next tick", async () => {
  let attempts = 0;
  const { calls, scheduler } = harness({
    recover: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("Authorization: Bearer secret-token\nRecovery exploded");
      }
      return { results: [] };
    },
  });

  await scheduler.start();
  assert.equal(calls.run.length, 0);
  assert.deepEqual(calls.notify, [{
    title: "Worklog recovery failed",
    body: "Authorization: [REDACTED] Recovery exploded",
  }]);

  await scheduler.tick(new Date("2026-07-30T17:30:00+05:45"));
  assert.equal(attempts, 2);
  assert.equal(calls.run.length, 1);
});

test("maps run outcomes to concise notifications", async () => {
  const cases = [
    [
      { status: "success", action: "appended" },
      { title: "Worklog complete", body: "Today's worklog was added." },
    ],
    [
      { status: "success", action: "updated" },
      { title: "Worklog complete", body: "Today's worklog was updated." },
    ],
    [
      { status: "no_activity" },
      { title: "No GitHub activity", body: "No worklog was written today." },
    ],
  ];

  for (const [outcome, notification] of cases) {
    const instance = harness({
      run: async () => outcome,
    });
    await instance.scheduler.runNow();
    assert.deepEqual(instance.calls.notify, [notification]);
  }

  const failed = harness({
    run: async () => {
      throw new Error("token=top-secret\nOpen provider failed");
    },
  });
  await failed.scheduler.runNow();
  assert.deepEqual(failed.calls.notify, [{
    title: "Worklog failed",
    body: "token=[REDACTED] Open provider failed",
  }]);
});

test("serializes timer, resume, and manual work and handles API already_running", async () => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const { calls, scheduler } = harness({
    run: async (input) => {
      calls.run.push(input);
      await pending;
      return { outcome: "already_running" };
    },
  });

  const timer = scheduler.tick(new Date("2026-07-30T17:30:00+05:45"));
  await Promise.resolve();
  assert.deepEqual(await scheduler.resume(), { outcome: "already_running" });
  assert.deepEqual(await scheduler.runNow(), { outcome: "already_running" });
  release();
  assert.deepEqual(await timer, { outcome: "already_running" });
  assert.equal(calls.run.length, 1);
  assert.deepEqual(calls.notify, []);
});

test("Electron composition starts scheduling only for authenticated managed servers", async () => {
  const source = await readFile(
    new URL("../electron/main.cjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /await waitForAppUrl\(appUrl, appServer\)/);
  assert.match(source, /if \(appServer\.automationAvailable\)/);
  assert.match(source, /await scheduler\.start\(\)/);
  assert.match(source, /powerMonitor\.on\("resume"/);
  assert.match(source, /void scheduler\.resume\(\)/);
});
