const WAKE_INTERVAL_MS = 60_000;

function defaultClock() {
  return {
    clearInterval,
    now: () => new Date(),
    setInterval,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

function localParts(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value]),
  );
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minutes: Number(values.hour) * 60 + Number(values.minute),
    weekday: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
      .indexOf(values.weekday) + 1,
  };
}

function sanitize(value) {
  return String(value?.message || value || "Automation failed.")
    .replace(
      /\bAuthorization\s*:\s*(?:Bearer|Basic)?\s*[^\s,;]+/gi,
      "Authorization: [REDACTED]",
    )
    .replace(
      /\b(token|key|secret|password|credential)\s*=\s*[^\s,;]+/gi,
      "$1=[REDACTED]",
    )
    .replace(/\bgh[oprsu]_[A-Za-z0-9_]{16,}\b/g, "[REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240) || "Automation failed.";
}

function notificationFor(result) {
  if (result?.status === "success") {
    return {
      title: "Worklog complete",
      body: result.action === "appended"
        ? "Today's worklog was added."
        : "Today's worklog was updated.",
    };
  }
  if (result?.status === "no_activity") {
    return {
      title: "No GitHub activity",
      body: "No worklog was written today.",
    };
  }
  return null;
}

function createScheduler({
  clock = defaultClock(),
  loadSettings,
  loadStatus,
  recover,
  run,
  notify,
}) {
  let timer = null;
  let active = false;
  let reconciliationNeeded = true;
  let recoveryBlocked = false;
  const completedDates = new Set();

  async function exclusive(operation) {
    if (active) return { outcome: "already_running" };
    active = true;
    try {
      return await operation();
    } finally {
      active = false;
    }
  }

  async function reconcile() {
    try {
      const result = await recover();
      if (result?.outcome === "already_running") {
        return result;
      }
      const failed = Array.isArray(result?.results)
        ? result.results.filter((entry) => entry?.status === "failed")
        : [];
      for (const entry of failed) {
        notify({
          title: entry.errorCategory === "sheet_conflict"
            ? "Worklog recovery needs attention"
            : "Worklog recovery failed",
          body: sanitize(entry.errorMessage || "Worklog recovery failed."),
        });
      }
      if (result?.maintenanceWarning) {
        notify({
          title: "Worklog maintenance warning",
          body: sanitize(
            result.maintenanceWarning.safeMessage ||
              "Automation cleanup failed.",
          ),
        });
      }
      recoveryBlocked = failed.length > 0;
      reconciliationNeeded = false;
      return result;
    } catch (error) {
      recoveryBlocked = true;
      reconciliationNeeded = true;
      notify({
        title: "Worklog recovery failed",
        body: sanitize(error),
      });
      return { status: "failed", error: sanitize(error) };
    }
  }

  async function execute(input, workDate) {
    try {
      const result = await run(input);
      if (result?.outcome === "already_running" ||
          result?.status === "already_running") {
        return { outcome: "already_running" };
      }
      const payload = notificationFor(result);
      if (payload) notify(payload);
      if (
        workDate &&
        (result?.status === "success" || result?.status === "no_activity")
      ) {
        completedDates.add(workDate);
      }
      return result;
    } catch (error) {
      const message = sanitize(error);
      notify({ title: "Worklog failed", body: message });
      return { status: "failed", error: message };
    }
  }

  async function evaluate(now) {
    if (reconciliationNeeded) {
      const recovery = await reconcile();
      if (
        reconciliationNeeded ||
        recoveryBlocked ||
        recovery?.outcome === "already_running"
      ) {
        return recovery;
      }
    }

    const settings = await loadSettings();
    const status = await loadStatus();
    if (!settings.enabled) return { status };

    const timezone = clock.timezone ||
      Intl.DateTimeFormat().resolvedOptions().timeZone;
    const local = localParts(now, timezone);
    if (!settings.days.includes(local.weekday) || completedDates.has(local.date)) {
      return { status };
    }

    const latest = status.lastAttempt;
    if (latest?.workDate === local.date) {
      if (["success", "no_activity", "running"].includes(latest.status)) {
        return { status };
      }
      if (latest.status === "failed") {
        if (
          !latest.retryDueAt ||
          new Date(latest.retryDueAt).valueOf() > now.valueOf()
        ) {
          return { status };
        }
        return execute({
          trigger: "automatic",
          workDate: local.date,
          timezone,
        }, local.date);
      }
    }

    const [hour, minute] = settings.time.split(":").map(Number);
    if (local.minutes < hour * 60 + minute) return { status };
    return execute({
      trigger: "automatic",
      workDate: local.date,
      timezone,
    }, local.date);
  }

  function tick(now = clock.now()) {
    return exclusive(() => evaluate(new Date(now)));
  }

  function resume(now = clock.now()) {
    return exclusive(async () => {
      reconciliationNeeded = true;
      const recovery = await reconcile();
      if (
        reconciliationNeeded ||
        recoveryBlocked ||
        recovery?.outcome === "already_running"
      ) {
        return recovery;
      }
      return evaluate(new Date(now));
    });
  }

  function runNow(now = clock.now()) {
    return exclusive(() => {
      const timezone = clock.timezone ||
        Intl.DateTimeFormat().resolvedOptions().timeZone;
      const { date: workDate } = localParts(new Date(now), timezone);
      return execute({ trigger: "manual", workDate, timezone });
    });
  }

  function stop() {
    if (timer) clock.clearInterval(timer);
    timer = null;
  }

  function start() {
    return exclusive(async () => {
      const recovery = await reconcile();
      let result = recovery;
      if (
        !reconciliationNeeded &&
        !recoveryBlocked &&
        recovery?.outcome !== "already_running"
      ) {
        result = await evaluate(new Date(clock.now()));
      }
      if (!timer) {
        timer = clock.setInterval(() => {
          void tick();
        }, WAKE_INTERVAL_MS);
      }
      return result;
    });
  }

  return { start, stop, tick, resume, runNow };
}

module.exports = { createScheduler };
